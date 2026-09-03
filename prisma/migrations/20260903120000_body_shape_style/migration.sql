-- How the body-shape panel draws the figure.
--
-- SILHOUETTE is the drawing that was already there: change as tinted bands over
-- the body. MEASURE holds the arms clear and puts a caliper across every level
-- a tape measure was put around, with the reference measurement marked on it.
-- Both are drawn from the same geometry and the same recorded circumferences,
-- so switching between them changes nothing but the picture.
--
-- Null means the reader has never chosen, and gets the silhouette.

-- CreateEnum
CREATE TYPE "BodyShapeStyle" AS ENUM ('SILHOUETTE', 'MEASURE');

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "bodyShapeStyle" "BodyShapeStyle";
