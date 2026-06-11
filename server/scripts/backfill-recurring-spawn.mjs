import "../src/load-env.js";
import { reconcileAllLegacyRolledRecurringTasks } from "../src/lib/recurringLegacyBackfill.js";
import { prisma } from "../src/lib/prisma.js";

const count = await reconcileAllLegacyRolledRecurringTasks();
console.log(`Recurring legacy backfill: split ${count} task(s).`);
await prisma.$disconnect();
