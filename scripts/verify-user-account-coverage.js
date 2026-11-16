/**
 * Audit : couverture comptes utilisateurs (users / userAccounts) vs entités métier.
 *
 * Usage:
 *   node scripts/verify-user-account-coverage.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api node scripts/verify-user-account-coverage.js
 */
const seedData = require("../backend/data");
const { superadminLoginPassword } = require("../backend/lib/superadminSeedSecret");

const REQUIRED_USER_FIELDS = ["id", "lastName", "firstName", "role", "identifier", "status"];
const MANAGED_MOBILE_ROLES = new Set([
  "Super Administrateur Somafrik",
  "Super Administrateur OKAFRIK",
  "Admin Pays",
  "Admin School",
  "Proviseur",
  "Directeur",
  "Préfet des études",
  "Secrétaire",
]);
const TEACHER_USER_ROLE = "Enseignant";
const STUDENT_ROLES = new Set(["Élève / Étudiant", "Eleve / Etudiant", "Élève", "Étudiant"]);
const PARENT_ROLE = "Parent";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isTeacherUserRole(role) {
  const key = normalize(role);
  return key === "enseignant" || key.includes("prof");
}

function missingFields(user) {
  const missing = [];
  for (const field of REQUIRED_USER_FIELDS) {
    const value = user[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(field);
    }
  }
  return missing;
}

function teacherMatchesUser(teacher, user) {
  if (user.id && String(teacher.userId ?? "") === String(user.id)) {
    return true;
  }
  const userIdentifier = normalize(user.identifier);
  const teacherIdentifier = normalize(teacher.identifier);
  if (!userIdentifier || userIdentifier !== teacherIdentifier) {
    return false;
  }
  const linkedUserId = String(teacher.userId ?? "");
  return !linkedUserId || linkedUserId === String(user.id ?? "");
}

function findTeacherForUser(teachers, user) {
  return teachers.find((teacher) => teacherMatchesUser(teacher, user));
}

function findUserForTeacher(users, teacher) {
  if (teacher.userId) {
    const byId = users.find((user) => String(user.id) === String(teacher.userId));
    if (byId) return byId;
  }
  const teacherIdentifier = normalize(teacher.identifier);
  return users.find(
    (user) =>
      isTeacherUserRole(user.role) &&
      normalize(user.identifier) === teacherIdentifier &&
      (!teacher.schoolCode || !user.schoolCode || normalize(user.schoolCode) === normalize(teacher.schoolCode))
  );
}

function auditDataset(label, users, teachers, students) {
  const report = {
    label,
    totals: {
      users: users.length,
      teachers: teachers.length,
      students: students.length,
    },
    usersWithMissingFields: [],
    teacherUsersWithoutTeacherRecord: [],
    teacherUsersWithoutLink: [],
    teacherUsersIdentifierMismatch: [],
    teachersWithoutUserAccount: [],
    teachersWithoutUserId: [],
    managedStaffWithoutMobileRole: [],
    studentUsersWithoutStudentRecord: [],
    parentUsersWithoutStudentLink: [],
    duplicateUserIdentifiers: [],
    duplicateTeacherIdentifiers: [],
    byRole: {},
  };

  for (const user of users) {
    const role = String(user.role ?? "—");
    report.byRole[role] = (report.byRole[role] ?? 0) + 1;

    const missing = missingFields(user);
    if (missing.length) {
      report.usersWithMissingFields.push({
        id: user.id,
        role: user.role,
        identifier: user.identifier,
        missing,
      });
    }

    if (isTeacherUserRole(user.role)) {
      const teacher = findTeacherForUser(teachers, user);
      if (!teacher) {
        report.teacherUsersWithoutTeacherRecord.push({
          userId: user.id,
          identifier: user.identifier,
          name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
          schoolCode: user.schoolCode,
        });
      } else {
        if (!teacher.userId || String(teacher.userId) !== String(user.id)) {
          report.teacherUsersWithoutLink.push({
            userId: user.id,
            userIdentifier: user.identifier,
            teacherId: teacher.id,
            teacherIdentifier: teacher.identifier,
            teacherUserId: teacher.userId ?? null,
          });
        }
        if (normalize(user.identifier) !== normalize(teacher.identifier)) {
          report.teacherUsersIdentifierMismatch.push({
            userId: user.id,
            userIdentifier: user.identifier,
            teacherId: teacher.id,
            teacherIdentifier: teacher.identifier,
          });
        }
      }
    }

    if (STUDENT_ROLES.has(user.role)) {
      const matricule = normalize(user.identifier);
      const student = students.find(
        (s) =>
          normalize(s.matricule) === matricule ||
          normalize(s.publicId) === matricule ||
          String(s.id) === String(user.id)
      );
      if (!student) {
        report.studentUsersWithoutStudentRecord.push({
          userId: user.id,
          identifier: user.identifier,
          schoolCode: user.schoolCode,
        });
      }
    }

    if (user.role === PARENT_ROLE) {
      const phone = normalize(user.identifier);
      const linked = students.some((s) => normalize(s.parentPhone) === phone);
      if (!linked) {
        report.parentUsersWithoutStudentLink.push({
          userId: user.id,
          identifier: user.identifier,
          phone: user.phone,
        });
      }
    }

    if (MANAGED_MOBILE_ROLES.has(user.role) === false && !isTeacherUserRole(user.role) && !STUDENT_ROLES.has(user.role) && user.role !== PARENT_ROLE) {
      // roles like Auditeur, Comptable — informational only
    }
  }

  for (const teacher of teachers) {
    if (!teacher.userId) {
      report.teachersWithoutUserId.push({
        teacherId: teacher.id,
        identifier: teacher.identifier,
        name: teacher.name ?? `${teacher.firstName ?? ""}`,
        schoolCode: teacher.schoolCode,
      });
    }
    const user = findUserForTeacher(users, teacher);
    if (!user) {
      report.teachersWithoutUserAccount.push({
        teacherId: teacher.id,
        identifier: teacher.identifier,
        name: teacher.name ?? `${teacher.firstName ?? ""}`,
        schoolCode: teacher.schoolCode,
        userId: teacher.userId ?? null,
      });
    }
  }

  const userIdentifierMap = new Map();
  for (const user of users) {
    const key = `${normalize(user.schoolCode)}::${normalize(user.identifier)}`;
    if (!userIdentifierMap.has(key)) userIdentifierMap.set(key, []);
    userIdentifierMap.get(key).push(user.id);
  }
  for (const [key, ids] of userIdentifierMap.entries()) {
    if (ids.length > 1) {
      report.duplicateUserIdentifiers.push({ key, userIds: ids });
    }
  }

  const teacherIdentifierMap = new Map();
  for (const teacher of teachers) {
    const key = `${normalize(teacher.schoolCode)}::${normalize(teacher.identifier)}`;
    if (!teacherIdentifierMap.has(key)) teacherIdentifierMap.set(key, []);
    teacherIdentifierMap.get(key).push(teacher.id);
  }
  for (const [key, ids] of teacherIdentifierMap.entries()) {
    if (ids.length > 1) {
      report.duplicateTeacherIdentifiers.push({ key, teacherIds: ids });
    }
  }

  return report;
}

