-- Applying an AI meal proposal without opening the review screen.
--
-- The review screen was only ever reachable through the redirect that followed
-- submitting a meal, so a proposal nobody reviewed immediately was a meal that
-- never reached the diary. Defaults on; everything logged is still recorded on
-- the proposal and every value still carries its provenance.

ALTER TABLE "UserProfile" ADD COLUMN "autoApproveAi" BOOLEAN NOT NULL DEFAULT true;
