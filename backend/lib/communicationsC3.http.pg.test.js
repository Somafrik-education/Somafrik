"use strict";

/**
 * COM-C3 — HTTP PostgreSQL réel : audience snapshot, read/unread, PJ, RBAC, tenant.
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_COM_C3_IT_DATABASE ?? "somafrik_com_c3_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_COM_C3_HTTP_PORT ?? 19884);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91";
const TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa92";
const TEACHER_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa97";
const PARENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa93";
const PARENT_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa94";
const PARENT_A3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99";
const ADMIN_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa95";
const PARENT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa96";
const SUPER_SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa98";
const STUDENT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc91";
const STUDENT_A2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc92";
const STUDENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc93";
const CLASS_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb91";
const CLASS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb92";
const CLASS_B_SCHOOL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb93";
const SAME_TS = "2026-08-28T10:00:00.000Z";

const ANN_PERMS = ["Announcements:READ", "Announcements:CREATE", "Announcements:UPDATE"];
const ANN_READ = ["Announcements:READ"];

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

async function uploadAnnouncementFile(token, { fileName, mimeType, body, query = "" }) {
  const response = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/announcements/attachments${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType,
        "X-Filename": fileName,
      },
      body,
    },
  );
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function uploadMessageFile(token, { fileName, mimeType, body }) {
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

async function downloadFile(token, attachmentId, query = "") {
  const response = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/communications/attachments/${encodeURIComponent(attachmentId)}${query}`,
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
    permissions: ANN_PERMS,
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
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'com-c3', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'com-c3')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function grantAnnouncements(pool, roleKey, flags) {
  await setRoleModuleGrant(pool, roleKey, "announcements", flags);
}

async function grantMessages(pool, roleKey, flags) {
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

function idsIn(data) {
  return unwrapList(data).map((row) => String(row.id));
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
  const yearB = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-COM-B' LIMIT 1`,
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES
       ($1, $3, $5, 'COM-CLS-A', '6ème A', 'active', $7::timestamptz),
       ($2, $3, $5, 'COM-CLS-B', '6ème B', 'active', $7::timestamptz),
       ($8, $4, $6, 'COM-CLS-B-SCHOOL', '6ème B école B', 'active', $7::timestamptz)`,
    [CLASS_A, CLASS_B, schoolA.id, schoolB.id, yearA.id, yearB.id, SAME_TS, CLASS_B_SCHOOL],
  );
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'COM-SUB-A', 'Mathématiques', 'active') RETURNING id`,
    [schoolA.id],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $9, 'ADM-COM-A', 'Admin', 'A', 'adm-com-a@test.local', 'Admin School', 'active', FALSE),
       ($2, $9, 'TCH-COM-A', 'Teacher', 'A', 'tch-com-a@test.local', 'Enseignant', 'active', FALSE),
       ($3, $9, 'TCH-COM-A2', 'Teacher', 'A2', 'tch-com-a2@test.local', 'Enseignant', 'active', FALSE),
       ($4, $9, 'PAR-COM-A', 'Parent', 'A', 'par-com-a@test.local', 'Parent', 'active', FALSE),
       ($5, $9, 'PAR-COM-A2', 'Parent', 'A2', 'par-com-a2@test.local', 'Parent', 'active', FALSE),
       ($6, $10, 'ADM-COM-B', 'Admin', 'B', 'adm-com-b@test.local', 'Admin School', 'active', FALSE),
       ($7, $10, 'PAR-COM-B', 'Parent', 'B', 'par-com-b@test.local', 'Parent', 'active', FALSE),
       ($8, NULL, 'SUPER-COM', 'Super', 'Admin', 'super-com@test.local', 'Super Administrateur Somafrik', 'active', FALSE)`,
    [ADMIN_A, TEACHER_A, TEACHER_A2, PARENT_A, PARENT_A2, ADMIN_B, PARENT_B, SUPER_SA, schoolA.id, schoolB.id],
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
     VALUES ($1, $2, 'TCH-C3-A', 'active'), ($1, $3, 'TCH-C3-A2', 'active')`,
    [schoolA.id, TEACHER_A, TEACHER_A2],
  );
  const teacherARow = (await pool.query(`SELECT id FROM teachers WHERE user_id = $1`, [TEACHER_A])).rows[0];
  const teacherA2Row = (await pool.query(`SELECT id FROM teachers WHERE user_id = $1`, [TEACHER_A2])).rows[0];
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES
       ($1, $2, $4, $6, $7, 'active'),
       ($1, $3, $5, $6, $7, 'active')`,
    [schoolA.id, teacherARow.id, teacherA2Row.id, CLASS_A, CLASS_B, subject.rows[0].id, yearA.id],
  );

  const studentA = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'COM-STU-A', 'Élève', 'A', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolA.id, SAME_TS],
  );
  const studentA2 = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'COM-STU-A2', 'Élève', 'A2', 'active', $2::timestamptz)
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
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, $6, 'Élève', 'A', 'stu-com-a@test.local', 'Élève / Étudiant', 'active', FALSE),
       ($2, $4, $7, 'Élève', 'A2', 'stu-com-a2@test.local', 'Élève / Étudiant', 'active', FALSE),
       ($3, $5, $8, 'Élève', 'B', 'stu-com-b@test.local', 'Élève / Étudiant', 'active', FALSE)`,
    [
      STUDENT_A,
      STUDENT_A2,
      STUDENT_B,
      schoolA.id,
      schoolB.id,
      studentA.rows[0].student_code,
      studentA2.rows[0].student_code,
      studentB.rows[0].student_code,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $3, 'STUDENT', 'active'),
       ($2, $3, 'STUDENT', 'active'),
       ($4, $5, 'STUDENT', 'active')`,
    [STUDENT_A, STUDENT_A2, schoolA.id, STUDENT_B, schoolB.id],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
     VALUES
       ($1, $3, $5, $7, '2025-09-01', 'active'),
       ($1, $4, $6, $7, '2025-09-01', 'active'),
       ($2, $8, $9, $10, '2025-09-01', 'active')`,
    [
      schoolA.id,
      schoolB.id,
      studentA.rows[0].id,
      studentA2.rows[0].id,
      CLASS_A,
      CLASS_B,
      yearA.id,
      studentB.rows[0].id,
      CLASS_B_SCHOOL,
      yearB.id,
    ],
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
  const contactA2 = (await pool.query(`SELECT id FROM contacts WHERE user_id = $1`, [PARENT_A2])).rows[0];
  await pool.query(
    `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
     VALUES
       ($1, $2, 'parent_student', $3, $5, 'active'),
       ($1, $2, 'parent_student', $4, $6, 'active')`,
    [schoolA.id, ci.rows[0].id, contactA.id, contactA2.id, studentA.rows[0].id, studentA2.rows[0].id],
  );

  await grantAnnouncements(pool, "SCHOOL_ADMIN", { create: true, read: true, update: true });
  await grantAnnouncements(pool, "TEACHER", { create: false, read: true, update: false });
  await grantAnnouncements(pool, "PARENT", { create: false, read: true, update: false });
  await grantAnnouncements(pool, "STUDENT", { create: false, read: true, update: false });
  await grantAnnouncements(pool, "SUPER_ADMIN", { create: true, read: true, update: true });
  await grantMessages(pool, "SCHOOL_ADMIN", { create: true, read: true, update: true });
  await grantMessages(pool, "PARENT", { create: true, read: true, update: true });
  await grantMessages(pool, "SUPER_ADMIN", { create: true, read: true, update: true });

  return {
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    studentA: studentA.rows[0].id,
    studentA2: studentA2.rows[0].id,
    countryA: ci.rows[0].id,
    yearA: yearA.id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour communicationsC3.http.pg.test.js");
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
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = path.join(require("node:os").tmpdir(), `somafrik-c3-${randomUUID()}`);
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
      claims({
        sub: PARENT_A,
        schoolCode: "SCH-COM-A",
        role: "Parent",
        roleKeys: ["PARENT"],
        permissions: ANN_READ,
      }),
    );
    const parentA2 = mintAccess(
      tokens,
      claims({
        sub: PARENT_A2,
        schoolCode: "SCH-COM-A",
        role: "Parent",
        roleKeys: ["PARENT"],
        permissions: ANN_READ,
      }),
    );
    const teacherA = mintAccess(
      tokens,
      claims({
        sub: TEACHER_A,
        schoolCode: "SCH-COM-A",
        role: "Enseignant",
        roleKeys: ["TEACHER"],
        permissions: ANN_READ,
      }),
    );
    const teacherA2 = mintAccess(
      tokens,
      claims({
        sub: TEACHER_A2,
        schoolCode: "SCH-COM-A",
        role: "Enseignant",
        roleKeys: ["TEACHER"],
        permissions: ANN_READ,
      }),
    );
    const studentA = mintAccess(
      tokens,
      claims({
        sub: STUDENT_A,
        schoolCode: "SCH-COM-A",
        role: "Élève / Étudiant",
        roleKeys: ["STUDENT"],
        permissions: ANN_READ,
      }),
    );
    const studentA2 = mintAccess(
      tokens,
      claims({
        sub: STUDENT_A2,
        schoolCode: "SCH-COM-A",
        role: "Élève / Étudiant",
        roleKeys: ["STUDENT"],
        permissions: ANN_READ,
      }),
    );
    const adminB = mintAccess(
      tokens,
      claims({ sub: ADMIN_B, schoolCode: "SCH-COM-B", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }),
    );
    const parentB = mintAccess(
      tokens,
      claims({
        sub: PARENT_B,
        schoolCode: "SCH-COM-B",
        role: "Parent",
        roleKeys: ["PARENT"],
        permissions: ANN_READ,
      }),
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

    const emptyTitle = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { title: "   ", message: "x", audience: "Tous" },
    });
    assert.equal(emptyTitle.status, 400, "titre vide → 400");
    const emptyBody = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { title: "x", message: "  ", audience: "Tous" },
    });
    assert.equal(emptyBody.status, 400, "contenu vide → 400");

    const foreignClass = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Classe école B",
        message: "ne doit pas passer",
        classIds: [CLASS_B_SCHOOL],
        recipientKinds: ["parent"],
      },
    });
    assert.ok([403, 404].includes(foreignClass.status), `C3.3 classe B dans école A: ${foreignClass.status}`);

    const schoolWide = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Réunion générale",
        message: "Samedi 9h",
        audience: "Tous",
        createdByUserId: ADMIN_B,
      },
    });
    assert.equal(schoolWide.status, 201, `C3-01: ${JSON.stringify(schoolWide.data)}`);
    const schoolWideId = schoolWide.data.id;
    assert.equal(schoolWide.data.createdByUserId, ADMIN_A, "C3-08 createdByUserId = Admin A");
    assert.equal(schoolWide.data.createdByName, "Admin A", "C3-08 createdByName exact");
    assert.match(String(schoolWide.data.publishedAt), /^\d{4}-\d{2}-\d{2}T/, "C3-08 publishedAt ISO");
    assert.match(String(schoolWide.data.createdAt), /^\d{4}-\d{2}-\d{2}T/, "C3-08 createdAt ISO");
    assert.doesNotMatch(String(schoolWide.data.publishedAt), /^\d{2}-\d{2}-\d{4}$/, "C3-08 pas JJ-MM-AAAA");
    const schoolRecipients = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM announcement_recipients WHERE announcement_id = $1`,
      [schoolWideId],
    );
    assert.ok(schoolRecipients >= 7, `C3-01 snapshot destinataires: ${schoolRecipients}`);
    const schoolRow = await pool.query(`SELECT created_by, school_id FROM announcements WHERE id = $1`, [schoolWideId]);
    assert.equal(schoolRow.rows[0].created_by, ADMIN_A);
    assert.equal(schoolRow.rows[0].school_id, fixtures.schoolA);

    for (const [label, token] of [
      ["Admin A", adminA],
      ["Teacher A", teacherA],
      ["Parent A", parentA],
      ["Student A", studentA],
      ["Parent A2", parentA2],
      ["Teacher A2", teacherA2],
    ]) {
      const list = idsIn((await request("/backoffice/announcements", { token })).data);
      assert.ok(list.includes(schoolWideId), `C3-01 ${label} voit établissement`);
    }
    const listB = idsIn((await request("/backoffice/announcements", { token: adminB })).data);
    assert.ok(!listB.includes(schoolWideId), "C3-01 école B ne voit jamais");
    const parentBList = idsIn((await request("/backoffice/announcements", { token: parentB })).data);
    assert.ok(!parentBList.includes(schoolWideId), "C3-01 Parent B isolé");

    const classParents = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Réunion 6e A",
        message: "Parents uniquement",
        classIds: [CLASS_A],
        recipientKinds: ["parent"],
      },
    });
    assert.equal(classParents.status, 201, `C3-02: ${JSON.stringify(classParents.data)}`);
    const classParentsId = classParents.data.id;
    const parentRecipients = await pool.query(
      `SELECT user_id FROM announcement_recipients WHERE announcement_id = $1`,
      [classParentsId],
    );
    const parentRecipientIds = parentRecipients.rows.map((row) => String(row.user_id));
    assert.ok(parentRecipientIds.includes(PARENT_A), "C3-02 Parent A snapshot");
    assert.ok(!parentRecipientIds.includes(PARENT_A2), "C3-02 Parent A2 hors snapshot");
    assert.ok(!parentRecipientIds.includes(TEACHER_A), "C3-02 Teacher A hors snapshot parents");
    assert.ok(!parentRecipientIds.includes(STUDENT_A), "C3-02 Student A hors snapshot parents");
    const parentAList = idsIn((await request("/backoffice/announcements", { token: parentA })).data);
    assert.ok(parentAList.includes(classParentsId), "C3-02 Parent A voit");
    const parentA2List = idsIn((await request("/backoffice/announcements", { token: parentA2 })).data);
    assert.ok(!parentA2List.includes(classParentsId), "C3-02 Parent A2 ne voit pas");
    const teacherAList = idsIn((await request("/backoffice/announcements", { token: teacherA })).data);
    assert.ok(!teacherAList.includes(classParentsId), "C3-02 Teacher A ne voit pas par affectation");
    const studentAList = idsIn((await request("/backoffice/announcements", { token: studentA })).data);
    assert.ok(!studentAList.includes(classParentsId), "C3-02 Student A ne voit pas");
    const parentA2Get = await request(`/backoffice/announcements/${classParentsId}`, { token: parentA2 });
    assert.ok([403, 404].includes(parentA2Get.status), `C3-02 GET Parent A2: ${parentA2Get.status}`);
    assert.ok(!parentA2Get.data?.title, "C3-02 pas de fuite titre");
    const adminSeesParents = idsIn((await request("/backoffice/announcements", { token: adminA })).data);
    assert.ok(adminSeesParents.includes(classParentsId), "C3.11 manager voit hors audience");

    const classTeachers = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Conseil 6e A",
        message: "Enseignants",
        classIds: [CLASS_A],
        recipientKinds: ["teacher"],
      },
    });
    assert.equal(classTeachers.status, 201, `C3-03: ${JSON.stringify(classTeachers.data)}`);
    const classTeachersId = classTeachers.data.id;
    const tList = idsIn((await request("/backoffice/announcements", { token: teacherA })).data);
    assert.ok(tList.includes(classTeachersId), "C3-03 Teacher A voit");
    const t2List = idsIn((await request("/backoffice/announcements", { token: teacherA2 })).data);
    assert.ok(!t2List.includes(classTeachersId), "C3-03 Teacher A2 Classe B ne voit pas");
    const pListTeachers = idsIn((await request("/backoffice/announcements", { token: parentA })).data);
    assert.ok(!pListTeachers.includes(classTeachersId), "C3-03 Parent A ne voit pas");

    const classStudents = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Devoir 6e A",
        message: "Élèves",
        classIds: [CLASS_A],
        recipientKinds: ["student"],
      },
    });
    assert.equal(classStudents.status, 201, `C3-04: ${JSON.stringify(classStudents.data)}`);
    const classStudentsId = classStudents.data.id;
    const sList = idsIn((await request("/backoffice/announcements", { token: studentA })).data);
    assert.ok(sList.includes(classStudentsId), "C3-04 Student A voit");
    const s2List = idsIn((await request("/backoffice/announcements", { token: studentA2 })).data);
    assert.ok(!s2List.includes(classStudentsId), "C3-04 Student A2 ne voit pas");
    const pListStudents = idsIn((await request("/backoffice/announcements", { token: parentA })).data);
    assert.ok(!pListStudents.includes(classStudentsId), "C3-04 Parent A non inclus");

    const snapshotAnn = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Snapshot parents 6e A",
        message: "historique",
        classIds: [CLASS_A],
        recipientKinds: ["parent"],
      },
    });
    assert.equal(snapshotAnn.status, 201, `C3-05: ${JSON.stringify(snapshotAnn.data)}`);
    const snapshotId = snapshotAnn.data.id;

    const bothAudience = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Parents + élèves 6e A",
        message: "lecture individuelle",
        classIds: [CLASS_A],
        recipientKinds: ["parent", "student"],
      },
    });
    assert.equal(bothAudience.status, 201, `C3-06: ${JSON.stringify(bothAudience.data)}`);
    const bothId = bothAudience.data.id;
    const parentUnreadBefore = await request("/backoffice/announcements/unread-count", { token: parentA });
    const studentUnreadBefore = await request("/backoffice/announcements/unread-count", { token: studentA });
    assert.ok((parentUnreadBefore.data?.count ?? 0) >= 1, "C3-06 Parent unread >= 1");
    assert.ok((studentUnreadBefore.data?.count ?? 0) >= 1, "C3-06 Student unread >= 1");
    const markParent = await request(`/backoffice/announcements/${bothId}/read`, {
      method: "PATCH",
      token: parentA,
    });
    assert.equal(markParent.status, 200, `C3-06 mark-read Parent: ${JSON.stringify(markParent.data)}`);
    assert.match(String(markParent.data?.readAt ?? ""), /^\d{4}-\d{2}-\d{2}T/, "P1-018 readAt immédiat");
    const parentReads = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM announcement_reads WHERE announcement_id = $1 AND user_id = $2`,
      [bothId, PARENT_A],
    );
    assert.equal(parentReads, 1, "C3-06 announcement_reads Parent = 1");
    const studentReads = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM announcement_reads WHERE announcement_id = $1 AND user_id = $2`,
      [bothId, STUDENT_A],
    );
    assert.equal(studentReads, 0, "C3-06 Student reste unread");
    const globalRead = await countRows(pool, `SELECT count(*)::int AS c FROM announcements WHERE id = $1 AND status = 'read'`, [
      bothId,
    ]);
    assert.equal(globalRead, 0, "C3-06 pas de status global read");
    const parentUnreadAfter = await request("/backoffice/announcements/unread-count", { token: parentA });
    assert.ok(
      (parentUnreadAfter.data?.count ?? 0) < (parentUnreadBefore.data?.count ?? 0),
      "C3-06 Parent unread diminue",
    );
    const studentUnreadAfter = await request("/backoffice/announcements/unread-count", { token: studentA });
    assert.equal(
      studentUnreadAfter.data?.count,
      studentUnreadBefore.data?.count,
      "C3-06 Student unread inchangé",
    );
    const reloadMobile = await request(`/backoffice/announcements/${bothId}`, { token: parentA });
    assert.ok(reloadMobile.data?.readAt, "C3-07 reload Mobile → Lu via PG");
    const webBadge = await request("/backoffice/announcements/unread-count", { token: parentA });
    const mobileBadge = await request("/backoffice/announcements/unread-count", { token: parentA });
    assert.equal(webBadge.data?.count, mobileBadge.data?.count, "C3-07 badge identique Web/Mobile");

    const patched = await request(`/backoffice/announcements/${schoolWideId}`, {
      method: "PATCH",
      token: adminA,
      body: { title: "Réunion générale (maj)", message: "horaire confirmé" },
    });
    assert.equal(patched.status, 200, `P1-018 update: ${JSON.stringify(patched.data)}`);
    assert.equal(patched.data.title, "Réunion générale (maj)", "P1-018 title immédiat");
    assert.equal(patched.data.content || patched.data.message, "horaire confirmé", "P1-018 body immédiat");
    assert.match(String(patched.data.updatedAt ?? ""), /^\d{4}-\d{2}-\d{2}T/, "P1-018 updatedAt ISO");
    const pgPatched = await pool.query(`SELECT title, message FROM announcements WHERE id = $1`, [schoolWideId]);
    assert.equal(pgPatched.rows[0].title, "Réunion générale (maj)", "P1-018 PG title");
    assert.equal(pgPatched.rows[0].message, "horaire confirmé", "P1-018 PG body");

    const immutableAudience = await request(`/backoffice/announcements/${classParentsId}`, {
      method: "PATCH",
      token: adminA,
      body: { classIds: [CLASS_B], recipientKinds: ["parent"] },
    });
    assert.ok([403, 404].includes(immutableAudience.status), "C3.8 audience immuable après publication");

    const pdfUp = await uploadAnnouncementFile(adminA, {
      fileName: "../../etc/reunion.pdf",
      mimeType: "application/pdf",
      body: pdfBuffer(),
    });
    assert.equal(pdfUp.status, 201, `C3-09 upload PDF: ${JSON.stringify(pdfUp.data)}`);
    assert.equal(pdfUp.data.fileName, "reunion.pdf");
    const withPdf = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Convocation PJ",
        message: "PDF joint",
        classIds: [CLASS_A],
        recipientKinds: ["parent"],
        attachmentIds: [pdfUp.data.id],
      },
    });
    assert.equal(withPdf.status, 201, `C3-09 publish PJ: ${JSON.stringify(withPdf.data)}`);
    assert.equal(withPdf.data.attachments?.length, 1);
    const parentMeta = await request(`/backoffice/announcements/${withPdf.data.id}`, { token: parentA });
    assert.equal(parentMeta.status, 200);
    assert.equal(parentMeta.data.attachments?.length, 1, "C3-09 Parent A metadata PJ");
    const parentDl = await downloadFile(parentA, pdfUp.data.id);
    assert.equal(parentDl.status, 200, "C3-09 Parent A télécharge 200");
    const parentA2Dl = await downloadFile(parentA2, pdfUp.data.id);
    assert.ok([403, 404].includes(parentA2Dl.status), `C3-09 Parent A2: ${parentA2Dl.status}`);
    const bDl = await downloadFile(adminB, pdfUp.data.id);
    assert.ok([403, 404].includes(bDl.status), `C3-09 école B: ${bDl.status}`);

    const exe = await uploadAnnouncementFile(adminA, {
      fileName: "virus.exe",
      mimeType: "application/pdf",
      body: Buffer.from("MZ executable"),
    });
    assert.equal(exe.status, 400, "C3-09 .exe refusé");
    const badMime = await uploadAnnouncementFile(adminA, {
      fileName: "ok.pdf",
      mimeType: "application/x-msdownload",
      body: pdfBuffer(),
    });
    assert.equal(badMime.status, 400, "C3-09 MIME interdit");
    const tooBig = await uploadAnnouncementFile(adminA, {
      fileName: "big.pdf",
      mimeType: "application/pdf",
      body: Buffer.alloc(10 * 1024 * 1024 + 8, 0x25),
    });
    assert.equal(tooBig.status, 400, "C3-09 trop gros");

    const pdf2 = await uploadAnnouncementFile(adminA, {
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      body: pdfBuffer(),
    });
    const pngUp = await uploadAnnouncementFile(adminA, {
      fileName: "photo.png",
      mimeType: "image/png",
      body: pngBuffer(),
    });
    assert.equal(pngUp.status, 201, `C3-10 PNG: ${JSON.stringify(pngUp.data)}`);
    const multi = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Multi PJ",
        message: "PDF + PNG",
        audience: "Tous",
        attachmentIds: [pdf2.data.id, pngUp.data.id],
      },
    });
    assert.equal(multi.status, 201, `C3-10: ${JSON.stringify(multi.data)}`);
    assert.equal(multi.data.attachments?.length, 2, "C3-10 attachments[2]");
    const attCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM communication_attachments
       WHERE entity_id = $1 AND entity_type = 'announcement'`,
      [multi.data.id],
    );
    assert.equal(attCount, 2, "C3-10 2 communication_attachments");

    const msgPdf = await uploadMessageFile(adminA, {
      fileName: "message.pdf",
      mimeType: "application/pdf",
      body: pdfBuffer(),
    });
    assert.equal(msgPdf.status, 201, `P1-017 upload message PDF: ${JSON.stringify(msgPdf.data)}`);
    const msgWithPdf = await request("/backoffice/messages", {
      method: "POST",
      token: adminA,
      body: {
        message: "PJ message Parent A",
        participantUserIds: [PARENT_A],
        attachmentIds: [msgPdf.data.id],
      },
    });
    assert.equal(msgWithPdf.status, 201, `P1-017 message PJ: ${JSON.stringify(msgWithPdf.data)}`);
    const parentMsgDl = await downloadFile(parentA, msgPdf.data.id);
    assert.equal(parentMsgDl.status, 200, "P1-017 Messages:READ → PJ Message 200");
    const parentAnnDl = await downloadFile(parentA, pdfUp.data.id);
    assert.equal(parentAnnDl.status, 200, "P1-017 Announcements:READ → PJ Annonce 200");

    await grantMessages(pool, "PARENT", { create: false, read: false, update: false });
    const parentMsgAfterMsgRevoke = await downloadFile(parentA, msgPdf.data.id);
    assert.ok(
      [403, 404].includes(parentMsgAfterMsgRevoke.status),
      `P1-017 Messages:READ révoqué PJ Message: ${parentMsgAfterMsgRevoke.status}`,
    );
    const parentAnnKeep = await downloadFile(parentA, pdfUp.data.id);
    assert.equal(parentAnnKeep.status, 200, "P1-017 Announcements:READ encore → PJ Annonce 200");

    await grantMessages(pool, "PARENT", { create: true, read: true, update: true });
    await grantAnnouncements(pool, "PARENT", { create: false, read: false, update: false });
    const parentAnnAfterAnnRevoke = await downloadFile(parentA, pdfUp.data.id);
    assert.ok(
      [403, 404].includes(parentAnnAfterAnnRevoke.status),
      `P1-017 Announcements:READ révoqué PJ Annonce: ${parentAnnAfterAnnRevoke.status}`,
    );
    const parentMsgKeep = await downloadFile(parentA, msgPdf.data.id);
    assert.equal(parentMsgKeep.status, 200, "P1-017 Messages:READ encore → PJ Message 200");
    await grantAnnouncements(pool, "PARENT", { create: false, read: true, update: false });

    const parentA2MsgDl = await downloadFile(parentA2, msgPdf.data.id);
    assert.ok([403, 404].includes(parentA2MsgDl.status), `P1-017 hors participation: ${parentA2MsgDl.status}`);
    const schoolBMsgDl = await downloadFile(adminB, msgPdf.data.id);
    assert.ok([403, 404].includes(schoolBMsgDl.status), `P1-017 école B PJ Message: ${schoolBMsgDl.status}`);
    const superMsgBare = await downloadFile(superSa, msgPdf.data.id);
    assert.equal(superMsgBare.status, 400, "P1-017 Superadmin download message sans école");
    const superAnnBare = await downloadFile(superSa, pdfUp.data.id);
    assert.equal(superAnnBare.status, 400, "P1-017 Superadmin download annonce sans école");
    const superAnnScoped = await downloadFile(superSa, pdfUp.data.id, "?effectiveSchoolCode=SCH-COM-A");
    assert.equal(superAnnScoped.status, 200, "P1-017 Superadmin request-scoped A PJ Annonce");
    const superAnnWrong = await downloadFile(superSa, pdfUp.data.id, "?effectiveSchoolCode=SCH-COM-B");
    assert.ok([403, 404].includes(superAnnWrong.status), `P1-017 Superadmin B sur PJ Annonce A: ${superAnnWrong.status}`);
    const superMsgWrong = await downloadFile(superSa, msgPdf.data.id, "?effectiveSchoolCode=SCH-COM-B");
    assert.ok([403, 404].includes(superMsgWrong.status), `P1-017 Superadmin B sur PJ Message A: ${superMsgWrong.status}`);

    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [CLASS_B, fixtures.studentA]);
    const afterMove = idsIn((await request("/backoffice/announcements", { token: parentA })).data);
    assert.ok(afterMove.includes(snapshotId), "C3-05 Parent A conserve l'annonce historique");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'PAR-COM-A3', 'Parent', 'A3', 'par-com-a3@test.local', 'Parent', 'active', FALSE)`,
      [PARENT_A3, fixtures.schoolA],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, 'PARENT', 'active')`,
      [PARENT_A3, fixtures.schoolA],
    );
    await pool.query(
      `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, phone, status, user_id)
       VALUES ($1, $2, 'Parent', 'A3', 'Parent', '+225000000013', 'active', $3)`,
      [fixtures.schoolA, fixtures.countryA, PARENT_A3],
    );
    const contactA3 = (await pool.query(`SELECT id FROM contacts WHERE user_id = $1`, [PARENT_A3])).rows[0];
    await pool.query(
      `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
       VALUES ($1, $2, 'parent_student', $3, $4, 'active')`,
      [fixtures.schoolA, fixtures.countryA, contactA3.id, fixtures.studentA],
    );
    const parentA3 = mintAccess(
      tokens,
      claims({
        sub: PARENT_A3,
        schoolCode: "SCH-COM-A",
        role: "Parent",
        roleKeys: ["PARENT"],
        permissions: ANN_READ,
      }),
    );
    const parentA3List = idsIn((await request("/backoffice/announcements", { token: parentA3 })).data);
    assert.ok(!parentA3List.includes(snapshotId), "C3-05 nouveau parent non rétroactif");
    const parentA3Get = await request(`/backoffice/announcements/${snapshotId}`, { token: parentA3 });
    assert.ok([403, 404].includes(parentA3Get.status), "C3-05 GET nouveau parent fail-closed");

    const idemKey = randomUUID();
    const idemBody = { title: "Idempotente", message: "une seule", audience: "Tous" };
    const firstIdem = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": idemKey },
      body: idemBody,
    });
    const secondIdem = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": idemKey },
      body: idemBody,
    });
    assert.ok([200, 201].includes(firstIdem.status), `C3-11 first: ${firstIdem.status}`);
    assert.ok([200, 201].includes(secondIdem.status), `C3-11 second: ${secondIdem.status}`);
    assert.equal(secondIdem.data.id, firstIdem.data.id, "C3-11 même clé → une seule annonce");
    const recipIdem = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM announcement_recipients WHERE announcement_id = $1 AND user_id = $2`,
      [firstIdem.data.id, PARENT_A],
    );
    assert.equal(recipIdem, 1, "C3-11 un seul snapshot recipient par user");
    const thirdIdem = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { title: "Nouvelle intention", message: "autre", audience: "Tous" },
    });
    assert.equal(thirdIdem.status, 201);
    assert.notEqual(thirdIdem.data.id, firstIdem.data.id, "C3-11 nouvelle clé → nouvelle annonce");

    const xss = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "<script>alert(1)</script>",
        message: "<script>alert(1)</script>",
        audience: "Tous",
      },
    });
    assert.equal(xss.status, 201, "C3-16 stocké");
    assert.equal(xss.data.title, "<script>alert(1)</script>", "C3-16 titre texte brut");
    assert.equal(xss.data.content || xss.data.message, "<script>alert(1)</script>", "C3-16 body texte brut");

    const bGet = await request(`/backoffice/announcements/${schoolWideId}`, { token: adminB });
    const bPatch = await request(`/backoffice/announcements/${schoolWideId}`, {
      method: "PATCH",
      token: adminB,
      body: { title: "injection B" },
    });
    const bArchive = await request(`/backoffice/announcements/${schoolWideId}/archive`, {
      method: "POST",
      token: adminB,
    });
    const bRead = await request(`/backoffice/announcements/${schoolWideId}/read`, {
      method: "PATCH",
      token: adminB,
    });
    for (const item of [bGet, bPatch, bArchive, bRead]) {
      assert.ok([403, 404].includes(item.status), `C3-13 ${item.status}`);
    }
    const afterB = await countRows(pool, `SELECT count(*)::int AS c FROM announcements WHERE id = $1 AND title = 'injection B'`, [
      schoolWideId,
    ]);
    assert.equal(afterB, 0, "C3-13 aucune mutation");

    const superNoSchool = await request("/backoffice/announcements", { token: superSa });
    assert.equal(superNoSchool.status, 400, "C3-14 Superadmin * sans école list");
    const superCreateBare = await request("/backoffice/announcements", {
      method: "POST",
      token: superSa,
      headers: { "Idempotency-Key": randomUUID() },
      body: { title: "global fantôme", message: "x", audience: "Tous" },
    });
    assert.equal(superCreateBare.status, 400, "C3-14 création sans école");
    const superUnreadBare = await request("/backoffice/announcements/unread-count", { token: superSa });
    assert.equal(superUnreadBare.status, 400, "C3-14 unread sans école");
    const superOptionsBare = await request("/backoffice/announcements/audience-options", { token: superSa });
    assert.equal(superOptionsBare.status, 400, "C3-14 audience-options sans école");
    const superUploadBare = await uploadAnnouncementFile(superSa, {
      fileName: "x.pdf",
      mimeType: "application/pdf",
      body: pdfBuffer(),
    });
    assert.equal(superUploadBare.status, 400, "C3-14 upload sans école");
    const superGetBare = await request(`/backoffice/announcements/${schoolWideId}`, { token: superSa });
    assert.equal(superGetBare.status, 400, "C3-14 GET sans école");
    const superReadBare = await request(`/backoffice/announcements/${schoolWideId}/read`, {
      method: "PATCH",
      token: superSa,
    });
    assert.equal(superReadBare.status, 400, "C3-14 mark-read sans école");
    const superDlBare = await downloadFile(superSa, pdfUp.data.id);
    assert.equal(superDlBare.status, 400, "C3-14 download sans école");

    const superScoped = await request("/backoffice/announcements?effectiveSchoolCode=SCH-COM-A", { token: superSa });
    assert.equal(superScoped.status, 200, `C3-14 Superadmin scoped A: ${JSON.stringify(superScoped.data)}`);
    assert.ok(idsIn(superScoped.data).includes(schoolWideId), "C3-14 Superadmin voit A");
    const superWrong = await request(`/backoffice/announcements/${schoolWideId}?effectiveSchoolCode=SCH-COM-B`, {
      token: superSa,
    });
    assert.ok([403, 404].includes(superWrong.status), `C3-14 Superadmin B sur A: ${superWrong.status}`);
    const superRight = await request(`/backoffice/announcements/${schoolWideId}?effectiveSchoolCode=SCH-COM-A`, {
      token: superSa,
    });
    assert.equal(superRight.status, 200, "C3-14 Superadmin A GET");
    const superCreate = await request("/backoffice/announcements", {
      method: "POST",
      token: superSa,
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        title: "Superadmin scoped",
        message: "dans A",
        audience: "Tous",
        effectiveSchoolCode: "SCH-COM-A",
      },
    });
    assert.equal(superCreate.status, 201, `C3-14 Superadmin crée dans A: ${JSON.stringify(superCreate.data)}`);

    const options = await request("/backoffice/announcements/audience-options", { token: adminA });
    assert.equal(options.status, 200);
    const classIds = (options.data.classes ?? []).map((row) => row.id);
    assert.ok(classIds.includes(CLASS_A) && classIds.includes(CLASS_B), "C3.12 classes A");
    assert.ok(!classIds.includes(CLASS_B_SCHOOL), "C3.12 pas de classe école B");
    const parentOptions = await request("/backoffice/announcements/audience-options", { token: parentA });
    assert.equal(parentOptions.status, 403, "C3.12 CREATE requis");

    const legacyId = randomUUID();
    await pool.query(
      `INSERT INTO announcements (
         id, school_id, title, message, target_role, created_by, published_at, status, created_at, updated_at
       ) VALUES ($1,$2,'Legacy non résolue','sans snapshot',NULL,$3,NOW(),'published',NOW(),NOW())`,
      [legacyId, fixtures.schoolA, ADMIN_A],
    );
    const parentLegacyList = idsIn((await request("/backoffice/announcements", { token: parentA })).data);
    assert.ok(!parentLegacyList.includes(legacyId), "C3-15 destinataire ne voit pas legacy");
    const parentLegacyGet = await request(`/backoffice/announcements/${legacyId}`, { token: parentA });
    assert.ok([403, 404].includes(parentLegacyGet.status), "C3-15 GET destinataire fail-closed");
    const adminLegacyList = idsIn((await request("/backoffice/announcements", { token: adminA })).data);
    assert.ok(adminLegacyList.includes(legacyId), "C3-15 manager retrouve legacy");
    const adminLegacyGet = await request(`/backoffice/announcements/${legacyId}`, { token: adminA });
    assert.equal(adminLegacyGet.status, 200, "C3-15 manager GET legacy");
    assert.equal(adminLegacyGet.data.unresolved, true, "C3-15 unresolved");

    const beforeCreate = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { title: "avant révocation", message: "ok", audience: "Tous" },
    });
    assert.equal(beforeCreate.status, 201, "C3-12 CREATE 201");
    const rowsBefore = await countRows(pool, `SELECT count(*)::int AS c FROM announcements`);
    await grantAnnouncements(pool, "SCHOOL_ADMIN", { create: false, read: true, update: true });
    const afterCreate = await request("/backoffice/announcements", {
      method: "POST",
      token: adminA,
      headers: { "Idempotency-Key": randomUUID() },
      body: { title: "après révocation CREATE", message: "non", audience: "Tous" },
    });
    assert.equal(afterCreate.status, 403, `C3-12 CREATE révoqué: ${afterCreate.status}`);
    const rowsAfterCreate = await countRows(pool, `SELECT count(*)::int AS c FROM announcements`);
    assert.equal(rowsAfterCreate, rowsBefore, "C3-12 aucune row");
    await grantAnnouncements(pool, "SCHOOL_ADMIN", { create: false, read: true, update: false });
    const afterUpdate = await request(`/backoffice/announcements/${schoolWideId}/archive`, {
      method: "POST",
      token: adminA,
    });
    assert.equal(afterUpdate.status, 403, "C3-12 UPDATE révoqué archive");
    await grantAnnouncements(pool, "SCHOOL_ADMIN", { create: false, read: false, update: false });
    const afterRead = await request("/backoffice/announcements", { token: adminA });
    assert.equal(afterRead.status, 403, "C3-12 READ révoqué liste");
    await grantAnnouncements(pool, "SCHOOL_ADMIN", { create: true, read: true, update: true });

    console.log("OK communicationsC3.http.pg.test.js — parcours COM-C3 PostgreSQL réel");
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
