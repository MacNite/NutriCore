-- Installations created before roles existed have no administrator. Promote
-- the sole existing account, but do not guess when an installation has more
-- than one account or already has an administrator.
UPDATE "User"
SET "role" = 'ADMIN'
WHERE "id" = (SELECT "id" FROM "User" LIMIT 1)
  AND (SELECT COUNT(*) FROM "User") = 1
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');
