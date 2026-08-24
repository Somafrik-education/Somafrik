/**
 * Badge présence par classe — période = aujourd'hui, scope classId + tenant.
 *   npx tsx Mobile/src/lib/classTodayPresenceBadge.test.ts
 */
import assert from "node:assert/strict";
import type { SchoolClass, Student } from "../data/catalog";
import type { ResourceSnapshot } from "./dataTruth";
import {
  CLASS_EMPTY_PRESENCE_BADGE,
  CLASS_TODAY_PRESENCE_PERIOD,
  CLASS_UNSET_PRESENCE_LABEL,
  resolveClassTodayPresenceBadge,
  type ClassPresenceRow,
} from "./classTodayPresenceBadge";

const TODAY = "2026-08-24";
const YESTERDAY = "2026-08-23";
const NOW = new Date("2026-08-24T12:00:00.000Z");
const TZ = "Africa/Kinshasa";
const SCHOOL = "CD-IN-26-001";
const OTHER_SCHOOL = "BI-EC-26-001";

const CLASS_A: SchoolClass = {
  id: "class-a",
  publicId: "CLS-1A",
  classCode: "CLS-1A",
  name: "1ère A",
  level: "",
  track: "",
  teacherId: "",
};
const CLASS_B: SchoolClass = {
  id: "class-b",
  publicId: "CLS-2A",
  classCode: "CLS-2A",
  name: "2ème A",
  level: "",
  track: "",
  teacherId: "",
};
const CLASS_A_HOMONYM: SchoolClass = {
  id: "class-a-other",
  publicId: "CLS-1A-OTHER",
  classCode: "CLS-1A-OTHER",
  name: "1ère A",
  level: "",
  track: "",
  teacherId: "",
};

function student(partial: Partial<Student> & { id: string }): Student {
  return {
    publicId: partial.id,
    name: "Élève",
    firstName: "Élève",
    matricule: partial.id,
    gender: "Féminin",
    birthDate: "",
    className: CLASS_B.name,
    classId: CLASS_B.id,
    classCode: CLASS_B.classCode,
    schoolCode: SCHOOL,
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    archived: false,
    ...partial,
  };
}

function presence(
  studentId: string,
  status: string,
  extras: Partial<ClassPresenceRow> = {},
): ClassPresenceRow {
  return {
    studentId,
    status,
    date: TODAY,
    present: status === "Présent" || status === "Retard",
    classId: CLASS_B.id,
    classCode: CLASS_B.classCode,
    schoolCode: SCHOOL,
    ...extras,
  };
}

function snapshot<T>(status: ResourceSnapshot<T>["status"], data: T[]): ResourceSnapshot<T> {
  return { status, data };
}

function badge(input: {
  students: Student[];
  presences: ClassPresenceRow[];
  schoolClass?: SchoolClass;
  studentsStatus?: ResourceSnapshot<unknown>["status"];
  presencesStatus?: ResourceSnapshot<ClassPresenceRow>["status"];
  schoolCode?: string | null;
}) {
  return resolveClassTodayPresenceBadge({
    studentsSnapshot: snapshot(input.studentsStatus ?? "success", input.students),
    presencesSnapshot: snapshot(input.presencesStatus ?? "success", input.presences),
    students: input.students,
    classes: [CLASS_A, CLASS_B, CLASS_A_HOMONYM],
    schoolClass: input.schoolClass ?? CLASS_B,
    schoolCode: input.schoolCode === undefined ? SCHOOL : input.schoolCode,
    timeZone: TZ,
    now: NOW,
  });
}

const four = ["s1", "s2", "s3", "s4"].map((id) => student({ id }));