function printReport(report) {
  console.log(`\n=== ${report.label} ===`);
  console.log(`Utilisateurs: ${report.totals.users} | Enseignants (teachers): ${report.totals.teachers} | Élèves: ${report.totals.students}`);
  console.log("Rôles utilisateurs:", JSON.stringify(report.byRole, null, 2));

  const sections = [
    ["Champs obligatoires manquants sur users", report.usersWithMissingFields],
    ["Comptes Enseignant sans fiche teachers[]", report.teacherUsersWithoutTeacherRecord],
    ["Enseignant user ↔ teacher sans lien userId", report.teacherUsersWithoutLink],
    ["Identifiants user/teacher différents", report.teacherUsersIdentifierMismatch],
    ["Fiches teachers[] sans compte users", report.teachersWithoutUserAccount],
    ["Fiches teachers[] sans userId", report.teachersWithoutUserId],
    ["Comptes Élève sans fiche students[]", report.studentUsersWithoutStudentRecord],
    ["Comptes Parent sans élève lié (téléphone)", report.parentUsersWithoutStudentLink],
    ["Identifiants users en doublon (école+identifiant)", report.duplicateUserIdentifiers],
    ["Identifiants teachers en doublon (école+identifiant)", report.duplicateTeacherIdentifiers],
  ];

  for (const [title, items] of sections) {
    console.log(`\n— ${title}: ${items.length}`);
    if (items.length) {
      console.log(JSON.stringify(items, null, 2));
    }
  }

  const actionCount =
    report.teacherUsersWithoutTeacherRecord.length +
    report.teacherUsersWithoutLink.length +
    report.teachersWithoutUserAccount.length +
    report.usersWithMissingFields.length +
    report.duplicateUserIdentifiers.length +
    report.duplicateTeacherIdentifiers.length;

  console.log(`\n>>> Actions recommandées: ${actionCount} point(s) à traiter`);
  return actionCount;
}

async function fetchLiveState() {
  const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
  const loginRes = await fetch(`${base}/backoffice/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: "superadmin",
      password: superadminLoginPassword(),
    }),
  });
  if (!loginRes.ok) {
    return null;
  }
  const loginData = await loginRes.json();
  const token = loginData.accessToken;
  if (!token) return null;

  const stateRes = await fetch(`${base}/backoffice/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!stateRes.ok) return null;
  const state = await stateRes.json();
  return {
    users: state.users ?? [],
    teachers: state.teachers ?? [],
    students: state.students ?? [],
  };
}

async function main() {
  const seedReport = auditDataset(
    "Seed backend/data.js (userAccounts)",
    seedData.userAccounts ?? [],
    seedData.teachers ?? [],
    seedData.students ?? []
  );
  const seedActions = printReport(seedReport);

  let liveActions = 0;
  try {
    const live = await fetchLiveState();
    if (live) {
      const liveReport = auditDataset("État live API /backoffice/state", live.users, live.teachers, live.students);
      liveActions = printReport(liveReport);
    } else {
      console.log("\n(État live non disponible — backend arrêté ou login superadmin échoué)");
    }
  } catch (error) {
    console.log("\n(État live non disponible:", error.message);
  }

  const totalActions = seedActions + liveActions;
  if (totalActions > 0) {
    process.exitCode = 1;
  }
}

main();
