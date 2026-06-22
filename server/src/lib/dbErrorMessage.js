const MIGRATE_HINT =
  "Database migration required. On the VPS run: cd server && npx prisma migrate deploy && npm run db:generate && pm2 restart ss2n";

/** Map Prisma / MySQL errors to a short client-safe message. */
export function friendlyDbError(err, { isProd = process.env.NODE_ENV === "production" } = {}) {
  const errMsg =
    err && typeof err === "object" && "message" in err && typeof err.message === "string"
      ? err.message
      : String(err ?? "");
  const errCode =
    err && typeof err === "object" && "code" in err ? String(err.code) : "";

  if (
    errMsg.includes("Can't reach database server") ||
    /ECONNREFUSED|connect ECONNREFUSED/i.test(errMsg)
  ) {
    return isProd
      ? "Cannot connect to the database. Check that MySQL is running and DATABASE_URL is correct on the server."
      : "Cannot connect to MySQL. Start MySQL, check DATABASE_URL in server/.env, then run: cd server && npx prisma migrate deploy && node prisma/seed.js";
  }

  const needsMigrate =
    errCode === "P2021" ||
    errCode === "P2022" ||
    /Unknown column|column.*does not exist/i.test(errMsg) ||
    /does not exist in the current database/i.test(errMsg) ||
    /task_submission_proof|submissionProofs|submission_text/i.test(errMsg);

  if (needsMigrate) {
    return MIGRATE_HINT;
  }

  return isProd ? "Server error" : errMsg;
}

export { MIGRATE_HINT };
