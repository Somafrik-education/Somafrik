"use strict";

/**
 * CONFIG-FINAL-01 — persistance PostgreSQL de finalized_at.
 *
 * Chaque exécution crée ses bases sur une instance loopback, sous un nom
 * unique tiré au sort. Une base déjà présente est refusée. Le nettoyage ne
 * supprime que les bases enregistrées par cette exécution, y compris si le
 * test échoue, et uniquement si leur nom correspond au motif prévu.
 * Aucune autre base n'est vidée ni supprimée.
 * Un SKIP n'est pas une validation.
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { guardPgPool } = require("./pgPoolGuard");
const { waitForNoDatabaseSessions } = require("./pgTestLifecycle");
const {
  createPgProgressStore,
  finalizeSchoolSetupGuided,
  getSchoolSetupGuided,
  completeGuidedStep,
} = require("./schoolSetupGuided");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const WORK_NAME = /^somafrik_test_cfgfin_[0-9a-f]{12}$/;
const SENTINEL_NAME = /^somafrik_test_cfgfin_keep_[0-9a-f]{12}$/;
const LEGACY_FIXED_DATABASE = "somafrik_school_setup_finalize_it";

const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const SENTINEL_SCHOOL = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const SENTINEL_STEPS = ["establishment", "academicYear"];

const createdByThisRun = new Set();

function createSession() {
  return { created: new Set(), droppable: new Set() };
}

function assertLocalTestInstance(databaseUrl, env = process.env) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("CONFIG-FINAL-01 : DATABASE_URL illisible.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Refus: hôte PostgreSQL non local (${host}).`);
  }
  for (const key of ["host", "hostaddr"]) {
    const override = String(parsed.searchParams.get(key) ?? "").toLowerCase();
    if (override && !LOOPBACK_HOSTS.has(override)) {
      throw new Error(`Refus: paramètre ${key} non local.`);
    }
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (/prod|preprod/i.test(`${host} ${name}`)) {
    throw new Error("Refus: cible prod ou préprod.");
  }
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production" || String(env.RENDER ?? "") !== "") {
    throw new Error("Refus: environnement de production.");
  }
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function requireDatabaseUrl() {
  if (process.env.GITHUB_ACTIONS && !DATABASE_URL) {
    throw new Error("DATABASE_URL requis en GitHub Actions — la persistance ne peut pas être SKIP.");
  }
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis — un test PostgreSQL ignoré ne valide pas CONFIG-FINAL-01.");
  }
  assertLocalTestInstance(DATABASE_URL);
}

function adminPool() {
  assertLocalTestInstance(DATABASE_URL);
  return guardPgPool(new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres"), max: 2 }));
}

async function databaseExists(name) {
  const admin = adminPool();
  try {
    const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    return result.rowCount > 0;
  } finally {
    await admin.end();
  }
}

async function createDisposableDatabase(name, pattern, session) {
  assertLocalTestInstance(DATABASE_URL);
  if (!pattern.test(name) || /prod|preprod/i.test(name)) {
    throw new Error("Refus: nom de base hors motif de cette exécution.");
  }
  const admin = adminPool();
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount) {
      throw new Error(`Refus: base préexistante non réutilisée (${name}).`);
    }
    await admin.query(`CREATE DATABASE ${name}`);
    session.created.add(name);
    session.droppable.add(name);
    createdByThisRun.add(name);
  } finally {
    await admin.end();
  }
  return { name, url: withDatabaseName(DATABASE_URL, name) };
}

async function dropDisposableDatabase(name, pattern, session) {
  if (!session.created.has(name) || !session.droppable.has(name) || !pattern.test(name)) return false;
  if (!createdByThisRun.has(name)) return false;
  assertLocalTestInstance(DATABASE_URL);
  const admin = adminPool();
  try {
    await waitForNoDatabaseSessions(admin, name);
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    session.created.delete(name);
    session.droppable.delete(name);
    createdByThisRun.delete(name);
    return true;
  } finally {
    await admin.end();
  }
}

async function dropSession(session) {
  const failures = [];
  for (const name of [...session.created]) {
    session.droppable.add(name);
    const pattern = SENTINEL_NAME.test(name) ? SENTINEL_NAME : WORK_NAME;
    try {
      await dropDisposableDatabase(name, pattern, session);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Nettoyage incomplet des bases de cette exécution. ${failures.join(" | ")}`);
  }
}

after(async () => {
  if (!DATABASE_URL || createdByThisRun.size === 0) return;
  const leaked = createSession();
  for (const name of createdByThisRun) {
    leaked.created.add(name);
    leaked.droppable.add(name);
  }
  await dropSession(leaked);
});

async function withPool(url, fn) {
  const pool = guardPgPool(new Pool({ connectionString: url }));
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function seedMarker(url) {
  await withPool(url, async (pool) => {
    await pool.query("CREATE TABLE sentinel_marker (id integer PRIMARY KEY, note text NOT NULL)");
    await pool.query("INSERT INTO sentinel_marker (id, note) VALUES (1, 'preexisting-row')");
  });
}

async function readMarker(url) {
  return withPool(url, async (pool) => (await pool.query("SELECT id, note FROM sentinel_marker ORDER BY id")).rows);
}

async function legacyFingerprint() {
  if (!(await databaseExists(LEGACY_FIXED_DATABASE))) return null;
  return withPool(withDatabaseName(DATABASE_URL, LEGACY_FIXED_DATABASE), async (pool) => {
    const progress = await pool.query(
      `SELECT school_id::text AS school_id, last_valid_step, completed_steps, finalized_at
       FROM school_setup_progress
       ORDER BY school_id::text`,
    );
    const schools = await pool.query("SELECT id::text AS id FROM schools ORDER BY id::text");
    return JSON.stringify({
      progress: progress.rows.map((row) => ({
        ...row,
        finalized_at: row.finalized_at ? new Date(row.finalized_at).toISOString() : null,
      })),
      schools: schools.rows,
    });
  });
}

function randomWorkName() {
  return `somafrik_test_cfgfin_${crypto.randomBytes(6).toString("hex")}`;
}

function randomSentinelName() {
  return `somafrik_test_cfgfin_keep_${crypto.randomBytes(6).toString("hex")}`;
}

function membershipOne() {
  return async (sql, params = []) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) {
      if (String(params[0]) === "admin-a") return { school_id: SCHOOL_A, login_code: "CD-IN-26-001", id: SCHOOL_A };
      if (String(params[0]) === "admin-b") return { school_id: SCHOOL_B, login_code: "CD-EL-26-002", id: SCHOOL_B };
    }
    return null;
  };
}

function readySnapshot(overrides = {}) {
  return {
    hasName: true,
    hasCountry: true,
    hasAddress: true,
    hasPhone: true,
    hasCurrency: true,
    hasCurrentOrOpenAcademicYear: true,
    hasAcademicYearDates: true,
    activatedLevelCount: 1,
    activatedGroupCount: 1,
    classCount: 1,
    subjectCount: 1,
    teacherCount: 1,
    teacherAssignmentCount: 1,
    enrolledStudentCount: 1,
    feeGridCount: 0,
    paymentMethodCount: 0,
    evaluationTypeCount: 0,
    notificationsConfigured: false,
    userCount: 1,
    ...overrides,
  };
}

test("le banc ne vise aucune base fixe et ne vide aucun schéma", () => {
  const source = fs.readFileSync(__filename, "utf8");
  assert.equal(/\bDROP\s+SCHEMA\b/i.test(source), false);
  const fixedSelector = ["SOMAFRIK", "SCHOOL", "SETUP", "FINALIZE", "IT", "DATABASE"].join("_");
  assert.equal(source.includes(fixedSelector), false);
});

test("cible non locale, prod ou préprod refusée", () => {
  assert.throws(() => assertLocalTestInstance("postgresql://user@db.internal/postgres"), /non local/);
  assert.throws(() => assertLocalTestInstance("postgresql://user@127.0.0.1/postgres?host=db.internal"), /non local/);
  assert.throws(() => assertLocalTestInstance("postgresql://user@127.0.0.1/postgres?hostaddr=10.0.0.8"), /non local/);
  assert.throws(() => assertLocalTestInstance("postgresql://user@127.0.0.1/somafrik_prod"), /prod ou préprod/);
  assert.throws(() => assertLocalTestInstance("postgresql://user@127.0.0.1/somafrik_preprod"), /prod ou préprod/);
  assert.throws(
    () => assertLocalTestInstance("postgresql://user@127.0.0.1/postgres", { NODE_ENV: "production", RENDER: "" }),
    /production/,
  );
  assert.throws(
    () => assertLocalTestInstance("postgresql://user@127.0.0.1/postgres", { NODE_ENV: "test", RENDER: "true" }),
    /production/,
  );
  assert.doesNotThrow(() => assertLocalTestInstance("postgresql://user@127.0.0.1:5432/postgres", {}));
  assert.doesNotThrow(() => assertLocalTestInstance("postgresql://user@localhost/postgres", {}));
  assert.doesNotThrow(() => assertLocalTestInstance("postgresql://user@[::1]/postgres", {}));
});

test("base préexistante refusée, échec nettoyé, sentinelle intacte", async () => {
  requireDatabaseUrl();
  const session = createSession();
  const legacyBefore = await legacyFingerprint();
  const sentinel = await createDisposableDatabase(randomSentinelName(), SENTINEL_NAME, session);
  const reused = await createDisposableDatabase(randomWorkName(), WORK_NAME, session);
  let doomedName = null;
  try {
    await seedMarker(sentinel.url);
    await seedMarker(reused.url);
    const marker = [{ id: 1, note: "preexisting-row" }];

    await assert.rejects(
      () => createDisposableDatabase(reused.name, WORK_NAME, session),
      (error) => {
        assert.match(error.message, /préexistante/);
        return true;
      },
    );
    assert.deepEqual(await readMarker(reused.url), marker);
    assert.deepEqual(await readMarker(sentinel.url), marker);

    session.droppable.delete(reused.name);
    assert.equal(await dropDisposableDatabase(reused.name, WORK_NAME, session), false);
    assert.equal(await databaseExists(reused.name), true);
    assert.deepEqual(await readMarker(reused.url), marker);
    session.droppable.add(reused.name);

    assert.equal(await dropDisposableDatabase(sentinel.name, WORK_NAME, session), false);
    assert.equal(await dropDisposableDatabase(LEGACY_FIXED_DATABASE, WORK_NAME, session), false);
    assert.equal(await dropDisposableDatabase(LEGACY_FIXED_DATABASE, SENTINEL_NAME, session), false);
    assert.deepEqual(await readMarker(sentinel.url), marker);

    const doomed = await createDisposableDatabase(randomWorkName(), WORK_NAME, session);
    doomedName = doomed.name;
    await assert.rejects(
      () =>
        withPool(doomed.url, async (pool) => {
          await pool.query("CREATE TABLE doomed_marker (id integer PRIMARY KEY)");
          await pool.query("INSERT INTO doomed_marker (id) VALUES (7)");
          throw new Error("échec injecté");
        }),
      (error) => error.message === "échec injecté",
    );
    assert.equal(await dropDisposableDatabase(doomed.name, WORK_NAME, session), true);
    assert.equal(await databaseExists(doomed.name), false);
    doomedName = null;

    assert.equal(await dropDisposableDatabase(reused.name, WORK_NAME, session), true);
    assert.equal(await databaseExists(reused.name), false);
    assert.deepEqual(await readMarker(sentinel.url), marker);
    assert.equal(await databaseExists(sentinel.name), true);
  } finally {
    await dropSession(session);
    if (doomedName != null) assert.equal(await databaseExists(doomedName), false);
    if (legacyBefore != null) {
      assert.equal(await legacyFingerprint(), legacyBefore);
    }
  }
  assert.equal(await databaseExists(sentinel.name), false);
  assert.equal(await databaseExists(reused.name), false);
});

test(
  "démarrage sur table existante, finalisation à 60 % et persistance après reconnexion",
  { timeout: 300_000 },
  async (t) => {
    requireDatabaseUrl();
    const session = createSession();
    const legacyBefore = await legacyFingerprint();
    const db = await createDisposableDatabase(randomWorkName(), WORK_NAME, session);
    const repo = createPostgresRepository(db.url);
    guardPgPool(repo.pool);
    const pool = guardPgPool(new Pool({ connectionString: db.url }));
    const previousSkip = process.env.SOMAFRIK_SKIP_DEMO_SEED;
    process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
    let restarted = null;
    try {
      await pool.query(`
        CREATE TABLE school_setup_progress (
          school_id UUID PRIMARY KEY,
          last_valid_step INTEGER NOT NULL DEFAULT 0,
          completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT school_setup_progress_last_valid_step_check
            CHECK (last_valid_step >= 0 AND last_valid_step <= 10)
        )
      `);
      await pool.query(
        `INSERT INTO school_setup_progress (school_id, last_valid_step, completed_steps)
         VALUES ($1::uuid, 2, $2::jsonb)`,
        [SENTINEL_SCHOOL, JSON.stringify(SENTINEL_STEPS)],
      );
      const before = await pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'school_setup_progress'
           AND column_name = 'finalized_at'`,
      );
      assert.equal(before.rowCount, 0);

      await repo.init();
      await repo.ensureSchoolSetupGuidedSchema();

      const after = await pool.query(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'school_setup_progress'
           AND column_name = 'finalized_at'`,
      );
      assert.equal(after.rowCount, 1);
      assert.equal(after.rows[0].is_nullable, "YES");
      const statusColumn = await pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'school_setup_progress'
           AND column_name = 'setup_status'`,
      );
      assert.equal(statusColumn.rowCount, 0);

      const sentinelBeforeFinalize = await pool.query(
        `SELECT last_valid_step, completed_steps, finalized_at
         FROM school_setup_progress
         WHERE school_id = $1`,
        [SENTINEL_SCHOOL],
      );
      assert.equal(sentinelBeforeFinalize.rowCount, 1);
      assert.equal(sentinelBeforeFinalize.rows[0].finalized_at, null);
      assert.equal(Number(sentinelBeforeFinalize.rows[0].last_valid_step), 2);
      assert.deepEqual(sentinelBeforeFinalize.rows[0].completed_steps, SENTINEL_STEPS);

      let writes = 0;
      const query = async (sql, params) => {
        if (/^\s*(insert|update)\b/i.test(String(sql))) writes += 1;
        return pool.query(sql, params);
      };
      const one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;
      const store = createPgProgressStore(one, query);
      const baseInput = {
        one: membershipOne(),
        progressStore: store,
        loadSnapshot: async () => readySnapshot(),
      };

      writes = 0;
      const first = await finalizeSchoolSetupGuided({
        ...baseInput,
        principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:UPDATE"] },
        body: { schoolId: SCHOOL_B },
      });
      assert.equal(first.finalized, true);
      assert.equal(first.percent, 60);
      assert.equal(first.status, "operational");
      assert.equal(first.schoolId, SCHOOL_A);
      assert.equal(writes, 1);

      const stored = await pool.query(
        "SELECT finalized_at, completed_steps FROM school_setup_progress WHERE school_id = $1",
        [SCHOOL_A],
      );
      assert.equal(stored.rowCount, 1);
      assert.ok(stored.rows[0].finalized_at);
      const other = await pool.query("SELECT 1 FROM school_setup_progress WHERE school_id = $1", [SCHOOL_B]);
      assert.equal(other.rowCount, 0);

      writes = 0;
      const second = await finalizeSchoolSetupGuided({
        ...baseInput,
        principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:UPDATE"] },
      });
      assert.equal(writes, 0);
      assert.equal(new Date(second.finalizedAt).getTime(), new Date(first.finalizedAt).getTime());
      const storedAgain = await pool.query(
        "SELECT finalized_at FROM school_setup_progress WHERE school_id = $1",
        [SCHOOL_A],
      );
      assert.equal(storedAgain.rows[0].finalized_at.toISOString(), stored.rows[0].finalized_at.toISOString());

      await pool.end();
      restarted = guardPgPool(new Pool({ connectionString: db.url }));
      const survived = await restarted.query(
        "SELECT finalized_at FROM school_setup_progress WHERE school_id = $1",
        [SCHOOL_A],
      );
      assert.equal(survived.rows[0].finalized_at.toISOString(), stored.rows[0].finalized_at.toISOString());
      const restartedStore = createPgProgressStore(
        async (sql, params) => (await restarted.query(sql, params)).rows[0] ?? null,
        (sql, params) => restarted.query(sql, params),
      );
      const reloaded = await getSchoolSetupGuided({
        principal: {
          role: "Admin School",
          sub: "admin-a",
          permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"],
        },
        one: membershipOne(),
        progressStore: restartedStore,
        loadSnapshot: async () => readySnapshot({ classCount: 0, enrolledStudentCount: 0 }),
      });
      assert.equal(reloaded.finalized, true);
      assert.equal(reloaded.percent < 60, true);
      assert.equal(new Date(reloaded.finalizedAt).getTime(), stored.rows[0].finalized_at.getTime());

      const kept = await completeGuidedStep({
        principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:UPDATE"] },
        stepKey: "establishment",
        one: membershipOne(),
        progressStore: restartedStore,
        loadSnapshot: async () => readySnapshot(),
      });
      assert.equal(kept.finalized, true);
      assert.equal(kept.percent, 60);
      const afterEdit = await restarted.query(
        "SELECT finalized_at FROM school_setup_progress WHERE school_id = $1",
        [SCHOOL_A],
      );
      assert.equal(afterEdit.rows[0].finalized_at.toISOString(), stored.rows[0].finalized_at.toISOString());
      const stillOther = await restarted.query("SELECT 1 FROM school_setup_progress WHERE school_id = $1", [SCHOOL_B]);
      assert.equal(stillOther.rowCount, 0);

      const sentinelAfter = await restarted.query(
        `SELECT last_valid_step, completed_steps, finalized_at
         FROM school_setup_progress
         WHERE school_id = $1`,
        [SENTINEL_SCHOOL],
      );
      assert.equal(sentinelAfter.rowCount, 1);
      assert.equal(sentinelAfter.rows[0].finalized_at, null);
      assert.equal(Number(sentinelAfter.rows[0].last_valid_step), 2);
      assert.deepEqual(sentinelAfter.rows[0].completed_steps, SENTINEL_STEPS);
      t.diagnostic("finalized_at ajouté au démarrage sur une table existante, finalisation 60 % conservée après reconnexion");
    } finally {
      if (previousSkip === undefined) delete process.env.SOMAFRIK_SKIP_DEMO_SEED;
      else process.env.SOMAFRIK_SKIP_DEMO_SEED = previousSkip;
      await pool.end().catch(() => undefined);
      if (restarted) await restarted.end().catch(() => undefined);
      await repo.pool.end().catch(() => undefined);
      await dropSession(session);
      if (legacyBefore != null) {
        assert.equal(await legacyFingerprint(), legacyBefore);
      }
    }
  },
);
