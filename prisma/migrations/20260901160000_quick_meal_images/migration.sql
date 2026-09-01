ALTER TABLE "MealInput"
  ADD COLUMN "imageMime" TEXT,
  ADD COLUMN "imageData" BYTEA,
  ADD COLUMN "imageExpiresAt" TIMESTAMP(3);

CREATE INDEX "MealInput_imageExpiresAt_idx" ON "MealInput"("imageExpiresAt");
