import "./load-env.js";
import fs from "fs";
import express from "express";
import "express-async-errors";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import sessionFileStore from "session-file-store";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import listRoutes from "./routes/lists.js";
import taskRoutes from "./routes/tasks.js";
import userRoutes from "./routes/users.js";
import pushRoutes from "./routes/push.js";
import supportRoutes from "./routes/support.js";
import chatRoutes from "./routes/chat.js";
import reportsRoutes from "./routes/reports.js";
import translateRoutes from "./routes/translate.js";
import { prisma } from "./lib/prisma.js";
import { initPush } from "./lib/push.js";
import { initFcm } from "./lib/fcm.js";
import { startReminderScheduler } from "./lib/reminderScheduler.js";
import { getTurnstileSiteKey } from "./lib/turnstile.js";
import { reconcileAllLegacyRolledRecurringTasks } from "./lib/recurringLegacyBackfill.js";
import { friendlyDbError } from "./lib/dbErrorMessage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionsDir = path.join(__dirname, "..", "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });
const FileStore = sessionFileStore(session);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

/** Stay signed in until manual logout (default ~10 years). Override with SESSION_MAX_AGE_MS. */
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 10 * 365 * 24 * 60 * 60 * 1000;
/** Set COOKIE_SECURE=true only when the site is served over HTTPS. HTTP VPS needs false. */
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const corsOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : isProd
    ? false
    : ["http://localhost:5173", "http://127.0.0.1:5173"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    name: "taskmgr.sid",
    store: new FileStore({
      path: sessionsDir,
      ttl: Math.ceil(SESSION_MAX_AGE_MS / 1000),
      logFn: () => {},
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      maxAge: SESSION_MAX_AGE_MS,
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/lists", listRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/translate", translateRoutes);

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    console.error("[health/db]", err);
    res.status(503).json({
      ok: false,
      db: "error",
      hint: "Check DATABASE_URL, MySQL is running, and run prisma migrate + seed on the server.",
    });
  }
});

const clientDist = path.join(__dirname, "../../client/dist");
if (isProd) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: friendlyDbError(err, { isProd }) });
});

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (getTurnstileSiteKey()) {
    console.log("[turnstile] CAPTCHA configured");
  } else {
    console.warn("[turnstile] TURNSTILE_SITE_KEY missing — registration CAPTCHA disabled");
  }
  initPush();
  initFcm();
  startReminderScheduler();
  void reconcileAllLegacyRolledRecurringTasks()
    .then((n) => {
      if (n > 0) {
        console.log(`[recurring-backfill] split ${n} legacy recurring task(s) into completed + active cards`);
      }
    })
    .catch((err) => console.error("[recurring-backfill]", err));
});

/** Avoid dev crash on abrupt client disconnect (browser tab closed mid-request, flaky proxy, etc.). */
server.on("clientError", (err, socket) => {
  const code = /** @type {NodeJS.ErrnoException} */ (err).code;
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") {
    socket.destroy();
    return;
  }
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
