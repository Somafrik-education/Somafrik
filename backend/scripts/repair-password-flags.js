/**
 * Aligne les flags mot de passe de backoffice_state avec la table users.
 *
 * Usage : node backend/scripts/repair-password-flags.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function matchesAccount(account, dbUser) {
  const id = String(dbUser.id ?? "");
  const code = String(dbUser.user_code ?? "").trim().toUpperCase();
  return (
    String(account.id ?? "") === id ||
    String(account.publicId ?? "").trim().toUpperCase() === code
  );
}

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const stateResult = await client.query(
      "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    const state = stateResult.rows[0]?.state_payload;
    if (!state || !Array.isArray(state.users) || !state.users.length) {
      console.log("Aucun utilisateur dans backoffice_state.");
      await client.query("COMMIT");
      return;
    }

    const dbUsers = await client.query(
      "SELECT id, user_code, must_change_password FROM users",
    );
    let repaired = 0;
    const users = state.users.map((account) => {
      const dbUser = dbUsers.rows.find((row) => matchesAccount(account, row));
      if (!dbUser || dbUser.must_change_password) {
        return account;
      }
      if (!account.mustChangePassword && !account.temporaryPassword) {
        return account;
      }
      repaired += 1;
      const next = { ...account, mustChangePassword: false, temporaryPassword: "" };
      delete next.password;
      delete next.pin;
      return next;
    });

    if (repaired > 0) {
      const nextState = { ...state, users, updatedAt: new Date().toISOString() };
      await client.query(
        `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
         VALUES ('default', $1::jsonb, NOW())
         ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
        [JSON.stringify(nextState)],
      );
    }

    await client.query("COMMIT");
    console.log(`Comptes réparés dans backoffice_state : ${repaired}`);
    if (repaired > 0) {
      console.log("Redémarrez le backend : docker compose restart backend");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
