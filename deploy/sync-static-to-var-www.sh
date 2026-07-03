#!/usr/bin/env bash
# Copy latest client/dist into nginx /var/www folders (temporary fix if you keep static root).
# Prefer: sudo bash deploy/fix-nginx-proxy-all-taskmgr.sh
set -euo pipefail

rsync -av --delete /root/Task_manager_ss2n/client/dist/ /var/www/ss2n/
rsync -av --delete /root/Task_manager_acs/client/dist/ /var/www/acs/
mkdir -p /var/www/tacs
rsync -av --delete /root/Task_manager_tacs/client/dist/ /var/www/tacs/

echo "Synced dist to /var/www/ss2n, /var/www/acs, /var/www/tacs"
echo "NOTE: tacs nginx still points to root /var/www/acs — run fix-nginx-proxy-all-taskmgr.sh for a permanent fix."
