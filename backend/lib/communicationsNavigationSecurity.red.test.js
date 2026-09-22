"use strict";

/**
 * Lot R5 (RED) — sécurité de la navigation depuis une notification.
 *
 * Invariant : une notification ne doit jamais servir de contournement au RBAC
 * de sa ressource cible. Elle transporte un pointeur, pas un droit.
 *
 * Ce lot ajoute uniquement les scénarios absents du socle existant. La
 * révocation de `Notifications:READ` (C4-11), le déni de périmètre `*` (C4-12)
 * et l'IDOR inter-établissement (C4-15) sont déjà couverts par
 * `communicationsC4.http.pg.test.js` et ne sont pas redupliqués ici.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { list, get } = require("./communicationsNotificationsService");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const SCHOOL_A = "b3000000-0000-4000-8000-000000000001";
const SCHOOL_B = "b3000000-0000-4000-8000-000000000002";
const USER_A = "b3000000-0000-4000-8000-000000000010";
const CODE_A = "SCH-NAV-A";
const CODE_B = "SCH-NAV-B";

/** Champs exposés au client par la projection C4. Toute clé hors de ce jeu
 *  signifierait que la ressource cible est réhydratée dans la notification. */
const PROJECTION_FIELDS = new Set([
  "type", "id", "schoolCode", "eventType", "sourceEntityType", "sourceEntityId",
  "senderType", "senderUserId", "senderName", "title", "body", "message",
  "createdAt", "publishedAt", "readAt", "archivedAt", "status", "attachments",
  "navigationTarget", "metadataSafe",
]);

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
  const dbName = `somafrik_nav_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

async function seedTwoSchools(pool) {
  const country = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('NAV','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES ($1,$3,$4,'Nav A','active'),($2,$3,$5,'Nav B','active')`,
    [SCHOOL_A, SCHOOL_B, country, CODE_A, CODE_B],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status)
     VALUES ($1,$2,'PAR-NAV-A','Parent','A','par-nav-a@test.local','Parent','active')`,
    [USER_A, SCHOOL_A],
  );
  return { country };
}

/** Notification de l'école A, destinée à USER_A, avec la cible fournie. */
async function seedNotification(pool, { navigationTarget, eventType = "communication.announcement.published", sourceEntityId }) {
  const noteId = randomUUID();
  await pool.query(
    `INSERT INTO communication_notifications
       (id,school_id,event_key,event_type,source_entity_type,source_entity_id,title,body,
        sender_type,sender_name,navigation_target,metadata,status)
     VALUES ($1,$2,$3,$4,'announcement',$5,'Nouvelle annonce','corps',
             'system','Somafrik',$6::jsonb,'{}'::jsonb,'published')`,
    [noteId, SCHOOL_A, `nav:${noteId}`, eventType, sourceEntityId ?? randomUUID(), JSON.stringify(navigationTarget)],
  );
  await pool.query(
    `INSERT INTO notification_recipients (notification_id,school_id,user_id,recipient_kind,read_at)
     VALUES ($1,$2,$3,'participant',NULL)`,
    [noteId, SCHOOL_A, USER_A],
  );
  return noteId;
}

function principalA() {
  return { sub: USER_A, schoolCode: CODE_A, role: "Parent", roleKeys: ["PARENT"] };
}

test("RED-N5-01 — cible supprimée : la notification reste consultable sans réhydrater la ressource", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTwoSchools(pool);
    const announcementId = (await pool.query(
      `INSERT INTO announcements (school_id,title,message,status) VALUES ($1,'Sortie scolaire','corps','published') RETURNING id`,
      [SCHOOL_A],
    )).rows[0].id;
    const noteId = await seedNotification(pool, {
      navigationTarget: { type: "announcement", announcementId },
      sourceEntityId: announcementId,
    });

    await pool.query(`DELETE FROM announcements WHERE id = $1`, [announcementId]);

    await withStore(pool, async (store) => {
      const page = await list(store, principalA(), {});
      assert.equal(page.items.length, 1, "la notification survit à la suppression de sa cible");
      const item = await get(store, noteId, principalA(), {});
      assert.equal(
        String(item.navigationTarget?.announcementId ?? ""),
        announcementId,
        "la cible reste un pointeur inerte, non résolu côté serveur",
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(item, "announcement"),
        false,
        "aucune donnée de la ressource supprimée ne doit être réinjectée",
      );
    });
  });
});

test("RED-N5-02 — cible appartenant à un autre établissement : la notification doit être refusée", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTwoSchools(pool);
    // Annonce de l'école B référencée par une notification de l'école A.
    const foreignAnnouncement = (await pool.query(
      `INSERT INTO announcements (school_id,title,message,status) VALUES ($1,'Annonce école B','corps','published') RETURNING id`,
      [SCHOOL_B],
    )).rows[0].id;
    await seedNotification(pool, {
      navigationTarget: { type: "announcement", announcementId: foreignAnnouncement },
    });

    await withStore(pool, async (store) => {
      const page = await list(store, principalA(), {});
      const leaking = page.items.filter(
        (item) => JSON.stringify(item.navigationTarget ?? {}).includes(foreignAnnouncement),
      );
      assert.deepEqual(
        leaking.map((item) => item.id),
        [],
        "fail-closed attendu : une cible pointant vers une ressource d'un autre établissement ne doit jamais être servie",
      );
    });
  });
});

test("RED-N5-03 — cible devenue inaccessible : la projection reste limitée au jeu de champs figé", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTwoSchools(pool);
    const announcementId = (await pool.query(
      `INSERT INTO announcements (school_id,title,message,status) VALUES ($1,'Annonce','corps','published') RETURNING id`,
      [SCHOOL_A],
    )).rows[0].id;
    const noteId = await seedNotification(pool, {
      navigationTarget: { type: "announcement", announcementId },
      sourceEntityId: announcementId,
    });
    // La ressource devient inaccessible sans disparaître.
    await pool.query(`UPDATE announcements SET status = 'archived' WHERE id = $1`, [announcementId]);

    await withStore(pool, async (store) => {
      const item = await get(store, noteId, principalA(), {});
      const extra = Object.keys(item).filter((key) => !PROJECTION_FIELDS.has(key));
      assert.deepEqual(
        extra,
        [],
        `la notification ne doit exposer aucun champ hors contrat : ${extra.join(", ")}`,
      );
    });
  });
});

test("RED-N5-04 — la lecture d'une notification ne joint aucune table métier de la ressource cible", () => {
  const source = read("backend/lib/communicationsNotificationsService.js");
  const start = source.indexOf("async function fetchRecipientPage(");
  const end = source.indexOf("async function get(", start);
  assert.ok(start >= 0 && end > start, "zone de lecture introuvable");
  const readingZone = source.slice(start, end);
  const businessTables = ["announcements", "school_messages", "payments", "grades", "report_cards", "attendance", "course_schedule_weekly_slots", "course_schedule_replacements"];
  const joined = businessTables.filter((table) => new RegExp(`(JOIN|FROM)\\s+${table}\\b`).test(readingZone));
  assert.deepEqual(
    joined,
    [],
    `la lecture de l'inbox ne doit pas résoudre la ressource cible côté serveur : ${joined.join(", ")}`,
  );
});
