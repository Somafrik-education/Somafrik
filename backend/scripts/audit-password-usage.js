/**
 * Vérifie quels comptes utilisent des mots de passe connus (démo / bootstrap / E2E).
 * Usage :
 *   node backend/scripts/audit-password-usage.js
 *   SOMAFRIK_CHECK_PASSWORD="votreMotDePasse" node backend/scripts/audit-password-usage.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const { Pool } = require("pg");
const { verifySecret } = require("../services/credentialService");
const { resolveDatabaseUrl } = require("../db/connectionConfig");

const KNOWN_PASSWORDS = [
  { label: "demo-seed", value: "1234" },
  { label: "e2e-bootstrap", value: "E2eTest!2026" },
  { label: "wipe-bootstrap", value: "change-me-now" },
];

function matchPassword(hash, plain) {
  if (!hash || !plain) return false;
  return verifySecret(plain, hash) || String(hash) === String(plain);
}

async function main() {
  const custom = String(process.env.SOMAFRIK_CHECK_PASSWORD ?? "").trim();
  const checks = custom
    ? [...KNOWN_PASSWORDS, { label: "custom-check", value: custom }]
    : KNOWN_PASSWORDS;

  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const users = await pool.query(
    `SELECT user_code, email, role, status, password_hash, pin_hash, updated_at
     FROM users ORDER BY updated_at DESC`,
  );
  const stateRow = await pool.query(
    `SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1`,
  );
  const stateUsers = stateRow.rows[0]?.state_payload?.users ?? [];
  const sessions = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active
     FROM sessions`,
  );
  const activeByRole = await pool.query(
    `SELECT role, COUNT(*)::int AS n
     FROM sessions
     WHERE expires_at > NOW()
     GROUP BY role
     ORDER BY n DESC`,
  );

  const matches = [];

  for (const user of users.rows) {
    for (const check of checks) {
      if (matchPassword(user.password_hash, check.value) || matchPassword(user.pin_hash, check.value)) {
        matches.push({
          source: "postgres",
          userCode: user.user_code,
          email: user.email,
          role: user.role,
          passwordType: check.label,
        });
        break;
      }
    }
  }

  for (const user of stateUsers) {
    const plain = String(user.password ?? user.temporaryPassword ?? "").trim();
    if (plain) {
      const hit = checks.find((check) => check.value === plain);
      if (hit) {
        matches.push({
          source: "backoffice_state-plain",
          userCode: user.publicId ?? user.id,
          identifier: user.identifier,
          role: user.role,
          passwordType: hit.label,
        });
      }
    }
    if (user.passwordHash || user.pinHash) {
      for (const check of checks) {
        if (matchPassword(user.passwordHash, check.value) || matchPassword(user.pinHash, check.value)) {
          matches.push({
            source: "backoffice_state-hash",
            userCode: user.publicId ?? user.id,
            identifier: user.identifier,
            role: user.role,
            passwordType: check.label,
          });
          break;
        }
      }
    }
  }

  console.log("\n=== Audit mots de passe comptes Somafrik ===\n");
  console.log(`Comptes PostgreSQL     : ${users.rows.length}`);
  console.log(`Comptes backoffice_state : ${stateUsers.length}`);
  console.log(`Sessions actives       : ${sessions.rows[0].active} / ${sessions.rows[0].total}`);
  console.log("");

  if (activeByRole.rows.length) {
    console.log("Sessions actives par rôle :");
    for (const row of activeByRole.rows) {
      console.log(`  - ${row.role}: ${row.n}`);
    }
    console.log("");
  }

  if (!matches.length) {
    console.log("Aucun compte ne correspond aux mots de passe vérifiés.");
    if (!custom) {
      console.log(
        "Astuce : pour tester votre mot de passe personnel, lancez avec SOMAFRIK_CHECK_PASSWORD=\"...\"",
      );
    }
    await pool.end();
    process.exit(0);
  }

  console.log(`Comptes correspondant à un mot de passe connu : ${matches.length}`);
  for (const row of matches) {
    console.log(
      `  - [${row.passwordType}] ${row.role} | ${row.userCode ?? row.identifier ?? "?"} | source=${row.source}`,
    );
  }

  if (custom) {
    const customHits = matches.filter((row) => row.passwordType === "custom-check");
    console.log("");
    if (customHits.length) {
      console.log(`ATTENTION : ${customHits.length} compte(s) utilisent le mot de passe personnalisé vérifié.`);
      process.exit(1);
    }
    console.log("OK : aucun compte n'utilise le mot de passe personnalisé vérifié.");
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
