/**
 * Vérification des règles métier planning (exécution : npx tsx scripts/verify-planning-rules.ts)
 */
import {
  auditSchoolPlanningConsistency,
  detectDuplicateCoursePlanning,
  detectScheduleConflicts,
  expandScheduleOccurrences,
  isPlanningFullyConsistent,
  repairSchoolCourseSchedules,
  validatePlanningSlotBusinessRules,
  type CourseScheduleSlot,
} from "../src/lib/coursePlanning";
import { fixUtf8Mojibake, resolveCanonicalLabel } from "../src/lib/planningTextRepair";
import type { BackOfficeState, SessionUser } from "../src/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const baseCourse: CourseScheduleSlot = {
  id: "CS-1",
  schoolCode: "CD-2026-0001",
  className: "6ème A",
  subject: "Mathématiques",
  teacherId: "T1",
  teacherName: "Prof A",
  start: "2026-09-14T10:00:00.000Z",
  end: "2026-09-14T11:00:00.000Z",
  kind: "course",
  periodName: "Trimestre 1",
  periodStart: "10-09-2026",
  periodEnd: "23-12-2026",
  dayOfWeek: 1,
  startTime: "10:00",
  endTime: "11:00",
};

function testWeeklyRecurrence() {
  const occurrences = expandScheduleOccurrences(baseCourse);
  assert(occurrences.length >= 10, `Récurrence hebdo : attendu ≥10 occurrences, reçu ${occurrences.length}`);
  const mondays = occurrences.filter((row) => {
    const js = new Date(row.start).getDay();
    return js === 1;
  });
  assert(mondays.length === occurrences.length, "Toutes les occurrences doivent être un lundi (dayOfWeek canonique)");
  const first = new Date(occurrences[0].start);
  assert(first >= new Date("2026-09-10"), "Première occurrence après le début de période");
  const last = new Date(occurrences[occurrences.length - 1].start);
  assert(last <= new Date("2026-12-23T23:59:59"), "Dernière occurrence avant la fin de période");
}

function testDuplicateSubjectPeriod() {
  const existing = [baseCourse];
  const duplicate: CourseScheduleSlot = {
    ...baseCourse,
    id: "CS-2",
    start: "2026-09-15T14:00:00.000Z",
    end: "2026-09-15T15:00:00.000Z",
  };
  const message = detectDuplicateCoursePlanning(existing, duplicate);
  assert(Boolean(message), "Doublon matière/période/classe attendu");
}

function testClassTimeConflict() {
  const other: CourseScheduleSlot = {
    ...baseCourse,
    id: "CS-3",
    subject: "Français",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
  };
  const issues = detectScheduleConflicts([other], baseCourse);
  assert(issues.some((row) => row.includes("Conflit sur")), "Conflit horaire même classe attendu");
}

function testTeacherTimeConflict() {
  // Même enseignant (T1), classes différentes, créneaux qui se chevauchent.
  const otherClassSameTeacher: CourseScheduleSlot = {
    ...baseCourse,
    id: "CS-T-1",
    className: "5ème B",
    subject: "Physique",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
  };
  const teacherConflict = detectScheduleConflicts([otherClassSameTeacher], baseCourse);
  assert(
    teacherConflict.some((row) => row.includes("Conflit enseignant")),
    "Chevauchement enseignant attendu (même prof, deux classes au même horaire)",
  );

  // Enseignant différent sur le même créneau, autre classe : aucun conflit.
  const differentTeacher: CourseScheduleSlot = {
    ...otherClassSameTeacher,
    id: "CS-T-2",
    teacherId: "T2",
    teacherName: "Prof B",
  };
  const noConflict = detectScheduleConflicts([differentTeacher], baseCourse);
  assert(
    !noConflict.some((row) => row.includes("Conflit enseignant")),
    "Aucun conflit enseignant si les professeurs diffèrent",
  );

  // Même enseignant mais créneaux adjacents (pas de chevauchement).
  const adjacent: CourseScheduleSlot = {
    ...otherClassSameTeacher,
    id: "CS-T-3",
    start: "2026-09-14T11:00:00.000Z",
    end: "2026-09-14T12:00:00.000Z",
  };
  const adjacentConflict = detectScheduleConflicts([adjacent], baseCourse);
  assert(
    !adjacentConflict.some((row) => row.includes("Conflit enseignant")),
    "Aucun conflit enseignant si les créneaux sont adjacents (10-11 / 11-12)",
  );

  // La validation métier doit bloquer la double réservation enseignant.
  const blocked = validatePlanningSlotBusinessRules([otherClassSameTeacher], baseCourse, {
    allowedSubjects: ["Mathématiques"],
  });
  assert(
    blocked.some((row) => row.includes("Conflit enseignant")),
    "validatePlanningSlotBusinessRules doit refuser la double réservation enseignant",
  );
}

