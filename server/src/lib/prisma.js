import { PrismaClient, Prisma } from "../../prisma-client/index.js";

const TRANSIENT_NODE_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND"]);

/** @param {unknown} err */
function isTransientDbError(err) {
  const any = /** @type {any} */ (err);
  const code = any?.code;
  if (typeof code === "string" && TRANSIENT_NODE_CODES.has(code)) return true;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1001", "P1008", "P1014", "P1017"].includes(err.code);
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const msg = String(any?.message ?? "").toLowerCase();
    return (
      msg.includes("econnreset") ||
      msg.includes("gone away") ||
      msg.includes("server has closed the connection") ||
      msg.includes("connection lost")
    );
  }
  const msg = String(any?.message ?? "").toLowerCase();
  return (
    msg.includes("gone away") ||
    msg.includes("server has closed the connection") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("connection lost") ||
    msg.includes("the connection timed out")
  );
}

const basePrisma = new PrismaClient();
const MAX_QUERY_RETRIES = 2;

/**
 * Reconnect and retry when MySQL / TCP drops idle pooled connections ("server has gone away", ECONNRESET).
 */
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        for (let attempt = 0; attempt <= MAX_QUERY_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (!isTransientDbError(e) || attempt === MAX_QUERY_RETRIES) throw e;
            await basePrisma.$disconnect().catch(() => {});
            await basePrisma.$connect();
          }
        }
      },
    },
  },
});
