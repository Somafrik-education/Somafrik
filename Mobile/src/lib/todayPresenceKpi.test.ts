/**
 * KPI Présence du jour — établissement, fuseau école, roster attendu.
 *   npx tsx Mobile/src/lib/todayPresenceKpi.test.ts
 */
import assert from "node:assert/strict";
import {
  TODAY_PRESENCE_KPI_LABEL,
  civilDateKeyInTimeZone,
  getTodayEstablishmentPresenceKpi,
  isExpectedStudentForToday,
} from "./todayPresenceKpi";

const TODAY = "2026-08-24";
const NOW = new Date("2026-08-24T12:00:00.000Z");
const TZ = "Africa/Kinshasa";
const SCHOOL = "CD-IN-26-001";

function student(
  id: string,
  extras: Record<string, unknown> = {},
) {
  return {
    id,
    matricule: id,
    publicId: id,
    className: "6ème A",
    schoolCode: SCHOOL,
    archived: false,
    ...extras,
  };
}

function presence(studentId: string, status: string, date = TODAY) {
  return {
    studentId,
    status,
    date,
    present: status === "Présent" || status === "Retard",
  };
}

function kpi(students: ReturnType<typeof student>[], presences: ReturnType<typeof presence>[]) {
  return getTodayEstablishmentPresenceKpi({
    students,
    presences,
    schoolCode: SCHOOL,
    timeZone: TZ,
    now: NOW,
  });
}

function run() {
  assert.equal(TODAY_PRESENCE_KPI_LABEL, "Présence du jour");
  assert.equal(civilDateKeyInTimeZone(NOW, TZ), TODAY);

  const five = ["s1", "s2", "s3", "s4", "s5"].map((id, index) =>
    student(id, { className: index < 3 ? "6ème A" : "6ème B" }),
  );

  const mixed = kpi(five, [
    presence("s1", "Présent"),
    presence("s2", "Présent"),
    presence("s3", "Présent"),
    presence("s4", "Retard"),
    presence("s5", "Absent"),
  ]);
  assert.equal(mixed.label, "Présence du jour");
  assert.equal(mixed.value, "80 %");
  assert.equal(mixed.rate, 80);
  assert.equal(mixed.expected, 5);

  const allPresent = kpi(
    five,
    five.map((row) => presence(row.id, "Présent")),
  );
  assert.equal(allPresent.value, "100 %");

  const nonePresent = kpi(
    five,
    five.map((row) => presence(row.id, "Absent")),
  );
  assert.equal(nonePresent.value, "0 %");
  assert.equal(nonePresent.rate, 0);

  const noCall = kpi(five, []);
  assert.equal(noCall.value, "—");
  assert.equal(noCall.rate, null);

  const partialCall = kpi(five, [presence("s1", "Présent")]);
  assert.equal(partialCall.value, "—", "une seule ligne d'appel ne transforme pas les non-appelés en absents");
  assert.equal(partialCall.rate, null);
  assert.equal(partialCall.recorded, 1);
  assert.equal(partialCall.expected, 5);

  const yesterdayOnly = kpi(
    five,
    five.map((row) => presence(row.id, "Présent", "2026-08-23")),
  );
  assert.equal(yesterdayOnly.value, "—");

  const withArchived = kpi(
    [...five, student("s-arch", { archived: true, className: "6ème A" })],
    [
      ...five.map((row) => presence(row.id, "Présent")),
      presence("s-arch", "Présent"),
    ],
  );
  assert.equal(withArchived.expected, 5);
  assert.equal(withArchived.value, "100 %");
  assert.equal(isExpectedStudentForToday(student("s-arch", { archived: true }), SCHOOL), false);

  const otherSchool = kpi(
    [...five, student("s-ext", { schoolCode: "BI-EC-26-001" })],
    [...five.map((row) => presence(row.id, "Présent")), presence("s-ext", "Présent")],
  );
  assert.equal(otherSchool.expected, 5);

  const justified = kpi(five, [
    presence("s1", "Présent"),
    presence("s2", "Présent"),
    presence("s3", "Présent"),
    presence("s4", "Retard"),
    presence("s5", "Justifié"),
  ]);
  assert.equal(justified.value, "80 %", "Justifié n'entre pas au numérateur");

  const nyDate = civilDateKeyInTimeZone(new Date("2026-08-24T00:30:00.000Z"), "America/New_York");
  const kinDate = civilDateKeyInTimeZone(new Date("2026-08-24T00:30:00.000Z"), "Africa/Kinshasa");
  assert.equal(nyDate, "2026-08-23");
  assert.equal(kinDate, "2026-08-24");

  console.log("OK: todayPresenceKpi Présence du jour");
}

run();
