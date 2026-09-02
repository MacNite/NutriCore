-- Per-user switches for the two body-progress visualisations.
--
-- Both default to true so nothing disappears for anyone who never opens their
-- settings: the card is the point of the progress page. The switches hide a
-- visualisation only -- every measurement stays recorded, exported and
-- editable, so turning one back on brings the whole history with it.

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "showBodyComposition" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showBodyShape" BOOLEAN NOT NULL DEFAULT true;
