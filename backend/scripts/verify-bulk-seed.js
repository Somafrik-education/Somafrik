const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? buildDatabaseUrl(),
});

const EXPECTED_SCHOOLS = 30;
const EXPECTED_PER_SCHOOL = 10;

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
    ["Notes", "grades"],
    ["Présences", "attendance"],
    ["Paiements", "payments"],
    ["Annonces", "announcements"],
    ["Examens", "exams"],
    ["Documents", "student_documents"],
  ];

  for (const [label, table] of features) {
    const total = await count(`SELECT COUNT(*)::int AS count FROM ${table}`);
    const expected = EXPECTED_SCHOOLS * EXPECTED_PER_SCHOOL;
    const ok = total >= expected ? "OK" : "ATTENTION";
    console.log(`${label} : ${total} (attendu ≥ ${expected}) ${ok}`);
  }

  console.log("\nUtilisateurs par rôle (PostgreSQL) :");
  const roles = await pool.query(
    `SELECT role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role`,
  );
  for (const row of roles.rows) {
    console.log(`  ${row.role} : ${row.count}`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
