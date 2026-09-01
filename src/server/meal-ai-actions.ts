"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAiModel } from "@/lib/env";
import { requireUser } from "./session";
import { addDiaryEntry, formatDateKey } from "./diary";
import { checkUrl } from "@/lib/url-guard";
import { validDateKey } from "@/lib/date";
import { partitionComponents, type AcceptedOutcome, type ProposedComponent } from "./ai-types";

export async function queueMealInputAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z
    .object({
      text: z.string().trim().min(2).max(2000),
      sourceUrl: z.string().trim().max(500).optional(),
      meal: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]),
      date: z.string(),
      returnTo: z.enum(["/", "/diary"]).default("/diary"),
    })
    .parse(Object.fromEntries(formData));

  const date = validDateKey(parsed.date);

  if (parsed.sourceUrl) {
    const safe = await checkUrl(parsed.sourceUrl);
    // Back to where the form was submitted from, not to an unrelated feature.
    if (!safe.ok) {
      const query = new URLSearchParams({ date, error: "unsafeUrl" });
      if (parsed.returnTo === "/") query.set("quickMeal", "1");
      redirect(`${parsed.returnTo}?${query}`);
    }
  }

  const input = await prisma.mealInput.create({
    data: {
      userId: user.id,
      text: parsed.text,
      sourceUrl: parsed.sourceUrl || null,
      meal: parsed.meal,
      diaryDate: new Date(`${date}T00:00:00.000Z`),
    },
  });
  await prisma.aiJob.create({
    data: {
      userId: user.id,
      entityType: "MEAL_INPUT",
      entityId: input.id,
      mealInputId: input.id,
      model: resolveAiModel(),
    },
  });
  redirect(`/ai-review/${input.id}?queued=1`);
}

/**
 * Approving a proposal is what finally writes to the diary. Only components the
 * worker matched to a food the user can see are logged, and each one goes
 * through `addDiaryEntry`, so it freezes a nutrition snapshot exactly like a
 * manually logged entry. Everything else is reported back as skipped rather
 * than guessed at.
 */
export async function reviewAiProposalAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("proposalId"));
  const decision = String(formData.get("decision"));

  const proposal = await prisma.aiProposal.findFirst({
    where: { id, job: { userId: user.id } },
    include: { job: { include: { mealInput: true } } },
  });
  if (!proposal || proposal.approvalStatus !== "PENDING") throw new Error("Proposal is not awaiting review");

  if (decision !== "accept") {
    await prisma.aiProposal.update({
      where: { id },
      data: { approvalStatus: "REJECTED", accepted: Prisma.DbNull, reviewedAt: new Date() },
    });
    redirect(`/ai-review/${proposal.job.entityId}`);
  }

  const mealInput = proposal.job.mealInput;
  if (!mealInput) throw new Error("Proposal has no meal to log against");

  const components = (proposal.proposed as { components?: ProposedComponent[] }).components ?? [];
  const { loggable, skipped } = partitionComponents(components);
  const date = formatDateKey(mealInput.diaryDate);
  const logged: string[] = [];

  for (const component of loggable) {
    try {
      await addDiaryEntry({
        userId: user.id,
        date,
        meal: mealInput.meal,
        foodId: component.canonicalFoodId!,
        quantity: component.estimatedGrams!,
        unit: "g",
      });
      logged.push(component.name);
    } catch (error) {
      // A food deleted since the proposal was made, or a portion that cannot be
      // resolved, is a skip and not a failed approval.
      logger.warn("Could not log an approved AI component", {
        proposalId: id,
        reason: error instanceof Error ? error.message : "unknown",
      });
      skipped.push(component.name);
    }
  }

  const outcome: AcceptedOutcome = { logged, skipped, acceptedAt: new Date().toISOString() };
  await prisma.aiProposal.update({
    where: { id },
    data: {
      approvalStatus: "ACCEPTED",
      accepted: outcome as unknown as Prisma.InputJsonValue,
      reviewedAt: new Date(),
    },
  });

  redirect(`/ai-review/${proposal.job.entityId}`);
}
