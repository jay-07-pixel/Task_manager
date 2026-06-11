import {
  bumpedRecurrenceRuleJson,
  computeNextDueAt,
  computePreviousDueAt,
  recurrenceEndsAfterThisCompletion,
  recurrenceNextDueExceedsEndOn,
  shouldRollOnEmployeeComplete,
} from "../src/lib/recurrenceRoll.js";

const due = new Date("2026-06-02T01:36:00.000Z");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(shouldRollOnEmployeeComplete("yearly", null), "yearly rolls");
assert(shouldRollOnEmployeeComplete("custom", JSON.stringify({ unit: "year", every: 1 })), "custom year rolls");

const nextYear = computeNextDueAt(due, "yearly", false, null);
assert(nextYear.getUTCFullYear() === 2027, "yearly +1 year");

const prevDay = computePreviousDueAt(new Date("2026-06-12T12:00:00.000Z"), "daily", true, null);
assert(prevDay.toISOString().startsWith("2026-06-11"), "daily previous due");

const ruleAfter = JSON.stringify({
  every: 1,
  unit: "day",
  endType: "after",
  endAfterOccurrences: 3,
  occurrencesCompleted: 2,
});
assert(recurrenceEndsAfterThisCompletion("custom", ruleAfter), "after 3 stops on 3rd complete");

const ruleOn = JSON.stringify({ every: 1, unit: "day", endType: "on", endOn: "2026-06-03" });
const dueJune3 = new Date("2026-06-03T01:36:00.000Z");
const nextFromJune3 = computeNextDueAt(dueJune3, "custom", false, ruleOn);
assert(recurrenceNextDueExceedsEndOn(nextFromJune3, ruleOn), "end on blocks next after end date");

const bumped = bumpedRecurrenceRuleJson(JSON.stringify({ every: 1, unit: "day", endType: "never" }));
assert(JSON.parse(bumped).occurrencesCompleted === 1, "increments occurrence count");

console.log("recurrenceRoll tests OK");
