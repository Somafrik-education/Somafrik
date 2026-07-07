import { describe, it, expect } from "vitest";

import {
  resolveTeacherRecordForUser,
  teacherScopedClassNames,
  scopedStudents,
  scopedClasses,
  scopedTeachers,
} from "../src/lib/establishment";
import {
  parsePeriodDate,
  periodDateToInput,
  inputToPeriodDate,
} from "../src/lib/academicPeriods";
import { entityCreateViaContactsOnly } from "../src/lib/entityModules";
import {
  enforceSinglePrincipalParent,
  getRelationParentContactOptions,
} from "../src/lib/relations";
import { getLinkableContactOptions } from "../src/lib/contacts";
import { getSchoolPeriodNames } from "../src/lib/evaluations";
import {
  detectScheduleConflicts,
  validatePlanningSlotBusinessRules,
  type CourseScheduleSlot,
} from "../src/lib/coursePlanning";
import type { BackOfficeState, SessionUser } from "../src/types";

/**
 * Suite de vérification des relations logiques métier :
 * compte utilisateur ↔ fiche enseignant ↔ classe ↔ élève ↔ affectation,
 * portée des données (école / enseignant) et utilitaires de dates.
 *
 * Ces fonctions sont pures : on injecte des états minimaux et on vérifie
 * que le filtrage/rattachement se comporte comme spécifié.
 */

type Row = Record<string, unknown>;

function makeState(overrides: Partial<Record<string, Row[]>> = {}): BackOfficeState {
  const base: Record<string, Row[]> = {
    schools: [
      { code: "SCH1", name: "École 1" },
      { code: "SCH2", name: "École 2" },
    ],
    students: [],
    teachers: [],
    classes: [],
    assignments: [],
    contacts: [],
    relations: [],
    payments: [],
    presences: [],
    notes: [],
    users: [],
  };
  return { ...base, ...overrides } as unknown as BackOfficeState;
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}): SessionUser {
  return {
    id: "user-1",
    identifier: "USR-1",
    role: "Admin School",
    schoolCode: "SCH1",
    firstName: "Ada",
    lastName: "Lovelace",
    ...overrides,
  } as unknown as SessionUser;
}

const teacherUser = (overrides: Partial<Record<string, unknown>> = {}): SessionUser =>
  makeUser({ role: "Enseignant", ...overrides });

