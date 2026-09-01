"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveAiModel } from "@/lib/env";
import { requireUser } from "./session";
import { checkUrl } from "@/lib/url-guard";
import { validDateKey } from "@/lib/date";
import { applyProposal } from "./ai-approval";
import { jobPriority } from "./ai-types";
import { hasMealInput, validateMealImage, type MealImageError } from "./meal-image";

export type MealInputError = MealImageError | "inputRequired" | "unsafeUrl";

export async function queueMealInputAction(formData: FormData) {
  const user = await requireUser();
  const dateValue = validDateKey(String(formData.get("date")));
  const back = (error: MealInputError) => {
    const query = new URLSearchParams({ date: dateValue, error, quickMeal: "1" });
    redirect(`/?${query}`);
  };
  let image;
  try {
    image = await validateMealImage(formData.get("image"));
  } catch (error) {
    const code = error instanceof Error ? error.message : "imageInvalid";
    back((code === "imageEmpty" || code === "imageTooLarge" ? code : "imageInvalid") as MealImageError);
  }
  const parsed = z
    .object({
      text: z.string().trim().max(2000).refine((value) => !value || value.length >= 2),
      sourceUrl: z.string().trim().max(500).optional(),
      meal: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]),
      servings: z.coerce.number().positive().max(10_000),
      date: z.string(),
      returnTo: z.literal("/").default("/"),
    })
    .parse(Object.fromEntries([...formData.entries()].filter(([key]) => key !== "image")));

  const date = validDateKey(parsed.date);
  if (!hasMealInput(parsed.text, parsed.sourceUrl ?? "", image ?? null)) back("inputRequired");

  if (parsed.sourceUrl) {
    const safe = await checkUrl(parsed.sourceUrl);
    // Back to where the form was submitted from, not to an unrelated feature.
    if (!safe.ok) {
      back("unsafeUrl");
    }
  }

  const input = await prisma.mealInput.create({
    data: {
      userId: user.id,
      text: parsed.text,
      sourceUrl: parsed.sourceUrl || null,
      meal: parsed.meal,
      diaryDate: new Date(`${date}T00:00:00.000Z`),
      servings: parsed.servings,
      imageMime: image?.mime ?? null,
      imageData: image?.data ?? null,
      imageExpiresAt: image?.expiresAt ?? null,
    },
  });
  await prisma.aiJob.create({
    data: {
      userId: user.id,
      entityType: "MEAL_INPUT",
      entityId: input.id,
      mealInputId: input.id,
      model: resolveAiModel(),
      // A meal the user is watching for goes ahead of background enrichment.
      priority: jobPriority("MEAL_INPUT"),
    },
  });
  redirect(`/ai-review/${input.id}?queued=1`);
}

/**
 * Approving a proposal is what writes it to the diary. The rules and the writing
 * live in `ai-approval.ts`, shared with the one-click accept and with the worker
 * for users who asked not to review every meal; this only reads the reviewer's
 * per-component choices out of the form.
 */
export async function reviewAiProposalAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("proposalId"));
  const decision = String(formData.get("decision"));

  // Scoped to this user's own proposal: the id comes from a form field.
  const proposal = await prisma.aiProposal.findFirst({
    where: { id, job: { userId: user.id } },
    include: { job: { select: { entityId: true } } },
  });
  if (!proposal || proposal.approvalStatus !== "PENDING") throw new Error("Proposal is not awaiting review");

  if (decision !== "accept") {
    await prisma.aiProposal.update({
      where: { id },
      data: { approvalStatus: "REJECTED", accepted: Prisma.DbNull, reviewedAt: new Date() },
    });
    redirect(`/ai-review/${proposal.job.entityId}`);
  }

  // One radio group per component, named by its index. An absent field leaves
  // the resolver's own choice standing, which is what a form submitted without
  // JavaScript does for a component that offered only one option.
  await applyProposal(id, {
    selection: (index) => {
      const raw = formData.get(`component-${index}`);
      return raw === null ? undefined : String(raw);
    },
  });

  redirect(`/ai-review/${proposal.job.entityId}`);
}

/**
 * Accepts a proposal in one click, from wherever it is surfaced, taking the
 * resolver's own choices. The review screen is for changing them; this is for
 * the far more common case of agreeing with them.
 */
export async function acceptAiProposalAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("proposalId"));
  const returnTo = "/";

  const owned = await prisma.aiProposal.findFirst({ where: { id, job: { userId: user.id } }, select: { id: true } });
  if (!owned) throw new Error("Proposal not found");

  await applyProposal(id);
  redirect(returnTo);
}

/** Declines a proposal in one click, leaving the diary untouched. */
export async function rejectAiProposalAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("proposalId"));
  const returnTo = "/";

  await prisma.aiProposal.updateMany({
    where: { id, approvalStatus: "PENDING", job: { userId: user.id } },
    data: { approvalStatus: "REJECTED", accepted: Prisma.DbNull, reviewedAt: new Date() },
  });
  redirect(returnTo);
}
