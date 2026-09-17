"use strict";

const { Pool } = require("pg");
const { assertDemoResetSafety } = require("../lib/demoResetSafety");
const {
  repairPublicDemoCanonicalRoles,
} = require("../lib/demoCanonicalRoleRepair");

async function main() {
  const { databaseUrl } = assertDemoResetSafety(process.env);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const proof = await repairPublicDemoCanonicalRoles(client);
    await client.query("COMMIT");
    console.log(`Canonical Demo roles repaired: ${JSON.stringify(proof)}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = { main };
