/**
 * Client is generated to server/prisma-client (not node_modules) to avoid Windows/OneDrive
 * EPERM locks on node_modules\.prisma\client\query_engine-*.dll.node.
 *
 * You still must stop `npm run dev` before generate — a running API locks the engine in prisma-client too.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "prisma-client");

if (existsSync(clientDir)) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(clientDir, { recursive: true, force: true });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      await delay(800 * (i + 1));
    }
  }
  if (lastErr) {
    console.error(
      "\nCould not remove prisma-client (files are locked).\n" +
        "→ Stop `npm run dev` and every `node` process for this project, then:\n" +
        "   npm run db:generate\n" +
        "\nIf the project is in OneDrive: pause syncing or move the repo outside OneDrive / exclude `server/prisma-client`.\n"
    );
    console.error(lastErr?.message || lastErr);
    process.exit(1);
  }
}

const res = spawnSync("npx", ["prisma", "generate"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

process.exit(res.status === null ? 1 : res.status);
