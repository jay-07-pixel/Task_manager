#!/usr/bin/env bash
# Point nginx at Node for ALL traffic (not a stale static root) for Task Manager sites.
# Run on VPS as root AFTER diagnose-site-bundles.sh shows MISMATCH.
#
# Usage: sudo bash deploy/fix-nginx-proxy-all-taskmgr.sh
#
# This script patches vhosts that proxy /api/ but use root/try_files for /.
# It replaces the location / block to proxy everything to the app's PORT from .env.
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

declare -A DOMAIN_DIR=(
  [sugandhshoppee.kalpanik.in]=Task_manager
  [safari.kalpanik.in]=Task_manager_safari
  [ss2n.kalpanik.in]=Task_manager_ss2n
  [acs.kalpanik.in]=Task_manager_acs
  [tacs.kalpanik.in]=Task_manager_tacs
)

SITES_DIR="/etc/nginx/sites-enabled"
patched=0

for domain in "${!DOMAIN_DIR[@]}"; do
  dir="${DOMAIN_DIR[$domain]}"
  env_file="/root/$dir/server/.env"
  [ -f "$env_file" ] || { echo "Skip $domain — no $env_file"; continue; }
  port=$(grep -E '^PORT=' "$env_file" | cut -d= -f2 | tr -d '"' | tr -d "'")
  [ -n "$port" ] || port=3000

  vhost=""
  for f in "$SITES_DIR"/*; do
    [ -f "$f" ] || continue
    if grep -q "$domain" "$f" 2>/dev/null; then
      vhost="$f"
      break
    fi
  done

  if [ -z "$vhost" ]; then
    echo "Skip $domain — no vhost in sites-enabled"
    continue
  fi

  if grep -q "# taskmgr-full-proxy" "$vhost"; then
    echo "OK (already patched): $vhost"
    continue
  fi

  cp "$vhost" "${vhost}.bak.$(date +%Y%m%d%H%M%S)"

  python3 - "$vhost" "$port" <<'PY'
import re, sys
path, port = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()

block = f"""
    # taskmgr-full-proxy — serve SPA + API from Node (auto-patched)
    location / {{
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:{port};
    }}
"""

# Remove old location / { ... } that is NOT /api/
text = re.sub(
    r"\n\s*location / \{[^}]*\}\s*(?=\n\s*location|\n\s*\}|\Z)",
    "\n",
    text,
    count=1,
    flags=re.DOTALL,
)

# Insert before first location /api/ if present, else before closing server brace
if re.search(r"\n\s*location /api/", text):
    text = re.sub(r"(\n\s*location /api/)", block + r"\1", text, count=1)
else:
    text = re.sub(r"(\n\s*\}\s*\n\s*(?:listen|\Z))", block + r"\1", text, count=1)

open(path, "w", encoding="utf-8").write(text)
print(f"Patched {path} -> proxy_pass :{port}")
PY

  patched=$((patched + 1))
done

if [ "$patched" -eq 0 ]; then
  echo "No vhosts patched."
else
  nginx -t
  systemctl reload nginx
  echo "nginx reloaded. Re-run: bash deploy/diagnose-site-bundles.sh"
fi
