import "dotenv/config";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionsDir = path.join(__dirname, "..", "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });
const FileStore = sessionFileStore(session);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: isProd ? false : ["http://localhost:5173", "http://127.0.0.1:5173"],
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
      ttl: 60 * 60 * 24 * 7,
      logFn: () => {},
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: isProd ? "lax" : "lax",
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/lists", listRoutes);
app.use("/api/tasks", taskRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const clientDist = path.join(__dirname, "../../client/dist");
if (isProd) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  const detail =
    !isProd && err && typeof err === "object" && "message" in err && typeof err.message === "string"
      ? err.message
      : "Server error";
  res.status(500).json({ error: detail });
});

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
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
