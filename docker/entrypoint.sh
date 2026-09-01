#!/bin/sh
# Applies pending migrations, then starts the server.
#
# Only `migrate deploy` is used. `prisma db push` is deliberately NOT run here:
# it compares the live database against the schema and can drop columns or
# tables to make them match, which would destroy data on an upgrade.
set -eu

echo "Applying database migrations..."
# Invoke the package entry point directly. Copying npm's `.bin/prisma` symlink
# between image stages turns it into a regular file, which makes Prisma look for
# its WASM assets in `.bin` instead of in the package's build directory.
node ./node_modules/prisma/build/index.js migrate deploy

if [ "${NUTRICORE_PROCESS:-app}" = "worker" ]; then
  echo "Starting NutriCore AI worker..."
  exec node --import tsx ./src/worker.ts
fi
echo "Starting NutriCore..."
exec node server.js
