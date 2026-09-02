import { describe, expect, it } from "vitest";
import { toCivilDate, visibleCivilRange } from "./planningCalendarUtils";

describe("planningCalendarUtils — plage civile calendrier", () => {
  it("toCivilDate formate YYYY-MM-DD en local, sans toISOString", () => {
    const date = new Date(2026, 8, 7, 23, 30, 0);
    expect(toCivilDate(date)).toBe("2026-09-07");
  });

  it("visibleCivilRange week lun–dim n'invente pas d'occurrences", () => {
    const monday = new Date(2026, 8, 7, 10, 0, 0);
    const range = visibleCivilRange("week", monday);
    expect(range).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });
});
