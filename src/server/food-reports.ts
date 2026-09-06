/**
 * Members reporting wrong nutrition on a shared food, and an administrator
 * deciding what to do about it.
 *
 * This is the mirror image of `enrichment-review`. There a model proposes a
 * value and a person decides; here a person proposes and an administrator
 * decides. Both end in the same two writes - the value on the food, and a
 * `FoodSource` row saying where it came from - so that a number is never in the
 * catalogue without something stating how it got there.
 *
 * Three rules shape the whole module:
 *
 *  - **Only foods nobody owns can be reported.** The same rule the review queue
 *    is split on: a food somebody created is theirs to fix, and an
 *    administrator has no business reading it. A report is therefore always
 *    about the shared catalogue, and always lands in the one shared queue.
 *  - **A correction overwrites.** Enrichment only ever fills a gap, because a
 *    model must not talk over a measured number. A report is the opposite case:
 *    the stored number is precisely what is being disputed, and a reviewer who
 *    accepts it means it. The overwritten value is kept on the report and in the
 *    source row, so the decision can be read back afterwards.
 *  - **Nothing rewrites a logged meal.** Every diary entry froze its nutrition
 *    when it was logged, so a correction changes what will be logged from now
 *    on and never what somebody already ate.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EDITABLE_KEYS, USER_REPORT_ORIGIN } from "@/lib/nutrients";

/** `FoodSource.provider` for the audit row an accepted report writes. */
export const USER_REPORT_PROVIDER = "USER_REPORT";

/** Why a report could not be filed. Each one is something to tell the reporter. */
export type FoodReportRefusal = "notReportable" | "duplicate" | "empty";

export class FoodReportError extends Error {
  constructor(readonly reason: FoodReportRefusal) {
    super(reason);
    this.name = "FoodReportError";
  }
}

export interface ReportInput {
  /** What the reporter says is wrong, in their own words. */
  comment: string | null;
  /** A page backing the proposed values. Already validated by the caller. */
  sourceUrl: string | null;
  /** A corrected serving weight, in the food's own basis unit. */
  servingSize: number | null;
  values: { nutrientKey: string; value: number }[];
}

const asNumber = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

/**
 * Files one report.
 *
 * The current values are snapshotted onto the report rather than read again at
 * review time: a reviewer has to see what the reporter actually disagreed with,
 * which is not necessarily what the food says by the time anyone looks.
 *
 * A proposed value equal to the one already stored is dropped rather than
 * refused - it is the shape a half-filled form takes, not a correction - and a
 * report left with nothing at all to say is refused as empty.
 */
export async function submitFoodReport(userId: string, foodId: string, input: ReportInput) {
  const food = await prisma.food.findFirst({
    where: { id: foodId, ownerId: null },
    select: { id: true },
  });
  // A food somebody owns, or one this instance does not have, is simply not
  // reportable. Not distinguished from each other, for the same reason an
  // unreadable food is absent rather than forbidden.
  if (!food) throw new FoodReportError("notReportable");

  const open = await prisma.foodReport.findFirst({
    where: { foodId, reporterId: userId, status: "OPEN" },
    select: { id: true },
  });
  // A second open report on the same food from the same person is a double
  // click or a second thought, and either way the queue should carry one.
  if (open) throw new FoodReportError("duplicate");

  const keys = input.values.map((value) => value.nutrientKey).filter((key) => EDITABLE_KEYS.includes(key));
  const current = new Map(
    (
      await prisma.foodNutrient.findMany({
        where: { foodId, nutrientKey: { in: keys } },
        select: { nutrientKey: true, value: true },
      })
    ).map((row) => [row.nutrientKey, asNumber(row.value)]),
  );

  const values = input.values
    .filter((value) => EDITABLE_KEYS.includes(value.nutrientKey))
    .filter((value) => current.get(value.nutrientKey) !== value.value)
    .map((value) => ({
      nutrientKey: value.nutrientKey,
      currentValue: current.get(value.nutrientKey) ?? null,
      proposedValue: value.value,
    }));

  const comment = input.comment?.trim() || null;
  if (!values.length && input.servingSize === null && !comment) throw new FoodReportError("empty");

  return prisma.foodReport.create({
    data: {
      foodId,
      reporterId: userId,
      comment,
      sourceUrl: input.sourceUrl,
      // `servingStatus` is only ever read alongside a serving weight, exactly
      // as `EnrichmentProposal` reads its own: a null size is a report that
      // says nothing about the portion, not one whose portion was refused.
      servingSize: input.servingSize,
      values: { createMany: { data: values } },
    },
    select: { id: true },
  });
}

export interface QueuedReportValue {
  id: string;
  nutrientKey: string;
  /** What the food said when the report was filed. Null when it said nothing. */
  currentValue: number | null;
  proposedValue: number;
  /** What the food says now, if that is no longer the snapshotted value. */
  liveValue: number | null;
}

