#!/bin/sh
# Starts the app or the worker.
#
# Migrations are NOT applied here. They run once, in the separate `migrate`
# service built from the `migrate` stage of the Dockerfile, which both of these
# services wait for. That keeps the Prisma CLI - and the transitive packages it
# drags in, several of which carry their own advisories - out of the image that
# stays running and faces the network.
#
# It also removes a race that was papered over rather than fixed: the app and
# the worker start at the same time and used to run `migrate deploy`
# concurrently against the same database.
set -eu

if [ "${NUTRICORE_PROCESS:-app}" = "worker" ]; then
  echo "Starting NutriCore AI worker..."
  exec node --import tsx ./src/worker.ts
fi
echo "Starting NutriCore..."
exec node server.js
