import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultPeriodsForMode,
  findActivePeriodIndexByDate,
  normalizeStoredPeriods,
  resolveAcademicYearBounds,
  selectCurrentAcademicYear,
  serializePeriods,
} from "./schoolAcademicPeriods";

const YEAR_2026_2027 = {
  name: "2026-2027",
  startDate: "2026-09-01",
  endDate: "2027-08-31",
  isCurrent: true,
};

const AUG_23_2026 = new Date(2026, 7, 23);
const OCT_15_2026 = new Date(2026, 9, 15);
const FEB_10_2027 = new Date(2027, 1, 10);

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schoolAcademicPeriods.ts");
const source = fs.readFileSync(sourcePath, "utf8");
assert.doesNotMatch(source, /01-09-2025/, "aucune date par défaut 2025–2026 ne doit rester codée en dur");
assert.doesNotMatch(source, /31-12-2025/);
assert.doesNotMatch(source, /30-06-2026/);

const bounds = resolveAcademicYearBounds(YEAR_2026_2027, AUG_23_2026);
assert.equal(bounds.startYear, 2026);
assert.equal(bounds.endYear, 2027);
assert.equal(bounds.start.getFullYear(), 2026);
assert.equal(bounds.start.getMonth(), 8);
assert.equal(bounds.start.getDate(), 1);

const namedOnly = resolveAcademicYearBounds({ name: "2026-2027" }, AUG_23_2026);
assert.equal(namedOnly.startYear, 2026);
assert.equal(namedOnly.endYear, 2027);
assert.equal(namedOnly.start.getMonth(), 8);
assert.equal(namedOnly.start.getDate(), 1);

assert.equal(selectCurrentAcademicYear([YEAR_2026_2027])?.name, "2026-2027");
assert.equal(
  selectCurrentAcademicYear([
    { name: "2025-2026", isCurrent: false },
    YEAR_2026_2027,
  ])?.name,
  "2026-2027",
);

const rows = defaultPeriodsForMode("trimestre", AUG_23_2026, YEAR_2026_2027);
assert.equal(rows.length, 3);
assert.equal(rows[0].startDate, "01-09-2026");
assert.equal(rows[0].endDate, "31-12-2026");
assert.equal(rows[1].startDate, "01-01-2027");
assert.equal(rows[1].endDate, "31-03-2027");
assert.equal(rows[2].startDate, "01-04-2027");
assert.equal(rows[2].endDate, "30-06-2027");
assert.equal(
  rows.every((row) => row.active === false),
  true,
  "le 23 août 2026 est hors bornes : aucune période ne doit être forcée active",
);
assert.equal(findActivePeriodIndexByDate(rows, AUG_23_2026), -1);
assert.equal(
  JSON.stringify(rows).includes("2025"),
  false,
  "T1 2025 ne doit jamais être généré pour 2026–2027",
);

const serialized = serializePeriods(rows, "trimestre", AUG_23_2026, YEAR_2026_2027);
assert.equal(serialized[0].startDate, "01-09-2026");
assert.equal(
  serialized.every((row) => row.active === false),
  true,
  "serializePeriods ne doit pas enregistrer T1 comme actif hors bornes",
);

const emptySerialized = serializePeriods([], "trimestre", AUG_23_2026, YEAR_2026_2027);
assert.equal(emptySerialized[0].startDate, "01-09-2026");
assert.equal(emptySerialized.every((row) => row.active === false), true);

const october = defaultPeriodsForMode("trimestre", OCT_15_2026, YEAR_2026_2027);
assert.equal(october[0].active, true);
assert.equal(october[1].active, false);
assert.equal(october[2].active, false);
assert.equal(findActivePeriodIndexByDate(october, OCT_15_2026), 0);

const february = defaultPeriodsForMode("trimestre", FEB_10_2027, YEAR_2026_2027);
assert.equal(february[1].active, true);
assert.equal(february[0].active, false);

const semesters = defaultPeriodsForMode("semestre", AUG_23_2026, YEAR_2026_2027);
assert.equal(semesters[0].startDate, "01-09-2026");
assert.equal(semesters[0].endDate, "31-01-2027");
assert.equal(semesters[1].startDate, "01-02-2027");
assert.equal(semesters[1].endDate, "30-06-2027");
assert.equal(semesters.every((row) => row.active === false), true);

const custom = defaultPeriodsForMode("periode", AUG_23_2026, { name: "2026-2027" });
assert.equal(custom[0].startDate, "01-09-2026");
assert.equal(custom[0].endDate, "31-10-2026");
assert.equal(custom[0].active, false);

const normalizedEmpty = normalizeStoredPeriods([], "trimestre", AUG_23_2026, YEAR_2026_2027);
assert.equal(normalizedEmpty[0].startDate, "01-09-2026");
assert.equal(normalizedEmpty.every((row) => row.active === false), true);

const stale2025 = normalizeStoredPeriods(
  [
    { name: "Trimestre 1", type: "Trimestre", startDate: "01-09-2025", endDate: "31-12-2025", order: 1 },
    { name: "Trimestre 2", type: "Trimestre", startDate: "01-01-2026", endDate: "31-03-2026", order: 2 },
    { name: "Trimestre 3", type: "Trimestre", startDate: "01-04-2026", endDate: "30-06-2026", order: 3 },
  ],
  "trimestre",
  AUG_23_2026,
  YEAR_2026_2027,
);
assert.equal(
  stale2025.every((row) => row.active === false),
  true,
  "des périodes 2025 expirées ne doivent pas être forcées actives le 23 août 2026",
);

const clockFallback = defaultPeriodsForMode("trimestre", AUG_23_2026);
assert.equal(clockFallback[0].startDate, "01-09-2026");
assert.equal(clockFallback.every((row) => row.active === false), true);

console.log("schoolAcademicPeriods.test.ts OK");