export interface QueuedReport {
  id: string;
  foodId: string;
  foodName: string;
  foodBrand: string | null;
  /** g or ml, so the serving weight is offered in the food's own unit. */
  basisUnit: "G" | "ML";
  reporterName: string;
  comment: string | null;
  sourceUrl: string | null;
  servingSize: number | null;
  currentServingSize: number | null;
  createdAt: Date;
  values: QueuedReportValue[];
}

const QUEUE_SELECT = {
  id: true,
  foodId: true,
  comment: true,
  sourceUrl: true,
  servingSize: true,
  createdAt: true,
  food: {
    select: {
      name: true,
      brand: true,
      basisUnit: true,
      servingSize: true,
      nutrients: { select: { nutrientKey: true, value: true } },
    },
  },
  reporter: { select: { username: true, profile: { select: { displayName: true } } } },
  values: {
    where: { status: "OPEN" as const },
    select: { id: true, nutrientKey: true, currentValue: true, proposedValue: true },
    orderBy: { nutrientKey: "asc" as const },
  },
} satisfies Prisma.FoodReportSelect;

type QueueRow = Prisma.FoodReportGetPayload<{ select: typeof QUEUE_SELECT }>;

const toQueued = (row: QueueRow): QueuedReport => {
  const live = new Map(row.food.nutrients.map((nutrient) => [nutrient.nutrientKey, asNumber(nutrient.value)]));
  return {
    id: row.id,
    foodId: row.foodId,
    foodName: row.food.name,
    foodBrand: row.food.brand,
    basisUnit: row.food.basisUnit,
    reporterName: row.reporter.profile?.displayName ?? row.reporter.username,
    comment: row.comment,
    sourceUrl: row.sourceUrl,
    servingSize: asNumber(row.servingSize),
    currentServingSize: asNumber(row.food.servingSize),
    createdAt: row.createdAt,
    values: row.values.map((value) => {
      const snapshot = asNumber(value.currentValue);
      const now = live.get(value.nutrientKey) ?? null;
      return {
        id: value.id,
        nutrientKey: value.nutrientKey,
        currentValue: snapshot,
        proposedValue: Number(value.proposedValue),
        // Only when it has moved since: a reviewer deciding against a stale
        // page should be told so rather than left to overwrite blind.
        liveValue: now === snapshot ? null : now,
      };
    }),
  };
};