function run() {
  assert.equal(CLASS_TODAY_PRESENCE_PERIOD, "today");
  assert.equal(CLASS_EMPTY_PRESENCE_BADGE, "Présence —");
  assert.equal(CLASS_UNSET_PRESENCE_LABEL, "Non saisi");

  // A. Classe 0 élève + présences ailleurs => aucun taux global ne fuite
  const elsewhere = [
    presence("x1", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("x2", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("x3", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("x4", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("x5", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("x6", "Absent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("x7", "Absent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
  ];
  const zeroStudentClass = badge({
    students: four,
    presences: elsewhere,
    schoolClass: CLASS_A,
  });
  assert.equal(zeroStudentClass.kind, "empty");
  assert.equal(zeroStudentClass.badgeText, "Présence —");
  assert.equal(zeroStudentClass.rate, null);
  assert.equal(zeroStudentClass.expected, 0);
  assert.doesNotMatch(zeroStudentClass.badgeText, /71|%/);

  // B. Classe 4 élèves + aucun appel aujourd'hui => Non saisi
  const noCall = badge({ students: four, presences: [] });
  assert.equal(noCall.kind, "unset");
  assert.equal(noCall.badgeText, "Non saisi");
  assert.equal(noCall.rate, null);
  assert.doesNotMatch(noCall.badgeText, /0\s*%/);

  // C. 3 Présents + 1 Absent => 75 %
  const caseC = badge({
    students: four,
    presences: [
      presence("s1", "Présent"),
      presence("s2", "Présent"),
      presence("s3", "Présent"),
      presence("s4", "Absent"),
    ],
  });
  assert.equal(caseC.kind, "rate");
  assert.equal(caseC.rate, 75);
  assert.equal(caseC.badgeText, "Présence 75 %");
  assert.equal(caseC.attended, 3);
  assert.equal(caseC.expected, 4);

  // D. 2 Présents + 1 Retard + 1 Justifié => 75 %
  const caseD = badge({
    students: four,
    presences: [
      presence("s1", "Présent"),
      presence("s2", "Présent"),
      presence("s3", "Retard"),
      presence("s4", "Justifié"),
    ],
  });
  assert.equal(caseD.rate, 75);
  assert.equal(caseD.attended, 3);
  assert.equal(caseD.badgeText, "Présence 75 %");

  // E. Appel d'hier uniquement => ne devient pas le taux d'aujourd'hui
  const yesterdayOnly = badge({
    students: four,
    presences: four.map((row) => presence(row.id, "Présent", { date: YESTERDAY })),
  });
  assert.equal(yesterdayOnly.kind, "unset");
  assert.equal(yesterdayOnly.badgeText, "Non saisi");
  assert.equal(yesterdayOnly.rate, null);
  assert.equal(yesterdayOnly.periodKey, TODAY);

  // F. Deux classes portant le même nom => aucune contamination
  const homonymStudents = [
    student({ id: "ha1", classId: CLASS_A.id, classCode: CLASS_A.classCode, className: "1ère A" }),
    student({ id: "ha2", classId: CLASS_A.id, classCode: CLASS_A.classCode, className: "1ère A" }),
    student({ id: "hb1", classId: CLASS_A_HOMONYM.id, classCode: CLASS_A_HOMONYM.classCode, className: "1ère A" }),
    student({ id: "hb2", classId: CLASS_A_HOMONYM.id, classCode: CLASS_A_HOMONYM.classCode, className: "1ère A" }),
  ];
  const homonymPresences = [
    presence("ha1", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("ha2", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    presence("hb1", "Absent", { classId: CLASS_A_HOMONYM.id, classCode: CLASS_A_HOMONYM.classCode }),
    presence("hb2", "Absent", { classId: CLASS_A_HOMONYM.id, classCode: CLASS_A_HOMONYM.classCode }),
  ];
  const classA = badge({
    students: homonymStudents,
    presences: homonymPresences,
    schoolClass: CLASS_A,
  });
  const classAOther = badge({
    students: homonymStudents,
    presences: homonymPresences,
    schoolClass: CLASS_A_HOMONYM,
  });
  assert.equal(classA.rate, 100);
  assert.equal(classA.expected, 2);
  assert.equal(classAOther.rate, 0);
  assert.equal(classAOther.expected, 2);
  assert.notDeepEqual(classA.studentIds, classAOther.studentIds);

  // G. Élève transféré A → B : anciennes présences de A hors scope de B
  const transferred = student({
    id: "moved",
    classId: CLASS_B.id,
    classCode: CLASS_B.classCode,
    className: CLASS_B.name,
  });
  const classmates = four;
  const transfer = badge({
    students: [...classmates, transferred],
    presences: [
      ...classmates.map((row) => presence(row.id, "Présent")),
      presence("moved", "Présent", {
        classId: CLASS_A.id,
        classCode: CLASS_A.classCode,
        date: TODAY,
      }),
    ],
    schoolClass: CLASS_B,
  });
  assert.equal(transfer.kind, "unset", "présence classId=A n'alimente pas l'appel du jour de B");
  assert.equal(transfer.recorded, 4);
  assert.equal(transfer.expected, 5);
  assert.equal(transfer.badgeText, "Non saisi");

  const classAAfterTransfer = badge({
    students: [...classmates, transferred],
    presences: [
      presence("moved", "Présent", { classId: CLASS_A.id, classCode: CLASS_A.classCode }),
    ],
    schoolClass: CLASS_A,
  });
  assert.equal(classAAfterTransfer.kind, "empty");
  assert.equal(classAAfterTransfer.expected, 0);

  // H. Autre établissement => isolation tenant stricte
  const foreign = student({
    id: "ext",
    schoolCode: OTHER_SCHOOL,
    classId: CLASS_B.id,
    classCode: CLASS_B.classCode,
  });
  const tenant = badge({
    students: [...four, foreign],
    presences: [
      ...four.map((row) => presence(row.id, "Présent")),
      presence("ext", "Présent", { schoolCode: OTHER_SCHOOL }),
    ],
  });
  assert.equal(tenant.expected, 4);
  assert.equal(tenant.rate, 100);
  assert.equal(tenant.studentIds.includes("ext"), false);

  // I. snapshot loading / offline / error => jamais inventer un pourcentage
  for (const status of ["idle", "loading"] as const) {
    const pending = badge({
      students: four,
      presences: four.map((row) => presence(row.id, "Présent")),
      presencesStatus: status,
    });
    assert.equal(pending.kind, "pending");
    assert.equal(pending.rate, null);
    assert.equal(pending.expected, 4);
    assert.doesNotMatch(pending.badgeText, /\d+\s*%/);
  }
  const errorSnap = badge({
    students: four,
    presences: four.map((row) => presence(row.id, "Présent")),
    presencesStatus: "error",
  });
  assert.equal(errorSnap.kind, "unavailable");
  assert.doesNotMatch(errorSnap.badgeText, /\d+\s*%/);
  const offlineEmpty = badge({
    students: four,
    presences: [],
    presencesStatus: "offline",
  });
  assert.equal(offlineEmpty.kind, "unavailable");
  assert.doesNotMatch(offlineEmpty.badgeText, /\d+\s*%/);

  const studentsLoading = badge({
    students: [],
    presences: elsewhere,
    studentsStatus: "loading",
    schoolClass: CLASS_A,
  });
  assert.equal(studentsLoading.kind, "pending");
  assert.equal(studentsLoading.badgeText, "Présence —");

  // Présence absente ≠ Absent : appel partiel → Non saisi, pas 75 %
  const partial = badge({
    students: four,
    presences: [
      presence("s1", "Présent"),
      presence("s2", "Présent"),
      presence("s3", "Présent"),
    ],
  });
  assert.equal(partial.kind, "unset");
  assert.equal(partial.recorded, 3);
  assert.equal(partial.rate, null);

  console.log("OK: classTodayPresenceBadge A–I");
}

run();
