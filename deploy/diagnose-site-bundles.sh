#!/usr/bin/env bash
# Compare JS bundle served locally (Node) vs publicly (nginx) for each Task Manager site.
# Run on VPS as root: bash deploy/diagnose-site-bundles.sh
set -uo pipefail

declare -A DIRS=(
  [taskmanager]=Task_manager
  [safari]=Task_manager_safari
  [ss2n]=Task_manager_ss2n
  [acs]=Task_manager_acs
  [tacs]=Task_manager_tacs
)

declare -A DOMAINS=(
  [taskmanager]=sugandhshoppee.kalpanik.in
  [safari]=safari.kalpanik.in
  [ss2n]=ss2n.kalpanik.in
  [acs]=acs.kalpanik.in
  [tacs]=tacs.kalpanik.in
)

echo "=== Expected bundle (from disk) ==="
for pm2 in taskmanager safari ss2n acs tacs; do
  dir="${DIRS[$pm2]}"
  js=$(ls ~/"$dir"/client/dist/assets/index-*.js 2>/dev/null | head -1)
  if [ -n "$js" ]; then
    echo "$pm2: $(basename "$js")"
  else
    echo "$pm2: MISSING client/dist"
  fi
done

echo ""
echo "=== Node (localhost) vs Public (nginx) ==="
for pm2 in taskmanager safari ss2n acs tacs; do
  dir="${DIRS[$pm2]}"
  domain="${DOMAINS[$pm2]}"
  port=$(grep -E '^PORT=' ~/"$dir"/server/.env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
  [ -z "$port" ] && port=3000

  local_js=$(curl -s "http://127.0.0.1:${port}/" | grep -oE 'assets/index-[^"]+\.js' | head -1)
  public_js=$(curl -s "https://${domain}/" | grep -oE 'assets/index-[^"]+\.js' | head -1)

  if [ "$local_js" = "$public_js" ]; then
    status="OK"
  else
    status="MISMATCH — nginx serving old static files"
  fi
  echo "$pm2 ($domain):"
  echo "  Node   : ${local_js:-FAILED (is PM2 running? port $port)}"
  echo "  Public : ${public_js:-FAILED}"
  echo "  => $status"
  echo ""
done

echo "=== Nginx root / proxy (sites with kalpanik) ==="
grep -E "server_name|root |proxy_pass|location /" /etc/nginx/sites-enabled/* 2>/dev/null \
  | grep -iE "ss2n|tacs|acs|safari|sugandh|kalpanik" || echo "(no nginx configs found)"