/** The queue itself. Administrators only - every report is about shared data. */
export async function openReports(limit = 50): Promise<QueuedReport[]> {
  const rows = await prisma.foodReport.findMany({
    where: { status: "OPEN" },
    select: QUEUE_SELECT,
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map(toQueued);
}

export async function countOpenReports(): Promise<number> {
  return prisma.foodReport.count({ where: { status: "OPEN" } });
}

export interface OwnReport {
  id: string;
  status: "OPEN" | "ACCEPTED" | "REJECTED";
  createdAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
  values: { nutrientKey: string; proposedValue: number; decidedValue: number | null; status: string }[];
}

/**
 * What this member has already reported about this food.
 *
 * Shown on the food's own page, which is the only place a reporter would look:
 * a report that vanishes on submit is indistinguishable from one that was never
 * filed, and an instance with one administrator can take a while to answer.
 */
export async function ownReportsForFood(userId: string, foodId: string): Promise<OwnReport[]> {
  const rows = await prisma.foodReport.findMany({
    where: { foodId, reporterId: userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      reviewNote: true,
      values: { select: { nutrientKey: true, proposedValue: true, decidedValue: true, status: true }, orderBy: { nutrientKey: "asc" } },
    },
  });
  return rows.map((row) => ({
    ...row,
    values: row.values.map((value) => ({
      nutrientKey: value.nutrientKey,
      proposedValue: Number(value.proposedValue),
      decidedValue: asNumber(value.decidedValue),
      status: value.status,
    })),
  }));
}

/** Whether anybody has an undecided report on this food, for the notice on it. */
export async function hasOpenReport(foodId: string): Promise<boolean> {
  return (await prisma.foodReport.count({ where: { foodId, status: "OPEN" } })) > 0;
}

export interface ReportDecision {
  /** Values to write, with the number the reviewer actually settled on. */
  accept?: { id: string; value: number }[];
  /** Values the reviewer refused. The food keeps what it has. */
  reject?: string[];
  serving?: "ACCEPT" | "REJECT";
  /** The serving weight to write, when the reviewer revised the proposal. */
  servingValue?: number;
  /** What the reporter is told about the decision. */
  note?: string | null;
}

export interface ReportOutcome {
  /** The food the decision touched, so the caller can revalidate its page. */
  foodId: string | null;
  accepted: number;
  rejected: number;
  servingApplied: boolean;
}

/**
 * Applies an administrator's decision to one report.
 *
 * The reviewer's own number is written, not the reporter's: the queue exists to
 * produce a decision, and "nearly right, but 148 not 152" is a decision the
 * form has to be able to express. Whatever is written, the value the food used
 * to hold is recorded on the report and cited in the source row, so an
 * overwrite is never silent.
 *
 * A report nobody accepted anything from ends REJECTED, which is what keeps the
 * queue finite; the values themselves keep their own verdicts, so a report where
 * one value was right and three were wrong reads correctly afterwards.
 */
export async function decideFoodReport(
  reportId: string,
  reviewerId: string,
  decision: ReportDecision,
): Promise<ReportOutcome> {
  const accept = decision.accept ?? [];
  const reject = decision.reject ?? [];

  return prisma.$transaction(async (tx) => {
    const report = await tx.foodReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        foodId: true,
        status: true,
        sourceUrl: true,
        servingSize: true,
        servingStatus: true,
        food: { select: { basisUnit: true } },
      },
    });
    // Already decided, or gone. Deciding twice would overwrite the food a
    // second time with numbers nobody looked at again.
    if (!report || report.status !== "OPEN") return { foodId: null, accepted: 0, rejected: 0, servingApplied: false };

    const ids = [...accept.map((value) => value.id), ...reject];
    const values = await tx.foodReportValue.findMany({
      where: { id: { in: ids }, reportId, status: "OPEN" },
      select: { id: true, nutrientKey: true, proposedValue: true },
    });
    const settled = new Map(accept.map((value) => [value.id, value.value]));
    const decided = new Date();
    const applied: { key: string; value: number; previous: number | null }[] = [];
    let rejected = 0;

    for (const value of values) {
      if (!settled.has(value.id)) {
        rejected++;
        await tx.foodReportValue.update({ where: { id: value.id }, data: { status: "REJECTED" } });
        continue;
      }

      const written = settled.get(value.id) as number;
      const existing = await tx.foodNutrient.findUnique({
        where: { foodId_nutrientKey: { foodId: report.foodId, nutrientKey: value.nutrientKey } },
        select: { value: true },
      });
      // The source's own raw figure and its qualifier described the number that
      // is being replaced, so they go with it: leaving them would make the row
      // claim a provenance for a value that no longer came from there.
      await tx.foodNutrient.upsert({
        where: { foodId_nutrientKey: { foodId: report.foodId, nutrientKey: value.nutrientKey } },
        create: { foodId: report.foodId, nutrientKey: value.nutrientKey, value: written, origin: USER_REPORT_ORIGIN },
        update: { value: written, sourceValue: null, sourceUnit: null, qualifier: null, origin: USER_REPORT_ORIGIN },
      });
      applied.push({ key: value.nutrientKey, value: written, previous: asNumber(existing?.value ?? null) });
      await tx.foodReportValue.update({
        where: { id: value.id },
        data: { status: "ACCEPTED", decidedValue: written },
      });
    }

    let servingApplied = false;
    let servingStatus = report.servingStatus;
    if (report.servingSize !== null && report.servingStatus === "OPEN" && decision.serving) {
      if (decision.serving === "ACCEPT") {
        const size = decision.servingValue ?? Number(report.servingSize);
        await tx.food.update({
          where: { id: report.foodId },
          // Stated in the food's own basis unit, because that is the unit the
          // reporter read it in and the only one the food measures in.
          data: { servingSize: size, servingUnit: report.food.basisUnit === "ML" ? "ml" : "g" },
        });
        servingApplied = true;
        servingStatus = "ACCEPTED";
      } else {
        servingStatus = "REJECTED";
      }
    }

    await tx.foodReport.update({
      where: { id: report.id },
      data: {
        status: applied.length || servingApplied ? "ACCEPTED" : "REJECTED",
        servingStatus,
        reviewedById: reviewerId,
        reviewedAt: decided,
        reviewNote: decision.note?.trim() || null,
      },
    });

    // The provenance row the food page reads. Written on the decision rather
    // than on the report, so a citation only ever describes values that are
    // actually on the food - and it carries what each of them replaced.
    if (applied.length || servingApplied) {
      await tx.foodSource.create({
        data: {
          foodId: report.foodId,
          provider: USER_REPORT_PROVIDER,
          retrievedAt: decided,
          url: report.sourceUrl,
          estimated: false,
          metadata: {
            reportId: report.id,
            reviewedById: reviewerId,
            nutrientKeys: applied.map((value) => value.key),
            replaced: Object.fromEntries(applied.map((value) => [value.key, value.previous])),
            servingSize: servingApplied,
          },
        },
      });
    }

    return { foodId: report.foodId, accepted: applied.length, rejected, servingApplied };
  });
}
