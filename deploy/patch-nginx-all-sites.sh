#!/usr/bin/env bash
# Patch all nginx vhosts that proxy /api/ for Task Manager (SSE + chat video ranges).
# Run on VPS as root: sudo bash deploy/patch-nginx-all-sites.sh
set -euo pipefail

SNIPPET="/etc/nginx/snippets/taskmgr-api-proxy.conf"
SITES_DIR="/etc/nginx/sites-enabled"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

mkdir -p /etc/nginx/snippets

cat >"$SNIPPET" <<'EOF'
# Task Manager — chat SSE (/api/chat/live) + attachment byte ranges
proxy_set_header Connection '';
proxy_buffering off;
proxy_cache off;
proxy_set_header Range $http_range;
proxy_set_header If-Range $http_if_range;
EOF

echo "Wrote $SNIPPET"

shopt -s nullglob
files=("$SITES_DIR"/*)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No files in $SITES_DIR"
  exit 1
fi

patched=0
for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  if ! grep -qE 'location[[:space:]]+/api/' "$f"; then
    continue
  fi
  if grep -q 'taskmgr-api-proxy.conf' "$f"; then
    echo "OK (already patched): $f"
    continue
  fi
  cp "$f" "${f}.bak.$(date +%Y%m%d%H%M%S)"
  # Insert include after the first "location /api/" line (GNU sed)
  sed -i '0,/location[[:space:]]\+\/api\//{ /location[[:space:]]\+\/api\//a\        include snippets/taskmgr-api-proxy.conf;
}' "$f"
  echo "Patched: $f"
  patched=$((patched + 1))
done

if [[ $patched -eq 0 ]]; then
  echo "No new sites patched (all already include snippet or no location /api/)."
fi

# Ensure upload limit in server blocks (idempotent)
for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  if ! grep -qE 'location[[:space:]]+/api/' "$f"; then
    continue
  fi
  if grep -q 'client_max_body_size' "$f"; then
    if grep -qE 'client_max_body_size[[:space:]]+6m' "$f"; then
      sed -i 's/client_max_body_size[[:space:]]\+6m/client_max_body_size 16m/g' "$f"
      echo "Updated client_max_body_size 6m -> 16m in: $f"
    fi
    continue
  fi
  sed -i '/server[[:space:]]*{/a\    client_max_body_size 16m;' "$f"
  echo "Added client_max_body_size 16m to: $f"
done

nginx -t
systemctl reload nginx
echo "Done. nginx reloaded."
