import { describe, expect, it } from "vitest";
import {
  TODAY_PRESENCE_KPI_LABEL,
  civilDateKeyInTimeZone,
  getTodayEstablishmentPresenceKpi,
  isExpectedStudentForToday,
} from "./presenceMetrics";

const TODAY = "2026-08-24";
const NOW = new Date("2026-08-24T12:00:00.000Z");
const TZ = "Africa/Kinshasa";
const SCHOOL = "CD-IN-26-001";

function student(id: string, extras: Record<string, unknown> = {}) {
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

describe("Présence du jour (Web, équivalent Mobile)", () => {
  it("libellé = Présence du jour", () => {
    expect(TODAY_PRESENCE_KPI_LABEL).toBe("Présence du jour");
  });

  it("5 élèves, 3 présents, 1 retard, 1 absent → 80 %", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id, index) =>
      student(id, { className: index < 3 ? "6ème A" : "6ème B" }),
    );
    const result = kpi(five, [
      presence("s1", "Présent"),
      presence("s2", "Présent"),
      presence("s3", "Présent"),
      presence("s4", "Retard"),
      presence("s5", "Absent"),
    ]);
    expect(result.label).toBe("Présence du jour");
    expect(result.value).toBe("80 %");
    expect(result.expected).toBe(5);
  });

  it("5 élèves, 5 présents → 100 %", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    expect(kpi(five, five.map((row) => presence(row.id, "Présent"))).value).toBe("100 %");
  });

  it("5 élèves, 0 présent après appel complet → 0 %", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    const result = kpi(five, five.map((row) => presence(row.id, "Absent")));
    expect(result.value).toBe("0 %");
    expect(result.rate).toBe(0);
  });

  it("aucun appel aujourd'hui → —", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    expect(kpi(five, []).value).toBe("—");
    expect(kpi(five, []).rate).toBeNull();
  });

  it("appel partiel (1 ligne / 5 attendus) → —", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    const result = kpi(five, [presence("s1", "Présent")]);
    expect(result.value).toBe("—");
    expect(result.rate).toBeNull();
    expect(result.recorded).toBe(1);
    expect(result.expected).toBe(5);
  });

  it("présence d'hier uniquement → —", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    expect(kpi(five, five.map((row) => presence(row.id, "Présent", "2026-08-23"))).value).toBe("—");
  });

  it("élève archivé exclu du dénominateur", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    const result = kpi(
      [...five, student("s-arch", { archived: true })],
      [...five.map((row) => presence(row.id, "Présent")), presence("s-arch", "Présent")],
    );
    expect(result.expected).toBe(5);
    expect(isExpectedStudentForToday(student("s-arch", { archived: true }), SCHOOL)).toBe(false);
  });

  it("élève autre établissement exclu", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    expect(
      kpi([...five, student("s-ext", { schoolCode: "BI-EC-26-001" })], five.map((row) => presence(row.id, "Présent")))
        .expected,
    ).toBe(5);
  });

  it("Retard compté présent ; Justifié non compté au numérateur", () => {
    const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => student(id));
    expect(
      kpi(five, [
        presence("s1", "Présent"),
        presence("s2", "Présent"),
        presence("s3", "Présent"),
        presence("s4", "Retard"),
        presence("s5", "Justifié"),
      ]).value,
    ).toBe("80 %");
  });

  it("aujourd'hui = date civile du fuseau établissement", () => {
    expect(civilDateKeyInTimeZone(new Date("2026-08-24T00:30:00.000Z"), "America/New_York")).toBe("2026-08-23");
    expect(civilDateKeyInTimeZone(new Date("2026-08-24T00:30:00.000Z"), "Africa/Kinshasa")).toBe("2026-08-24");
  });
});
