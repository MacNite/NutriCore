import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, bodyScan, bodyScanEstimate, bodyMeasurement } = vi.hoisted(() => {
  const bodyScan = { findFirst: vi.fn(), update: vi.fn() };
  const bodyScanEstimate = { update: vi.fn(), updateMany: vi.fn() };
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));

import { applyBodyScanAction } from "./body-scan-actions";

const DATE = new Date("2026-09-03T00:00:00.000Z");

const estimate = (metricKey: string, valueCm: string) => ({
  id: `est-${metricKey}`,
  metricKey,
  valueCm,
  lowerCm: "0",
  upperCm: "0",
});

function awaitingReview(estimates = [estimate("waistCm", "82.4"), estimate("chestCm", "98.0")]) {
  bodyScan.findFirst.mockResolvedValue({
    id: "scan-1",
    userId: "user-1",
    date: DATE,
    state: "AWAITING_REVIEW",
    estimates,
  });
}

/** The form the review screen actually submits. */
function form(accepted: string[], edits: Record<string, string> = {}) {
  const data = new FormData();
  data.set("scanId", "scan-1");
  for (const region of accepted) {
    data.set(`accept:${region}`, "on");
    data.set(`value:${region}`, edits[region] ?? "");
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  bodyMeasurement.findUnique.mockResolvedValue(null);
});

describe("applyBodyScanAction", () => {
  it("writes only the values the user ticked", async () => {
    awaitingReview();

    expect(await applyBodyScanAction({}, form(["waistCm"]))).toEqual({ ok: true });

    const upsert = bodyMeasurement.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({ waistCm: 82.4 });
    /* The chest estimate existed and was not ticked, so it is not written at
       all - the field keeps whatever it held. */
    expect(upsert.update).not.toHaveProperty("chestCm");
  });

  it("records an untouched estimate as a scan value and an edited one as manual", async () => {
    awaitingReview();

    await applyBodyScanAction({}, form(["waistCm", "chestCm"], { chestCm: "96.5" }));

    const upsert = bodyMeasurement.upsert.mock.calls[0][0];
    expect(upsert.update.waistCm).toBe(82.4);
    expect(upsert.update.chestCm).toBe(96.5);
    /* A number the user typed is their measurement, whatever prompted it. */
    expect(upsert.update.valueSources).toMatchObject({ waistCm: "OPTICAL_SCAN", chestCm: "MANUAL" });
  });

  it("fills both sides for a paired region, which a photo cannot tell apart", async () => {
    awaitingReview([estimate("thighCm", "56.0")]);

    await applyBodyScanAction({}, form(["thighCm"]));

    const upsert = bodyMeasurement.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({ thighLeftCm: 56, thighRightCm: 56 });
    expect(upsert.update.valueSources).toMatchObject({
      thighLeftCm: "OPTICAL_SCAN",
      thighRightCm: "OPTICAL_SCAN",
    });
  });

  it("keeps provenance for values this scan did not touch", async () => {
    awaitingReview();
    bodyMeasurement.findUnique.mockResolvedValue({ valueSources: { hipCm: "OPTICAL_SCAN" } });

    await applyBodyScanAction({}, form(["waistCm"]));

    const upsert = bodyMeasurement.upsert.mock.calls[0][0];
    /* An earlier scan's badge is not erased by a later one that skipped it. */
    expect(upsert.update.valueSources).toEqual({ hipCm: "OPTICAL_SCAN", waistCm: "OPTICAL_SCAN" });
  });

  it("keeps the estimate whatever the user decided, so a correction stays visible", async () => {
    awaitingReview();

    await applyBodyScanAction({}, form(["waistCm", "chestCm"], { chestCm: "96.5" }));

    const decisions = Object.fromEntries(
      bodyScanEstimate.update.mock.calls.map((call) => [call[0].where.id, call[0].data]),
    );
    expect(decisions["est-waistCm"]).toEqual({ decision: "ACCEPTED", acceptedCm: "82.4" });
    expect(decisions["est-chestCm"]).toEqual({ decision: "EDITED", acceptedCm: 96.5 });
  });

  it("marks an estimate the user left out as rejected", async () => {
    awaitingReview();

    await applyBodyScanAction({}, form(["waistCm"]));

    const chest = bodyScanEstimate.update.mock.calls.find((call) => call[0].where.id === "est-chestCm");
    expect(chest![0].data).toEqual({ decision: "REJECTED", acceptedCm: null });
  });

  it("treats accepting nothing as a decision, not as an unfinished review", async () => {
    awaitingReview();

    expect(await applyBodyScanAction({}, form([]))).toEqual({ ok: true });

    expect(bodyMeasurement.upsert).not.toHaveBeenCalled();
    expect(bodyScan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "REJECTED" }) }),
    );
  });

  it("marks the scan accepted once values have been merged", async () => {
    awaitingReview();

    await applyBodyScanAction({}, form(["waistCm"]));

    expect(bodyScan.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "scan-1" }, data: expect.objectContaining({ state: "ACCEPTED" }) }),
    );
  });

  it("refuses a scan that was already reviewed, so a resubmit cannot write twice", async () => {
    bodyScan.findFirst.mockResolvedValue({ id: "scan-1", date: DATE, state: "ACCEPTED", estimates: [] });

    expect(await applyBodyScanAction({}, form(["waistCm"]))).toEqual({ error: "already-reviewed" });
    expect(bodyMeasurement.upsert).not.toHaveBeenCalled();
  });

  it("is not found for someone else's scan", async () => {
    bodyScan.findFirst.mockResolvedValue(null);
    expect(await applyBodyScanAction({}, form(["waistCm"]))).toEqual({ error: "notFound" });
  });

  it("rejects an edited value outside the range a body can be", async () => {
    awaitingReview();
    expect(await applyBodyScanAction({}, form(["waistCm"], { waistCm: "900" }))).toEqual({ error: "validation" });
    expect(bodyMeasurement.upsert).not.toHaveBeenCalled();
  });
});
