"use strict";

/**
 * COM-C2 — HTTP PostgreSQL réel : participation, destinataires, thread, read, PJ.
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_COM_C2_IT_DATABASE ?? "somafrik_com_c2_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_COM_C2_HTTP_PORT ?? 19883);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91";
const TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa92";
const TEACHER_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa97";
const PARENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa93";
const PARENT_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa94";
const ADMIN_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa95";
const PARENT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa96";
const SUPER_SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa98";
const CLASS_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb91";
const SAME_TS = "2026-08-28T10:00:00.000Z";

const MSG_PERMS = ["Messages:READ", "Messages:CREATE", "Messages:UPDATE"];

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

async function uploadFile(token, { fileName, mimeType, body }) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/backoffice/communications/attachments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
      "X-Filename": fileName,
    },
    body,
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

async function downloadFile(token, attachmentId) {
  const response = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/communications/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, contentType: response.headers.get("content-type") };
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
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'com-c2', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'com-c2')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function grantMessages(pool, roleKey, enabled) {
  const flags = enabled
    ? { create: true, read: true, update: true }
    : { create: false, read: false, update: false };
  await setRoleModuleGrant(pool, roleKey, "messages", flags);
}

async function countRows(pool, sql, params) {
  const result = await pool.query(sql, params);
  return result.rows[0].c;
}

function pdfBuffer() {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
}

function pngBuffer() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
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
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'COM-SUB-A', 'Mathématiques', 'active') RETURNING id`,
    [schoolA.id],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $8, 'ADM-COM-A', 'Admin', 'A', 'adm-com-a@test.local', 'Admin School', 'active', FALSE),
       ($2, $8, 'TCH-COM-A', 'Teacher', 'A', 'tch-com-a@test.local', 'Enseignant', 'active', FALSE),
       ($3, $8, 'TCH-COM-A2', 'Teacher', 'A2', 'tch-com-a2@test.local', 'Enseignant', 'active', FALSE),
       ($4, $8, 'PAR-COM-A', 'Parent', 'A', 'par-com-a@test.local', 'Parent', 'active', FALSE),
       ($5, $8, 'PAR-COM-A2', 'Parent', 'A2', 'par-com-a2@test.local', 'Parent', 'active', FALSE),
       ($6, $9, 'ADM-COM-B', 'Admin', 'B', 'adm-com-b@test.local', 'Admin School', 'active', FALSE),
       ($7, $9, 'PAR-COM-B', 'Parent', 'B', 'par-com-b@test.local', 'Parent', 'active', FALSE),
       ($10, NULL, 'SUPER-COM', 'Super', 'Admin', 'super-com@test.local', 'Super Administrateur Somafrik', 'active', FALSE)`,
    [ADMIN_A, TEACHER_A, TEACHER_A2, PARENT_A, PARENT_A2, ADMIN_B, PARENT_B, schoolA.id, schoolB.id, SUPER_SA],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $8, 'SCHOOL_ADMIN', 'active'),
       ($2, $8, 'TEACHER', 'active'),
       ($3, $8, 'TEACHER', 'active'),
       ($4, $8, 'PARENT', 'active'),
       ($5, $8, 'PARENT', 'active'),
       ($6, $9, 'SCHOOL_ADMIN', 'active'),
       ($7, $9, 'PARENT', 'active'),
       ($10, NULL, 'SUPER_ADMIN', 'active')`,
    [ADMIN_A, TEACHER_A, TEACHER_A2, PARENT_A, PARENT_A2, ADMIN_B, PARENT_B, schoolA.id, schoolB.id, SUPER_SA],
  );

  await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'TCH-C2-A', 'active'), ($1, $3, 'TCH-C2-A2', 'active')`,
    [schoolA.id, TEACHER_A, TEACHER_A2],
  );
  const teacherRow = (await pool.query(`SELECT id FROM teachers WHERE user_id = $1`, [TEACHER_A])).rows[0];
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.id, teacherRow.id, CLASS_A, subject.rows[0].id, yearA.id],
  );

  const studentA = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'COM-STU-A', 'Élève', 'A', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'COM-STU-B', 'Élève', 'B', 'active', $2::timestamptz)`,
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
       ($1, $3, 'Parent', 'A2', 'Parent', '+225000000003', 'active', $6),
       ($2, $4, 'Parent', 'B', 'Parent', '+33000000002', 'active', $7)`,
    [schoolA.id, schoolB.id, ci.rows[0].id, fr.rows[0].id, PARENT_A, PARENT_A2, PARENT_B],
  );
  const contactA = (await pool.query(`SELECT id FROM contacts WHERE user_id = $1`, [PARENT_A])).rows[0];
  await pool.query(
    `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
     VALUES ($1, $2, 'parent_student', $3, $4, 'active')`,
    [schoolA.id, ci.rows[0].id, contactA.id, studentA.rows[0].id],
  );

  await grantMessages(pool, "SCHOOL_ADMIN", true);
  await grantMessages(pool, "TEACHER", true);
  await grantMessages(pool, "PARENT", true);

  return { schoolA: schoolA.id, schoolB: schoolB.id, studentA: studentA.rows[0].id };
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour communicationsC2.http.pg.test.js");
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
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = path.join(require("node:os").tmpdir(), `somafrik-c2-${randomUUID()}`);
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  try {
    await repo.init();
    const fixtures = await seed(pool);

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
    const parentA2 = mintAccess(
      tokens,
      claims({
        sub: PARENT_A2,
        schoolCode: "SCH-COM-A",
        role: "Parent",
        roleKeys: ["PARENT"],
        studentIds: ["COM-STU-A"],
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
    const teacherA2 = mintAccess(
      tokens,
      claims({ sub: TEACHER_A2, schoolCode: "SCH-COM-A", role: "Enseignant", roleKeys: ["TEACHER"] }),
    );
    const adminB = mintAccess(
      tokens,
      claims({ sub: ADMIN_B, schoolCode: "SCH-COM-B", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }),
    );
    const parentB = mintAccess(
      tokens,
      claims({ sub: PARENT_B, schoolCode: "SCH-COM-B", role: "Parent", roleKeys: ["PARENT"] }),
    );
    const superSa = mintAccess(
      tokens,
      claims({
        sub: SUPER_SA,
        schoolCode: "*",
        role: "Super Administrateur Somafrik",
        roleKeys: ["SUPER_ADMIN"],
        permissions: ["ALL_PRIVILEGES"],
      }),
    );

    const created = await request("/backoffice/conversations", {
      method: "POST",
      token: adminA,
      body: {
        message: "Réunion parents",
        participantUserIds: [PARENT_A],
        senderUserId: PARENT_B,
        schoolCode: "SCH-COM-B",
      },
    });
    assert.equal(created.status, 201, `C2-06/create: ${JSON.stringify(created.data)}`);
    assert.equal(created.data.senderUserId, ADMIN_A, "C2-06 senderUserId exact");
    assert.equal(created.data.senderName, "Admin A", "C2-06 senderName exact");
    assert.match(String(created.data.sentAt), /^\d{4}-\d{2}-\d{2}T/, "C2-06 sentAt ISO");
    const conversationId = created.data.conversationId;
    const message1Id = created.data.id;
    assert.ok(conversationId && message1Id);

    const teacherList = unwrapList((await request("/backoffice/conversations", { token: teacherA })).data);
    assert.ok(!teacherList.some((row) => row.id === conversationId), "C2-01 Teacher A non participant : thread absent");
    const teacherGetConv = await request(`/backoffice/conversations/${conversationId}`, { token: teacherA });
    assert.ok([403, 404].includes(teacherGetConv.status), `C2-01 GET conversation: ${teacherGetConv.status}`);
    const teacherGetMsg = await request(`/backoffice/messages/${message1Id}`, { token: teacherA });
    assert.ok([403, 404].includes(teacherGetMsg.status), `C2-01 GET message: ${teacherGetMsg.status}`);

    const adminToParent = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: { message: "Admin vers parent lié", participantUserIds: [PARENT_A] },
    });
    assert.equal(adminToParent.status, 201, "C2-02 Admin A → Parent A");
    const teacherToParent = await request("/backoffice/messages", {
      method: "POST",
      token: teacherA,
      body: { message: "Teacher vers parent de sa classe", participantUserIds: [PARENT_A], studentId: fixtures.studentA },
    });
    assert.equal(teacherToParent.status, 201, `C2-02 Teacher A → Parent A: ${JSON.stringify(teacherToParent.data)}`);
    const teacherA2ToParent = await request("/backoffice/messages", {
      method: "POST",
      token: teacherA2,
      body: { message: "hors affectation", participantUserIds: [PARENT_A], studentId: fixtures.studentA },
    });
    assert.ok([403, 404].includes(teacherA2ToParent.status), `C2-02 Teacher A2: ${teacherA2ToParent.status}`);
    const parentToStaff = await request("/backoffice/messages", {
      method: "POST",
      token: parentA,
      body: { message: "Parent vers admin", participantUserIds: [ADMIN_A] },
    });
    assert.equal(parentToStaff.status, 201, `C2-02 Parent A → staff: ${JSON.stringify(parentToStaff.data)}`);
    const parentA2Denied = await request("/backoffice/messages", {
      method: "POST",
      token: parentA2,
      body: { message: "Parent non lié", participantUserIds: [ADMIN_A], studentId: fixtures.studentA },
    });
    assert.ok([403, 404].includes(parentA2Denied.status), `C2-02 Parent A2: ${parentA2Denied.status}`);
    const bCreate = await request("/backoffice/messages", {
      method: "POST",
      token: adminB,
      body: { message: "B vers parent A", participantUserIds: [PARENT_A], schoolCode: "SCH-COM-A" },
    });
    assert.ok([403, 404].includes(bCreate.status), `C2-02 Admin B: ${bCreate.status}`);

    function recipientIds(data) {
      return unwrapList(data).map((row) => String(row.userId || row.id));
    }
    const parentUsers = await request("/backoffice/users", { token: parentA });
    assert.ok([401, 403, 404].includes(parentUsers.status), `C2-13 Parent sans Utilisateurs:READ: ${parentUsers.status}`);
    const parentRecipients = await request("/backoffice/messages/recipients", { token: parentA });
    assert.equal(parentRecipients.status, 200, `C2-13 Parent recipients: ${JSON.stringify(parentRecipients.data)}`);
    const parentIds = recipientIds(parentRecipients.data);
    assert.ok(parentIds.includes(ADMIN_A), "C2-13 Parent voit staff");
    assert.ok(parentIds.includes(TEACHER_A), "C2-13 Parent voit enseignant lié");
    assert.ok(!parentIds.includes(TEACHER_A2), "C2-13 Parent ne voit pas enseignant hors contexte");
    assert.ok(!parentIds.includes(PARENT_A2), "C2-13 Parent ne voit pas Parent A2");
    assert.ok(!parentIds.includes(ADMIN_B) && !parentIds.includes(PARENT_B), "C2-13 Parent ne voit jamais école B");
    const teacherRecipients = await request("/backoffice/messages/recipients", { token: teacherA });
    assert.equal(teacherRecipients.status, 200);
    const teacherIds = recipientIds(teacherRecipients.data);
    assert.ok(teacherIds.includes(PARENT_A), "C2-13 Teacher voit parent de ses élèves");
    assert.ok(teacherIds.includes(ADMIN_A), "C2-13 Teacher voit staff");
    assert.ok(!teacherIds.includes(PARENT_A2), "C2-13 Teacher ne voit pas parent hors affectation");
    const adminRecipients = await request("/backoffice/messages/recipients", { token: adminA });
    assert.equal(adminRecipients.status, 200);
    const adminIds = recipientIds(adminRecipients.data);
    assert.ok(adminIds.includes(PARENT_A) && adminIds.includes(TEACHER_A), "C2-13 Admin destinataires établissement");
    const bRecipients = await request("/backoffice/messages/recipients", { token: parentB });
    const bRecipientIds = recipientIds(bRecipients.data);
    assert.ok(!bRecipientIds.includes(PARENT_A) && !bRecipientIds.includes(ADMIN_A), "C2-13 école B isolée");

    const superNoSchool = await request("/backoffice/conversations", { token: superSa });
    assert.equal(superNoSchool.status, 400, `C2-14 Superadmin * sans école: ${superNoSchool.status}`);
    const superScoped = await request("/backoffice/conversations?effectiveSchoolCode=SCH-COM-A", { token: superSa });
    assert.equal(superScoped.status, 200, `C2-14 Superadmin scoped: ${JSON.stringify(superScoped.data)}`);
    const superCreateBare = await request("/backoffice/messages", {
      method: "POST",
      token: superSa,
      body: { message: "global fantôme", participantUserIds: [PARENT_A] },
    });
    assert.equal(superCreateBare.status, 400, "C2-14 création sans école refusée");
    const superCreate = await request("/backoffice/messages", {
      method: "POST",
      token: superSa,
      body: {
        message: "Superadmin request-scoped",
        participantUserIds: [PARENT_A],
        effectiveSchoolCode: "SCH-COM-A",
      },
    });
    assert.equal(superCreate.status, 201, `C2-14 Superadmin crée dans A: ${JSON.stringify(superCreate.data)}`);
    const superWrongSchool = await request(
      `/backoffice/conversations/${superCreate.data.conversationId}?effectiveSchoolCode=SCH-COM-B`,
      { token: superSa },
    );
    assert.ok([403, 404].includes(superWrongSchool.status), `C2-14 Superadmin B sur fil A: ${superWrongSchool.status}`);
    const superRightSchool = await request(
      `/backoffice/conversations/${superCreate.data.conversationId}?effectiveSchoolCode=SCH-COM-A`,
      { token: superSa },
    );
    assert.equal(superRightSchool.status, 200, "C2-14 Superadmin A voit son fil");

    const reply2 = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: parentA,
      body: { message: "Oui, je serai présent" },
    });
    assert.equal(reply2.status, 201, `C2-03 reply parent: ${JSON.stringify(reply2.data)}`);
    assert.equal(reply2.data.conversationId, conversationId);
    const reply3 = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminA,
      body: { message: "Parfait, à samedi" },
    });
    assert.equal(reply3.status, 201);
    assert.equal(reply3.data.conversationId, conversationId);
    const convCount = await countRows(pool, `SELECT count(*)::int AS c FROM school_conversations WHERE id = $1`, [
      conversationId,
    ]);
    assert.equal(convCount, 1, "C2-03 une seule conversation");
    const msgCount = await countRows(pool, `SELECT count(*)::int AS c FROM school_messages WHERE conversation_id = $1`, [
      conversationId,
    ]);
    assert.equal(msgCount, 3, "C2-03 trois messages");
    const thread = await request(`/backoffice/conversations/${conversationId}/messages`, { token: parentA });
    assert.equal(thread.status, 200);
    const bodies = unwrapList(thread.data).map((row) => row.body || row.message);
    assert.deepEqual(bodies, ["Réunion parents", "Oui, je serai présent", "Parfait, à samedi"]);

    const unreadBefore = await request("/backoffice/messages/unread-count", { token: parentA });
    assert.ok((unreadBefore.data?.count ?? 0) >= 1, `C2-04 unread parent >= 1: ${JSON.stringify(unreadBefore.data)}`);
    const adminUnreadOwn = await request("/backoffice/messages/unread-count", { token: adminA });
    const mark = await request(`/backoffice/messages/${message1Id}/read`, { method: "PATCH", token: parentA });
    assert.equal(mark.status, 200, `C2-04 mark-read: ${JSON.stringify(mark.data)}`);
    const readRows = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_message_reads WHERE message_id = $1 AND user_id = $2`,
      [message1Id, PARENT_A],
    );
    assert.equal(readRows, 1, "C2-04 row Parent");
    const globalRead = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM school_messages WHERE id = $1 AND status = 'read'`,
      [message1Id],
    );
    assert.equal(globalRead, 0, "C2-04 pas de status global read");
    const unreadAfter = await request("/backoffice/messages/unread-count", { token: parentA });
    assert.ok(
      (unreadAfter.data?.count ?? 0) < (unreadBefore.data?.count ?? 0),
      "C2-04 unread parent diminue",
    );
    assert.equal(
      adminUnreadOwn.data?.count,
      (await request("/backoffice/messages/unread-count", { token: adminA })).data?.count,
      "C2-04 lecture Parent ne change pas unread Admin",
    );

    const parentNoJwtStudents = mintAccess(
      tokens,
      claims({ sub: PARENT_A, schoolCode: "SCH-COM-A", role: "Parent", roleKeys: ["PARENT"] }),
    );
    const convsNoStudents = unwrapList(
      (await request("/backoffice/conversations", { token: parentNoJwtStudents })).data,
    );
    assert.ok(convsNoStudents.some((row) => row.id === conversationId), "C2-05 conversation visible sans studentIds");
    const threadNoStudents = await request(`/backoffice/conversations/${conversationId}/messages`, {
      token: parentNoJwtStudents,
    });
    assert.equal(threadNoStudents.status, 200, "C2-05 GET thread 200");

    const pdfUp = await uploadFile(adminA, {
      fileName: "../../etc/reunion.pdf",
      mimeType: "application/pdf",
      body: pdfBuffer(),
    });
    assert.equal(pdfUp.status, 201, `C2-07 upload PDF: ${JSON.stringify(pdfUp.data)}`);
    assert.equal(pdfUp.data.fileName, "reunion.pdf");
    const pngUp = await uploadFile(adminA, {
      fileName: "photo.png",
      mimeType: "image/png",
      body: pngBuffer(),
    });
    assert.equal(pngUp.status, 201, `C2-08 upload PNG: ${JSON.stringify(pngUp.data)}`);
    const withFiles = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminA,
      body: {
        message: "Convocation avec pièces",
        attachmentIds: [pdfUp.data.id, pngUp.data.id],
      },
    });
    assert.equal(withFiles.status, 201, `C2-08 message PJ: ${JSON.stringify(withFiles.data)}`);
    assert.equal(withFiles.data.attachments?.length, 2, "C2-08 attachments[2]");
    const attCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM communication_attachments WHERE entity_id = $1 AND entity_type = 'message'`,
      [withFiles.data.id],
    );
    assert.equal(attCount, 2);
    const parentDownload = await downloadFile(parentA, pdfUp.data.id);
    assert.equal(parentDownload.status, 200, "C2-07 Parent A télécharge 200");
    assert.match(String(parentDownload.contentType), /pdf/i);
    const teacherDl = await downloadFile(teacherA, pdfUp.data.id);
    assert.ok([403, 404].includes(teacherDl.status), `C2-07 Teacher non participant: ${teacherDl.status}`);
    const bDl = await downloadFile(adminB, pdfUp.data.id);
    assert.ok([403, 404].includes(bDl.status), `C2-07 école B: ${bDl.status}`);

    const exe = await uploadFile(adminA, {
      fileName: "virus.exe",
      mimeType: "application/pdf",
      body: Buffer.from("MZ executable"),
    });
    assert.equal(exe.status, 400, "C2-07 .exe refusé");
    const badMime = await uploadFile(adminA, {
      fileName: "ok.pdf",
      mimeType: "application/x-msdownload",
      body: pdfBuffer(),
    });
    assert.equal(badMime.status, 400, "C2-07 MIME interdit");
    const tooBig = await uploadFile(adminA, {
      fileName: "big.pdf",
      mimeType: "application/pdf",
      body: Buffer.alloc(10 * 1024 * 1024 + 8, 0x25),
    });
    assert.equal(tooBig.status, 400, "C2-07 trop gros");

    const idemKey = randomUUID();
    const firstIdem = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": idemKey },
      body: { message: "idempotent" },
    });
    const secondIdem = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": idemKey },
      body: { message: "idempotent" },
    });
    assert.ok([200, 201].includes(firstIdem.status));
    assert.ok([200, 201].includes(secondIdem.status));
    assert.equal(secondIdem.data.id, firstIdem.data.id, "C2-09 même clé → un seul message");
    const thirdIdem = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { message: "nouvelle intention" },
    });
    assert.equal(thirdIdem.status, 201);
    assert.notEqual(thirdIdem.data.id, firstIdem.data.id);

    const xss = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminA,
      body: { message: "<script>alert(1)</script>" },
    });
    assert.equal(xss.status, 201);
    assert.equal(xss.data.body || xss.data.message, "<script>alert(1)</script>", "C2-11 texte brut");

    const bConv = await request(`/backoffice/conversations/${conversationId}`, { token: adminB });
    const bMsg = await request(`/backoffice/messages/${message1Id}`, { token: adminB });
    const bAtt = await downloadFile(adminB, pdfUp.data.id);
    const bRead = await request(`/backoffice/messages/${message1Id}/read`, { method: "PATCH", token: adminB });
    const bPost = await request(`/backoffice/conversations/${conversationId}/messages`, {
      method: "POST",
      token: adminB,
      body: { message: "injection B" },
    });
    for (const item of [bConv, bMsg, bRead, bPost]) {
      assert.ok([403, 404].includes(item.status), `C2-12 ${item.status}`);
    }
    assert.ok([403, 404].includes(bAtt.status));
    const afterB = await countRows(pool, `SELECT count(*)::int AS c FROM school_messages WHERE conversation_id = $1 AND body = 'injection B'`, [
      conversationId,
    ]);
    assert.equal(afterB, 0, "C2-12 aucune mutation");
    const parentBList = unwrapList((await request("/backoffice/conversations", { token: parentB })).data);
    assert.ok(!parentBList.some((row) => row.id === conversationId));

    await grantMessages(pool, "SCHOOL_ADMIN", true);
    const beforeRevoke = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: { message: "avant révocation", participantUserIds: [PARENT_A] },
    });
    assert.equal(beforeRevoke.status, 201, "C2-10 CREATE 201");
    const msgBefore = await countRows(pool, `SELECT count(*)::int AS c FROM school_messages`);
    await grantMessages(pool, "SCHOOL_ADMIN", false);
    const afterRevoke = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: { message: "après révocation", participantUserIds: [PARENT_A] },
    });
    assert.equal(afterRevoke.status, 403, `C2-10 CREATE révoqué: ${afterRevoke.status}`);
    const msgAfter = await countRows(pool, `SELECT count(*)::int AS c FROM school_messages`);
    assert.equal(msgAfter, msgBefore, "C2-10 aucune row");
    const listRevoked = await request("/backoffice/conversations", { token: adminA });
    assert.equal(listRevoked.status, 403, "C2-10 READ révoqué");
    const recipientsRevoked = await request("/backoffice/messages/recipients", { token: adminA });
    assert.equal(recipientsRevoked.status, 403, "C2-13 READ révoqué destinataires");
    await grantMessages(pool, "SCHOOL_ADMIN", true);

    console.log("OK communicationsC2.http.pg.test.js — parcours COM-C2 PostgreSQL réel");
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
