-- Diagnostics for background AI work. `AiJob.errorMessage` is overwritten by
-- every retry, so a job that failed three times for three different reasons
-- looked identical to one that failed the same way three times. Each attempt is
-- now recorded, and the classified kind is kept on the job for filtering.

ALTER TABLE "AiJob"
  ADD COLUMN "failureKind" TEXT,
  ADD COLUMN "errorDetail" TEXT;

CREATE TABLE "AiJobAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "detail" TEXT,
  "model" TEXT,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiJobAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiJobAttempt_jobId_attempt_idx" ON "AiJobAttempt"("jobId", "attempt");

ALTER TABLE "AiJobAttempt" ADD CONSTRAINT "AiJobAttempt_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