// ---------------------------------------------------------------------------
// resolveTeacherRecordForUser : compte ↔ fiche enseignant
// ---------------------------------------------------------------------------
describe("resolveTeacherRecordForUser", () => {
  it("retourne null pour un utilisateur absent", () => {
    expect(resolveTeacherRecordForUser(null, makeState())).toBeNull();
  });

  it("rattache la fiche via userId", () => {
    const state = makeState({
      teachers: [
        { id: "T-A", userId: "user-1", name: "Seke" },
        { id: "T-B", userId: "user-2", name: "Autre" },
      ],
    });
    const found = resolveTeacherRecordForUser(makeUser(), state);
    expect(found?.id).toBe("T-A");
  });

  it("rattache la fiche via identifiant (normalisé) quand userId absent", () => {
    const state = makeState({
      teachers: [{ id: "T-A", identifier: "ens-0002", name: "Seke" }],
    });
    const user = teacherUser({ id: "", identifier: "ENS-0002" });
    const found = resolveTeacherRecordForUser(user, state);
    expect(found?.id).toBe("T-A");
  });

  it("retourne null si aucune correspondance", () => {
    const state = makeState({ teachers: [{ id: "T-A", userId: "zzz" }] });
    expect(resolveTeacherRecordForUser(makeUser(), state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// teacherScopedClassNames : enseignant ↔ classes affectées
// ---------------------------------------------------------------------------
describe("teacherScopedClassNames", () => {
  it("retourne null pour un rôle non enseignant", () => {
    const state = makeState({ classes: [{ name: "6ème A", teacherId: "user-1" }] });
    expect(teacherScopedClassNames(makeUser(), state)).toBeNull();
  });

  it("détecte les classes via teacher.assignedClasses", () => {
    const state = makeState({
      teachers: [{ id: "T", userId: "user-1", assignedClasses: ["6ème A", "6ème B"] }],
    });
    const names = teacherScopedClassNames(teacherUser(), state);
    expect(names).not.toBeNull();
    expect(names?.has("6eme a")).toBe(true);
    expect(names?.has("6eme b")).toBe(true);
  });

  it("détecte les classes via teacher.assignments[].className", () => {
    const state = makeState({
      teachers: [{ id: "T", userId: "user-1", assignments: [{ className: "Terminale S" }] }],
    });
    const names = teacherScopedClassNames(teacherUser(), state);
    expect(names?.has("terminale s")).toBe(true);
  });

  it("détecte les classes via classes.teacherId == teacher.id", () => {
    const state = makeState({
      teachers: [{ id: "uuid-1", userId: "user-1" }],
      classes: [{ name: "5ème C", teacherId: "uuid-1" }],
    });
    const names = teacherScopedClassNames(teacherUser(), state);
    expect(names?.has("5eme c")).toBe(true);
  });

  it("détecte les classes via classes.teacherId == teacher.publicId", () => {
    const state = makeState({
      teachers: [{ id: "uuid-1", publicId: "ENS-0002", userId: "user-1" }],
      classes: [{ name: "4ème D", teacherId: "ENS-0002" }],
    });
    const names = teacherScopedClassNames(teacherUser(), state);
    expect(names?.has("4eme d")).toBe(true);
  });

  it("détecte les classes via assignments.teacherId (publicId)", () => {
    const state = makeState({
      teachers: [{ id: "uuid-1", publicId: "ENS-9", userId: "user-1" }],
      assignments: [{ teacherId: "ENS-9", className: "3ème A" }],
    });
    const names = teacherScopedClassNames(teacherUser(), state);
    expect(names?.has("3eme a")).toBe(true);
  });

  it("détecte les classes via assignments.teacherName (nom complet)", () => {
    const state = makeState({
      teachers: [{ id: "T", userId: "user-1", firstName: "Kilombo", lastName: "Seke" }],
      assignments: [{ teacherName: "Kilombo Seke", className: "1ère L" }],
    });
    const names = teacherScopedClassNames(teacherUser(), state);
    expect(names?.has("1ere l")).toBe(true);
  });

  it("rattache via l'identité du compte quand la fiche est liée par identifiant", () => {
    const state = makeState({
      teachers: [{ id: "T", identifier: "ENS-9", assignedClasses: ["5ème B"] }],
    });
    const user = teacherUser({ id: "", identifier: "ENS-9" });
    const names = teacherScopedClassNames(user, state);
    expect(names?.has("5eme b")).toBe(true);
  });

  it("retourne null (pas de verrouillage) pour un enseignant sans aucune classe", () => {
    const state = makeState({
      teachers: [{ id: "T", userId: "user-1" }],
      classes: [{ name: "6ème A", teacherId: "autre" }],
    });
    expect(teacherScopedClassNames(teacherUser(), state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scopedStudents : portée élèves (école + enseignant)
// ---------------------------------------------------------------------------
describe("scopedStudents", () => {
  const students = [
    { id: "s1", schoolCode: "SCH1", className: "6ème A" },
    { id: "s2", schoolCode: "SCH1", className: "6ème B" },
    { id: "s3", schoolCode: "SCH2", className: "6ème A" },
  ];

  it("portée plateforme ('*') : tous les élèves", () => {
    const state = makeState({ students });
    const rows = scopedStudents(makeUser({ schoolCode: "*" }), state);
    expect(rows).toHaveLength(3);
  });

  it("admin école : uniquement les élèves de son école", () => {
    const state = makeState({ students });
    const rows = scopedStudents(makeUser({ schoolCode: "SCH1" }), state);
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("enseignant affecté : uniquement les élèves de ses classes", () => {
    const state = makeState({
      students,
      teachers: [{ id: "T", userId: "user-1", assignedClasses: ["6ème A"] }],
    });
    const rows = scopedStudents(teacherUser({ schoolCode: "SCH1" }), state);
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("enseignant sans affectation : retombe sur la portée établissement", () => {
    const state = makeState({
      students,
      teachers: [{ id: "T", userId: "user-1" }],
    });
    const rows = scopedStudents(teacherUser({ schoolCode: "SCH1" }), state);
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2"]);
  });
});

// ---------------------------------------------------------------------------
// scopedClasses : classes réelles + synthétiques, restriction enseignant
// ---------------------------------------------------------------------------
describe("scopedClasses", () => {
  it("crée des classes synthétiques à partir des className des élèves", () => {
    const state = makeState({
      students: [{ id: "s1", schoolCode: "SCH1", className: "6ème A" }],
      classes: [],
    });
    const rows = scopedClasses(makeUser({ schoolCode: "SCH1" }), state);
    expect(rows.some((c) => c.name === "6ème A")).toBe(true);
  });

  it("dédoublonne les classes par nom", () => {
    const state = makeState({
      students: [{ id: "s1", schoolCode: "SCH1", className: "6ème A" }],
      classes: [{ id: "c1", name: "6ème A", schoolCode: "SCH1" }],
    });
    const rows = scopedClasses(makeUser({ schoolCode: "SCH1" }), state);
    expect(rows.filter((c) => c.name === "6ème A")).toHaveLength(1);
  });

  it("restreint les classes à celles de l'enseignant", () => {
    const state = makeState({
      students: [
        { id: "s1", schoolCode: "SCH1", className: "6ème A" },
        { id: "s2", schoolCode: "SCH1", className: "6ème B" },
      ],
      classes: [
        { id: "c1", name: "6ème A", schoolCode: "SCH1" },
        { id: "c2", name: "6ème B", schoolCode: "SCH1" },
      ],
      teachers: [{ id: "T", userId: "user-1", assignedClasses: ["6ème A"] }],
    });
    const rows = scopedClasses(teacherUser({ schoolCode: "SCH1" }), state);
    expect(rows.map((c) => c.name)).toEqual(["6ème A"]);
  });
});

// ---------------------------------------------------------------------------
// scopedTeachers : rattachement enseignant ↔ école / classes des élèves
// ---------------------------------------------------------------------------
describe("scopedTeachers", () => {
  it("filtre par école mais inclut un enseignant rattaché via assignedClasses", () => {
    const state = makeState({
      students: [{ id: "s1", schoolCode: "SCH1", className: "6ème A" }],
      teachers: [
        { id: "T1", schoolCode: "SCH1", name: "Local" },
        { id: "T2", schoolCode: "SCH2", name: "Externe", assignedClasses: ["6ème A"] },
        { id: "T3", schoolCode: "SCH2", name: "Hors portée" },
      ],
    });
    const rows = scopedTeachers(makeUser({ schoolCode: "SCH1" }), state);
    const ids = rows.map((t) => t.id).sort();
    expect(ids).toEqual(["T1", "T2"]);
  });
});

// ---------------------------------------------------------------------------
// Règle métier RB-001 / CONTACT-004 : Contacts est le référentiel unique.
// Les fiches Élèves/Enseignants se créent uniquement via un contact ;
// aucun autre sous-module ne provisionne de personne/compte.
// ---------------------------------------------------------------------------
describe("Contacts = référentiel unique (RB-001 / CONTACT-004)", () => {
  it("les fiches Élèves ne sont créables que via Contacts", () => {
    expect(entityCreateViaContactsOnly("students")).toBe(true);
  });

  it("les fiches Enseignants ne sont créables que via Contacts", () => {
    expect(entityCreateViaContactsOnly("teachers")).toBe(true);
  });

  it("Contacts et Classes restent créables directement", () => {
    expect(entityCreateViaContactsOnly("contacts")).toBe(false);
    expect(entityCreateViaContactsOnly("classes")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PE-005 : un seul parent principal par élève.
// ---------------------------------------------------------------------------
describe("enforceSinglePrincipalParent (PE-005)", () => {
  // La ligne sauvegardée est déjà fusionnée dans la liste (isPrincipal = Oui)
  // au moment de l'appel, comme dans le flux réel de EntityPage.
  const relations: Row[] = [
    { id: "r1", relationType: "Parent → Élève", toStudentId: "s1", isPrincipal: "Oui" },
    { id: "r2", relationType: "Parent → Élève", toStudentId: "s1", isPrincipal: "Oui" },
    { id: "r3", relationType: "Parent → Élève", toStudentId: "s2", isPrincipal: "Oui" },
  ];

  it("bascule les autres principaux du même élève à Non", () => {
    const saved = { id: "r2", relationType: "Parent → Élève", toStudentId: "s1", isPrincipal: "Oui" };
    const next = enforceSinglePrincipalParent(relations, saved);
    expect(next.find((r) => r.id === "r1")?.isPrincipal).toBe("Non");
    expect(next.find((r) => r.id === "r2")?.isPrincipal).toBe("Oui");
    // Un autre élève n'est pas affecté.
    expect(next.find((r) => r.id === "r3")?.isPrincipal).toBe("Oui");
  });

  it("ne modifie rien si la relation sauvegardée n'est pas principale", () => {
    const saved = { id: "r1", relationType: "Parent → Élève", toStudentId: "s1", isPrincipal: "Non" };
    const next = enforceSinglePrincipalParent(relations, saved);
    expect(next).toEqual(relations);
  });
});

// ---------------------------------------------------------------------------
// RB-002 : un contact peut cumuler des rôles ; un enseignant peut être parent.
// ---------------------------------------------------------------------------
describe("getRelationParentContactOptions (RB-002)", () => {
  const state = makeState({
    contacts: [
      { id: "p1", contactType: "Parent", schoolCode: "SCH1", lastName: "Kdi", firstName: "Awa" },
      { id: "t1", contactType: "Enseignant", schoolCode: "SCH1", lastName: "Seke", firstName: "Kilombo" },
      { id: "e1", contactType: "Élève", schoolCode: "SCH1", lastName: "Jean", firstName: "Onan" },
      { id: "s1", contactType: "Étudiant", schoolCode: "SCH1", lastName: "Uni", firstName: "Max" },
    ],
  });

  it("inclut un enseignant (parent potentiel) mais exclut les élèves/étudiants", () => {
    const options = getRelationParentContactOptions(makeUser({ schoolCode: "SCH1" }), state);
    const ids = options.map((o) => o.value).sort();
    expect(ids).toEqual(["p1", "t1"]);
  });
});

// ---------------------------------------------------------------------------
// ELEVE-001 / ENS-001 : contacts éligibles à la création de fiche.
// ---------------------------------------------------------------------------
describe("getLinkableContactOptions (ELEVE-001 / ENS-001)", () => {
  const state = makeState({
    contacts: [
      { id: "c1", contactType: "Élève", schoolCode: "SCH1", lastName: "Doe", firstName: "Jane" },
      { id: "c2", contactType: "Élève", schoolCode: "SCH1", lastName: "Roe", firstName: "Max", studentId: "s9" },
      { id: "c3", contactType: "Enseignant", schoolCode: "SCH1", lastName: "Prof", firstName: "Al" },
      { id: "c4", contactType: "Élève", schoolCode: "SCH2", lastName: "Autre", firstName: "Ecole" },
    ],
    students: [{ id: "sX", contactId: "cLinked" }],
    teachers: [],
  });

  it("propose les contacts élève non reliés de l'école", () => {
    const options = getLinkableContactOptions(state, "SCH1", "student");
    expect(options.map((o) => o.value)).toEqual(["c1"]);
  });

  it("propose les contacts enseignant non reliés", () => {
    const options = getLinkableContactOptions(state, "SCH1", "teacher");
    expect(options.map((o) => o.value)).toEqual(["c3"]);
  });
});

// ---------------------------------------------------------------------------
// AFF-001 : noms de périodes de l'établissement (fallback trimestres).
// ---------------------------------------------------------------------------
describe("getSchoolPeriodNames", () => {
  it("retourne les périodes configurées", () => {
    const state = {
      academicConfigs: {
        SCH1: { periods: [{ name: "Semestre 1" }, { name: "Semestre 2" }] },
      },
    } as unknown as BackOfficeState;
    expect(getSchoolPeriodNames(state, "SCH1")).toEqual(["Semestre 1", "Semestre 2"]);
  });

  it("retombe sur les trimestres par défaut", () => {
    const state = { academicConfigs: {} } as unknown as BackOfficeState;
    expect(getSchoolPeriodNames(state, "SCH1")).toEqual([
      "Trimestre 1",
      "Trimestre 2",
      "Trimestre 3",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dates : parsing / conversions (incluant le format compact hérité)
// ---------------------------------------------------------------------------
describe("dates", () => {
  it("parsePeriodDate : JJ-MM-AAAA", () => {
    const d = parsePeriodDate("01-02-2000");
    expect(d?.getFullYear()).toBe(2000);
    expect(d?.getMonth()).toBe(1); // février
    expect(d?.getDate()).toBe(1);
  });

  it("parsePeriodDate : YYYY-MM-DD", () => {
    const d = parsePeriodDate("2000-02-01");
    expect(d?.getFullYear()).toBe(2000);
    expect(d?.getMonth()).toBe(1);
    expect(d?.getDate()).toBe(1);
  });

  it("parsePeriodDate : format compact hérité JJMMAAAA", () => {
    const d = parsePeriodDate("01012000");
    expect(d?.getFullYear()).toBe(2000);
    expect(d?.getMonth()).toBe(0); // janvier
    expect(d?.getDate()).toBe(1);
  });

  it("parsePeriodDate : vide / invalide → null", () => {
    expect(parsePeriodDate("")).toBeNull();
    expect(parsePeriodDate("pas une date")).toBeNull();
  });

  it("periodDateToInput : compact hérité → YYYY-MM-DD", () => {
    expect(periodDateToInput("01012000")).toBe("2000-01-01");
  });

  it("periodDateToInput : JJ-MM-AAAA → YYYY-MM-DD", () => {
    expect(periodDateToInput("31-12-1999")).toBe("1999-12-31");
  });

  it("inputToPeriodDate : YYYY-MM-DD → JJ-MM-AAAA", () => {
    expect(inputToPeriodDate("2000-01-05")).toBe("05-01-2000");
  });

  it("aller-retour input ↔ stockage cohérent", () => {
    const stored = "07-03-2010";
    const asInput = periodDateToInput(stored);
    expect(asInput).toBe("2010-03-07");
    expect(inputToPeriodDate(asInput)).toBe(stored);
  });
});

// ---------------------------------------------------------------------------
// Planning par créneau : détection de chevauchement enseignant (jour/heure).
// ---------------------------------------------------------------------------
describe("detectScheduleConflicts — chevauchement enseignant", () => {
  const baseCourse: CourseScheduleSlot = {
    id: "CS-1",
    schoolCode: "SCH1",
    className: "6ème A",
    subject: "Mathématiques",
    teacherId: "T1",
    teacherName: "Seke Kilombo",
    start: "2026-09-14T10:00:00.000Z", // lundi 10:00
    end: "2026-09-14T11:00:00.000Z",
    kind: "course",
    periodName: "Trimestre 1",
    periodStart: "10-09-2026",
    periodEnd: "23-12-2026",
  };

  it("détecte la double réservation d'un enseignant sur deux classes au même horaire", () => {
    const otherClassSameTeacher: CourseScheduleSlot = {
      ...baseCourse,
      id: "CS-2",
      className: "5ème B",
      subject: "Physique",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
    };
    const issues = detectScheduleConflicts([otherClassSameTeacher], baseCourse);
    expect(issues.some((row) => row.includes("Conflit enseignant"))).toBe(true);
  });

  it("n'émet pas de conflit enseignant si les professeurs diffèrent", () => {
    const differentTeacher: CourseScheduleSlot = {
      ...baseCourse,
      id: "CS-3",
      className: "5ème B",
      subject: "Physique",
      teacherId: "T2",
      teacherName: "Autre Prof",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
    };
    const issues = detectScheduleConflicts([differentTeacher], baseCourse);
    expect(issues.some((row) => row.includes("Conflit enseignant"))).toBe(false);
  });

  it("n'émet pas de conflit enseignant pour des créneaux adjacents (10-11 / 11-12)", () => {
    const adjacent: CourseScheduleSlot = {
      ...baseCourse,
      id: "CS-4",
      className: "5ème B",
      subject: "Physique",
      start: "2026-09-14T11:00:00.000Z",
      end: "2026-09-14T12:00:00.000Z",
    };
    const issues = detectScheduleConflicts([adjacent], baseCourse);
    expect(issues.some((row) => row.includes("Conflit enseignant"))).toBe(false);
  });

  it("validatePlanningSlotBusinessRules bloque la double réservation enseignant", () => {
    const otherClassSameTeacher: CourseScheduleSlot = {
      ...baseCourse,
      id: "CS-5",
      className: "5ème B",
      subject: "Physique",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
    };
    const issues = validatePlanningSlotBusinessRules([otherClassSameTeacher], baseCourse, {
      allowedSubjects: ["Mathématiques"],
    });
    expect(issues.some((row) => row.includes("Conflit enseignant"))).toBe(true);
  });
});
