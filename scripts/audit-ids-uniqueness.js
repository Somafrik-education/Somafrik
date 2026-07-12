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

async function loadStateViaApi() {
  const { login, getState, SUPERADMIN_ID, SUPERADMIN_PASSWORD } = require("./e2e-api-helpers");
  const token = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const state = await getState(token);
  return { state, pgUsers: [], source: "api" };
}

async function loadState() {
  const { loadBackofficeStateFromPostgres, loadUsersFromPostgres } = require("./pg-connection");
  try {
    const { state, updatedAt, source } = await loadBackofficeStateFromPostgres();
    const pgUsers = await loadUsersFromPostgres();
    return { state, pgUsers, source, updatedAt };
  } catch (error) {
    console.warn(`Lecture PostgreSQL échouée (${error.message}) — repli API.`);
    return loadStateViaApi();
  }
}

async function main() {
  const { state, pgUsers, source } = await loadState();
  const users = state.users ?? [];
  const contacts = state.contacts ?? [];

  console.log("\n=== Audit unicité id — comptes & contacts ===\n");
  console.log(`Source : ${source ?? "postgres"}\n`);

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

  const pgByCode = pgUsers.length
    ? auditCollection(pgUsers, "PostgreSQL users — user_code", (u) => String(u.user_code ?? "").trim())
    : { label: "PostgreSQL users — user_code", total: 0, unique: 0, missing: 0, duplicates: [] };
  if (pgUsers.length) printReport(pgByCode);

  const pgByUuid = pgUsers.length
    ? auditCollection(pgUsers, "PostgreSQL users — uuid id", (u) => String(u.id ?? "").trim())
    : { label: "PostgreSQL users — uuid id", total: 0, unique: 0, missing: 0, duplicates: [] };
  if (pgUsers.length) printReport(pgByUuid);

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
