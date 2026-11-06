#!/bin/sh
set -e

echo "Running migrations..."
node dist/db/migrate.js

echo "Starting server..."
exec npm start
