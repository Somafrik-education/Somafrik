const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const {
  SCHOOLS_PER_COUNTRY,
  COUNTRY_TEMPLATES,
  CLASSES_PER_SCHOOL,
  STUDENTS_PER_SCHOOL,
  TEACHERS_PER_SCHOOL,
  SUBJECTS_PER_SCHOOL,
  RECORDS_PER_FEATURE,
} = require("../lib/bulkPlatformSeed");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
});

const EXPECTED_SCHOOLS = COUNTRY_TEMPLATES.length * SCHOOLS_PER_COUNTRY;

const PER_SCHOOL_EXPECTATIONS = {
  classes: CLASSES_PER_SCHOOL,
  subjects: SUBJECTS_PER_SCHOOL,
  students: STUDENTS_PER_SCHOOL,
  teachers: TEACHERS_PER_SCHOOL,
  attendance: STUDENTS_PER_SCHOOL,
  payments: STUDENTS_PER_SCHOOL,
  announcements: RECORDS_PER_FEATURE,
  exams: RECORDS_PER_FEATURE,
  student_documents: RECORDS_PER_FEATURE,
};

async function count(sql) {
  const row = await pool.query(sql);
  return row.rows[0].count;
}

async function main() {
  console.log("Vérification seed bulk Somafrik\n");

  const schools = await count("SELECT COUNT(*)::int AS count FROM schools");
  console.log(`Établissements : ${schools} (attendu ${EXPECTED_SCHOOLS})`);

  const features = [
    ["Classes", "classes"],
    ["Matières", "subjects"],
    ["Élèves", "students"],
    ["Enseignants (table)", "teachers"],
    ["Présences", "attendance"],
    ["Paiements", "payments"],
    ["Annonces", "announcements"],
    ["Examens", "exams"],
    ["Documents", "student_documents"],
  ];

  for (const [label, table] of features) {
    const total = await count(`SELECT COUNT(*)::int AS count FROM ${table}`);
    const expected = EXPECTED_SCHOOLS * (PER_SCHOOL_EXPECTATIONS[table] ?? 0);
    const ok = total >= expected ? "OK" : "ATTENTION";
    console.log(`${label} : ${total} (attendu ≥ ${expected}) ${ok}`);
  }

  const grades = await count("SELECT COUNT(*)::int AS count FROM grades");
  console.log(`Notes : ${grades} (attendu > 0) ${grades > 0 ? "OK" : "ATTENTION"}`);

  console.log("\nUtilisateurs par rôle (PostgreSQL) :");
  const roles = await pool.query(
    `SELECT role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role`,
  );
  for (const row of roles.rows) {
    console.log(`  ${row.role} : ${row.count}`);
  }

  const stateRow = await pool.query(
    "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
  );
  const state = stateRow.rows[0]?.state_payload ?? {};
  const backofficeEntities = [
    ["Contacts", "contacts", RECORDS_PER_FEATURE],
    ["Relations", "relations", STUDENTS_PER_SCHOOL],
    ["Messages", "messages", RECORDS_PER_FEATURE],
    ["Bulletins", "bulletins", CLASSES_PER_SCHOOL],
    ["Emplois du temps", "courseSchedules", null],
  ];
  console.log("\nBackOffice (JSON) :");
  for (const [label, key, perSchool] of backofficeEntities) {
    const total = Array.isArray(state[key]) ? state[key].length : 0;
    const expected = perSchool ? EXPECTED_SCHOOLS * perSchool : null;
    const ok = expected === null ? "—" : total >= expected ? "OK" : "ATTENTION";
    const expectedLabel = expected === null ? "variable" : `≥ ${expected}`;
    console.log(`${label} : ${total} (attendu ${expectedLabel}) ${ok}`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
