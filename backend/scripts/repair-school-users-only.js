/**
 * Supprime les contacts d'un établissement et ne conserve que les comptes utilisateurs cibles.
 *
 * Usage :
 *   node backend/scripts/repair-school-users-only.js
 *   node backend/scripts/repair-school-users-only.js CD-2026-0001
 *   docker compose exec backend node scripts/repair-school-users-only.js CD-2026-0001
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { rolePermissions } = require("../data");
const { initializeRepository } = require("../db/repositoryFactory");

const SCHOOL_CODE = String(process.argv[2] ?? "CD-2026-0001").trim().toUpperCase();

/** 6 comptes utilisateurs — INSTITUT NURU (CD-2026-0001), sans couche Contacts. */
function buildSchoolUsers(schoolCode) {
  const base = {
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    mustChangePassword: false,
    temporaryPassword: "",
  };

  return [
    {
      ...base,
      id: "USER-ADM-NURU",
      identifier: "ADM-0001",
      role: "Admin School",
      firstName: "Admin",
      lastName: "NURU",
      email: "admin@nuru.somafrik.app",
      phone: "+243 810 100 001",
      password: "E2eTest!2026",
      permissions: rolePermissions["Admin School"] ?? [],
    },
    {
      ...base,
      id: "USER-ENS-0001",
      identifier: "ENS-0001",
      role: "Enseignant",
      firstName: "Etienne",
      lastName: "LUPUNGU",
      email: "etienne.lupungu@nuru.somafrik.app",
      password: "529481",
      pin: "529481",
      permissions: rolePermissions.Enseignant ?? [],
    },
    {
      ...base,
      id: "USER-ENS-0002",
      identifier: "ENS-0002",
      role: "Enseignant",
      firstName: "Elie",
      lastName: "NDABAZA",
      email: "elie.ndabaza@nuru.somafrik.app",
      password: "638274",
      pin: "638274",
      permissions: rolePermissions.Enseignant ?? [],
    },
    {
      ...base,
      id: "USER-PAR-0001",
      identifier: "PAR-0001",
      role: "Parent",
      firstName: "Baudouin",
      lastName: "OKITO",
      phone: "+243 820 000 101",
      email: "baudouin.okito@nuru.somafrik.app",
      password: "847392",
      pin: "847392",
      permissions: rolePermissions.Parent ?? [],
    },
    {
      ...base,
      id: "USER-ELE-0001",
      identifier: "CD-IN-EL-26-001",
      role: "Élève / Étudiant",
      firstName: "Esther",
      lastName: "OKITO",
      email: "esther.okito@nuru.somafrik.app",
      password: "847392",
      pin: "847392",
      permissions: rolePermissions["Élève / Étudiant"] ?? [],
    },
    {
      ...base,
      id: "USER-ELE-0002",
      identifier: "CD-IN-EL-26-002",
      role: "Élève / Étudiant",
      firstName: "Hope Sabrina",
      lastName: "OKITO",
      email: "hope.okito@nuru.somafrik.app",
      password: "847392",
      pin: "847392",
      permissions: rolePermissions["Élève / Étudiant"] ?? [],
    },
  ];
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function main() {
  const { repository } = await initializeRepository();
  const stored = (await repository.getBackOfficeState()) ?? {};
  const schoolUsers = buildSchoolUsers(SCHOOL_CODE);

  const otherUsers = (stored.users ?? []).filter(
    (user) => normalize(user.schoolCode) !== normalize(SCHOOL_CODE),
  );
  const contacts = (stored.contacts ?? []).filter(
    (contact) => normalize(contact.schoolCode) !== normalize(SCHOOL_CODE),
  );

  const teachers = (stored.teachers ?? []).map((teacher) => {
    if (normalize(teacher.schoolCode) !== normalize(SCHOOL_CODE)) return teacher;
    const identifier = String(teacher.identifier ?? "").trim();
    if (identifier === "ENS-0001") {
      return { ...teacher, userId: "USER-ENS-0001", contactId: "" };
    }
    if (identifier === "ENS-0002" || String(teacher.publicId ?? "").includes("ENS-0002")) {
      return { ...teacher, userId: "USER-ENS-0002", contactId: "" };
    }
    return { ...teacher, contactId: "" };
  });

  const students = (stored.students ?? []).map((student) => {
    if (normalize(student.schoolCode) !== normalize(SCHOOL_CODE)) return student;
    return {
      ...student,
      contactId: "",
      parentPhone: student.parentPhone || "+243 820 000 101",
      parentName: student.parentName || "Baudouin OKITO",
    };
  });

  const relations = (stored.relations ?? []).map((relation) => {
    if (normalize(relation.schoolCode) !== normalize(SCHOOL_CODE)) return relation;
    if (normalize(relation.relationType) !== normalize("Parent → Élève")) return relation;
    return {
      ...relation,
      fromContactId: "USER-PAR-0001",
      fromContactName: "Baudouin OKITO",
    };
  });

  const next = {
    ...stored,
    contacts,
    users: [...schoolUsers, ...otherUsers],
    teachers,
    students,
    relations,
    updatedAt: new Date().toISOString(),
  };

  await repository.saveBackOfficeState(next);
  console.log(`OK : ${SCHOOL_CODE} — ${schoolUsers.length} comptes utilisateurs, contacts établissement supprimés.`);
  for (const user of schoolUsers) {
    console.log(`  - ${user.identifier} (${user.role}) ${user.firstName} ${user.lastName}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
