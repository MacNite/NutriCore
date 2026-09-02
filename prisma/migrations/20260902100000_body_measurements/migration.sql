-- Body progress: measuring-tape sessions, plus the two profile columns that
-- decide how the drawn figure looks.
--
-- Weight is deliberately not part of a measurement. It stays in "WeightEntry"
-- so the weight chart, the goal line and body progress can never disagree
-- about what someone weighed on a given day.
--
-- Every measured column is nullable. A session where only the waist was
-- measured is a real session, and a zero would be a lie about the rest.
-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('MANUAL', 'BIA', 'OTHER_DEVICE');

-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('ECTOMORPH', 'MESOMORPH', 'ENDOMORPH');

-- CreateEnum
CREATE TYPE "BodyFigure" AS ENUM ('NEUTRAL', 'MASCULINE', 'FEMININE');

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "bodyFigure" "BodyFigure",
ADD COLUMN     "bodyType" "BodyType";

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "neckCm" DECIMAL(5,1),
    "chestCm" DECIMAL(5,1),
    "waistCm" DECIMAL(5,1),
    "hipCm" DECIMAL(5,1),
    "upperArmLeftCm" DECIMAL(5,1),
    "upperArmRightCm" DECIMAL(5,1),
    "thighLeftCm" DECIMAL(5,1),
    "thighRightCm" DECIMAL(5,1),
    "calfLeftCm" DECIMAL(5,1),
    "calfRightCm" DECIMAL(5,1),
    "bodyFatPct" DECIMAL(4,1),
    "muscleKg" DECIMAL(5,1),
    "bodyWaterPct" DECIMAL(4,1),
    "boneKg" DECIMAL(4,1),
    "compositionSource" "MeasurementSource",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BodyMeasurement_userId_date_idx" ON "BodyMeasurement"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BodyMeasurement_userId_date_key" ON "BodyMeasurement"("userId", "date");

-- AddForeignKey
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

