#!/usr/bin/env bash
#
# Public HTTPS tunnel for the robotics API, as a supervised process.
#
# This is the Cloudflare replacement for robo-ngrok. A quick tunnel needs no
# account and no domain, but it gets a FRESH random hostname every start — so
# this is a preview link, not production. Once the real domain exists this
# script gets replaced by a named tunnel with a stable hostname.
#
# The current URL is always in .tunnel-url at the repo root.
#
# Run it through PM2, not directly:
#   pm2 start scripts/dev-tunnel.sh --name robo-tunnel --interpreter bash
#   pm2 save
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${TUNNEL_PORT:-3002}"
URL_FILE="$ROOT/.tunnel-url"
# Shared with routefinder rather than vendored twice; override if it moves.
CLOUDFLARED="${CLOUDFLARED:-/home/postal/projects/routefinder/frontend/node_modules/.bin/cloudflared}"

if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "cloudflared not found at $CLOUDFLARED — set CLOUDFLARED to its path" >&2
  exit 1
fi

echo "[tunnel] starting against http://127.0.0.1:$PORT"

# Line-buffered through a read loop rather than backgrounded-and-grepped: the
# process has to stay in the foreground for PM2 to supervise it, and the URL
# only appears a few seconds in.
"$CLOUDFLARED" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate 2>&1 |
while IFS= read -r line; do
  echo "$line"

  # Only the first match matters. cloudflared prints the hostname once at
  # startup; anything later is a retry of the same tunnel.
  if [[ -z "${FOUND:-}" && "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    FOUND=1
    URL="${BASH_REMATCH[0]}"
    echo "$URL" > "$URL_FILE"
    echo "[tunnel] url: $URL"
    echo "[tunnel] set NEXT_PUBLIC_API_URL to this in both Vercel projects, then redeploy"
  fi
done