function testExamSingleOccurrence() {
  const exam: CourseScheduleSlot = {
    ...baseCourse,
    id: "CS-EX",
    kind: "exam",
    examType: "Contrôle",
    periodStart: undefined,
    periodEnd: undefined,
    start: "2026-12-15T10:00:00.000Z",
    end: "2026-12-15T12:00:00.000Z",
  };
  const occurrences = expandScheduleOccurrences(exam);
  assert(occurrences.length === 1, "Examen = une seule occurrence");
}

function testValidationRequiresPeriodForCourse() {
  const noPeriod: CourseScheduleSlot = {
    ...baseCourse,
    periodStart: undefined,
    periodEnd: undefined,
  };
  const issues = validatePlanningSlotBusinessRules([], noPeriod, {
    allowedSubjects: ["Mathématiques"],
  });
  assert(
    issues.some((row) => row.includes("période")),
    "Cours sans période doit être refusé",
  );
}

function testEncodingRepair() {
  const fixed = fixUtf8Mojibake("Math\uFFFDmatiques");
  assert(fixed === "Mathématiques", `Encodage : attendu Mathématiques, reçu ${fixed}`);
  const canonical = resolveCanonicalLabel("1re A", ["1ère A", "2ème B"]);
  assert(canonical === "1ère A", `Classe canonique : attendu 1ère A, reçu ${canonical}`);
}

function testRepairLegacySlots() {
  const user = { schoolCode: "CD-2026-0001", role: "Admin School" } as SessionUser;
  const state = {
    courseSchedules: [
      {
        id: "CS-legacy-1",
        schoolCode: "CD-2026-0001",
        className: "1\uFFFDre A",
        subject: "Math\uFFFDmatiques",
        start: "2026-09-14T08:00:00.000Z",
        end: "2026-09-14T10:00:00.000Z",
        kind: "course",
      },
      {
        id: "CS-legacy-2",
        schoolCode: "CD-2026-0001",
        className: "1\uFFFDre A",
        subject: "Math\uFFFDmatiques",
        start: "2026-09-14T08:00:00.000Z",
        end: "2026-09-14T10:00:00.000Z",
        kind: "course",
      },
      {
        id: "CS-legacy-3",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Anglais",
        start: "2026-09-15T10:00:00.000Z",
        end: "2026-09-15T11:00:00.000Z",
        kind: "course",
      },
    ],
    classes: [{ id: "C1", name: "1ère A", schoolCode: "CD-2026-0001" }],
    courses: [
      { id: "CO1", name: "Mathématiques", className: "1ère A", schoolCode: "CD-2026-0001" },
      { id: "CO2", name: "Anglais", className: "1ère A", schoolCode: "CD-2026-0001" },
    ],
    academicConfigs: {
      "CD-2026-0001": {
        periodMode: "trimestre",
        periods: [{ name: "Trimestre 1", startDate: "10-09-2026", endDate: "23-12-2026", active: true }],
      },
    },
  } as unknown as BackOfficeState;

  const report = repairSchoolCourseSchedules(state, user, "CD-2026-0001");
  assert(report.slots.length === 2, `Réparation : attendu 2 créneaux, reçu ${report.slots.length}`);
  assert(report.duplicatesRemoved === 1, "Un doublon legacy doit être supprimé");
  assert(
    report.slots.every((slot) => slot.periodStart && slot.periodEnd),
    "Tous les cours réparés doivent avoir une période",
  );
  assert(
    report.slots.some((slot) => slot.subject === "Mathématiques" && slot.className === "1ère A"),
    "Libellés UTF-8 restaurés",
  );
}

function testImportPedagogyLinks() {
  const user = { schoolCode: "CD-2026-0001", role: "Admin School" } as SessionUser;
  const state = {
    courseSchedules: [],
    assignments: [
      {
        id: "AS-1",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Sciences",
        teacherId: "T9",
        teacherName: "Prof Sciences",
      },
    ],
    classes: [{ id: "C1", name: "1ère A", schoolCode: "CD-2026-0001" }],
    courses: [],
    academicConfigs: {
      "CD-2026-0001": {
        periodMode: "trimestre",
        periods: [{ name: "Trimestre 1", startDate: "10-09-2026", endDate: "23-12-2026", active: true }],
      },
    },
  } as unknown as BackOfficeState;

  const report = repairSchoolCourseSchedules(state, user, "CD-2026-0001");
  assert(report.migratedFromPedagogy === 1, "Affectation importée en créneau planning");
  assert(
    report.slots.some((slot) => slot.subject === "Sciences" && hasSchedulePeriod(slot)),
    "Créneau importé avec période",
  );
}

