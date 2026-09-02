#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { UserTeacherSyncService } = require("../services/userTeacherSyncService");
const {
  DELETE_TO_CANON,
  COLLISION_REPAIR,
  buildCleanupState,
  auditState,
} = require("../lib/teacherHistoricalPreprodCleanup");

const EXPECTED_SNAPSHOT_SHA256 = "9ccd75d2fa130b7bb0534c33d4b9272697e10ed25adfd8c65e2fea4e5f54645d";
const EXPECTED_BACKUP_SHA256 = "6958b727d3adf585086d5a71b556bdab33aa73dba7a95012a7c2c3f13d150b4f";
const REFERENCE_TABLES = ["teacher_assignments", "grades", "attendance", "evaluations"];
const AFFECTED_USER_IDS = new Set([
  "43b64560-dfeb-4bca-8040-68cc935591cd",
  "745d78af-4420-43c6-9432-6ffca2f59cc5",
  "04e2e402-e681-46b3-bab1-5245158ee194",
  "a2c95657-c55a-42da-a883-05a72a23205c",
]);

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--confirm-preproduction") options.confirmPreproduction = true;
    else if (arg === "--database-url-env") options.databaseUrlEnv = argv[++index];
    else if (arg === "--backup-sha256") options.backupSha256 = argv[++index];
    else if (arg === "--evidence-output") options.evidenceOutput = argv[++index];
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  return options;
}

function hashState(state) {
  return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function counts(state, relational) {
  return {
    backoffice: {
      teachers: (state.teachers ?? []).length,
      users: (state.users ?? []).length,
      assignments: (state.assignments ?? []).length,
      grades: (state.grades ?? []).length,
      attendance: (state.attendance ?? []).length + (state.presences ?? []).length,
      evaluations: (state.evaluations ?? []).length,
    },
    postgres: relational,
  };
}

async function relationalCounts(client) {
  const result = await client.query(`SELECT
    (SELECT count(*)::int FROM teachers) AS teachers,
    (SELECT count(*)::int FROM users) AS users,
    (SELECT count(*)::int FROM teacher_assignments) AS assignments,
    (SELECT count(*)::int FROM grades) AS grades,
    (SELECT count(*)::int FROM attendance) AS attendance,
    (SELECT count(*)::int FROM evaluations) AS evaluations`);
  return result.rows[0];
}

async function loadLatestState(client, lock = false) {
  const result = await client.query(
    `SELECT state_key, state_payload, updated_at FROM backoffice_state ORDER BY updated_at DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  );
  if (!result.rows[0]?.state_payload) throw new Error("Snapshot backoffice_state absent");
  return result.rows[0];
}

async function danglingPostgresReferences(client) {
  const result = {};
  for (const table of REFERENCE_TABLES) {
    const row = await client.query(
      `SELECT count(*)::int AS count FROM ${table} r LEFT JOIN teachers t ON t.id=r.teacher_id WHERE r.teacher_id IS NOT NULL AND t.id IS NULL`,
    );
    result[table] = row.rows[0].count;
  }
  return result;
}

async function buildDryRun(client, state) {
  const cleaned = buildCleanupState(state);
  const beforeRelational = await relationalCounts(client);
  const teacherRows = await client.query(
    `SELECT teacher_code AS "teacherCode", id::text AS "postgresId" FROM teachers WHERE teacher_code = ANY($1::text[])`,
    [[...DELETE_TO_CANON.keys(), ...DELETE_TO_CANON.values()]],
  );
  const ids = new Map(teacherRows.rows.map((row) => [row.teacherCode, row.postgresId]));
  const referencePlan = {};
  for (const [duplicateCode, canonicalCode] of DELETE_TO_CANON) {
    if (!ids.has(duplicateCode) || !ids.has(canonicalCode)) throw new Error(`Paire PostgreSQL incomplète: ${duplicateCode}`);
    referencePlan[duplicateCode] = { canonicalTeacherId: canonicalCode, tables: {} };
    for (const table of REFERENCE_TABLES) {
      const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE teacher_id=$1`, [ids.get(duplicateCode)]);
      referencePlan[duplicateCode].tables[table] = result.rows[0].count;
    }
  }
  const sync = new UserTeacherSyncService();
  let simulated = cleaned;
  const syncRuns = [];
  for (let run = 1; run <= 10; run += 1) {
    const output = syncAffectedTeachers(sync, simulated);
    simulated = { ...simulated, teachers: output.teachers };
    syncRuns.push({ run, teacherCount: output.teachers.length, teacherIds: output.teachers.map((teacher) => String(teacher.id)).sort() });
  }
  return {
    expectedSnapshotSha256: EXPECTED_SNAPSHOT_SHA256,
    actualSnapshotSha256: hashState(state),
    decisions: [...DELETE_TO_CANON].map(([deletedTeacherId, canonicalTeacherId]) => ({ deletedTeacherId, canonicalTeacherId })),
    publicIdRepair: COLLISION_REPAIR,
    referencePlan,
    countsBefore: counts(state, beforeRelational),
    countsAfterSimulation: counts(cleaned, {
      ...beforeRelational,
      teachers: beforeRelational.teachers - DELETE_TO_CANON.size,
    }),
    auditAfterSimulation: auditState(cleaned),
    syncRuns,
    syncStable: syncRuns.every((run) => run.teacherCount === cleaned.teachers.length),
  };
}

