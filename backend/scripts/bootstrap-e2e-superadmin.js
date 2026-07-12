/**
 * Prépare le compte Super Admin pour les tests E2E (mot de passe connu).
 *
 * Usage (depuis le conteneur backend ou avec DATABASE_URL vers PostgreSQL) :
 *   SOMAFRIK_E2E_BOOTSTRAP=true node backend/scripts/bootstrap-e2e-superadmin.js
 *
 * Mot de passe appliqué : SOMAFRIK_E2E_SUPERADMIN_PASSWORD (défaut E2eTest!2026)
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { hashSecret } = require("../services/credentialService");

const SUPERADMIN_IDENTIFIER = String(process.env.SOMAFRIK_E2E_SUPERADMIN_ID ?? "superadmin").trim();
const SUPERADMIN_CODE = String(process.env.SOMAFRIK_E2E_SUPERADMIN_CODE ?? "USR-2026-000002").trim();
const SCHOOL_ADMIN_IDENTIFIER = String(process.env.SOMAFRIK_E2E_SCHOOL_ADMIN_ID ?? "admin").trim();
const SCHOOL_ADMIN_CODE = String(process.env.SOMAFRIK_E2E_SCHOOL_ADMIN_CODE ?? "USR-2026-000001").trim();
const NEW_PASSWORD = String(process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD ?? "E2eTest!2026").trim();

const BOOTSTRAP_ACCOUNTS = [
  {
    identifier: SUPERADMIN_IDENTIFIER,
    userCode: SUPERADMIN_CODE,
    email: `${SUPERADMIN_IDENTIFIER}@somafrik.app`,
  },
  {
    identifier: SCHOOL_ADMIN_IDENTIFIER,
    userCode: SCHOOL_ADMIN_CODE,
    email: `${SCHOOL_ADMIN_IDENTIFIER}@somafrik.app`,
  },
];

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function matchesBootstrapAccount(account) {
  return BOOTSTRAP_ACCOUNTS.some(
    (target) =>
      String(account.identifier ?? "").trim().toLowerCase() === target.identifier.toLowerCase() ||
      String(account.publicId ?? account.id ?? "")
        .trim()
        .toUpperCase() === target.userCode.toUpperCase(),
  );
}

async function main() {
  if (process.env.SOMAFRIK_E2E_BOOTSTRAP !== "true" && !process.argv.includes("--confirm")) {
    console.error(
      "Refusé : définissez SOMAFRIK_E2E_BOOTSTRAP=true ou passez --confirm pour appliquer le mot de passe E2E.",
    );
    process.exit(1);
  }

  const passwordHash = hashSecret(NEW_PASSWORD);
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let touched = 0;
    for (const target of BOOTSTRAP_ACCOUNTS) {
      const dbResult = await client.query(
        `UPDATE users
         SET password_hash = $1, must_change_password = false, updated_at = NOW()
         WHERE user_code = $2 OR LOWER(email) = LOWER($3)
         RETURNING user_code`,
        [passwordHash, target.userCode, target.email],
      );
      if (dbResult.rowCount) touched += dbResult.rowCount;
    }

    const stateResult = await client.query(
      "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    const state = stateResult.rows[0]?.state_payload;
    if (!state || !Array.isArray(state.users)) {
      throw new Error("backoffice_state introuvable ou sans utilisateurs.");
    }

    let stateTouched = 0;
    const users = state.users.map((account) => {
      if (!matchesBootstrapAccount(account)) return account;
      stateTouched += 1;
      const next = {
        ...account,
        passwordHash,
        pinHash: passwordHash,
        mustChangePassword: false,
        temporaryPassword: "",
      };
      delete next.password;
      delete next.pin;
      delete next.temporaryPassword;
      return next;
    });

    if (!stateTouched) {
      throw new Error("Comptes E2E introuvables dans backoffice_state.");
    }

    await client.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
      [JSON.stringify({ ...state, users, updatedAt: new Date().toISOString() })],
    );

    await client.query("COMMIT");
    console.log(`Mot de passe E2E appliqué (${touched} ligne(s) users, ${stateTouched} compte(s) state).`);
    console.log(`Super Admin   : ${SUPERADMIN_IDENTIFIER}`);
    console.log(`Admin école   : ${SCHOOL_ADMIN_IDENTIFIER}`);
    console.log(`Mot de passe  : ${NEW_PASSWORD}`);
    console.log("Redémarrez le backend si nécessaire : docker compose restart backend");
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
