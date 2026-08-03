#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { buildFullAudit } = require("../lib/teacherPostCleanupFullAudit");

const REMOVED_POSTGRES_IDS = [
  "657e6063-2fad-4cc1-bc19-94ef28d82d92",
  "f4cafbe5-7ac2-4272-8766-f361027cb935",
];
const REFERENCE_TABLES = ["teacher_assignments", "grades", "attendance", "evaluations"];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") continue;
    else if (arg === "--database-url-env") options.databaseUrlEnv = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  return options;
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

async function load(client, lock = false) {
  const stateResult = await client.query(
    `SELECT state_key,state_payload,updated_at FROM backoffice_state ORDER BY updated_at DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  );
  const postgresUsers = await client.query(
    `SELECT u.id::text AS id,u.user_code AS "userCode",u.first_name AS "firstName",u.last_name AS "lastName",
            u.email,u.phone,u.role,u.status,u.created_at AS "createdAt",u.updated_at AS "updatedAt",s.school_code AS "schoolCode"
       FROM users u LEFT JOIN schools s ON s.id=u.school_id`,
  );
  const postgresTeachers = await client.query(
    `SELECT t.id::text AS "postgresId",t.teacher_code AS "teacherCode",t.user_id::text AS "postgresUserId",
            s.school_code AS "schoolCode" FROM teachers t JOIN schools s ON s.id=t.school_id`,
  );
  const postgresReferences = { dangling: {}, toRemovedTeacherIds: {} };
  for (const table of REFERENCE_TABLES) {
    const dangling = await client.query(
      `SELECT count(*)::int AS count FROM ${table} r LEFT JOIN teachers t ON t.id=r.teacher_id WHERE r.teacher_id IS NOT NULL AND t.id IS NULL`,
    );
    const removed = await client.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE teacher_id=ANY($1::uuid[])`,
      [REMOVED_POSTGRES_IDS],
    );
    postgresReferences.dangling[table] = dangling.rows[0].count;
    postgresReferences.toRemovedTeacherIds[table] = removed.rows[0].count;
  }
  return {
    row: stateResult.rows[0],
    postgresUsers: postgresUsers.rows,
    postgresTeachers: postgresTeachers.rows,
    postgresReferences,
  };
}

function write(target, evidence) {
  const absolute = path.resolve(process.cwd(), target ?? "docs/audits/evidence/POST-CLEANUP-FULL-AUDIT.json");
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env[options.databaseUrlEnv ?? "TEACHER_FULL_AUDIT_DATABASE_URL"];
  if (!connectionString) throw new Error("URL de base absente");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const evidence = { mode: "CANONICAL_IDENTITY_AUDIT_READ_ONLY", generatedAt: new Date().toISOString() };
  try {
    await client.query("BEGIN READ ONLY");
    const loaded = await load(client, false);
    const snapshotHash = hash(loaded.row.state_payload);
    evidence.snapshotBefore = { updatedAt: loaded.row.updated_at, sha256: snapshotHash };
    evidence.auditBefore = buildFullAudit(loaded.row.state_payload, loaded.postgresUsers, loaded.postgresTeachers, loaded.postgresReferences);
    await client.query("ROLLBACK");
    write(options.output, evidence);
    console.log(JSON.stringify({
      counts: evidence.auditBefore.counts,
      canonicalIdentityAudit: evidence.auditBefore.canonicalIdentityAudit,
    }, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
