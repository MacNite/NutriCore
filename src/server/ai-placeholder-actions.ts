"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireUser } from "./session";
import { aiAvailable } from "./ai-availability";
import { AI_JOB_REQUEUE_DATA } from "./ai-types";

/**
 * The pages a failed placeholder is offered on, and so the only places these
 * actions may send the browser afterwards. An allowlist rather than a returned
 * path: a redirect target taken from a form is a redirect target an attacker
 * can write.
 */
const RETURN_TO = ["/", "/foods"] as const;

const runForm = z.object({ jobId: z.string().min(1).max(64), returnTo: z.enum(RETURN_TO).catch("/") });

/** Both buttons on the row submit the same two fields, and read them the same way. */
const readRunForm = (formData: FormData) =>
  runForm.parse({ jobId: String(formData.get("jobId") ?? ""), returnTo: String(formData.get("returnTo") ?? "/") });

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
  const parsed = readRunForm(formData);

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

/**
 * Throws a failed run away, from the same row that offers to re-run it.
 *
 * Keeping a failure visible is only half of not discarding it silently: a run
 * the submitter has finished with has to be dismissable, or the list collects
 * rows that can only be waited out. The submitted input goes with it rather
 * than being orphaned in the database behind a row nothing shows any more -
 * this is a tracker whose users chose it for not keeping what it does not
 * need, and the input can hold the text, the URL and the photo they sent.
 *
 * Deleting the `AiIngestionInput` cascades to the job, its attempts and its
 * proposal. A draft recipe an earlier run of the same input produced is not
 * touched: that relation is `SetNull`, so a recipe already in the user's own
 * list stays there and merely loses the pointer back to the import.
 *
 * Only ever the caller's own FAILED ingestion runs. A job still queued or
 * running is left alone: the worker is holding it, and deleting the row it is
 * working on is not what an X on a failed row means.
 */
export async function discardAiRunAction(formData: FormData) {
  const user = await requireUser();
  const parsed = readRunForm(formData);

  const job = await prisma.aiJob.findFirst({
    where: { id: parsed.jobId, userId: user.id, status: "FAILED", entityType: "AI_INGESTION" },
    select: { id: true, ingestionInputId: true },
  });
  if (!job) return redirect(parsed.returnTo);

  if (job.ingestionInputId) await prisma.aiIngestionInput.deleteMany({ where: { id: job.ingestionInputId, userId: user.id } });
  else await prisma.aiJob.deleteMany({ where: { id: job.id, userId: user.id } });
  logger.info("Failed AI run discarded by its submitter", { jobId: job.id });

  redirect(parsed.returnTo);
}
