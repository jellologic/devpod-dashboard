#!/bin/sh
set -e

echo "Starting WorkspaceKit..."

# Start worker in background
echo "Starting worker..."
bun run /app/worker/index.js &
WORKER_PID=$!

# Start web server in foreground
echo "Starting web server on port 3000..."
bun run /app/.output/server/index.mjs

# If web server exits, kill worker
kill $WORKER_PID 2>/dev/null
