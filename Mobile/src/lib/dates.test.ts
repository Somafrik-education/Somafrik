import assert from "node:assert/strict";
import {
  DISPLAY_DATE_HINT,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  isValidDisplayDate,
  parseDisplayDate,
  toApiDate,
} from "./dates";

assert.equal(DISPLAY_DATE_HINT, "JJ-MM-AAAA");
assert.equal(formatDateForDisplay("2026-09-17"), "17-09-2026");
assert.equal(formatDateForDisplay("2026-01-05"), "05-01-2026");
assert.equal(formatDateForDisplay("2026-09-17T00:00:00.000Z"), "17-09-2026");
assert.equal(isValidDisplayDate("29-02-2028"), true);
assert.equal(isValidDisplayDate("29-02-2027"), false);
assert.equal(isValidDisplayDate("31-02-2026"), false);
assert.equal(isValidDisplayDate("32-13-2026"), false);
assert.equal(parseDisplayDate("17-09-2026"), "2026-09-17");
assert.equal(toApiDate("17-09-2026"), "2026-09-17");
assert.equal(toApiDate("2026-09-17"), "2026-09-17");
assert.equal(parseDisplayDate("29-02-2027"), "");
assert.equal(formatDateForDisplay(null), "");
assert.equal(formatDateForDisplay(undefined), "");
assert.equal(formatDateForDisplay("not-a-date"), "");
assert.match(formatDateTimeForDisplay("2026-09-17T14:35:00+02:00"), /^17-09-2026 14:35$/);

console.log("dates.test.ts: OK");