function hasSchedulePeriod(slot: CourseScheduleSlot): boolean {
  return Boolean(slot.periodStart && slot.periodEnd);
}

function testFullRepairClearsIssues() {
  const user = { schoolCode: "CD-2026-0001", role: "Admin School" } as SessionUser;
  const state = {
    courseSchedules: [
      {
        id: "CS-a",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Mathématiques",
        teacherId: "T1",
        start: "2026-09-14T08:00:00.000Z",
        end: "2026-09-14T10:00:00.000Z",
        kind: "course",
        periodName: "Trimestre 1",
        periodStart: "10-09-2026",
        periodEnd: "23-12-2026",
      },
      {
        id: "CS-b",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Mathématiques",
        teacherId: "T1",
        start: "2026-09-14T09:00:00.000Z",
        end: "2026-09-14T11:00:00.000Z",
        kind: "course",
        periodName: "Trimestre 1",
        periodStart: "10-09-2026",
        periodEnd: "23-12-2026",
      },
      {
        id: "CS-c",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Français",
        teacherId: "T2",
        start: "2026-09-14T08:00:00.000Z",
        end: "2026-09-14T10:00:00.000Z",
        kind: "course",
        periodName: "Trimestre 1",
        periodStart: "10-09-2026",
        periodEnd: "23-12-2026",
      },
    ],
    assignments: [
      {
        id: "AS-1",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Anglais",
        teacherId: "T3",
        teacherName: "Prof Anglais",
      },
    ],
    exams: [
      {
        id: "EX-1",
        schoolCode: "CD-2026-0001",
        name: "Contrôle Sciences",
        className: "1ère A",
        subject: "Sciences",
        date: "15-12-2026",
        status: "Programmé",
      },
    ],
    classes: [{ id: "C1", name: "1ère A", schoolCode: "CD-2026-0001" }],
    courses: [
      { id: "CO1", name: "Mathématiques", className: "1ère A", schoolCode: "CD-2026-0001", teacherId: "T1" },
      { id: "CO2", name: "Français", className: "1ère A", schoolCode: "CD-2026-0001", teacherId: "T2" },
      { id: "CO3", name: "Anglais", className: "1ère A", schoolCode: "CD-2026-0001", teacherId: "T3" },
    ],
    academicConfigs: {
      "CD-2026-0001": {
        periodMode: "trimestre",
        periods: [{ name: "Trimestre 1", startDate: "10-09-2026", endDate: "23-12-2026", active: true }],
      },
    },
  } as unknown as BackOfficeState;

  const before = auditSchoolPlanningConsistency(
    state.courseSchedules as CourseScheduleSlot[],
    state,
    user,
    "CD-2026-0001",
  );
  assert(before.length > 0, "Jeu de test incohérent attendu avant réparation");

  const report = repairSchoolCourseSchedules(state, user, "CD-2026-0001");
  assert(
    isPlanningFullyConsistent(state, user, "CD-2026-0001", report.slots),
    `Après réparation, alertes restantes : ${auditSchoolPlanningConsistency(report.slots, state, user, "CD-2026-0001")
      .map((row) => row.message)
      .join(" | ")}`,
  );
  assert(report.conflictsResolved >= 1, "Au moins un conflit horaire doit être résolu");
}

const checks = [
  ["Récurrence hebdomadaire lundi → déc.", testWeeklyRecurrence],
  ["Doublon matière / classe / période", testDuplicateSubjectPeriod],
  ["Conflit horaire même classe", testClassTimeConflict],
  ["Chevauchement enseignant (double réservation)", testTeacherTimeConflict],
  ["Examen ponctuel", testExamSingleOccurrence],
  ["Cours sans période refusé", testValidationRequiresPeriodForCourse],
  ["Réparation encodage UTF-8", testEncodingRepair],
  ["Réparation legacy (période + dédoublonnage)", testRepairLegacySlots],
  ["Import affectations → planning", testImportPedagogyLinks],
  ["Réparation complète sans alerte", testFullRepairClearsIssues],
] as const;

let passed = 0;
for (const [label, fn] of checks) {
  fn();
  passed += 1;
  console.log(`✓ ${label}`);
}

console.log(`\n${passed}/${checks.length} vérifications métier OK.`);
