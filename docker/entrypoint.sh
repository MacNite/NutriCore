#!/bin/sh
# Applies pending migrations, then starts the server.
#
# Only `migrate deploy` is used. `prisma db push` is deliberately NOT run here:
# it compares the live database against the schema and can drop columns or
# tables to make them match, which would destroy data on an upgrade.
set -eu

echo "Applying database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting NutriCore..."
exec node server.js
