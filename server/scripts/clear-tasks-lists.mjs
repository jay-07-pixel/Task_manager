import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "../prisma-client/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "uploads", "completion-proofs");
const prisma = new PrismaClient();

async function main() {
  const assignees = await prisma.taskAssignee.findMany({
    where: { completionProofPath: { not: null } },
    select: { completionProofPath: true },
  });
  for (const row of assignees) {
    const name = row.completionProofPath;
    if (!name || /[\\/]/.test(name)) continue;
    const full = path.join(uploadsRoot, path.basename(name));
    try {
      fs.unlinkSync(full);
    } catch {
      /* ignore missing files */
    }
  }

  if (fs.existsSync(uploadsRoot)) {
    for (const name of fs.readdirSync(uploadsRoot)) {
      try {
        fs.unlinkSync(path.join(uploadsRoot, name));
      } catch {
        /* ignore */
      }
    }
  }

  const tasks = await prisma.task.deleteMany({});
  const lists = await prisma.taskList.deleteMany({});

  console.log("Cleared:", { tasks: tasks.count, lists: lists.count });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
