/**
 * Audit : élèves / enseignants présents sans lien vers contacts[].
 *
 *   node scripts/audit-contacts-orphans.js
 */
const path = require("path");
try {
  require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
    path: path.join(__dirname, "..", ".env"),
  });
} catch {
  // optional
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function collectStudentKeys(student = {}) {
  return [student.id, student.publicId, student.matricule]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function collectTeacherKeys(teacher = {}) {
  return [teacher.id, teacher.publicId, teacher.identifier]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function studentLinkedToContacts(student, contacts) {
  const studentKeys = new Set(collectStudentKeys(student));
  const contactId = String(student.contactId ?? "").trim();
  if (contactId && contacts.some((contact) => String(contact.id ?? "") === contactId)) {
    return true;
  }
  return contacts.some((contact) => {
    const linkedId = String(contact.studentId ?? "").trim();
    return linkedId && studentKeys.has(linkedId);
  });
}

function teacherLinkedToContacts(teacher, contacts) {
  const teacherKeys = new Set(collectTeacherKeys(teacher));
  const contactId = String(teacher.contactId ?? "").trim();
  if (contactId && contacts.some((contact) => String(contact.id ?? "") === contactId)) {
    return true;
  }
  return contacts.some((contact) => {
    const linkedId = String(contact.teacherId ?? "").trim();
    return linkedId && teacherKeys.has(linkedId);
  });
}

function guessOrigin(row, kind) {
  const id = String(row.id ?? "");
  const userId = String(row.userId ?? "");

  if (id.startsWith("STUDENTS-") || id.startsWith("TEACHERS-")) {
    return "backoffice_state (créé via contact / E2E, id artificiel)";
  }
  if (id.startsWith("TEACHER-")) {
    return "userTeacherSyncService (compte utilisateur Enseignant → fiche auto)";
  }
  if (kind === "student" && /^ELE-|STU-|ELEVE/i.test(String(row.matricule ?? ""))) {
    return "inscription manuelle / E2E (matricule généré)";
  }
  if (userId && !row.contactId) {
    return kind === "teacher"
      ? "fiche teacher liée à userId sans contact"
      : "fiche élève liée à userId sans contact";
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) || /^CD-|^[A-Z]{2}-\d{4}-/.test(id)) {
    return "postgresql relationnel (seed demo / tables students|teachers)";
  }
  return "source non identifiée";
}

function summarizeByOrigin(rows, kind) {
  const counts = {};
  for (const row of rows) {
    const origin = guessOrigin(row, kind);
    counts[origin] = (counts[origin] ?? 0) + 1;
  }
  return counts;
}

async function loadStateViaApi() {
  const { login, getState, SUPERADMIN_ID, SUPERADMIN_PASSWORD } = require("./e2e-api-helpers");
  const token = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const state = await getState(token);
  return { state, source: "api" };
}

async function loadPostgresCounts() {
  try {
    const { execSync } = require("child_process");
    const composeFile = path.join(__dirname, "..", "docker-compose.yml");
    const sql = `
      SELECT 'students_pg' AS src, COUNT(*)::text AS cnt FROM students
      UNION ALL SELECT 'teachers_pg', COUNT(*)::text FROM teachers
      UNION ALL SELECT 'users_teacher', COUNT(*)::text FROM users WHERE role = 'TEACHER'
      UNION ALL SELECT 'users_student', COUNT(*)::text FROM users WHERE role = 'STUDENT';
    `.replace(/\s+/g, " ").trim();
    const output = execSync(
      `docker compose -f "${composeFile}" exec -T postgres psql -U ${process.env.POSTGRES_USER ?? "somafrik"} -d ${process.env.POSTGRES_DB ?? "somafrik"} -t -A -F "|" -c "${sql}"`,
      { encoding: "utf8" },
    ).trim();
    const counts = {};
    for (const line of output.split("\n").filter(Boolean)) {
      const [src, cnt] = line.split("|");
      counts[src] = Number(cnt);
    }
    return counts;
  } catch {
    return null;
  }
}

function printRow(row) {
  console.log(
    `  - [${row.type}] ${row.label} | id=${row.id} | étab=${row.schoolCode ?? "—"} | contactId=${row.contactId ?? "—"} | userId=${row.userId ?? "—"}`,
  );
  console.log(`    origine probable : ${row.origin}`);
}

async function main() {
  console.log("\n=== Audit élèves / enseignants sans contacts ===\n");

  const { state, source } = await loadStateViaApi();
  const contacts = state.contacts ?? [];
  const students = state.students ?? [];
  const teachers = state.teachers ?? [];
  const users = state.users ?? [];

  const orphanStudents = students.filter((row) => !studentLinkedToContacts(row, contacts));
  const orphanTeachers = teachers.filter((row) => !teacherLinkedToContacts(row, contacts));

  console.log(`Source état     : ${source}`);
  console.log(`Contacts        : ${contacts.length}`);
  console.log(`Élèves          : ${students.length} (orphelins: ${orphanStudents.length})`);
  console.log(`Enseignants     : ${teachers.length} (orphelins: ${orphanTeachers.length})`);
  console.log("");

  const pgCounts = await loadPostgresCounts();
  if (pgCounts) {
    console.log("PostgreSQL relationnel :");
    console.log(`  students table  : ${pgCounts.students_pg ?? "?"}`);
    console.log(`  teachers table  : ${pgCounts.teachers_pg ?? "?"}`);
    console.log(`  users TEACHER   : ${pgCounts.users_teacher ?? "?"}`);
    console.log(`  users STUDENT   : ${pgCounts.users_student ?? "?"}`);
    console.log("");
  }

  if (orphanStudents.length) {
    console.log("Répartition orphelins élèves par origine :");
    console.log(summarizeByOrigin(orphanStudents, "student"));
    console.log("\nDétail (max 20) :");
    for (const student of orphanStudents.slice(0, 20)) {
      printRow({
        type: "élève",
        label: [student.firstName, student.lastName ?? student.name].filter(Boolean).join(" "),
        id: student.id ?? student.matricule,
        schoolCode: student.schoolCode,
        contactId: student.contactId,
        userId: student.userId,
        origin: guessOrigin(student, "student"),
      });
    }
    console.log("");
  }

  if (orphanTeachers.length) {
    console.log("Répartition orphelins enseignants par origine :");
    console.log(summarizeByOrigin(orphanTeachers, "teacher"));
    console.log("\nDétail (max 20) :");
    for (const teacher of orphanTeachers.slice(0, 20)) {
      printRow({
        type: "enseignant",
        label: [teacher.firstName, teacher.lastName ?? teacher.name].filter(Boolean).join(" "),
        id: teacher.id ?? teacher.identifier,
        schoolCode: teacher.schoolCode,
        contactId: teacher.contactId,
        userId: teacher.userId,
        origin: guessOrigin(teacher, "teacher"),
      });
    }
    console.log("");
  }

  const teacherUsersOrphan = users.filter((user) => {
    const role = normalize(user.role);
    if (!role.includes("enseignant") && !role.includes("prof")) return false;
    const linked = teachers.find((row) => String(row.userId ?? "") === String(user.id ?? ""));
    return linked && !teacherLinkedToContacts(linked, contacts);
  });

  if (teacherUsersOrphan.length) {
    console.log(`Comptes utilisateur Enseignant liés à une fiche orpheline : ${teacherUsersOrphan.length}`);
    for (const user of teacherUsersOrphan.slice(0, 10)) {
      console.log(
        `  - user ${user.identifier ?? user.id} | contactId=${user.contactId ?? "—"} | school=${user.schoolCode ?? "—"}`,
      );
    }
    console.log("");
  }

  console.log("Origines documentées dans le code :");
  console.log("  1. seed PostgreSQL (backend/data.js → postgresRepository.seedAcademicData)");
  console.log("     → mapStudent/mapTeacher sans contactId");
  console.log("  2. userTeacherSyncService (PUT backoffice quand users[] touché)");
  console.log("     → crée teachers[] depuis comptes Enseignant, sans contact");
  console.log("  3. E2E / scripts qui créent teacherRecord avec id TEACHERS-* en plus du sync");
  console.log("  4. backoffice_state seul (contacts[] vide après db:wipe-demo)");
  console.log("");

  if (!orphanStudents.length && !orphanTeachers.length) {
    console.log("Audit contacts : OK (aucun orphelin)");
    process.exit(0);
  }

  console.log(
    `Audit contacts : ${orphanStudents.length + orphanTeachers.length} fiche(s) sans lien contacts`,
  );
  process.exit(orphanStudents.length + orphanTeachers.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
