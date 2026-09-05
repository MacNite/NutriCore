/**
 * Reviewing the nutrition the AI backfill proposes.
 *
 * Enrichment is the one AI path that used to write into shared data with nobody
 * confirming it. Everything else in the app produces something a person
 * approves - a quick meal, a recipe import, a body scan - which is the last
 * clause of the principle the worker states: "LLM interprets; sources provide
 * facts; code calculates; human approves". This module is that clause for
 * nutrition backfill.
 *
 * Who approves depends on whose data it is, and mirrors `visibleFoodWhere`: a
 * food somebody owns is reviewed by its owner, on the food's own page; the
 * shared catalogue is reviewed by an administrator. Nothing here lets an
 * administrator read a food they could not already open, which is the whole
 * reason the queue is split rather than pooled.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AI_ENRICHMENT_ORIGIN } from "@/lib/nutrients";
import { AI_ENRICHMENT_PROVIDER } from "./food-enrichment";

/** A value waiting for a decision, with everything the reviewer needs to judge it. */
export interface PendingValue {
  id: string;
  nutrientKey: string;
  value: number;
  /** Whether it is already the value on the food - true for pre-review backfill. */
  applied: boolean;
}

export interface PendingProposal {
  id: string;
  foodId: string;
  foodName: string;
  foodBrand: string | null;
  /** Null for a food nobody owns: the shared catalogue. */
  ownerId: string | null;
  sourceUrl: string | null;
  model: string | null;
  retrievedAt: Date;
  values: PendingValue[];
  servingSizeG: number | null;
  servingApplied: boolean;
}

const PROPOSAL_SELECT = {
  id: true,
  foodId: true,
  sourceUrl: true,
  model: true,
  retrievedAt: true,
  servingSizeG: true,
  servingApplied: true,
  servingStatus: true,
  food: { select: { name: true, brand: true, ownerId: true } },
  values: {
    where: { status: "PENDING" as const },
    select: { id: true, nutrientKey: true, value: true, applied: true },
    orderBy: { nutrientKey: "asc" as const },
  },
} satisfies Prisma.EnrichmentProposalSelect;

type ProposalRow = Prisma.EnrichmentProposalGetPayload<{ select: typeof PROPOSAL_SELECT }>;

const toPending = (row: ProposalRow): PendingProposal => ({
  id: row.id,
  foodId: row.foodId,
  foodName: row.food.name,
  foodBrand: row.food.brand,
  ownerId: row.food.ownerId,
  sourceUrl: row.sourceUrl,
  model: row.model,
  retrievedAt: row.retrievedAt,
  values: row.values.map((value) => ({
    id: value.id,
    nutrientKey: value.nutrientKey,
    value: Number(value.value),
    applied: value.applied,
  })),
  servingSizeG: row.servingStatus === "PENDING" && row.servingSizeG !== null ? Number(row.servingSizeG) : null,
  servingApplied: row.servingApplied,
});

/**
 * A proposal is only open while something on it is still undecided. Rows whose
 * every value has been settled stay as the audit record and leave the queue.
 */
const OPEN = {
  OR: [{ values: { some: { status: "PENDING" as const } } }, { servingStatus: "PENDING" as const, servingSizeG: { not: null } }],
};

/** The shared catalogue's queue: foods nobody owns. Administrators only. */
export async function catalogueProposals(limit = 50): Promise<PendingProposal[]> {
  const rows = await prisma.enrichmentProposal.findMany({
    where: { ...OPEN, food: { ownerId: null } },
    select: PROPOSAL_SELECT,
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map(toPending);
}

/** One user's own queue, for the foods they own. */
export async function ownedProposals(userId: string, foodId?: string): Promise<PendingProposal[]> {
  const rows = await prisma.enrichmentProposal.findMany({
    where: { ...OPEN, food: { ownerId: userId }, ...(foodId ? { foodId } : {}) },
    select: PROPOSAL_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPending);
}

export async function countCatalogueProposals(): Promise<number> {
  return prisma.enrichmentProposal.count({ where: { ...OPEN, food: { ownerId: null } } });
}

/**
 * Whether this reviewer may decide this proposal.
 *
 * The same rule as reading the food: its owner, or an administrator when it
 * belongs to nobody. An administrator is deliberately *not* allowed to decide a
 * food somebody owns - they cannot see it anywhere else in the app, and a
 * review queue is no reason to start.
 */
export async function mayReview(proposalId: string, reviewer: { id: string; isAdmin: boolean }) {
  const proposal = await prisma.enrichmentProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, foodId: true, food: { select: { ownerId: true } } },
  });
  if (!proposal) return null;
  const ownerId = proposal.food.ownerId;
  const allowed = ownerId === null ? reviewer.isAdmin : ownerId === reviewer.id;
  return allowed ? proposal : null;
}

