#!/bin/sh
# Applies pending migrations, once, and exits.
#
# This used to run inside the entrypoint of every long-running container, which
# meant the Prisma CLI and its transitive dependencies had to ship in the
# runtime image, and that the app and the worker both raced to apply the same
# migrations on every start. Both are now somebody else's problem: this runs as
# a one-shot `migrate` service that the app and worker wait for.
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
  echo "Migrations applied."
  exit 0
fi

if grep -q "P3009" "$log"; then
  # A migration recorded as failed blocks every later deploy until it is
  # resolved, which is what turns one bad upgrade into an app and a worker that
  # restart for ever. Prisma applies each migration to PostgreSQL inside a
  # transaction, so a failed one left nothing of itself behind: marking it
  # rolled back and applying it again is the documented recovery, and with a
  # corrected migration file it is also the whole fix.
  #
  # Running as a single one-shot service rather than in two racing entrypoints
  # means this recovery now happens once, with nothing else applying migrations
  # underneath it.
  failed=$(sed -n 's/^The `\(.*\)` migration started at .* failed$/\1/p' "$log")
  if [ -z "$failed" ]; then
    echo "A migration is recorded as failed but its name could not be read from the output above." >&2
    exit 1
  fi
  for name in $failed; do
    echo "Migration $name is recorded as failed; marking it rolled back so it can be applied again."
    $PRISMA migrate resolve --rolled-back "$name"
  done
  echo "Re-applying database migrations..."
  deploy
  echo "Migrations applied."
  exit 0
fi

exit 1
