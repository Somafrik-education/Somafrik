#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { UserTeacherSyncService } = require("../services/userTeacherSyncService");
const { buildFullAudit } = require("../lib/teacherPostCleanupFullAudit");

const EXPECTED_POST_CLEANUP_SHA256 = "484dd9610e395ff967ad09fb5ac0122d7b455af45895bd3f08b52c2d25c74448";
const REMOVED_POSTGRES_IDS = [
  "657e6063-2fad-4cc1-bc19-94ef28d82d92",
  "f4cafbe5-7ac2-4272-8766-f361027cb935",
];
const REFERENCE_TABLES = ["teacher_assignments", "grades", "attendance", "evaluations"];

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply-global-sync") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--confirm-preproduction") options.confirm = true;
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

function globalSyncTen(state, canonicalUserIds) {
  const service = new UserTeacherSyncService();
  const allowed = new Set(canonicalUserIds);
  const users = (state.users ?? []).filter((user) => allowed.has(String(user.id)));
  if (users.length !== canonicalUserIds.length) throw new Error("Identités canoniques incomplètes pour la sync globale");
  let current = state;
  const initialIds = (current.teachers ?? []).map((teacher) => String(teacher.id)).sort();
  const runs = [];
  for (let run = 1; run <= 10; run += 1) {
    let teachers = [...(current.teachers ?? [])];
    for (const user of users) {
      teachers = service.upsertTeacherFromUser(teachers, user, { assignments: current.assignments ?? [] });
    }
    current = { ...current, teachers };
    const ids = teachers.map((teacher) => String(teacher.id)).sort();
    runs.push({ run, teacherCount: ids.length, teacherIdsSha256: hash(ids) });
  }
  const finalIds = (current.teachers ?? []).map((teacher) => String(teacher.id)).sort();
  return {
    state: current,
    evidence: {
      scope: "ALL_59_CANONICAL_TEACHER_ACCOUNTS_AFTER_ALIAS_RESOLUTION",
      rawBackofficeTeacherAccountRows: (state.users ?? []).filter((user) => ["enseignant", "teacher"].includes(String(user.role ?? "").toLowerCase())).length,
      canonicalAccountsSynced: users.length,
      initialTeacherCount: initialIds.length,
      finalTeacherCount: finalIds.length,
      initialTeacherIdsSha256: hash(initialIds),
      finalTeacherIdsSha256: hash(finalIds),
      idsStrictlyStable: JSON.stringify(initialIds) === JSON.stringify(finalIds),
      runs,
    },
  };
}

function gates(audit, sync) {
  const zeroObject = (object) => Object.values(object).every((value) => value === 0);
  return {
    teacherCount59: audit.counts.teachers === 59,
    canonicalAccounts59: audit.counts.canonicalTeacherAccounts === 59,
    duplicateUserIdZero: audit.collisions.userId.length === 0,
    duplicateContactIdZero: audit.collisions.contactId.length === 0,
    duplicateIdentifierZero: audit.collisions.identifier.length === 0,
    duplicatePublicIdZero: audit.collisions.publicId.length === 0,
    incoherentBackofficeAccountZero: audit.accounts.incoherentBackoffice.length === 0,
    incoherentPostgresAccountZero: audit.accounts.incoherentPostgres.length === 0,
    teacherMissingLinkZero: audit.teachersWithoutExpectedLink.length === 0,
    teacherMissingBackofficeUserZero: audit.teachersWithMissingBackofficeUser.length === 0,
    postgresTeacherMissingUserZero: audit.postgresTeachersWithMissingUser.length === 0,
    backofficeDanglingReferenceZero: audit.references.backofficeDangling.length === 0,
    backofficeRemovedIdReferenceZero: audit.references.backofficeToRemovedIds.length === 0,
    postgresDanglingReferenceZero: zeroObject(audit.references.postgres.dangling),
    postgresRemovedIdReferenceZero: zeroObject(audit.references.postgres.toRemovedTeacherIds),
    globalSyncCountStable: sync.initialTeacherCount === 59 && sync.runs.every((run) => run.teacherCount === 59),
    globalSyncIdsStable: sync.idsStrictlyStable,
  };
}

function write(target, evidence) {
  const absolute = path.resolve(process.cwd(), target ?? "docs/audits/evidence/POST-CLEANUP-FULL-AUDIT.json");
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply && !options.confirm) throw new Error("Confirmation préproduction obligatoire");
  const connectionString = process.env[options.databaseUrlEnv ?? "TEACHER_FULL_AUDIT_DATABASE_URL"];
  if (!connectionString) throw new Error("URL de base absente");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const evidence = { mode: options.apply ? "GLOBAL_SYNC_X10_APPLY_PREPRODUCTION" : "FULL_AUDIT_DRY_RUN", generatedAt: new Date().toISOString() };
  try {
    await client.query(options.apply ? "BEGIN" : "BEGIN READ ONLY");
    const loaded = await load(client, options.apply);
    const snapshotHash = hash(loaded.row.state_payload);
    evidence.snapshotBefore = { updatedAt: loaded.row.updated_at, sha256: snapshotHash };
    if (options.apply && snapshotHash !== EXPECTED_POST_CLEANUP_SHA256) throw new Error("Snapshot post-cleanup différent de l’état revalidé");
    evidence.auditBefore = buildFullAudit(loaded.row.state_payload, loaded.postgresUsers, loaded.postgresTeachers, loaded.postgresReferences);
    const simulation = globalSyncTen(loaded.row.state_payload, evidence.auditBefore.canonicalUserIds);
    evidence.globalSyncX10 = simulation.evidence;
    evidence.gatesBefore = gates(evidence.auditBefore, evidence.globalSyncX10);
    if (!Object.values(evidence.gatesBefore).every(Boolean)) {
      await client.query("ROLLBACK");
      write(options.output, evidence);
      throw new Error("Audit exhaustif non conforme: aucune synchronisation réelle exécutée");
    }
    if (!options.apply) {
      await client.query("ROLLBACK");
      write(options.output, evidence);
      console.log(JSON.stringify({ counts: evidence.auditBefore.counts, gates: evidence.gatesBefore, sync: evidence.globalSyncX10 }, null, 2));
      return;
    }
    await client.query("UPDATE backoffice_state SET state_payload=$1,updated_at=NOW() WHERE state_key=$2", [simulation.state, loaded.row.state_key]);
    await client.query("COMMIT");

    await client.query("BEGIN READ ONLY");
    const finalLoaded = await load(client);
    evidence.snapshotAfter = { updatedAt: finalLoaded.row.updated_at, sha256: hash(finalLoaded.row.state_payload) };
    evidence.auditAfter = buildFullAudit(finalLoaded.row.state_payload, finalLoaded.postgresUsers, finalLoaded.postgresTeachers, finalLoaded.postgresReferences);
    const finalCheck = globalSyncTen(finalLoaded.row.state_payload, evidence.auditAfter.canonicalUserIds);
    evidence.gatesAfter = gates(evidence.auditAfter, finalCheck.evidence);
    await client.query("ROLLBACK");
    write(options.output, evidence);
    console.log(JSON.stringify({ counts: evidence.auditAfter.counts, gates: evidence.gatesAfter, sync: evidence.globalSyncX10 }, null, 2));
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