export interface ReviewDecision {
  /** Value ids to accept. For an already-applied value this simply keeps it. */
  approve?: string[];
  /** Value ids to refuse. An applied one is taken back off the food. */
  reject?: string[];
  /** What to do with the proposed serving weight, when the proposal carries one. */
  serving?: "APPROVE" | "REJECT";
}

/**
 * Applies a reviewer's decisions.
 *
 * Approving writes the value only when it is not already there; the conditional
 * update is what keeps a real measured number, or a second reviewer's earlier
 * decision, from being overwritten by an approval made against a stale page.
 * Rejecting an applied value removes exactly the row the backfill wrote - it is
 * matched on `origin` as well, so a value a dataset has since supplied is never
 * deleted by somebody rejecting the model's older guess at it.
 */
export async function applyReview(
  proposalId: string,
  reviewerId: string,
  decision: ReviewDecision,
): Promise<{ approved: number; rejected: number }> {
  const approve = decision.approve ?? [];
  const reject = decision.reject ?? [];
  if (!approve.length && !reject.length && !decision.serving) return { approved: 0, rejected: 0 };

  return prisma.$transaction(async (tx) => {
    const proposal = await tx.enrichmentProposal.findUniqueOrThrow({
      where: { id: proposalId },
      select: { id: true, foodId: true, sourceUrl: true, model: true, servingSizeG: true },
    });
    const values = await tx.enrichmentProposalValue.findMany({
      where: { id: { in: [...approve, ...reject] }, proposalId, status: "PENDING" },
      select: { id: true, nutrientKey: true, value: true, applied: true },
    });
    const decided = new Date();
    const approvedKeys: string[] = [];
    let rejected = 0;

    for (const value of values) {
      if (approve.includes(value.id)) {
        if (!value.applied) {
          const updated = await tx.foodNutrient.updateMany({
            where: { foodId: proposal.foodId, nutrientKey: value.nutrientKey, value: null },
            data: { value: value.value, origin: AI_ENRICHMENT_ORIGIN },
          });
          if (!updated.count) {
            try {
              await tx.foodNutrient.create({
                data: { foodId: proposal.foodId, nutrientKey: value.nutrientKey, value: value.value, origin: AI_ENRICHMENT_ORIGIN },
              });
            } catch (error) {
              // Somebody filled it between the proposal and this click. Their
              // value stands; the decision is still recorded.
              if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
            }
          }
        }
        approvedKeys.push(value.nutrientKey);
        await tx.enrichmentProposalValue.update({
          where: { id: value.id },
          data: { status: "APPROVED", applied: true, reviewedById: reviewerId, reviewedAt: decided },
        });
      } else {
        if (value.applied) {
          await tx.foodNutrient.deleteMany({
            where: { foodId: proposal.foodId, nutrientKey: value.nutrientKey, origin: AI_ENRICHMENT_ORIGIN },
          });
        }
        rejected++;
        await tx.enrichmentProposalValue.update({
          where: { id: value.id },
          data: { status: "REJECTED", applied: false, reviewedById: reviewerId, reviewedAt: decided },
        });
      }
    }

    let servingApproved = false;
    if (decision.serving && proposal.servingSizeG !== null) {
      if (decision.serving === "APPROVE") {
        const updated = await tx.food.updateMany({
          where: { id: proposal.foodId, servingSize: null },
          data: { servingSize: proposal.servingSizeG, servingUnit: "g" },
        });
        servingApproved = updated.count > 0;
      }
      await tx.enrichmentProposal.update({
        where: { id: proposal.id },
        data: {
          servingStatus: decision.serving === "APPROVE" ? "APPROVED" : "REJECTED",
          servingApplied: decision.serving === "APPROVE" ? servingApproved : false,
        },
      });
    }

    // The provenance row the food page reads. Written on approval rather than on
    // extraction, so a URL is only ever cited for values somebody accepted.
    if (approvedKeys.length || servingApproved) {
      await tx.foodSource.create({
        data: {
          foodId: proposal.foodId,
          provider: AI_ENRICHMENT_PROVIDER,
          retrievedAt: decided,
          url: proposal.sourceUrl,
          estimated: true,
          model: proposal.model,
          metadata: { nutrientKeys: approvedKeys, servingSize: servingApproved, addedAt: decided.toISOString() },
        },
      });
    }

    return { approved: approvedKeys.length, rejected };
  });
}
