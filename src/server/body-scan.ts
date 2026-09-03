import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { REGION_FIELDS, SCAN_REGIONS, type ScanRegion } from "@/lib/body-scan";
import { SilhouetteBodyScanProvider, type BodyScanProvider } from "@/providers/body-scan";

/**
 * Body-scan service: the state machine, and the rules about the images.
 *
 * Two things here are load-bearing and neither is the estimate. The first is
 * that the captured images are deleted in the same transaction that writes the
 * estimates, with a sweeper behind it for the crash that skips the transaction
 * entirely. The second is that a scan never writes a measurement: it produces
 * estimates, and only a person accepting one turns it into a recorded value.
 */

/**
 * The consent text a scan was captured under.
 *
 * Bumped whenever the copy makes a materially different promise, so an old scan
 * says what it was actually taken under rather than what the current wording
 * happens to say.
 */
export const BODY_SCAN_CONSENT_VERSION = "2026-09-03";

/**
 * How long captured images may wait for a worker before the sweeper clears
 * them. The same reasoning as `MEAL_IMAGE_TTL_MS`, and shorter still: two
 * near-unclothed photographs are the most sensitive bytes this app ever holds.
 */
export const BODY_SCAN_IMAGE_TTL_MS = 10 * 60 * 1000;

/** Scans a user may queue per hour, so a queue cannot be filled with images. */
export const BODY_SCAN_RATE = { limit: 12, windowMs: 60 * 60 * 1000 } as const;

const IMAGE_FIELDS = { frontData: null, frontMime: null, sideData: null, sideMime: null, imagesExpireAt: null } as const;

/**
 * Clears the captured images from a scan.
 *
 * Idempotent, and never throws into a caller's happy path: every terminal route
 * calls it, and a cleanup that failed loudly would turn a finished scan into a
 * retried one. A failure here is logged and left to the sweeper, which is
 * exactly what the sweeper is for.
 */
