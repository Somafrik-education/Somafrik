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

const CLASS_A = "uuid-primaire-a";
const CODE_A = "CLS-1PA";
const TODAY = "19-09-2026";

function primaireStudents(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    id: `STU-${index + 1}`,
    matricule: `STU-${index + 1}`,
    classId: CLASS_A,
    classCode: CODE_A,
    className: "1ère Primaire A",
    schoolCode: "SCH-A",
    status: "ENROLLED",
  }));
}

describe("resolveExpectedStudentsForClassCard", () => {
  it("studentCount 0 + élèves canoniques de la classe → le roster fait foi", () => {
    const students = primaireStudents();
    expect(
      resolveExpectedStudentsForClassCard({
        studentCount: 0,
        students,
        classId: CLASS_A,
        classCode: CODE_A,
        schoolCode: "SCH-A",
      }),
    ).toEqual(students);
  });

  it("0 réel et aucun élève canonique → roster vide, même si des lignes d'appel existent", () => {
    const expected = resolveExpectedStudentsForClassCard({
      studentCount: 0,
      students: [],
      classId: CLASS_A,
      classCode: CODE_A,
    });
    expect(expected).toEqual([]);
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: expected,
      todayRows: [{ studentId: "STU-1", date: "2026-09-19", status: "Présent", present: true }],
      todayLabel: TODAY,
    });
    expect(badge.kind).toBe("empty");
    expect(badge.badgeText).toBe(CLASS_EMPTY_PRESENCE_BADGE);
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

  it("classId divergent ne retombe pas sur classCode ni className", () => {
    expect(
      resolveExpectedStudentsForClassCard({
        studentCount: 0,
        students: [
          {
            id: "X",
            classId: "uuid-other",
            classCode: CODE_A,
            className: "1ère Primaire A",
          },
        ],
        classId: CLASS_A,
        classCode: CODE_A,
      }),
    ).toEqual([]);
  });

  it("classCode est le repli canonique quand classId est absent", () => {
    const student = { id: "A", classCode: CODE_A, className: "autre nom" };
    expect(
      resolveExpectedStudentsForClassCard({
        studentCount: 0,
        students: [student],
        classId: CLASS_A,
        classCode: CODE_A,
      }),
    ).toEqual([student]);
  });

  it("className seul ne rattache pas l'élève", () => {
    expect(
      resolveExpectedStudentsForClassCard({
        studentCount: 0,
        students: [{ id: "A", className: "1ère Primaire A" }],
        classId: CLASS_A,
        classCode: CODE_A,
      }),
    ).toEqual([]);
  });

  it("deux classes homonymes ne partagent pas leur roster", () => {
    const students = [
      ...primaireStudents(),
      {
        id: "STU-B",
        classId: "uuid-primaire-b",
        classCode: "CLS-1PB",
        className: "1ère Primaire A",
        schoolCode: "SCH-A",
        status: "ENROLLED",
      },
    ];
    const expectedA = resolveExpectedStudentsForClassCard({
      studentCount: 0,
      students,
      classId: CLASS_A,
      classCode: CODE_A,
      schoolCode: "SCH-A",
    });
    const expectedB = resolveExpectedStudentsForClassCard({
      studentCount: 0,
      students,
      classId: "uuid-primaire-b",
      classCode: "CLS-1PB",
      schoolCode: "SCH-A",
    });
    expect(expectedA?.map((student) => student.id)).toEqual(primaireStudents().map((student) => student.id));
    expect(expectedB?.map((student) => student.id)).toEqual(["STU-B"]);
  });

  it("aucune fuite cross-school quand les deux schoolCode sont connus", () => {
    const expected = resolveExpectedStudentsForClassCard({
      studentCount: 0,
      students: [
        { id: "local", classId: CLASS_A, classCode: CODE_A, schoolCode: "SCH-A" },
        { id: "foreign", classId: CLASS_A, classCode: CODE_A, schoolCode: "SCH-B" },
      ],
      classId: CLASS_A,
      classCode: CODE_A,
      schoolCode: "SCH-A",
    });
    expect(expected?.map((student) => student.id)).toEqual(["local"]);
  });
});

describe("P1 #759 — compteur classe à 0 et appel réel", () => {
  it("6 élèves canoniques + appel complet → effectif 6 et Présence N %", () => {
    const students = primaireStudents();
    const expected = resolveExpectedStudentsForClassCard({
      studentCount: 0,
      students,
      classId: CLASS_A,
      classCode: CODE_A,
      schoolCode: "SCH-A",
    });
    expect(expected).toHaveLength(6);
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: expected,
      todayRows: students.map((student, index) => ({
        studentId: student.id,
        classId: CLASS_A,
        classCode: CODE_A,
        date: "2026-09-19",
        status: index === 0 ? "Absent" : "Présent",
        present: index !== 0,
      })),
      todayLabel: TODAY,
    });
    expect(badge.kind).toBe("rate");
    expect(badge.badgeText).toBe("Présence 83 %");
    expect(badge.expected).toBe(6);
    expect(badge.rate).toBe(83);
  });

  it("tous absents → Présence 0 %, pas Présence —", () => {
    const students = primaireStudents();
    const expected = resolveExpectedStudentsForClassCard({
      studentCount: 0,
      students,
      classId: CLASS_A,
      classCode: CODE_A,
    });
    const badge = resolveClassTodayPresenceBadge({
      expectedStudents: expected,
      todayRows: students.map((student) => ({
        studentId: student.id,
        date: "2026-09-19",
        status: "Absent",
        present: false,
      })),
      todayLabel: TODAY,
    });
    expect(badge.kind).toBe("rate");
    expect(badge.badgeText).toBe("Présence 0 %");
    expect(badge.rate).toBe(0);
  });
});
