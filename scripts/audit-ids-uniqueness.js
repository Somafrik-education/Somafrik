/**
 * Audit : unicité des id pour comptes (users) et contacts dans backoffice_state + PostgreSQL.
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  // optional
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function userIdentityKey(user = {}) {
  const school = normalize(user.schoolCode) || "*";
  const identity = String(user.id ?? user.publicId ?? user.identifier ?? "").trim().toLowerCase();
  return identity ? `${school}|${identity}` : "";
}

function auditCollection(rows = [], label, keyFn) {
  const missing = [];
  const byKey = new Map();
  const duplicates = [];

  for (const row of rows) {
    const key = keyFn(row);
    if (!key) {
      missing.push(row);
      continue;
    }
    if (byKey.has(key)) {
      duplicates.push({ key, a: byKey.get(key), b: row });
    } else {
      byKey.set(key, row);
    }
  }

  return { label, total: rows.length, unique: byKey.size, missing: missing.length, duplicates };
}

function printReport(report) {
  console.log(`\n${report.label}`);
  console.log(`  Total        : ${report.total}`);
  console.log(`  Clés uniques : ${report.unique}`);
  console.log(`  Sans id/clé  : ${report.missing}`);
  console.log(`  Doublons     : ${report.duplicates.length}`);
  for (const dup of report.duplicates.slice(0, 10)) {
    const a = dup.a;
    const b = dup.b;
    console.log(
      `    - ${dup.key} :: [${a.id ?? "?"} / ${a.identifier ?? a.publicId ?? "?"}] vs [${b.id ?? "?"} / ${b.identifier ?? b.publicId ?? "?"}]`,
    );
  }
  if (report.missing > 0 && report.samples?.length) {
    console.log("  Exemples sans id :");
    for (const row of report.samples) {
      console.log(
        `    - ${row.firstName ?? ""} ${row.lastName ?? ""} | role=${row.role ?? row.contactType ?? "?"} | identifier=${row.identifier ?? "—"} | school=${row.schoolCode ?? "—"}`,
      );
    }
  }
}

async function loadState() {
  const { Pool } = require("pg");
  const { buildDatabaseUrl } = require("../backend/db/connectionConfig");
  const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });
  const row = await pool.query(
    "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
  );
  const pgUsers = await pool.query("SELECT id, user_code, first_name, last_name, role FROM users ORDER BY created_at");
  await pool.end();
  return {
    state: row.rows[0]?.state_payload ?? {},
    pgUsers: pgUsers.rows,
  };
}

async function main() {
  const { state, pgUsers } = await loadState();
  const users = state.users ?? [];
  const contacts = state.contacts ?? [];

  console.log("\n=== Audit unicité id — comptes & contacts ===\n");

  const usersById = auditCollection(users, "Comptes (users) — clé id", (u) => String(u.id ?? "").trim());
  usersById.samples = users.filter((u) => !String(u.id ?? "").trim()).slice(0, 5);
  printReport(usersById);

  const usersByIdentity = auditCollection(
    users,
    "Comptes (users) — clé métier school|id|publicId|identifier",
    userIdentityKey,
  );
  usersByIdentity.samples = users.filter((u) => !userIdentityKey(u)).slice(0, 5);
  printReport(usersByIdentity);

  const contactsById = auditCollection(contacts, "Contacts — clé id", (c) => String(c.id ?? "").trim());
  contactsById.samples = contacts.filter((c) => !String(c.id ?? "").trim()).slice(0, 5);
  printReport(contactsById);

  const pgByCode = auditCollection(pgUsers, "PostgreSQL users — user_code", (u) => String(u.user_code ?? "").trim());
  printReport(pgByCode);

  const pgByUuid = auditCollection(pgUsers, "PostgreSQL users — uuid id", (u) => String(u.id ?? "").trim());
  printReport(pgByUuid);

  const issues =
    usersById.missing +
    usersById.duplicates.length +
    contactsById.missing +
    contactsById.duplicates.length +
    pgByCode.duplicates.length;

  console.log(`\nRésumé : ${issues === 0 ? "OK — aucun problème détecté" : `${issues} problème(s) détecté(s)`}\n`);
  process.exit(issues > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