function syncAffectedTeachers(service, state) {
  let teachers = [...(state.teachers ?? [])];
  const users = (state.users ?? []).filter((user) => AFFECTED_USER_IDS.has(String(user.id)));
  if (users.length !== AFFECTED_USER_IDS.size) throw new Error("Comptes enseignants ciblés incomplets");
  for (const user of users) {
    teachers = service.upsertTeacherFromUser(teachers, user, { assignments: state.assignments ?? [] });
  }
  return { teachers };
}

async function applyCleanup(client, stateRow, dryRun) {
  if (dryRun.actualSnapshotSha256 !== EXPECTED_SNAPSHOT_SHA256) throw new Error("Snapshot préproduction différent du snapshot audité");
  const cleaned = buildCleanupState(stateRow.state_payload);
  const movedReferences = {};
  const deletedTeacherIds = [];
  for (const [duplicateCode, canonicalCode] of DELETE_TO_CANON) {
    const rows = await client.query(
      `SELECT teacher_code AS "teacherCode", id::text AS "postgresId" FROM teachers WHERE teacher_code=ANY($1::text[]) FOR UPDATE`,
      [[duplicateCode, canonicalCode]],
    );
    const ids = new Map(rows.rows.map((row) => [row.teacherCode, row.postgresId]));
    if (ids.size !== 2) throw new Error(`Paire verrouillée incomplète: ${duplicateCode}`);
    movedReferences[duplicateCode] = {};
    for (const table of REFERENCE_TABLES) {
      const update = await client.query(`UPDATE ${table} SET teacher_id=$1 WHERE teacher_id=$2 RETURNING id::text`, [ids.get(canonicalCode), ids.get(duplicateCode)]);
      movedReferences[duplicateCode][table] = update.rows.map((row) => row.id);
    }
    const deleted = await client.query("DELETE FROM teachers WHERE id=$1 RETURNING teacher_code", [ids.get(duplicateCode)]);
    if (deleted.rowCount !== 1) throw new Error(`Suppression non déterministe: ${duplicateCode}`);
    deletedTeacherIds.push(duplicateCode);
  }
  await client.query("UPDATE backoffice_state SET state_payload=$1, updated_at=NOW() WHERE state_key=$2", [cleaned, stateRow.state_key]);
  return { cleaned, movedReferences, deletedTeacherIds };
}

async function syncTen(client) {
  const row = await loadLatestState(client, true);
  const service = new UserTeacherSyncService();
  let state = row.state_payload;
  const runs = [];
  const initialIds = (state.teachers ?? []).map((teacher) => String(teacher.id)).sort();
  for (let run = 1; run <= 10; run += 1) {
    const output = syncAffectedTeachers(service, state);
    state = { ...state, teachers: output.teachers };
    runs.push({ run, teacherCount: output.teachers.length, teacherIds: output.teachers.map((teacher) => String(teacher.id)).sort() });
  }
  await client.query("UPDATE backoffice_state SET state_payload=$1, updated_at=NOW() WHERE state_key=$2", [state, row.state_key]);
  return { runs, initialIds, finalIds: (state.teachers ?? []).map((teacher) => String(teacher.id)).sort() };
}

function writeEvidence(target, evidence) {
  if (!target) return;
  const absolute = path.resolve(process.cwd(), target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envName = options.databaseUrlEnv ?? "TEACHER_CLEANUP_DATABASE_URL";
  const connectionString = process.env[envName];
  if (!connectionString) throw new Error(`Variable ${envName} absente`);
  if (options.apply && (!options.confirmPreproduction || options.backupSha256 !== EXPECTED_BACKUP_SHA256)) {
    throw new Error("Apply refusé: confirmation préproduction et SHA-256 exact du backup obligatoires");
  }
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const evidence = { mode: options.apply ? "APPLY_PREPRODUCTION" : "DRY_RUN", generatedAt: new Date().toISOString() };
  try {
    await client.query(options.apply ? "BEGIN" : "BEGIN READ ONLY");
    const beforeRow = await loadLatestState(client, options.apply);
    evidence.snapshotBefore = { updatedAt: beforeRow.updated_at, sha256: hashState(beforeRow.state_payload) };
    evidence.dryRun = await buildDryRun(client, beforeRow.state_payload);
    if (!options.apply) {
      await client.query("ROLLBACK");
      writeEvidence(options.evidenceOutput, evidence);
      console.log(JSON.stringify(evidence, null, 2));
      return;
    }
    if (!evidence.dryRun.syncStable) throw new Error("Apply refusé: sync x10 instable sur l’état simulé");
    evidence.apply = await applyCleanup(client, beforeRow, evidence.dryRun);
    delete evidence.apply.cleaned;
    await client.query("COMMIT");

    await client.query("BEGIN READ ONLY");
    const postCleanup = await loadLatestState(client);
    evidence.postCleanup = {
      audit: auditState(postCleanup.state_payload),
      counts: counts(postCleanup.state_payload, await relationalCounts(client)),
      danglingPostgresReferences: await danglingPostgresReferences(client),
    };
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    evidence.syncTen = await syncTen(client);
    await client.query("COMMIT");

    await client.query("BEGIN READ ONLY");
    const finalRow = await loadLatestState(client);
    evidence.finalAudit = {
      snapshotSha256: hashState(finalRow.state_payload),
      audit: auditState(finalRow.state_payload),
      counts: counts(finalRow.state_payload, await relationalCounts(client)),
      danglingPostgresReferences: await danglingPostgresReferences(client),
      syncTeacherIdsStable: JSON.stringify(evidence.syncTen.initialIds) === JSON.stringify(evidence.syncTen.finalIds),
    };
    await client.query("ROLLBACK");
    writeEvidence(options.evidenceOutput, evidence);
    console.log(JSON.stringify(evidence, null, 2));
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
