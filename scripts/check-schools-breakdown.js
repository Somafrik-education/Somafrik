/**
 * Diagnostic : comptage établissements (runtime, PostgreSQL, API fusionnée).
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  // dotenv optionnel hors backend
}

const seedData = require("../backend/data");
const {
  login,
  getState,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
} = require("./e2e-api-helpers");

function schoolKey(school = {}) {
  return String(school.code ?? school.publicId ?? "").trim().toUpperCase();
}

function mergeSchoolRows(runtime = [], stored = []) {
  const rows = new Map();
  for (const school of runtime) {
    const key = schoolKey(school);
    if (key) rows.set(key, { ...school });
  }
  for (const school of stored) {
    const key = schoolKey(school);
    if (!key) continue;
    const existing = rows.get(key);
    rows.set(key, existing ? { ...existing, ...school } : { ...school });
  }
  return [...rows.values()];
}

function categorize(schools = []) {
  const manual = [];
  const e2e = [];
  const seed = [];
  for (const school of schools) {
    const name = String(school.name ?? "");
    if (/E2E/i.test(name)) {
      e2e.push(school);
    } else if (/^Établissement Somafrik \d+$/.test(name) || /^Établissement Somafrik (CD|CG|BI) /.test(name)) {
      seed.push(school);
    } else {
      manual.push(school);
    }
  }
  return { manual, e2e, seed };
}

async function loadStoredSchools() {
  try {
    const { Pool } = require("pg");
    const { buildDatabaseUrl } = require("../backend/db/connectionConfig");
    const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl();
    const pool = new Pool({ connectionString: databaseUrl });
    const row = await pool.query(
      "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    await pool.end();
    return row.rows[0]?.state_payload?.schools ?? [];
  } catch (error) {
    console.warn("PostgreSQL indisponible:", error.message);
    return null;
  }
}

async function main() {
  const runtime = seedData.platformSchools ?? [];
  const stored = await loadStoredSchools();
  const token = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const apiState = await getState(token);
  const apiSchools = apiState.schools ?? [];

  console.log("\n=== Diagnostic établissements ===\n");
  console.log(`Runtime seed (data.js)     : ${runtime.length}`);
  if (stored) {
    console.log(`PostgreSQL state JSON      : ${stored.length}`);
    const merged = mergeSchoolRows(runtime, stored);
    console.log(`Fusion runtime + stocké    : ${merged.length}`);
    const storedCats = categorize(stored);
    const mergedCats = categorize(merged);
    console.log(`  PG — manuels superadmin  : ${storedCats.manual.length}`);
    console.log(`  PG — E2E                 : ${storedCats.e2e.length}`);
    console.log(`  PG — seed démo           : ${storedCats.seed.length}`);
    console.log(`  Fusion — manuels         : ${mergedCats.manual.length}`);
    console.log(`  Fusion — E2E visibles    : ${mergedCats.e2e.length}`);
    console.log(`  Fusion — seed démo       : ${mergedCats.seed.length}`);
    console.log("\nManuels dans PostgreSQL (hors E2E / seed) :");
    for (const school of storedCats.manual) {
      console.log(`  - ${school.code} | ${school.name}`);
    }
  } else {
    console.log("PostgreSQL state JSON      : (non lu)");
  }

  const apiCats = categorize(apiSchools);
  console.log(`\nAPI / UI (state courant) : ${apiSchools.length}`);
  console.log(`  API — manuels            : ${apiCats.manual.length}`);
  console.log(`  API — E2E                : ${apiCats.e2e.length}`);
  console.log(`  API — seed démo          : ${apiCats.seed.length}`);
  console.log("\nManuels visibles dans l'API :");
  for (const school of apiCats.manual) {
    console.log(`  - ${school.code} | ${school.name}`);
  }
  console.log(`\ndeletedRows.schools (API)  : ${(apiState.deletedRows?.schools ?? []).length}`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
