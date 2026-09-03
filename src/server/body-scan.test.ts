import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, bodyScan, bodyScanEstimate, bodyMeasurement } = vi.hoisted(() => {
  const bodyScan = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const bodyScanEstimate = { deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const bodyMeasurement = { findUnique: vi.fn(), upsert: vi.fn() };
  const $transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)({ bodyScan, bodyScanEstimate, bodyMeasurement }) : arg,
  );
  return {
    bodyScan,
    bodyScanEstimate,
    bodyMeasurement,
    prismaMock: { bodyScan, bodyScanEstimate, bodyMeasurement, $transaction },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { cleanupExpiredScanImages, loadScanReview, runBodyScan } from "./body-scan";
import type { BodyScanProvider } from "@/providers/body-scan";

const IMAGE_CLEARED = {
  frontData: null,
  frontMime: null,
  sideData: null,
  sideMime: null,
  imagesExpireAt: null,
};

const scanRow = (overrides: Record<string, unknown> = {}) => ({
  id: "scan-1",
  userId: "user-1",
  date: new Date("2026-09-03T00:00:00.000Z"),
  state: "QUEUED",
  heightCm: "176",
  weightKg: "80",
  frontMime: "image/jpeg",
  frontData: Buffer.from([1, 2, 3]),
  sideMime: "image/jpeg",
  sideData: Buffer.from([4, 5, 6]),
  ...overrides,
});

/** A provider that answers with whatever the test wants, without touching sharp. */
function stubProvider(result: Partial<Awaited<ReturnType<BodyScanProvider["estimate"]>>> = {}): BodyScanProvider {
  return {
    name: "stub",
    estimate: vi.fn(async () => ({
      quality: { accepted: true, reasons: [] },
      measurements: [{ region: "waistCm" as const, valueCm: 82.4, lowerCm: 77.5, upperCm: 87.3 }],
      processor: { provider: "stub", model: "test", version: "0" },
      ...result,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bodyScan.updateMany.mockResolvedValue({ count: 1 });
  bodyScanEstimate.deleteMany.mockResolvedValue({ count: 0 });
});

describe("runBodyScan", () => {
  it("clears the images in the same transaction that stores the result", async () => {
    bodyScan.findUnique.mockResolvedValue(scanRow());

    await runBodyScan("scan-1", { provider: stubProvider() });

    const update = bodyScan.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "scan-1" });
    /* The whole privacy promise in one assertion: the bytes are gone by the
       time the estimates exist, not in a later pass that might not run. */
    expect(update.data).toMatchObject(IMAGE_CLEARED);
    expect(update.data.state).toBe("AWAITING_REVIEW");
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("stores each estimate with the interval the provider gave it", async () => {
    bodyScan.findUnique.mockResolvedValue(scanRow());

    await runBodyScan("scan-1", { provider: stubProvider() });

    expect(bodyScanEstimate.createMany).toHaveBeenCalledWith({
      data: [{ scanId: "scan-1", metricKey: "waistCm", valueCm: 82.4, lowerCm: 77.5, upperCm: 87.3 }],
    });
  });

  it("rejects a capture that failed its quality checks, and still clears the images", async () => {
    bodyScan.findUnique.mockResolvedValue(scanRow());
    const provider = stubProvider({
      quality: { accepted: false, reasons: ["too-small"] },
      measurements: [],
    });

    await runBodyScan("scan-1", { provider });

    const update = bodyScan.update.mock.calls[0][0];
    expect(update.data.state).toBe("REJECTED");
    expect(update.data.failureKind).toBe("quality-rejected");
    expect(update.data).toMatchObject(IMAGE_CLEARED);
  });

  it("refuses a scan whose images are already gone, rather than estimating from nothing", async () => {
    bodyScan.findUnique.mockResolvedValue(scanRow({ frontData: null }));
    await expect(runBodyScan("scan-1", { provider: stubProvider() })).rejects.toThrow("scan-images-gone");
  });

  it("refuses a scan that does not exist", async () => {
    bodyScan.findUnique.mockResolvedValue(null);
    await expect(runBodyScan("scan-1", { provider: stubProvider() })).rejects.toThrow("scan-not-found");
  });

  it("does not persist a mesh a provider happens to return", async () => {
    bodyScan.findUnique.mockResolvedValue(scanRow());
    const provider = stubProvider({ mesh: { format: "glb", data: Buffer.from([9]) } });

    await runBodyScan("scan-1", { provider });

    const update = bodyScan.update.mock.calls[0][0];
    expect(JSON.stringify(update.data)).not.toContain("mesh");
  });
});

describe("cleanupExpiredScanImages", () => {
  it("does nothing when no capture is past its deadline", async () => {
    bodyScan.findMany.mockResolvedValue([]);
    expect(await cleanupExpiredScanImages()).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("clears the images and expires a scan that was never processed", async () => {
    bodyScan.findMany.mockResolvedValue([
      { id: "scan-1", state: "QUEUED" },
      { id: "scan-2", state: "AWAITING_REVIEW" },
    ]);

    expect(await cleanupExpiredScanImages()).toBe(2);

    /* Both lose their images; only the unprocessed one becomes EXPIRED. A scan
       waiting on a person keeps its estimates - those are numbers, not pixels. */
    expect(bodyScan.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["scan-1", "scan-2"] } },
      data: IMAGE_CLEARED,
    });
    expect(bodyScan.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["scan-1"] } },
      data: { state: "EXPIRED", failureKind: "images-expired" },
    });
  });
});

describe("loadScanReview", () => {
  it("puts the recorded value beside each estimate, because that is the decision", async () => {
    bodyScan.findFirst.mockResolvedValue({
      ...scanRow({ state: "AWAITING_REVIEW", accepted: true, qualityReasons: [] }),
      provider: "silhouette",
      processorModel: "two-view-ellipse",
      version: "1.0.0",
      estimates: [
        { metricKey: "waistCm", valueCm: "82.4", lowerCm: "77.5", upperCm: "87.3" },
        { metricKey: "thighCm", valueCm: "56.0", lowerCm: "51.0", upperCm: "61.0" },
      ],
    });
    bodyMeasurement.findUnique.mockResolvedValue({ waistCm: "84.0", thighLeftCm: null });

    const review = await loadScanReview("user-1", "scan-1");

    expect(review!.estimates).toEqual([
      { metricKey: "waistCm", valueCm: 82.4, lowerCm: 77.5, upperCm: 87.3, currentCm: 84 },
      /* A paired region reads its current value from the left-hand column. */
      { metricKey: "thighCm", valueCm: 56, lowerCm: 51, upperCm: 61, currentCm: null },
    ]);
    expect(review!.processor).toEqual({ provider: "silhouette", model: "two-view-ellipse", version: "1.0.0" });
  });

  it("orders estimates head to toe rather than alphabetically", async () => {
    bodyScan.findFirst.mockResolvedValue({
      ...scanRow({ state: "AWAITING_REVIEW", accepted: true, qualityReasons: [] }),
      estimates: [
        { metricKey: "calfCm", valueCm: "38", lowerCm: "35", upperCm: "41" },
        { metricKey: "neckCm", valueCm: "38", lowerCm: "35", upperCm: "41" },
        { metricKey: "waistCm", valueCm: "82", lowerCm: "77", upperCm: "87" },
      ],
    });
    bodyMeasurement.findUnique.mockResolvedValue(null);

    const review = await loadScanReview("user-1", "scan-1");
    expect(review!.estimates.map((e) => e.metricKey)).toEqual(["neckCm", "waistCm", "calfCm"]);
  });

  it("is not found for someone else's scan", async () => {
    bodyScan.findFirst.mockResolvedValue(null);
    expect(await loadScanReview("user-2", "scan-1")).toBeNull();
  });
});
