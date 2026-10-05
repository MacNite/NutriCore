-- Optional single sign-on through an OpenID Connect provider (e.g. authentik).
--
-- Accounts are matched by email on their first SSO sign-in and then linked to
-- the provider's stable subject, so a later email change on either side does
-- not move the sign-in to a different account. Existing accounts are unchanged
-- until they sign in through the provider.
ALTER TABLE "User" ADD COLUMN "oidcSubject" TEXT;
CREATE UNIQUE INDEX "User_oidcSubject_key" ON "User"("oidcSubject");

-- The ID token is the `id_token_hint` for ending the provider session on
-- sign-out. It dies with the session row.
ALTER TABLE "Session" ADD COLUMN "oidcIdToken" TEXT;
