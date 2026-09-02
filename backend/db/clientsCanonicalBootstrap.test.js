"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CLIENTS_SCHEMA_SQL } = require("./clientsSchema");
const {
  applyClientsTablesSchema,
  ensureClientsCanonicalBootstrap,
} = require("./clientsCanonicalBootstrap");

const QUIET = { info() {}, error() {} };

async function main() {
  assert.doesNotMatch(CLIENTS_SCHEMA_SQL, /uq_contacts_school_user_active/);
  assert.doesNotMatch(CLIENTS_SCHEMA_SQL, /uq_contact_relations_active/);

  const calls = [];
  const db = {
    query: async (sql) => {
      calls.push({ op: "query", sql: String(sql) });
      return { rows: [] };
    },
    one: async (sql) => {
      calls.push({ op: "one", sql: String(sql) });
      if (String(sql).includes("pg_indexes")) return { present: 1 };
      return { duplicate_groups: 0 };
    },
    all: async (sql) => {
      calls.push({ op: "all", sql: String(sql) });
      return [];
    },
  };

  await applyClientsTablesSchema(db);
  assert.equal(calls[0].op, "query");
  assert.equal(calls[0].sql, CLIENTS_SCHEMA_SQL);
  assert.equal(calls.length, 1, "tables schema must not create parent-linking indexes");

  calls.length = 0;
  await ensureClientsCanonicalBootstrap(db, QUIET);
  assert.equal(calls[0].sql, CLIENTS_SCHEMA_SQL);
  assert.ok(
    calls.some((c) => c.op === "query" && /CREATE TABLE IF NOT EXISTS platform_announcements/.test(c.sql)),
    "bootstrap must apply platform announcements schema",
  );
  assert.ok(
    calls.some((c) => c.op === "query" && /CREATE TABLE IF NOT EXISTS mobile_push_devices/.test(c.sql)),
    "bootstrap must apply mobile push devices schema",
  );
  const inventoryIdx = calls.findIndex((c) => c.op === "one" && c.sql.includes("FROM contacts"));
  const indexIdx = calls.findIndex(
    (c) => c.op === "query" && /CREATE UNIQUE INDEX/i.test(c.sql) && c.sql.includes("uq_contact_relations_active"),
  );
  assert.ok(inventoryIdx > 0, "inventory must run after CLIENTS_SCHEMA_SQL");
  assert.ok(indexIdx > inventoryIdx, "unique indexes must be created after inventory");

  const helperSrc = fs.readFileSync(path.join(__dirname, "clientsCanonicalBootstrap.js"), "utf8");
  const schemaIdx = helperSrc.indexOf("applyClientsTablesSchema");
  const bootstrapFn = helperSrc.indexOf("async function ensureClientsCanonicalBootstrap");
  const constraintsCall = helperSrc.indexOf("ensureParentLinkingConstraints(db", bootstrapFn);
  assert.ok(schemaIdx > 0 && bootstrapFn > schemaIdx);
  assert.ok(constraintsCall > bootstrapFn);

  const repoSrc = fs.readFileSync(path.join(__dirname, "postgresRepository.js"), "utf8");
  assert.match(repoSrc, /ensureClientsCanonicalBootstrap/);
  const initStart = repoSrc.indexOf("async init()");
  const initClients = repoSrc.indexOf("ensureClientsCanonicalSchema()", initStart);
  const initLinking = repoSrc.indexOf("ensureParentLinkingConstraints()", initStart);
  assert.ok(initClients > initStart);
  assert.ok(initLinking < 0 || initLinking > initClients);

  const storeTests = [
    "clientsRepository.pg.test.js",
    "clientsUserProvision.pg.test.js",
    "usersLoginIdentity.pg.test.js",
    "userRoleLifecycle.pg.test.js",
  ];
  for (const file of storeTests) {
    const src = fs.readFileSync(path.join(__dirname, `../lib/${file}`), "utf8");
    assert.match(src, /ensureClientsCanonicalBootstrap/, `${file} must use canonical Clients bootstrap`);
    assert.doesNotMatch(
      src,
      /await pool\.query\(CLIENTS_SCHEMA_SQL\)/,
      `${file} must not apply CLIENTS_SCHEMA_SQL without inventory`,
    );
  }

  const insertRelationSrc = fs.readFileSync(path.join(__dirname, "clientsPgStore.js"), "utf8");
  assert.match(
    insertRelationSrc,
    /ON CONFLICT \(school_id, contact_id, student_id\) WHERE status = 'active'/,
  );

  console.log("clientsCanonicalBootstrap.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
