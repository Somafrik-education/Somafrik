"use strict";

/**
 * Lot R3 (harnais de reproduction) — divergence « badge cloche » / « N non lue(s) ».
 *
 * Scénario figé : 51 notifications visibles, les 50 plus récentes lues,
 * la plus ancienne non lue.
 *
 * Ce fichier caractérise le contrat côté API et sert d'ancrage au correctif C3 :
 * il démontre que `unread-count` et la pagination par curseur sont corrects, et
 * donc que la divergence observée en préproduction est un défaut de consommation
 * côté client (première page seule, `nextCursor` ignoré), pas un défaut backend.
 *
 * La preuve RED correspondante vit côté Web dans
 * `web/src/components/communications/InternalNotificationsCenter.counter.red.test.tsx`.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { list, unreadCount } = require("./communicationsNotificationsService");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const SCHOOL = "b2000000-0000-4000-8000-000000000001";
const USER = "b2000000-0000-4000-8000-000000000002";
const SCHOOL_CODE = "SCH-PAG-A";
const TOTAL = 51;
const OLDEST_TITLE = "Notification la plus ancienne";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withIsolatedPg(run) {
  if (!DATABASE_URL) return { skipped: true };
  const dbName = `somafrik_pag_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = withDatabaseName(DATABASE_URL, dbName);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(read("backend/db/schema.sql"));
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    return { skipped: false, ...(await run(pool)) };
  } finally {
    await pool.end();
    const drop = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
    await drop.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await drop.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await drop.end();
  }
}

async function withStore(pool, fn) {
  const { createPostgresRepository } = require("../db/repositoryFactory");
  const repo = createPostgresRepository(pool.options.connectionString);
  await repo.init();
  try {
    return await fn(repo.getClientsStore());
  } finally {
    await repo.close();
  }
}

/** 51 notifications : la plus ancienne non lue, les 50 suivantes lues. */
async function seedFiftyOneNotifications(pool) {
  const country = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('PAG','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES ($1,$2,$3,'Pagination A','active')`,
    [SCHOOL, country, SCHOOL_CODE],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status)
     VALUES ($1,$2,'PAR-PAG','Parent','Pag','par-pag@test.local','Parent','active')`,
    [USER, SCHOOL],
  );
  for (let i = 0; i < TOTAL; i += 1) {
    const noteId = randomUUID();
    const ageMinutes = TOTAL - i;
    await pool.query(
      `INSERT INTO communication_notifications
         (id,school_id,event_key,event_type,source_entity_type,source_entity_id,title,body,
          sender_type,sender_name,navigation_target,metadata,status,created_at,published_at)
       VALUES ($1,$2,$3,'communication.message.created','message',$4,$5,'corps',
               'system','Somafrik','{}'::jsonb,'{}'::jsonb,'published',
               NOW() - ($6 || ' minutes')::interval, NOW() - ($6 || ' minutes')::interval)`,
      [noteId, SCHOOL, `pag:${i}`, randomUUID(), i === 0 ? OLDEST_TITLE : `Notification ${i}`, String(ageMinutes)],
    );
    await pool.query(
      `INSERT INTO notification_recipients (notification_id,school_id,user_id,recipient_kind,read_at)
       VALUES ($1,$2,$3,'participant',$4)`,
      [noteId, SCHOOL, USER, i === 0 ? null : new Date()],
    );
  }
}

function principal() {
  return { sub: USER, schoolCode: SCHOOL_CODE, role: "Parent", roleKeys: ["PARENT"] };
}

test("RED-N2-API-01 — le badge compte bien l'unique non lue du serveur", async () => {
  await withIsolatedPg(async (pool) => {
    await seedFiftyOneNotifications(pool);
    await withStore(pool, async (store) => {
      const badge = await unreadCount(store, principal(), {});
      assert.equal(badge.count, 1, "unread-count doit voir la non lue quelle que soit sa position");
    });
  });
});

test("RED-N2-API-02 — la première page seule ne contient aucune non lue et annonce un curseur", async () => {
  await withIsolatedPg(async (pool) => {
    await seedFiftyOneNotifications(pool);
    await withStore(pool, async (store) => {
      const page = await list(store, principal(), {});
      assert.equal(page.items.length, 50, "page par défaut plafonnée à 50");
      assert.equal(
        page.items.filter((row) => !row.readAt).length,
        0,
        "toutes les notifications de la première page sont lues",
      );
      assert.ok(page.nextCursor, "l'API annonce explicitement une page suivante");
    });
  });
});

test("RED-N2-API-03 — suivre nextCursor atteint la non lue et reconstitue le compte du badge", async () => {
  await withIsolatedPg(async (pool) => {
    await seedFiftyOneNotifications(pool);
    await withStore(pool, async (store) => {
      const badge = await unreadCount(store, principal(), {});
      const seen = [];
      let cursor = null;
      let guard = 0;
      do {
        const page = await list(store, principal(), cursor ? { cursor } : {});
        seen.push(...page.items);
        cursor = page.nextCursor;
        guard += 1;
      } while (cursor && guard < 10);

      assert.equal(seen.length, TOTAL, "la pagination complète doit restituer les 51 notifications");
      assert.ok(
        seen.some((row) => row.title === OLDEST_TITLE),
        "la notification non lue doit être atteignable en suivant le curseur",
      );
      assert.equal(
        seen.filter((row) => !row.readAt).length,
        badge.count,
        "le total des non lues paginées doit égaler le compteur du badge",
      );
    });
  });
});

test("RED-N2-API-04 — aucune notification n'est perdue entre les pages", async () => {
  await withIsolatedPg(async (pool) => {
    await seedFiftyOneNotifications(pool);
    await withStore(pool, async (store) => {
      const first = await list(store, principal(), {});
      const second = await list(store, principal(), { cursor: first.nextCursor });
      const ids = new Set([...first.items, ...second.items].map((row) => row.id));
      assert.equal(ids.size, TOTAL, "pas de doublon ni de trou entre les deux pages");
      assert.equal(second.nextCursor, null, "la seconde page clôt la pagination");
    });
  });
});
