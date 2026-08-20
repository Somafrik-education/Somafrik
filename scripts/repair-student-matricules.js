/**
 * Réattribue les matricules élèves au format ELE-établissement-année-séquence.
 *
 * Usage:
 *   node scripts/repair-student-matricules.js
 *   node scripts/repair-student-matricules.js CD-IN-26-001
 */

function repairStudentMatriculesInline(students, schoolCode) {
  const SCHOOL_YEAR_BASE = 2025;
  const STUDENT_PROFILE = "ELE";

  function parseSchoolCodeSegments(code) {
    const normalized = String(code ?? "").trim().toUpperCase();
    const match = /^[A-Z]{2}-(\d{4})-(\d{4})$/.exec(normalized);
    if (match) {
      const year = match[1];
      const establishment = match[2];
      const yearIndex = Math.max(1, Number.parseInt(year, 10) - SCHOOL_YEAR_BASE);
      return {
        year,
        establishment,
        yearIndex: String(yearIndex).padStart(4, "0"),
      };
    }
    return { year: "0000", establishment: "0000", yearIndex: "0001" };
  }

  function isLegacy(value) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!normalized) return true;
    if (normalized.startsWith("STUDENTS-")) return true;
    return !/^ELE-\d{4}-\d{4}-\d{6}$/i.test(normalized);
  }

  function generateMatricule(code, rebuilt) {
    const segments = parseSchoolCodeSegments(code);
    const next = rebuilt.length + 1;
    return `${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-${String(next).padStart(6, "0")}`;
  }

  function getLoginIdentifier(matricule) {
    const match = /^ELE-\d{4}-\d{4}-(\d+)$/i.exec(String(matricule ?? "").trim());
    if (match?.[1]) return `ELE-${String(Number(match[1])).padStart(4, "0")}`;
    return String(matricule ?? "");
  }

  const normalizedSchool = schoolCode?.trim().toUpperCase();
  const scoped = normalizedSchool
    ? students.filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === normalizedSchool)
    : students.filter((row) => isLegacy(row.matricule ?? row.publicId ?? row.id));

  const bySchool = new Map();
  for (const student of scoped) {
    const code = String(student.schoolCode ?? "").trim().toUpperCase();
    if (!code) continue;
    if (!bySchool.has(code)) bySchool.set(code, []);
    bySchool.get(code).push(student);
  }

  const nextById = new Map();
  for (const [code, group] of bySchool) {
    const ordered = [...group].sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
    const rebuilt = [];
    for (const student of ordered) {
      const matricule = generateMatricule(code, rebuilt);
      const patched = { ...student, matricule, publicId: matricule };
      rebuilt.push(patched);
      nextById.set(String(student.id ?? ""), patched);
    }
  }

  const nextStudents = students.map((student) => {
    const id = String(student.id ?? "");
    const current = String(student.matricule ?? student.publicId ?? "");
    if (!isLegacy(current)) return student;
    return nextById.get(id) ?? student;
  });

  return { nextStudents, getLoginIdentifier, isLegacy };
}

async function persistState(state) {
  const { queryPostgres, queryPostgresViaDocker } = require("./pg-connection");
  const payload = JSON.stringify(state);
  try {
    await queryPostgres(
      "UPDATE backoffice_state SET state_payload = $1::jsonb, updated_at = NOW() WHERE state_key = 'default'",
      [state],
    );
    return "postgres";
  } catch (error) {
    const compact = payload.replace(/'/g, "''");
    queryPostgresViaDocker(
      `UPDATE backoffice_state SET state_payload = '${compact}'::jsonb, updated_at = NOW() WHERE state_key = 'default'`,
    );
    return `docker-postgres (${error.code ?? error.message})`;
  }
}

async function main() {
  const schoolFilter = process.argv[2] ? String(process.argv[2]).trim().toUpperCase() : undefined;
  const { loadBackofficeStateFromPostgres } = require("./pg-connection");
  const { state, source } = await loadBackofficeStateFromPostgres();

  const students = [...(state.students ?? [])];
  const { nextStudents, getLoginIdentifier, isLegacy } = repairStudentMatriculesInline(students, schoolFilter);

  const changedStudents = [];
  for (let index = 0; index < students.length; index += 1) {
    const before = students[index];
    const after = nextStudents[index];
    if (String(before.matricule ?? "") !== String(after.matricule ?? "")) {
      changedStudents.push({ before, after });
    }
  }

  if (!changedStudents.length) {
    console.log("Aucun matricule legacy à corriger.");
    return;
  }

  const users = [...(state.users ?? [])].map((user) => {
    const linkedStudent = changedStudents.find(
      ({ after }) =>
        String(after.contactId ?? "") === String(user.contactId ?? "") ||
        String(after.id ?? "") === String(user.id ?? ""),
    );
    if (!linkedStudent) return user;
    const loginId = getLoginIdentifier(linkedStudent.after.matricule);
    return {
      ...user,
      identifier: loginId,
      publicId: linkedStudent.after.matricule,
    };
  });

  const contacts = [...(state.contacts ?? [])].map((contact) => {
    const linkedStudent = changedStudents.find(
      ({ after }) => String(after.contactId ?? "") === String(contact.id ?? ""),
    );
    if (!linkedStudent) return contact;
    return {
      ...contact,
      userIdentifier: getLoginIdentifier(linkedStudent.after.matricule),
    };
  });

  const nextState = {
    ...state,
    students: nextStudents,
    users,
    contacts,
  };

  const persistSource = await persistState(nextState);
  console.log(`Source lecture: ${source}`);
  console.log(`Persistance: ${persistSource}`);
  console.log(`Matricules corrigés: ${changedStudents.length}`);
  for (const { before, after } of changedStudents) {
    console.log(
      `  ${before.firstName ?? ""} ${before.name ?? before.lastName ?? ""} : ${before.matricule ?? before.id} -> ${after.matricule}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
