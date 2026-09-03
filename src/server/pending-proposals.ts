import { prisma } from "@/lib/db";
import { decideComponents, type ProposedComponent } from "./ai-types";

export interface PendingProposal {
  proposalId: string;
  /** The MealInput id, which is what `/ai-review/[id]` is keyed on. */
  ingestionInputId: string;
  text: string;
  /** What accepting would log, and what it would leave out. */
  summary: string;
  skipped: string[];
}

/**
 * Proposals this user still has to decide on, newest first.
 *
 * The summary is computed with the same `decideComponents` the approval uses, so
 * what the card promises and what accepting actually logs cannot drift apart.
 */
export async function pendingProposals(userId: string, limit = 5): Promise<PendingProposal[]> {
  const rows = await prisma.aiProposal.findMany({
    where: { approvalStatus: "PENDING", job: { userId, ingestionInput: { intent: "MEAL" } } },
    include: { job: { select: { entityId: true, ingestionInput: { select: { text: true } } } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.flatMap((row) => {
    const mealInput = row.job.ingestionInput;
    if (!mealInput) return [];

    const components = (row.proposed as { components?: ProposedComponent[] }).components ?? [];
    const { loggable, skipped } = decideComponents(components);

    return [
      {
        proposalId: row.id,
        ingestionInputId: row.job.entityId,
        text: mealInput.text,
        summary: loggable
          .map((entry) => `${entry.component.name} · ${Math.round(entry.grams)} g`)
          .join(" · "),
        skipped,
      },
    ];
  });
}
