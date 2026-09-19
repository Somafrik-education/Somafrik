import { describe, expect, it } from "vitest";
import {
  CLASS_EMPTY_PRESENCE_BADGE,
  CLASS_UNSET_PRESENCE_LABEL,
  formatClassTodayPresenceBadge,
  resolveClassTodayPresenceBadge,
  resolveExpectedStudentsForClassCard,
} from "./classTodayPresenceBadge";

describe("formatClassTodayPresenceBadge — fail-closed numérique", () => {
  it("aucun élève attendu → Présence —", () => {
    expect(formatClassTodayPresenceBadge({ expected: 0, recorded: 0, attended: 0 })).toEqual({
      kind: "empty",
      badgeText: CLASS_EMPTY_PRESENCE_BADGE,
      rate: null,
      expected: 0,
      recorded: 0,
      attended: 0,
    });
  });

  it("expected 3 / recorded 4 → Non saisi", () => {
    const badge = formatClassTodayPresenceBadge({ expected: 3, recorded: 4, attended: 3 });
    expect(badge.kind).toBe("unset");
    expect(badge.badgeText).toBe(CLASS_UNSET_PRESENCE_LABEL);
    expect(badge.rate).toBeNull();
  });

  it("recorded !== expected (partiel) → Non saisi, jamais un pourcentage", () => {
    const badge = formatClassTodayPresenceBadge({ expected: 3, recorded: 2, attended: 2 });
    expect(badge.kind).toBe("unset");
    expect(badge.badgeText).toBe(CLASS_UNSET_PRESENCE_LABEL);
    expect(badge.rate).toBeNull();
  });
});

describe("resolveClassTodayPresenceBadge — roster attendu", () => {
  const A = { id: "A", matricule: "A" };
  const B = { id: "B", matricule: "B" };
  const C = { id: "C", matricule: "C" };
  const todayLabel = "19-09-2026";

  it("expected A/B/C, lignes A/B/D → Non saisi", () => {
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: [A, B, C],
      todayRows: [
        { studentId: "A", date: "2026-09-19", status: "Présent", present: true },
        { studentId: "B", date: "2026-09-19", status: "Présent", present: true },
        { studentId: "D", date: "2026-09-19", status: "Présent", present: true },
      ],
      todayLabel,
    });
    expect(badge.kind).toBe("unset");
    expect(badge.badgeText).toBe(CLASS_UNSET_PRESENCE_LABEL);
    expect(badge.recorded).toBe(2);
    expect(badge.expected).toBe(3);
    expect(badge.rate).toBeNull();
  });

  it("expected A/B/C, lignes A/B/C → taux calculé", () => {
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: [A, B, C],
      todayRows: [
        { studentId: "A", date: "2026-09-19", status: "Présent", present: true },
        { studentId: "B", date: "2026-09-19", status: "Retard", present: true },
        { studentId: "C", date: "2026-09-19", status: "Absent", present: false },
      ],
      todayLabel,
    });
    expect(badge.kind).toBe("rate");
    expect(badge.badgeText).toBe("Présence 67 %");
    expect(badge.rate).toBe(67);
    expect(badge.attended).toBe(2);
  });

  it("tous absents mais A/B/C réellement couverts → Présence 0 %", () => {
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: [A, B, C],
      todayRows: [
        { studentId: "A", date: "2026-09-19", status: "Absent", present: false },
        { studentId: "B", date: "2026-09-19", status: "Justifié", present: false },
        { studentId: "C", date: "2026-09-19", status: "Absent", present: false },
      ],
      todayLabel,
    });
    expect(badge.kind).toBe("rate");
    expect(badge.badgeText).toBe("Présence 0 %");
    expect(badge.rate).toBe(0);
  });

  it("aucun élève attendu → Présence —", () => {
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: [],
      todayRows: [{ studentId: "D", date: "2026-09-19", status: "Présent", present: true }],
      todayLabel,
    });
    expect(badge.kind).toBe("empty");
    expect(badge.badgeText).toBe(CLASS_EMPTY_PRESENCE_BADGE);
    expect(badge.rate).toBeNull();
  });

  it("roster attendu indisponible → Non saisi, jamais un taux inventé", () => {
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: null,
      todayRows: [
        { studentId: "A", date: "2026-09-19", status: "Présent", present: true },
        { studentId: "B", date: "2026-09-19", status: "Présent", present: true },
        { studentId: "C", date: "2026-09-19", status: "Présent", present: true },
      ],
      todayLabel,
    });
    expect(badge.kind).toBe("unset");
    expect(badge.badgeText).toBe(CLASS_UNSET_PRESENCE_LABEL);
    expect(badge.rate).toBeNull();
  });
});

describe("resolveExpectedStudentsForClassCard", () => {
  it("studentCount 0 → roster vide fiable", () => {
    expect(
      resolveExpectedStudentsForClassCard({
        studentCount: 0,
        students: [{ id: "A", classId: "uuid-a", classCode: "CLS-A" }],
        classId: "uuid-a",
        classCode: "CLS-A",
      }),
    ).toEqual([]);
  });

  it("hydratation partielle vs studentCount → null fail-closed", () => {
    expect(
      resolveExpectedStudentsForClassCard({
        studentCount: 3,
        students: [
          { id: "A", classId: "uuid-a", classCode: "CLS-A" },
          { id: "B", classId: "uuid-a", classCode: "CLS-A" },
        ],
        classId: "uuid-a",
        classCode: "CLS-A",
      }),
    ).toBeNull();
  });
});
