const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const {
  assertDemoResetSafety,
  hardenBackOfficeCredentials,
} = require("../lib/demoResetSafety");
const { resolveDemoInternalSeedPin } = require("../lib/demoGatewayPolicy");

async function hardenDemoCredentials(databaseUrl, internalSeedPin) {
  const pool = new Pool({ connectionString: databaseUrl });
  const secretHash = hashSecret(internalSeedPin);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = await client.query(
      `UPDATE users
       SET password_hash = $1, pin_hash = $1, updated_at = NOW()
       WHERE status = 'active'
       RETURNING id`,
      [secretHash],
    );

    const state = await client.query(
      `SELECT state_payload
       FROM backoffice_state
       WHERE state_key = 'default'
       FOR UPDATE`,
    );
    if (state.rows[0]?.state_payload) {
      const hardenedPayload = hardenBackOfficeCredentials(state.rows[0].state_payload, secretHash);
      await client.query(
        `UPDATE backoffice_state
         SET state_payload = $1::jsonb, updated_at = NOW()
         WHERE state_key = 'default'`,
        [JSON.stringify(hardenedPayload)],
      );
    }

    await client.query("COMMIT");
    return { rotatedUsers: users.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

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
  const internalSeedPin = resolveDemoInternalSeedPin(process.env);
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

  const hardening = await hardenDemoCredentials(databaseUrl, internalSeedPin);
  const counts = await verifyDataset(databaseUrl);
  console.log(`Credentials Démo durcis : ${hardening.rotatedUsers} comptes.`);
  console.log(`Dataset Démo vérifié : ${JSON.stringify(counts)}`);
  console.log("Rappel : seul le port public de la passerelle Démo doit être publié.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { hardenDemoCredentials, verifyDataset };
