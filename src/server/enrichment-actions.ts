"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "./session";
import { applyReview, mayReview } from "./enrichment-review";

/**
 * One reviewer's verdict on one proposal, from either review surface.
 *
 * Deliberately a single action for both the administrator's catalogue queue and
 * a user's own food page: who may decide what is `mayReview`'s answer, and
 * having one place to ask it is what keeps the two surfaces from drifting into
 * two different ideas of who owns a food.
 */
const decisionSchema = z.object({
  proposalId: z.string().min(1),
  /** Every value the form showed, ticked or not. */
  offered: z.array(z.string().min(1)).max(200).default([]),
  approve: z.array(z.string().min(1)).max(200).default([]),
  servingOffered: z.boolean(),
  servingApproved: z.boolean(),
});

export async function reviewEnrichmentAction(formData: FormData) {
  const user = await requireUser();

  const parsed = decisionSchema.safeParse({
    proposalId: String(formData.get("proposalId") ?? ""),
    offered: formData.getAll("offered").map(String),
    approve: formData.getAll("approve").map(String),
    servingOffered: formData.getAll("servingOffered").length > 0,
    servingApproved: String(formData.get("serving") ?? "") === "APPROVE",
  });
  if (!parsed.success) return;

  const proposal = await mayReview(parsed.data.proposalId, { id: user.id, isAdmin: user.role === "ADMIN" });
  // Silent on purpose: a proposal this user may not decide is not distinguished
  // from one that does not exist, the way an unreadable food is simply absent.
  if (!proposal) return;

  // An unticked checkbox posts nothing, so a refusal is the absence of a tick
  // against the ids the form did offer - never an empty list, which would let a
  // stale or truncated post silently reject everything.
  const approve = parsed.data.approve.filter((id) => parsed.data.offered.includes(id));
  const reject = parsed.data.offered.filter((id) => !approve.includes(id));

  await applyReview(proposal.id, user.id, {
    approve,
    reject,
    ...(parsed.data.servingOffered ? { serving: parsed.data.servingApproved ? ("APPROVE" as const) : ("REJECT" as const) } : {}),
  });

  revalidatePath("/admin");
  revalidatePath(`/foods/${proposal.foodId}`);
}