export async function discardScanImages(scanId: string) {
  try {
    await prisma.bodyScan.updateMany({ where: { id: scanId }, data: { ...IMAGE_FIELDS } });
  } catch (error) {
    logger.warn("Could not clear body-scan images", {
      scanId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Worker maintenance: images left behind by a crash, and captures nobody
 * finished.
 *
 * A scan still waiting for review keeps its estimates - they are numbers, not
 * pixels - and only loses the images. A scan that never got processed at all is
 * marked EXPIRED, because without its images it can never be processed now.
 */
export async function cleanupExpiredScanImages(now = new Date()) {
  const expired = await prisma.bodyScan.findMany({
    where: { imagesExpireAt: { lte: now }, OR: [{ frontData: { not: null } }, { sideData: { not: null } }] },
    select: { id: true, state: true },
  });
  if (!expired.length) return 0;

  const unprocessed = expired.filter((scan) => scan.state === "QUEUED" || scan.state === "PROCESSING");
  await prisma.$transaction([
    prisma.bodyScan.updateMany({ where: { id: { in: expired.map((scan) => scan.id) } }, data: { ...IMAGE_FIELDS } }),
    prisma.bodyScan.updateMany({
      where: { id: { in: unprocessed.map((scan) => scan.id) } },
      data: { state: "EXPIRED", failureKind: "images-expired" },
    }),
  ]);
  logger.warn("Swept body-scan images past their deadline", { count: expired.length });
  return expired.length;
}

/**
 * Runs one scan, in the worker. Throws on failure so the AI job's retry budget
 * and failure classification apply to it like any other job.
 *
 * The images are read once and cleared in the transaction that stores the
 * result. A retry therefore cannot re-read them - which is deliberate: a scan
 * whose first attempt read the images and then failed has nothing left to try,
 * and `describeFailure` treats a missing capture as permanent rather than
 * spending two more attempts on it.
 */
export async function runBodyScan(scanId: string, deps: { provider?: BodyScanProvider } = {}) {
  const scan = await prisma.bodyScan.findUnique({ where: { id: scanId } });
  if (!scan) throw new Error("scan-not-found");
  if (!scan.frontData || !scan.sideData || !scan.frontMime || !scan.sideMime) throw new Error("scan-images-gone");

  await prisma.bodyScan.updateMany({ where: { id: scanId, state: "QUEUED" }, data: { state: "PROCESSING" } });

  const provider = deps.provider ?? new SilhouetteBodyScanProvider();
  const result = await provider.estimate({
    front: { mime: scan.frontMime, data: Buffer.from(scan.frontData) },
    side: { mime: scan.sideMime, data: Buffer.from(scan.sideData) },
    heightCm: Number(scan.heightCm),
    weightKg: scan.weightKg === null ? null : Number(scan.weightKg),
  });

  /* A provider that returned a mesh is not an invitation to store one: keeping
     a reconstructed body needs its own consent, so it is dropped here and the
     fact is recorded rather than silently ignored. */
  if (result.mesh) logger.info("Discarded a body-scan mesh; retention is not implemented", { scanId });

  await prisma.$transaction([
    prisma.bodyScanEstimate.deleteMany({ where: { scanId } }),
    prisma.bodyScanEstimate.createMany({
      data: result.measurements.map((measurement) => ({
        scanId,
        metricKey: measurement.region,
        valueCm: measurement.valueCm,
        lowerCm: measurement.lowerCm,
        upperCm: measurement.upperCm,
      })),
    }),
    prisma.bodyScan.update({
      where: { id: scanId },
      data: {
        /* A capture that failed its quality checks is finished, not pending:
           there is nothing to review and the user needs a retake, not a list. */
        state: result.quality.accepted ? "AWAITING_REVIEW" : "REJECTED",
        accepted: result.quality.accepted,
        qualityReasons: result.quality.reasons,
        provider: result.processor.provider,
        processorModel: result.processor.model,
        version: result.processor.version,
        processedAt: new Date(),
        failureKind: result.quality.accepted ? null : "quality-rejected",
        /* Read once, gone in the same transaction. */
        ...IMAGE_FIELDS,
      },
    }),
  ]);

  return { accepted: result.quality.accepted, count: result.measurements.length };
}

export interface ScanReviewEstimate {
  metricKey: ScanRegion;
  valueCm: number;
  lowerCm: number;
  upperCm: number;
  /** What the day's check-in already holds for this region, for comparison. */
  currentCm: number | null;
}

export interface ScanReview {
  id: string;
  date: string;
  state: string;
  quality: { accepted: boolean; reasons: string[] };
  processor: { provider: string; model: string; version: string } | null;
  estimates: ScanReviewEstimate[];
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/**
 * One scan, ready to be shown beside what is already recorded.
 *
 * The existing value travels with each estimate because the decision the user
 * is making is a comparison, not a reading: "34 cm" means little, and "34 cm
 * where you measured 36 cm by hand last week" means a great deal.
 */
export async function loadScanReview(userId: string, scanId: string): Promise<ScanReview | null> {
  const scan = await prisma.bodyScan.findFirst({
    where: { id: scanId, userId },
    include: { estimates: { orderBy: { metricKey: "asc" } } },
  });
  if (!scan) return null;

  const existing = await prisma.bodyMeasurement.findUnique({
    where: { userId_date: { userId, date: scan.date } },
  });

  const order = new Map(SCAN_REGIONS.map((region, index) => [region as string, index]));
  const estimates = scan.estimates
    .filter((estimate) => order.has(estimate.metricKey))
    .sort((a, b) => (order.get(a.metricKey) ?? 0) - (order.get(b.metricKey) ?? 0))
    .map((estimate) => {
      const region = estimate.metricKey as ScanRegion;
      /* A paired region fills both columns, so the left one represents it. */
      const field = REGION_FIELDS[region][0] as keyof typeof existing;
      const current = existing?.[field];
      return {
        metricKey: region,
        valueCm: Number(estimate.valueCm),
        lowerCm: Number(estimate.lowerCm),
        upperCm: Number(estimate.upperCm),
        currentCm: current == null ? null : Number(current),
      };
    });

  return {
    id: scan.id,
    date: dateKey(scan.date),
    state: scan.state,
    quality: {
      accepted: scan.accepted,
      reasons: Array.isArray(scan.qualityReasons) ? (scan.qualityReasons as string[]) : [],
    },
    processor: scan.provider
      ? { provider: scan.provider, model: scan.processorModel ?? "", version: scan.version ?? "" }
      : null,
    estimates,
  };
}

/** The scan a user should be shown next, if any is waiting on them. */
export async function pendingScan(userId: string) {
  return prisma.bodyScan.findFirst({
    where: { userId, state: { in: ["QUEUED", "PROCESSING", "AWAITING_REVIEW"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, state: true, createdAt: true },
  });
}
