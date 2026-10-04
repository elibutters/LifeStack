#!/usr/bin/env bash
# Dedicated Chrome profile with remote debugging. Sign in to Amazon here and leave it running.
set -euo pipefail
DIR="${HOME}/Library/Application Support/lifestack-amazon-chrome"
mkdir -p "$DIR"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$DIR" \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  "https://www.amazon.com/your-orders/orders?timeFilter=months-3"
