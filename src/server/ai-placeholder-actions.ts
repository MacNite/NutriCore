"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireUser } from "./session";
import { aiAvailable } from "./ai-availability";
import { AI_JOB_REQUEUE_DATA } from "./ai-types";

/**
 * The pages a failed placeholder is offered on, and so the only places this may
 * send the browser afterwards. An allowlist rather than a returned path: a
 * redirect target taken from a form is a redirect target an attacker can write.
 */
const RETURN_TO = ["/", "/foods"] as const;

/**
 * Queues a failed run again from the list it failed in.
 *
 * When Ollama is unreachable, every job in flight fails, and the only way back
 * used to be the admin queue - which an ordinary user does not have. The button
 * this action serves sits on the failed placeholder itself, so the submitter
 * retries their own run where they find it, without re-typing the input or
 * re-uploading anything.
 *
 * Scoped to the caller's own FAILED jobs: `updateMany` with `userId` in the
 * filter means a job id guessed from someone else's run matches nothing, and a
 * run that has since succeeded or is already back on the queue is untouched
 * rather than restarted.
 */
export async function retryAiRunAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z
    .object({ jobId: z.string().min(1).max(64), returnTo: z.enum(RETURN_TO).catch("/") })
    .parse({ jobId: String(formData.get("jobId") ?? ""), returnTo: String(formData.get("returnTo") ?? "/") });

  // A run cannot be restarted into a feature the user has since switched off:
  // the worker would only fail it again, and with a reason nobody asked for.
  if (!aiAvailable(user)) return redirect(parsed.returnTo);

  const requeued = await prisma.aiJob.updateMany({
    where: { id: parsed.jobId, userId: user.id, status: "FAILED", entityType: "AI_INGESTION" },
    data: AI_JOB_REQUEUE_DATA,
  });
  if (requeued.count) logger.info("AI run requeued by its submitter", { jobId: parsed.jobId });

  redirect(parsed.returnTo);
}
