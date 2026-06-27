#!/usr/bin/env bash
# Recover from failed 20260627120000_user_salary migration, then deploy.
# Run on VPS from repo root: bash deploy/fix-failed-salary-migration.sh [repo_dir ...]
set -euo pipefail

DIRS=("${@:-Task_manager Task_manager_safari Task_manager_ss2n}")
FAILED_MIGRATION="20260627120000_user_salary"

for dir in "${DIRS[@]}"; do
  root="${HOME}/${dir}"
  echo "=== Fix migrations: ${root} ==="
  cd "${root}"
  git pull origin main
  cd server
  npx prisma migrate resolve --rolled-back "${FAILED_MIGRATION}"
  npx prisma migrate deploy
  cd "${root}"
  npm install --prefix client
  npm run build --prefix client
done

pm2 restart taskmanager safari ss2n
echo "Done."
