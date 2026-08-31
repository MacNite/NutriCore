-- Country tags from Open Food Facts, so search can prefer products sold locally.
-- Existing rows read back as an empty list until their next provider refresh.
ALTER TABLE "Food" ADD COLUMN "countries" TEXT[];
