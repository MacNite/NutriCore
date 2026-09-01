"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAiModel } from "@/lib/env";
import { normalizeName } from "@/lib/units";
import { requireUser } from "./session";
import { addDiaryEntry, formatDateKey } from "./diary";
import { checkUrl } from "@/lib/url-guard";
import { validDateKey } from "@/lib/date";
import { decideComponents, jobPriority, type AcceptedOutcome, type ProposedComponent } from "./ai-types";

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
      // A meal the user is watching for goes ahead of background enrichment.
      priority: jobPriority("MEAL_INPUT"),
    },
  });
  redirect(`/ai-review/${input.id}?queued=1`);
}

/**
 * Creates the food behind an approved estimate.
 *
 * `sourceType: AI_RESEARCH` and `isEstimated` are deliberate: ranking must keep
 * treating these with the low trust an estimate deserves, so they never
 * outrank a sourced food in search. `AI_MEAL_ESTIMATE` on the source row records
 * where the numbers came from, and it is the only provider value that means "the
 * model said so and a human accepted it".
 */
async function createEstimatedFood(user: { id: string; language: "de" | "en" }, component: ProposedComponent) {
  const nutrients = Object.entries(component.nutritionPer100g ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([nutrientKey, value]) => ({ nutrientKey, value }));

  return prisma.food.create({
    data: {
      ownerId: user.id,
      name: component.name,
      normalizedName: normalizeName(component.name),
      locale: user.language,
      sourceType: "AI_RESEARCH",
      foodType: "GENERIC",
      basisAmount: 100,
      basisUnit: "G",
      isEstimated: true,
      nutrients: { createMany: { data: nutrients } },
      sources: {
        create: [
          {
            provider: "AI_MEAL_ESTIMATE",
            retrievedAt: new Date(),
            model: resolveAiModel(),
            estimated: true,
          },
        ],
      },
    },
  });
}

/**
 * Approving a proposal is what finally writes to the diary. A component is
 * logged when the worker matched it to a food the user can see, or - failing
 * that - when the model stated nutrition for it, in which case it is logged
 * against a food created here and marked as an estimate. Either way it goes
 * through `addDiaryEntry` and freezes a nutrition snapshot exactly like a
 * manually logged entry. A component with neither is reported back as skipped
 * rather than logged as zero calories.
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
  // One radio group per component, named by its index. An absent field leaves
  // the resolver's own choice standing, which is what a form submitted without
  // JavaScript does for a component that offered only one option.
  const { loggable, skipped } = decideComponents(components, (index) => {
    const raw = formData.get(`component-${index}`);
    return raw === null ? undefined : String(raw);
  });

  const date = formatDateKey(mealInput.diaryDate);
  const logged: string[] = [];
  const estimated: string[] = [];

  for (const { component, foodId: chosenFoodId, grams } of loggable) {
    try {
      // A component nothing resolved is logged against a food created here from
      // the model's own numbers, marked as an estimate. Creating it is what makes
      // the entry auditable afterwards: the diary entry then freezes a snapshot
      // exactly like any other, and the food carries its provenance.
      const foodId = chosenFoodId ?? (await createEstimatedFood(user, component)).id;
      await addDiaryEntry({
        userId: user.id,
        date,
        meal: mealInput.meal,
        foodId,
        quantity: grams,
        unit: "g",
      });
      logged.push(component.name);
      if (!chosenFoodId) estimated.push(component.name);
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

  const outcome: AcceptedOutcome = { logged, estimated, skipped, acceptedAt: new Date().toISOString() };
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
