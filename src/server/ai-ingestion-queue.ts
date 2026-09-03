import type { MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveAiModel } from "@/lib/env";
import { jobPriority, type AiIngestionIntent } from "./ai-types";

export async function queueAiIngestion(input: { userId: string; intent: AiIngestionIntent; text: string; sourceUrl: string | null; servings: number; imageMime: string | null; imageData: Buffer | null; imageExpiresAt: Date | null; meal?: MealType | null; diaryDate?: Date | null; logAfterConfirm?: boolean; manualReview?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const record = await tx.aiIngestionInput.create({ data: { userId: input.userId, intent: input.intent, text: input.text, sourceUrl: input.sourceUrl, servings: input.servings, imageMime: input.imageMime, imageData: input.imageData, imageExpiresAt: input.imageExpiresAt, meal: input.meal ?? null, diaryDate: input.diaryDate ?? null, logAfterConfirm: input.logAfterConfirm ?? false } });
    await tx.aiJob.create({ data: { userId: input.userId, entityType: "AI_INGESTION", entityId: record.id, ingestionInputId: record.id, model: resolveAiModel(), priority: jobPriority("AI_INGESTION"), metadata: input.manualReview ? { manualReview: true } : undefined } });
    return record;
  });
}
