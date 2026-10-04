# Amazon snapshot worker
#
# Runs on a laptop that already has Chrome signed in to Amazon. It never stores
# the Amazon password. It posts the last ~90 days of orders and the current cart
# to Life Stack.
#
# Setup (second laptop):
# 1. Copy this folder. Install Node 22+. From this folder: pnpm install
# 2. Copy env.example to .env and fill LIFESTACK_URL and LIFESTACK_TOKEN
# 3. Run ./start-chrome.sh once, sign in to Amazon, leave that Chrome window open
# 4. Run ./install-launchd.sh so snapshots run every 15 minutes at login

set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo "missing .env (copy env.example)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${LIFESTACK_URL:?set LIFESTACK_URL in .env}"
: "${LIFESTACK_TOKEN:?set LIFESTACK_TOKEN in .env}"
export LIFESTACK_URL LIFESTACK_TOKEN
export AMAZON_CDP_URL="${AMAZON_CDP_URL:-http://127.0.0.1:9222}"
exec node sync.mjs
