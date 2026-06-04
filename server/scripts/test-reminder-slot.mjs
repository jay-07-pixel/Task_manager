/**
 * Quick check: which reminder slot (if any) applies for a due time.
 * Usage: node server/scripts/test-reminder-slot.mjs "2026-06-06T15:10:00.000Z"
 */
import { reminderSlotForDue } from "../src/lib/reminderScheduler.js";

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node server/scripts/test-reminder-slot.mjs "<ISO dueAt>"');
  process.exit(1);
}

const dueAt = new Date(arg);
const now = Date.now();
const slot = reminderSlotForDue(dueAt, now);

console.log({
  dueAt: dueAt.toISOString(),
  now: new Date(now).toISOString(),
  msUntilDue: dueAt.getTime() - now,
  slot: slot ?? "none (outside reminder window)",
});
