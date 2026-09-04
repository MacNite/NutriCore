-- Recipe generation is served before everything else in the queue.
--
-- The band is written when a job is queued, so without this every recipe import
-- already waiting keeps the old user-facing value and stays behind the quick
-- meals queued after it - on a busy worker that is the exact wait this change
-- is meant to remove.
--
-- Only unfinished jobs are touched: the priority of a job that has already run
-- is a record of how it was queued, and rewriting it would misreport history in
-- the admin queue panel.
UPDATE "AiJob"
SET "priority" = 20
WHERE "status" IN ('QUEUED', 'RUNNING')
  AND "entityType" = 'AI_INGESTION'
  AND "ingestionInputId" IN (SELECT "id" FROM "AiIngestionInput" WHERE "intent" = 'RECIPE');
