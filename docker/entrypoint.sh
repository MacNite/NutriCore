#!/bin/sh
# Applies pending migrations, then starts the server.
#
# Only `migrate deploy` is used. `prisma db push` is deliberately NOT run here:
# it compares the live database against the schema and can drop columns or
# tables to make them match, which would destroy data on an upgrade.
set -eu

# Invoke the package entry point directly. Copying npm's `.bin/prisma` symlink
# between image stages turns it into a regular file, which makes Prisma look for
# its WASM assets in `.bin` instead of in the package's build directory.
PRISMA="node ./node_modules/prisma/build/index.js"

log="${TMPDIR:-/tmp}/nutricore-migrate.log"
status="${TMPDIR:-/tmp}/nutricore-migrate.status"

# Runs `migrate deploy` with its output both shown and kept, and leaves its exit
# code in $status. `set -e` must not abort here: a failure is handled below.
deploy() {
  { $PRISMA migrate deploy 2>&1; echo "$?" >"$status"; } | tee "$log"
  [ "$(cat "$status")" = "0" ]
}

echo "Applying database migrations..."
if deploy; then
  :
elif grep -q "P3009" "$log"; then
  # A migration recorded as failed blocks every later deploy until it is
  # resolved, which is what turns one bad upgrade into an app and a worker that
  # restart for ever. Prisma applies each migration to PostgreSQL inside a
  # transaction, so a failed one left nothing of itself behind: marking it
  # rolled back and applying it again is the documented recovery, and with a
  # corrected migration file it is also the whole fix.
  #
  # If the retry fails too the startup still fails, loudly, with the database
  # error that caused it - never silently, and never more than once per start.
  failed=$(sed -n 's/^The `\(.*\)` migration started at .* failed$/\1/p' "$log")
  if [ -z "$failed" ]; then
    echo "A migration is recorded as failed but its name could not be read from the output above." >&2
    exit 1
  fi
  # A failure here is not fatal: the app and the worker start at the same time
  # and both apply migrations, so the other one may have got there first. The
  # retry below is what decides whether the database is usable.
  for name in $failed; do
    echo "Migration $name is recorded as failed; marking it rolled back so it can be applied again."
    $PRISMA migrate resolve --rolled-back "$name" \
      || echo "Could not mark $name rolled back - carrying on to see whether it is already resolved."
  done
  echo "Re-applying database migrations..."
  deploy
else
  exit 1
fi

if [ "${NUTRICORE_PROCESS:-app}" = "worker" ]; then
  echo "Starting NutriCore AI worker..."
  exec node --import tsx ./src/worker.ts
fi
echo "Starting NutriCore..."
exec node server.js
