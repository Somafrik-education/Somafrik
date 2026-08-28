"use strict";

/**
 * COM-C1 — parcours HTTP PostgreSQL réel Messages / Annonces / Notifications.
 * Mesure l'état actuel ; ne masque pas les capacités absentes.
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_COM_C1_IT_DATABASE ?? "somafrik_com_c1_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_COM_C1_HTTP_PORT ?? 19882);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91";
const TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa92";
const PARENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa93";
const PARENT_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa94";
const ADMIN_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa95";
const PARENT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa96";
const CLASS_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb91";
const SAME_TS = "2026-08-28T10:00:00.000Z";

const MSG_PERMS = ["Messages:READ", "Messages:CREATE", "Messages:UPDATE", "Notifications:READ", "Notifications:CREATE", "Notifications:UPDATE"];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function mintAccess(tokens, payload) {
  return tokens.createAccessToken({ mustChangePassword: false, ...payload });
}

function claims(overrides) {
  return {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: MSG_PERMS,
    ...overrides,
  };
}

async function setRoleModuleGrant(pool, roleKey, moduleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'com-c1', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'com-c1')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function grantComms(pool, roleKey, enabled) {
  const flags = enabled
    ? { create: true, read: true, update: true }
    : { create: false, read: false, update: false };
  await setRoleModuleGrant(pool, roleKey, "messages", flags);
  await setRoleModuleGrant(pool, roleKey, "notifications", flags);
}

async function countRows(pool, sql, params) {
  const result = await pool.query(sql, params);
  return result.rows[0].c;
}

async function seed(pool) {
  const ci = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('COM Côte test', 'CI', '+225', 'XOF') RETURNING id`,
  );
  const fr = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('COM France test', 'FR', '+33', 'EUR') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-COM-A', 'École COM A', 'active'), ($2, 'SCH-COM-B', 'École COM B', 'active')`,
    [ci.rows[0].id, fr.rows[0].id],
  );
  const schoolA = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-COM-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-COM-B'`)).rows[0];

  await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     SELECT id, '2025-2026', 'open' FROM schools WHERE school_code IN ('SCH-COM-A', 'SCH-COM-B')`,
  );
  const yearA = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-COM-A' LIMIT 1`,
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, 'COM-CLS-A', '6ème A', 'active', $4::timestamptz)`,
    [CLASS_A, schoolA.id, yearA.id, SAME_TS],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $7, 'ADM-COM-A', 'Admin', 'A', 'adm-com-a@test.local', 'Admin School', 'active', FALSE),
       ($2, $7, 'TCH-COM-A', 'Teacher', 'A', 'tch-com-a@test.local', 'Enseignant', 'active', FALSE),
       ($3, $7, 'PAR-COM-A', 'Parent', 'A', 'par-com-a@test.local', 'Parent', 'active', FALSE),
       ($4, $7, 'PAR-COM-A2', 'Parent', 'A2', 'par-com-a2@test.local', 'Parent', 'active', FALSE),
       ($5, $8, 'ADM-COM-B', 'Admin', 'B', 'adm-com-b@test.local', 'Admin School', 'active', FALSE),
       ($6, $8, 'PAR-COM-B', 'Parent', 'B', 'par-com-b@test.local', 'Parent', 'active', FALSE)`,
    [ADMIN_A, TEACHER_A, PARENT_A, PARENT_A2, ADMIN_B, PARENT_B, schoolA.id, schoolB.id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $7, 'SCHOOL_ADMIN', 'active'),
       ($2, $7, 'TEACHER', 'active'),
       ($3, $7, 'PARENT', 'active'),
       ($4, $7, 'PARENT', 'active'),
       ($5, $8, 'SCHOOL_ADMIN', 'active'),
       ($6, $8, 'PARENT', 'active')`,
    [ADMIN_A, TEACHER_A, PARENT_A, PARENT_A2, ADMIN_B, PARENT_B, schoolA.id, schoolB.id],
  );

  const studentA = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'COM-STU-A', 'Élève', 'A', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolA.id, SAME_TS],
  );
  const studentB = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'COM-STU-B', 'Élève', 'B', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolB.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
     VALUES ($1, $2, $3, $4, '2025-09-01', 'active')`,
    [schoolA.id, studentA.rows[0].id, CLASS_A, yearA.id],
  );

  await pool.query(
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, phone, status, user_id)
     VALUES
       ($1, $3, 'Parent', 'A', 'Parent', '+225000000001', 'active', $5),
       ($2, $4, 'Parent', 'B', 'Parent', '+33000000002', 'active', $6)`,
    [schoolA.id, schoolB.id, ci.rows[0].id, fr.rows[0].id, PARENT_A, PARENT_B],
  );
  const contactA = (await pool.query(`SELECT id FROM contacts WHERE user_id = $1`, [PARENT_A])).rows[0];
  await pool.query(
    `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
     VALUES ($1, $2, 'parent_student', $3, $4, 'active')`,
    [schoolA.id, ci.rows[0].id, contactA.id, studentA.rows[0].id],
  );

  await grantComms(pool, "SCHOOL_ADMIN", true);
  await grantComms(pool, "TEACHER", true);
  await grantComms(pool, "PARENT", true);

  return {
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    studentCodeA: studentA.rows[0].student_code,
    studentCodeB: studentB.rows[0].student_code,
  };
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour communicationsReadiness.http.pg.test.js");
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;
  const notes = [];

  try {
    await repo.init();
    await seed(pool);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderrRef);

    const adminA = mintAccess(
      tokens,
      claims({ sub: ADMIN_A, schoolCode: "SCH-COM-A", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }),
    );
    const parentA = mintAccess(
      tokens,
      claims({ sub: PARENT_A, schoolCode: "SCH-COM-A", role: "Parent", roleKeys: ["PARENT"] }),
    );
    const parentAInbox = mintAccess(
      tokens,
      claims({
        sub: PARENT_A,
        schoolCode: "SCH-COM-A",
        role: "Parent",
        roleKeys: ["PARENT"],
        studentIds: ["COM-STU-A"],
      }),
    );
    const parentA2 = mintAccess(
      tokens,
      claims({
        sub: PARENT_A2,
        schoolCode: "SCH-COM-A",
        role: "Parent",
        roleKeys: ["PARENT"],
        studentIds: ["COM-STU-UNRELATED"],
      }),
    );
    const teacherA = mintAccess(
      tokens,
      claims({
        sub: TEACHER_A,
        schoolCode: "SCH-COM-A",
        role: "Enseignant",
        roleKeys: ["TEACHER"],
        classNames: ["6ème A"],
      }),
    );
    const adminB = mintAccess(
      tokens,
      claims({ sub: ADMIN_B, schoolCode: "SCH-COM-B", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }),
    );
    const parentB = mintAccess(
      tokens,
      claims({ sub: PARENT_B, schoolCode: "SCH-COM-B", role: "Parent", roleKeys: ["PARENT"] }),
    );

    const empty = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: { message: "   ", participantUserIds: [PARENT_A] },
    });
    assert.equal(empty.status, 400, `COM-C1 message vide: ${JSON.stringify(empty.data)}`);

    const spoof = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: {
        message: "Réunion parents",
        participantUserIds: [PARENT_A],
        senderUserId: PARENT_B,
        senderId: PARENT_B,
        schoolCode: "SCH-COM-B",
        studentId: "COM-STU-A",
      },
    });
    assert.equal(spoof.status, 201, `COM-C1 E2E1 envoi: ${JSON.stringify(spoof.data)}`);
    assert.equal(spoof.data.senderUserId, ADMIN_A, "sender vient du principal, jamais du body");
    assert.equal(spoof.data.schoolCode, "SCH-COM-A", "schoolId/schoolCode client ignorés");
    const messageAId = spoof.data.id;
    const conversationAId = spoof.data.conversationId;
    assert.ok(messageAId && conversationAId, "conversation + message persistés dans la réponse");

    const convCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_conversations WHERE id = $1 AND school_id = $2`,
      [conversationAId, (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-COM-A'`)).rows[0].id],
    );
    assert.equal(convCount, 1, "COM-C1 E2E1 PostgreSQL conversation A");
    const partCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_conversation_participants WHERE conversation_id = $1`,
      [conversationAId],
    );
    assert.ok(partCount >= 2, `COM-C1 E2E1 participants: ${partCount}`);
    const msgCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_messages WHERE id = $1 AND body = 'Réunion parents'`,
      [messageAId],
    );
    assert.equal(msgCount, 1, "COM-C1 E2E1 PostgreSQL message");

    const adminList = unwrapList((await request("/backoffice/messages", { token: adminA })).data);
    assert.ok(
      adminList.some((row) => row.id === messageAId),
      "COM-C1 E2E1 Admin A voit le message envoyé",
    );

    const parentBlind = unwrapList((await request("/backoffice/messages", { token: parentA })).data);
    if (!parentBlind.some((row) => row.id === messageAId)) {
      notes.push(
        "COM-C1-P1-PARENT-JWT: Parent sans studentIds dans le JWT → GET messages vide (y compris ses propres fils)",
      );
    }

    const parentList = unwrapList((await request("/backoffice/messages", { token: parentAInbox })).data);
    const seenByParent = parentList.find((row) => row.id === messageAId);
    assert.ok(seenByParent, "COM-C1 E2E1 Parent A voit le message");
    assert.notEqual(String(seenByParent.status), "Lu", "message non lu pour Parent A");

    const unreadBefore = parentList.filter((row) => String(row.status ?? "") !== "Lu").length;
    assert.ok(unreadBefore >= 1, `COM-C1 E2E1 non-lu >= 1 (observé ${unreadBefore})`);

    const markRead = await request(`/backoffice/messages/${encodeURIComponent(messageAId)}/read`, {
      method: "PATCH",
      token: parentA,
    });
    assert.equal(markRead.status, 200, `COM-C1 E2E1 mark-read: ${JSON.stringify(markRead.data)}`);
    const readRows = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_message_reads WHERE message_id = $1 AND user_id = $2`,
      [messageAId, PARENT_A],
    );
    assert.equal(readRows, 1, "COM-C1 E2E1 read_at persisté");

    const parentListAfter = unwrapList((await request("/backoffice/messages", { token: parentAInbox })).data);
    const afterRead = parentListAfter.find((row) => row.id === messageAId);
    assert.equal(String(afterRead.status), "Lu", "COM-C1 E2E1 statut Lu après lecture");

    const parentA2List = unwrapList((await request("/backoffice/messages", { token: parentA2 })).data);
    const leakedToA2 = parentA2List.some((row) => row.id === messageAId);
    if (leakedToA2) {
      notes.push("COM-C1-P0-PRIVATE: GET /messages n'est pas scoped aux participants (Parent A2 voit le thread A)");
    }
    const teacherList = unwrapList((await request("/backoffice/messages", { token: teacherA })).data);
    if (teacherList.some((row) => row.id === messageAId)) {
      notes.push(
        "COM-C1-P0-PRIVATE: Enseignant affecté voit un message parent sans être participant (filterByRoleOwnership return true)",
      );
    }

    const reply = await request("/backoffice/messages", {
      method: "POST",
      token: parentA,
      body: {
        message: "Oui, je serai présent",
        participantUserIds: [ADMIN_A],
        conversationId: conversationAId,
      },
    });
    assert.equal(reply.status, 201, `COM-C1 E2E2 réponse: ${JSON.stringify(reply.data)}`);
    if (reply.data.conversationId === conversationAId) {
      notes.push("COM-C1: réponse réutilise la conversation");
    } else {
      notes.push("COM-C1-P1-THREAD: chaque POST crée une nouvelle conversation (conversationId body ignoré)");
    }

    const adminAList = unwrapList((await request("/backoffice/messages", { token: adminA })).data);
    assert.ok(
      adminAList.some((row) => row.id === reply.data.id),
      "COM-C1 E2E2 Admin A voit la réponse",
    );

    const adminBList = unwrapList((await request("/backoffice/messages", { token: adminB })).data);
    assert.ok(
      !adminBList.some((row) => row.id === messageAId || row.id === reply.data.id),
      "COM-C1 E2E2/E2E3 Admin B ne voit pas le thread A",
    );
    const parentBList = unwrapList((await request("/backoffice/messages", { token: parentB })).data);
    assert.ok(
      !parentBList.some((row) => row.id === messageAId),
      "COM-C1 E2E2 Parent B ne voit pas le thread A",
    );

    const getMsgA = await request(`/backoffice/messages/${encodeURIComponent(messageAId)}`, { token: adminB });
    assert.ok([403, 404].includes(getMsgA.status), `COM-C1 E2E3 GET message A: ${getMsgA.status}`);
    const getConvA = await request(`/backoffice/conversations/${encodeURIComponent(conversationAId)}`, {
      token: adminB,
    });
    assert.ok([403, 404].includes(getConvA.status), `COM-C1 E2E3 GET conversation A: ${getConvA.status}`);

    const messagesInABefore = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_messages WHERE conversation_id = $1`,
      [conversationAId],
    );
    const inject = await request("/backoffice/messages", {
      method: "POST",
      token: adminB,
      body: {
        message: "injection B",
        conversationId: conversationAId,
        participantUserIds: [PARENT_A],
        schoolCode: "SCH-COM-A",
      },
    });
    assert.ok(
      [201, 403, 404].includes(inject.status),
      `COM-C1 E2E3 POST dans conversation A: ${inject.status} ${JSON.stringify(inject.data)}`,
    );
    const messagesInAAfter = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_messages WHERE conversation_id = $1`,
      [conversationAId],
    );
    assert.equal(messagesInAAfter, messagesInABefore, "COM-C1 E2E3 aucune mutation dans conversation A");
    if (inject.status === 201) {
      assert.notEqual(inject.data.conversationId, conversationAId, "POST B n'écrit pas dans le thread A");
    }

    const markAsB = await request(`/backoffice/messages/${encodeURIComponent(messageAId)}/read`, {
      method: "PATCH",
      token: adminB,
    });
    assert.ok([403, 404].includes(markAsB.status), `COM-C1 E2E3 mark-read B: ${markAsB.status} ${JSON.stringify(markAsB.data)}`);

    const createdAnn = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      body: { title: "Réunion générale", message: "Samedi 9h", audience: "Tous" },
    });
    assert.equal(createdAnn.status, 201, `COM-C1 E2E4 annonce: ${JSON.stringify(createdAnn.data)}`);
    const announcementAId = createdAnn.data.id;
    const listA = unwrapList((await request("/backoffice/announcements", { token: adminA })).data);
    assert.ok(listA.some((row) => row.id === announcementAId), "COM-C1 E2E4 utilisateurs A voient l'annonce");
    const listB = unwrapList((await request("/backoffice/announcements", { token: adminB })).data);
    assert.ok(!listB.some((row) => row.id === announcementAId), "COM-C1 E2E4 école B ne voit jamais l'annonce A");
    const archiveB = await request(`/backoffice/announcements/${encodeURIComponent(announcementAId)}/archive`, {
      method: "POST",
      token: adminB,
    });
    assert.ok(
      [403, 404].includes(archiveB.status),
      `COM-C1 E2E4 archive B: ${archiveB.status} ${JSON.stringify(archiveB.data)}`,
    );

    const classAnn = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      body: {
        title: "Devoir 6ème A",
        message: "Apporter le cahier",
        audience: "Élèves",
        targetClassId: CLASS_A,
      },
    });
    assert.equal(classAnn.status, 201, `COM-C1 E2E5 annonce classe: ${JSON.stringify(classAnn.data)}`);
    const storedClass = (
      await pool.query(`SELECT target_class_id FROM announcements WHERE id = $1`, [classAnn.data.id])
    ).rows[0];
    assert.equal(String(storedClass.target_class_id), CLASS_A, "target_class_id persisté");
    const parentA2Anns = unwrapList((await request("/backoffice/announcements", { token: parentA2 })).data);
    if (parentA2Anns.some((row) => row.id === classAnn.data.id)) {
      notes.push("COM-C1-P1-AUDIENCE: GET announcements ne filtre pas target_class_id côté serveur");
    }

    const notifAfterEvents = await countRows(pool, `SELECT count(*)::int AS c FROM notifications`);
    assert.equal(
      notifAfterEvents,
      0,
      "COM-C1 E2E6 NOT_IMPLEMENTED: message/annonce ne créent pas de notification interne persistée",
    );
    notes.push("COM-C1-E2E-6 NOT_IMPLEMENTED: pas de trigger événement → notification (badge +1 / lecture / 0)");

    const beforeRevoke = await countRows(pool, `SELECT count(*)::int AS c FROM school_messages`);
    await grantComms(pool, "SCHOOL_ADMIN", false);
    const afterRevoke = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: { message: "après révocation PG", participantUserIds: [PARENT_A] },
    });
    const afterRevokeCount = await countRows(pool, `SELECT count(*)::int AS c FROM school_messages`);
    if (afterRevoke.status === 201) {
      notes.push("COM-C1-P0-RBAC: live RBAC communications non branché — même JWT mute encore après révocation PG");
      assert.equal(afterRevokeCount, beforeRevoke + 1, "JWT stale a créé une ligne supplémentaire");
    } else {
      assert.ok([403, 401].includes(afterRevoke.status), `COM-C1 E2E7 révocation: ${afterRevoke.status}`);
      assert.equal(afterRevokeCount, beforeRevoke, "aucune ligne après révocation");
    }
    await grantComms(pool, "SCHOOL_ADMIN", true);

    const idemKey = randomUUID();
    const idemBody = { message: "double soumission", participantUserIds: [PARENT_A] };
    const firstIdem = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": idemKey },
      body: idemBody,
    });
    const secondIdem = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": idemKey },
      body: idemBody,
    });
    assert.equal(firstIdem.status, 201, `COM-C1 E2E8 first: ${JSON.stringify(firstIdem.data)}`);
    assert.ok(
      [200, 201].includes(secondIdem.status),
      `COM-C1 E2E8 replay: ${secondIdem.status} ${JSON.stringify(secondIdem.data)}`,
    );
    assert.equal(secondIdem.data.id, firstIdem.data.id, "même Idempotency-Key → un seul message");
    const thirdIdem = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { message: "nouvelle intention", participantUserIds: [PARENT_A] },
    });
    assert.equal(thirdIdem.status, 201, "nouvelle intention → nouvelle ressource");
    assert.notEqual(thirdIdem.data.id, firstIdem.data.id);

    const annKey = randomUUID();
    const ann1 = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": annKey },
      body: { title: "Idem annonce", message: "corps" },
    });
    const ann2 = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": annKey },
      body: { title: "Idem annonce", message: "corps" },
    });
    assert.equal(ann1.status, 201, `COM-C1 E2E8 annonce 1: ${JSON.stringify(ann1.data)}`);
    if (ann2.status === 201 && ann2.data.id !== ann1.data.id) {
      notes.push("COM-C1-P1-IDEM-ANN: POST announcements n'est pas enveloppe withIdempotency");
    }

    const xss = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: { message: "<script>alert(1)</script>", participantUserIds: [PARENT_A] },
    });
    assert.equal(xss.status, 201, "contenu HTML accepté (pas de sanitization serveur)");
    assert.match(String(xss.data.message || xss.data.body), /<script>/);

    const pdfPath = "/api/backoffice/communications/files/com-c1-reunion.pdf";
    const withPdf = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: {
        message: "Convocation PDF",
        participantUserIds: [PARENT_A],
        studentId: "COM-STU-A",
        attachmentUrl: pdfPath,
      },
    });
    assert.equal(withPdf.status, 201, `COM-C1 E2E9 message PDF: ${JSON.stringify(withPdf.data)}`);
    assert.equal(withPdf.data.senderUserId, ADMIN_A, "COM-C1 E2E9 senderUserId canonique");
    assert.match(String(withPdf.data.sentAt || ""), /^\d{4}-\d{2}-\d{2}T/, "COM-C1 E2E9 sentAt ISO complet");
    if (withPdf.data.attachmentUrl === pdfPath) {
      notes.push("COM-C1-P1-012: attachmentUrl libre encore persisté (C2 doit ignorer l'URL cliente)");
    }
    const storedPdf = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_messages WHERE id = $1 AND attachment_url = $2`,
      [withPdf.data.id, pdfPath],
    );
    if (storedPdf === 1) {
      notes.push("COM-C1-P1-012: attachment_url texte encore écrit depuis le client");
    }

    const parentPdf = unwrapList((await request("/backoffice/messages", { token: parentAInbox })).data).find(
      (row) => row.id === withPdf.data.id,
    );
    assert.ok(parentPdf, "COM-C1 E2E9 Parent A retrouve le message PDF");
    assert.equal(parentPdf.senderUserId, ADMIN_A);
    assert.match(String(parentPdf.sentAt || ""), /^\d{4}-\d{2}-\d{2}T/, "COM-C1 E2E9 Parent A voit date+heure");

    const bPdfList = unwrapList((await request("/backoffice/messages", { token: adminB })).data);
    assert.ok(!bPdfList.some((row) => row.id === withPdf.data.id), "COM-C1 E2E9 école B ne voit pas le message PDF");
    const bDownload = await request("/backoffice/communications/files/com-c1-reunion.pdf", { token: adminB });
    assert.ok(
      [403, 404].includes(bDownload.status),
      `COM-C1 E2E9 B ne télécharge pas le PDF: ${bDownload.status}`,
    );
    const aDownload = await request("/backoffice/communications/files/com-c1-reunion.pdf", { token: adminA });
    if (aDownload.status !== 200) {
      notes.push("COM-C1-P1-012: pas d'upload/stockage/téléchargement authentifié (attachmentUrl texte seulement)");
    }

    const annPdf = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      body: {
        title: "Circulaire PDF",
        message: "voir pièce jointe",
        attachmentUrl: pdfPath,
        attachments: [{ fileName: "circulaire.pdf", url: pdfPath }],
      },
    });
    assert.equal(annPdf.status, 201, `COM-C1 E2E9 annonce PDF: ${JSON.stringify(annPdf.data)}`);
    const annTs = String(annPdf.data.publishedAt || annPdf.data.createdAt || annPdf.data.date || "");
    if (!/^\d{4}-\d{2}-\d{2}T/.test(annTs)) {
      notes.push("COM-C1-P1-011: annonce API sans timestamp ISO (formatDate JJ-MM-AAAA)");
    }
    if (!annPdf.data.attachmentUrl && !Array.isArray(annPdf.data.attachments)) {
      notes.push("COM-C1-P1-012: annonce n'accepte pas de pièce jointe");
    }
    const bAnnPdf = unwrapList((await request("/backoffice/announcements", { token: adminB })).data);
    assert.ok(
      !bAnnPdf.some((row) => row.id === annPdf.data.id),
      "COM-C1 E2E9 école B ne voit pas l'annonce PDF",
    );
    notes.push("COM-C1-P1-010: pas de projection historique transversale message|annonce|notification");
    notes.push("COM-C1-E2E9-NOTIF: pièces jointes notification reportées à COM-C4");

    console.log("OK communicationsReadiness.http.pg.test.js — parcours COM-C1 PostgreSQL réel");
    if (notes.length) {
      console.log("COM-C1 notes:\n- " + notes.join("\n- "));
    }
  } finally {
    await stopChild(child);
    await pool.end();
    if (typeof repo.end === "function") await repo.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
