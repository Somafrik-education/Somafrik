const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");
const { assertDemoResetSafety } = require("../lib/demoResetSafety");

async function verifyDataset(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM schools) AS schools,
         (SELECT COUNT(*)::int FROM classes) AS classes,
         (SELECT COUNT(*)::int FROM students) AS students,
         (SELECT COUNT(*)::int FROM teachers) AS teachers,
         (SELECT COUNT(*)::int FROM payments) AS payments`,
    );
    const counts = result.rows[0];
    if (!counts || counts.schools < 1 || counts.classes < 1 || counts.students < 1 || counts.teachers < 1) {
      throw new Error(`Dataset Démo incomplet : ${JSON.stringify(counts || {})}`);
    }
    return counts;
  } finally {
    await pool.end();
  }
}

async function main() {
  const { databaseUrl } = assertDemoResetSafety(process.env);
  const seedScript = path.join(__dirname, "seed-platform-bulk.js");

  console.log("Reset contrôlé du dataset Démo…");
  const run = spawnSync(process.execPath, [seedScript, "--fresh"], {
    cwd: path.join(__dirname, "..", ".."),
    env: process.env,
    stdio: "inherit",
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`Seed Démo échoué (code ${run.status}).`);
  }

  const counts = await verifyDataset(databaseUrl);
  console.log(`Dataset Démo vérifié : ${JSON.stringify(counts)}`);
  console.log("Rappel : seul le port public de la passerelle Démo doit être publié.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { verifyDataset };
