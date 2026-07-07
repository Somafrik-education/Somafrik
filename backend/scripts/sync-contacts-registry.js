/**
 * Synchronise Contacts ↔ élèves / enseignants / utilisateurs et purge les orphelins.
 *
 * Usage :
 *   node backend/scripts/sync-contacts-registry.js
 *   docker compose restart backend
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { initializeRepository } = require("../db/repositoryFactory");
const { dedupeBackOfficeState } = require("../lib/backofficeDedupe");
const {
  syncContactRegistry,
  mergeRowsByIdentity,
  collectStudentKeys,
  collectTeacherKeys,
  collectUserKeys,
} = require("../lib/contactRegistrySync");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function countEntity(state, key) {
  return Array.isArray(state[key]) ? state[key].length : 0;
}

async function loadMergedState(repository) {
  const stored = (await repository.getBackOfficeState()) ?? {};
  const runtime = await repository.getDataset();

  return {
    ...stored,
    schools: mergeRowsByIdentity(runtime.platformSchools ?? [], stored.schools ?? []),
    users: mergeRowsByIdentity(runtime.userAccounts ?? [], stored.users ?? []),
    countries: mergeRowsByIdentity(runtime.countries ?? [], stored.countries ?? []),
    students: mergeRowsByIdentity(runtime.students ?? [], stored.students ?? []),
    teachers: mergeRowsByIdentity(runtime.teachers ?? [], stored.teachers ?? []),
    classes: mergeRowsByIdentity(runtime.classes ?? [], stored.classes ?? []),
    courses: mergeRowsByIdentity(runtime.courses ?? [], stored.courses ?? []),
    assignments: mergeRowsByIdentity(runtime.teacherAssignments ?? [], stored.assignments ?? []),
    payments: mergeRowsByIdentity(runtime.payments ?? [], stored.payments ?? []),
    presences: mergeRowsByIdentity(runtime.presences ?? [], stored.presences ?? []),
    notes: mergeRowsByIdentity(runtime.notes ?? [], stored.notes ?? []),
    announcements: mergeRowsByIdentity(runtime.announcements ?? [], stored.announcements ?? []),
    contacts: stored.contacts ?? [],
    relations: stored.relations ?? [],
    subscriptions: mergeRowsByIdentity(runtime.subscriptions ?? [], stored.subscriptions ?? []),
    notifications: mergeRowsByIdentity(runtime.platformNotifications ?? [], stored.notifications ?? []),
    academicConfigs: stored.academicConfigs ?? {},
    rolePermissions: stored.rolePermissions ?? {},
    deletedRows: stored.deletedRows ?? {},
  };
}

async function purgePostgresOrphans(pool, removedStudentKeys, removedTeacherKeys, removedUserKeys) {
  const studentKeys = [...removedStudentKeys];
  const teacherKeys = [...removedTeacherKeys];
  const userKeys = [...removedUserKeys];

  if (studentKeys.length) {
    const studentIds = await pool.query(
      `SELECT id FROM students
       WHERE student_code = ANY($1::text[]) OR id::text = ANY($1::text[])`,
      [studentKeys],
    );
    const ids = studentIds.rows.map((row) => row.id);
    if (ids.length) {
      await pool.query(`DELETE FROM attendance WHERE student_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM grades WHERE student_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM enrollments WHERE student_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [ids]);
    }
  }

  if (teacherKeys.length) {
    const teacherIds = await pool.query(
      `SELECT id FROM teachers
       WHERE teacher_code = ANY($1::text[]) OR id::text = ANY($1::text[])`,
      [teacherKeys],
    );
    const ids = teacherIds.rows.map((row) => row.id);
    if (ids.length) {
      await pool.query(`DELETE FROM teacher_assignments WHERE teacher_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM teachers WHERE id = ANY($1::uuid[])`, [ids]);
    }
  }

  if (userKeys.length) {
    await pool.query(
      `DELETE FROM users
       WHERE user_code = ANY($1::text[]) OR id::text = ANY($1::text[])`,
      [userKeys],
    );
  }
}

function diffKeys(beforeRows = [], afterRows = [], keyFn) {
  const after = new Set(afterRows.flatMap((row) => keyFn(row)));
  return [...new Set(beforeRows.flatMap((row) => keyFn(row)).filter((key) => key && !after.has(key)))];
}

async function main() {
  const { repository } = await initializeRepository();
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });

  try {
    const merged = await loadMergedState(repository);
    if (!Array.isArray(merged.contacts) || !merged.contacts.length) {
      console.log("Aucun contact dans l'état — rien à synchroniser.");
      return;
    }

    const before = {
      contacts: countEntity(merged, "contacts"),
      students: countEntity(merged, "students"),
      teachers: countEntity(merged, "teachers"),
      users: countEntity(merged, "users"),
      relations: countEntity(merged, "relations"),
      notes: countEntity(merged, "notes"),
      presences: countEntity(merged, "presences"),
    };

    const { state: synced, report: syncReport } = syncContactRegistry(merged);
    const { state: next, report: dedupeReport } = dedupeBackOfficeState(synced);

    const removedStudentKeys = diffKeys(merged.students, next.students, collectStudentKeys);
    const removedTeacherKeys = diffKeys(merged.teachers, next.teachers, collectTeacherKeys);
    const removedUserKeys = diffKeys(merged.users, next.users, collectUserKeys);

    await pool.query("BEGIN");
    await pool.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
      [JSON.stringify(next)],
    );
    await purgePostgresOrphans(pool, removedStudentKeys, removedTeacherKeys, removedUserKeys);
    await pool.query("COMMIT");

    const after = {
      contacts: countEntity(next, "contacts"),
      students: countEntity(next, "students"),
      teachers: countEntity(next, "teachers"),
      users: countEntity(next, "users"),
      relations: countEntity(next, "relations"),
      notes: countEntity(next, "notes"),
      presences: countEntity(next, "presences"),
    };

    console.log("Synchronisation Contacts terminée.");
    console.log(`  Contacts reliés : ${syncReport.contactsLinked}`);
    console.log(`  Fiches créées depuis contacts : ${syncReport.fichesCreated}`);
    console.log(`  Comptes utilisateurs reliés : ${syncReport.usersLinked}`);
    console.log("");
    console.log("  Suppressions (orphelins sans contact) :");
    Object.entries(syncReport.removed).forEach(([entity, count]) => {
      if (count > 0) console.log(`    - ${entity}: ${count}`);
    });
    if (dedupeReport.totalRemoved > 0) {
      console.log(`  Doublons supprimés (dedupe): ${dedupeReport.totalRemoved}`);
    }
    console.log("");
    console.log("  Avant → Après");
    Object.keys(before).forEach((key) => {
      if (before[key] !== after[key]) {
        console.log(`    ${key}: ${before[key]} → ${after[key]}`);
      }
    });
    console.log("");
    console.log("Redémarrez le backend : docker compose restart backend");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await repository.close?.();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
