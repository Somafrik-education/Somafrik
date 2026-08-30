"use strict";

/**
 * ANN-PLATFORM-1 — HTTP PostgreSQL : audiences Superadmin, snapshot, PJ, RBAC.
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PLATFORM_ANN_IT_DATABASE ?? "somafrik_platform_ann_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PLATFORM_ANN_HTTP_PORT ?? 19887);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const SUPER_SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const COUNTRY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const COUNTRY_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const SCHOOL_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";
const PARENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07";
const STUDENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08";
const INACTIVE_U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09";
const REVOKED_U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
const BULK_ACTIVE_USERS = 40;

const SUPER_PERMS = ["ALL_PRIVILEGES", "Announcements:READ", "Announcements:CREATE", "Announcements:UPDATE"];
const READ_PERMS = ["Announcements:READ"];
const SCHOOL_WRITE = ["Announcements:READ", "Announcements:CREATE", "Announcements:UPDATE"];

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
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/backoffice/platform-announcements/attachments`, {
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
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/platform-announcements/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, contentType: response.headers.get("content-type") };
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function idsIn(data) {
  return unwrapList(data).map((row) => String(row.id));
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

async function setRoleModuleGrant(pool, roleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = 'announcements' AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [roleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'platform-ann', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', 'announcements', $2, $3, $4, FALSE, 'platform-ann')`,
    [roleKey, flags.create, flags.read, flags.update],
  );
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

function jpegBuffer() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
}

async function seed(pool) {
  const ci = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('PA Côte', 'CI', '+225', 'XOF') RETURNING id`,
  );
  const fr = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('PA France', 'FR', '+33', 'EUR') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-PA-A', 'École PA A', 'active'), ($2, 'SCH-PA-B', 'École PA B', 'active')`,
    [ci.rows[0].id, fr.rows[0].id],
  );
  const schoolA = (await pool.query(`SELECT id, login_code FROM schools WHERE school_code = 'SCH-PA-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id, login_code FROM schools WHERE school_code = 'SCH-PA-B'`)).rows[0];
  let loginA = String(schoolA?.login_code || "").trim();
  let loginB = String(schoolB?.login_code || "").trim();
  if (!loginA) {
    await pool.query(`UPDATE schools SET login_code = $1 WHERE school_code = 'SCH-PA-A'`, ["CI-PAA-26-001"]);
    loginA = "CI-PAA-26-001";
  }
  if (!loginB) {
    await pool.query(`UPDATE schools SET login_code = $1 WHERE school_code = 'SCH-PA-B'`, ["FR-PAB-26-001"]);
    loginB = "FR-PAB-26-001";
  }

  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'PA-STU-A', 'Élève', 'A', 'active')
     RETURNING id, student_code`,
    [schoolA.id],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, NULL, 'SUPER-PA', 'Super', 'Admin', 'super-pa@test.local', 'Super Administrateur Somafrik', 'active', FALSE),
       ($2, NULL, 'CADM-PA-A', 'Pays', 'A', 'pays-a@test.local', 'Admin Pays', 'active', FALSE),
       ($3, NULL, 'CADM-PA-B', 'Pays', 'B', 'pays-b@test.local', 'Admin Pays', 'active', FALSE),
       ($4, $10, 'SADM-PA-A', 'School', 'A', 'school-a@test.local', 'Admin School', 'active', FALSE),
       ($5, $11, 'SADM-PA-B', 'School', 'B', 'school-b@test.local', 'Admin School', 'active', FALSE),
       ($6, $10, 'TCH-PA-A', 'Teacher', 'A', 'tch-pa@test.local', 'Enseignant', 'active', FALSE),
       ($7, $10, 'PAR-PA-A', 'Parent', 'A', 'par-pa@test.local', 'Parent', 'active', FALSE),
       ($8, $10, $12, 'Élève', 'A', 'stu-pa@test.local', 'Élève / Étudiant', 'active', FALSE),
       ($9, $10, 'INA-PA', 'Inactif', 'U', 'ina-pa@test.local', 'Parent', 'inactive', FALSE)`,
    [
      SUPER_SA,
      COUNTRY_A,
      COUNTRY_B,
      SCHOOL_A,
      SCHOOL_B,
      TEACHER_A,
      PARENT_A,
      STUDENT_A,
      INACTIVE_U,
      schoolA.id,
      schoolB.id,
      student.rows[0].student_code,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, NULL, 'SUPER_ADMIN', 'active'),
       ($2, NULL, 'COUNTRY_ADMIN', 'active'),
       ($3, NULL, 'COUNTRY_ADMIN', 'active'),
       ($4, $10, 'SCHOOL_ADMIN', 'active'),
       ($5, $11, 'SCHOOL_ADMIN', 'active'),
       ($6, $10, 'TEACHER', 'active'),
       ($7, $10, 'PARENT', 'active'),
       ($8, $10, 'STUDENT', 'active'),
       ($9, $10, 'PARENT', 'active')`,
    [SUPER_SA, COUNTRY_A, COUNTRY_B, SCHOOL_A, SCHOOL_B, TEACHER_A, PARENT_A, STUDENT_A, INACTIVE_U, schoolA.id, schoolB.id],
  );
  await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'TCH-PA-A', 'active')`,
    [schoolA.id, TEACHER_A],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES ($1, $2, 'REV-PA', 'Révoqué', 'U', 'rev-pa@test.local', NULL, 'active', FALSE)`,
    [REVOKED_U, schoolA.id],
  );
  const existingRoles = await pool.query(`SELECT id FROM user_roles WHERE user_id = $1`, [REVOKED_U]);
  if (!existingRoles.rowCount) {
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'PARENT', 'active')`,
      [REVOKED_U, schoolA.id],
    );
  }
  await pool.query(
    `UPDATE user_roles
     SET status = 'revoked', revoked_at = NOW(), revoked_by = $2, updated_at = NOW()
     WHERE user_id = $1 AND (status = 'active' OR revoked_at IS NULL)`,
    [REVOKED_U, SUPER_SA],
  );

  await setRoleModuleGrant(pool, "SUPER_ADMIN", { create: true, read: true, update: true });
  await setRoleModuleGrant(pool, "COUNTRY_ADMIN", { create: false, read: true, update: false });
  await setRoleModuleGrant(pool, "SCHOOL_ADMIN", { create: true, read: true, update: true });
  await setRoleModuleGrant(pool, "TEACHER", { create: false, read: true, update: false });
  await setRoleModuleGrant(pool, "PARENT", { create: false, read: true, update: false });
  await setRoleModuleGrant(pool, "STUDENT", { create: false, read: true, update: false });

  return { schoolA: schoolA.id, schoolB: schoolB.id, loginA, loginB };
}

async function recipientIds(pool, announcementId) {
  const rows = await pool.query(
    `SELECT user_id::text AS id FROM platform_announcement_recipients WHERE announcement_id = $1 ORDER BY user_id`,
    [announcementId],
  );
  return rows.rows.map((row) => row.id);
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour platformAnnouncements.http.pg.test.js");
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
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = path.join(
    require("node:os").tmpdir(),
    `somafrik-platform-ann-${randomUUID()}`,
  );
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
    await pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()), revoked_by = $2, updated_at = NOW()
       WHERE user_id = $1 AND (status = 'active' OR revoked_at IS NULL)`,
      [REVOKED_U, SUPER_SA],
    );

    const superSa = mintAccess(tokens, {
      sub: SUPER_SA,
      schoolCode: "*",
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      permissions: SUPER_PERMS,
    });
    const countryA = mintAccess(tokens, {
      sub: COUNTRY_A,
      schoolCode: "*",
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      permissions: READ_PERMS,
    });
    const countryB = mintAccess(tokens, {
      sub: COUNTRY_B,
      schoolCode: "*",
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      permissions: READ_PERMS,
    });
    const schoolA = mintAccess(tokens, {
      sub: SCHOOL_A,
      schoolCode: fixtures.loginA,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: SCHOOL_WRITE,
    });
    const schoolB = mintAccess(tokens, {
      sub: SCHOOL_B,
      schoolCode: fixtures.loginB,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: SCHOOL_WRITE,
    });
    const teacherA = mintAccess(tokens, {
      sub: TEACHER_A,
      schoolCode: fixtures.loginA,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      permissions: READ_PERMS,
    });
    const parentA = mintAccess(tokens, {
      sub: PARENT_A,
      schoolCode: fixtures.loginA,
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions: READ_PERMS,
    });
    const studentA = mintAccess(tokens, {
      sub: STUDENT_A,
      schoolCode: fixtures.loginA,
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      permissions: READ_PERMS,
    });
    const inactive = mintAccess(tokens, {
      sub: INACTIVE_U,
      schoolCode: fixtures.loginA,
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions: READ_PERMS,
    });

    const pa01 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "administrative",
        audienceKey: "country_admins",
        title: "Admin pays",
        message: "Message pays",
      },
    });
    assert.equal(pa01.status, 201, `PA-01 publish: ${JSON.stringify(pa01.data)}`);
    const pa01Ids = await recipientIds(pool, pa01.data.id);
    assert.ok(pa01Ids.includes(COUNTRY_A) && pa01Ids.includes(COUNTRY_B), "PA-01 Admin Pays reçoivent");
    assert.ok(!pa01Ids.includes(SCHOOL_A), "PA-01 Admin School exclu");
    assert.ok(!pa01Ids.includes(PARENT_A), "PA-01 Parent exclu");
    assert.ok(!pa01Ids.includes(TEACHER_A), "PA-01 Enseignant exclu");
    assert.ok(!pa01Ids.includes(STUDENT_A), "PA-01 Élève exclu");
    assert.equal((await request(`/backoffice/platform-announcements/${pa01.data.id}`, { token: countryA })).status, 200);
    assert.ok([403, 404].includes((await request(`/backoffice/platform-announcements/${pa01.data.id}`, { token: schoolA })).status));

    const pa02 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "administrative",
        audienceKey: "school_admins",
        title: "Admin écoles",
        message: "Message écoles",
      },
    });
    assert.equal(pa02.status, 201, "PA-02 publish");
    const pa02Ids = await recipientIds(pool, pa02.data.id);
    assert.ok(pa02Ids.includes(SCHOOL_A) && pa02Ids.includes(SCHOOL_B), "PA-02 Admin School reçoivent");
    assert.ok(!pa02Ids.includes(COUNTRY_A), "PA-02 Admin Pays exclu");
    assert.ok(!pa02Ids.includes(TEACHER_A), "PA-02 autres rôles exclus");

    const pa03 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "administrative",
        audienceKey: "all_admins",
        title: "Tous admins",
        message: "Message admins",
      },
    });
    assert.equal(pa03.status, 201, "PA-03 publish");
    const pa03Ids = await recipientIds(pool, pa03.data.id);
    assert.equal(new Set(pa03Ids).size, pa03Ids.length, "PA-03 déduplication");
    assert.ok(pa03Ids.includes(COUNTRY_A) && pa03Ids.includes(SCHOOL_A), "PA-03 union Admin Pays + School");
    assert.ok(!pa03Ids.includes(PARENT_A), "PA-03 parent exclu");

    const pa04 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "system",
        audienceKey: "all_active_users",
        title: "Maintenance Somafrik samedi 30 août",
        message: "Somafrik sera indisponible de 22h00 à 23h00 pour une opération de maintenance.",
      },
    });
    assert.equal(pa04.status, 201, `PA-04 publish: ${JSON.stringify(pa04.data)}`);
    assert.equal(pa04.data.senderDisplayName, "Somafrik", "PA-11 senderDisplayName");
    assert.equal(pa04.data.createdByUserId, SUPER_SA, "PA-11 createdBy Superadmin réel");
    assert.equal(pa04.data.publishedByUserId, SUPER_SA, "PA-11 publishedBy Superadmin réel");
    const pa04Ids = await recipientIds(pool, pa04.data.id);
    for (const id of [COUNTRY_A, COUNTRY_B, SCHOOL_A, SCHOOL_B, TEACHER_A, PARENT_A, STUDENT_A, SUPER_SA]) {
      assert.ok(pa04Ids.includes(id), `PA-04 actif ${id}`);
    }
    assert.ok(!pa04Ids.includes(INACTIVE_U), "PA-04 inactive exclu");
    assert.ok(!pa04Ids.includes(REVOKED_U), "PA-13 user actif + tous rôles révoqués exclu");
    assert.equal(Number(pa04.data.recipientCount), pa04Ids.length, "PA-04 recipientCount = snapshot PG");
    assert.equal((await request(`/backoffice/platform-announcements/${pa04.data.id}`, { token: teacherA })).status, 200);
    assert.equal((await request(`/backoffice/platform-announcements/${pa04.data.id}`, { token: parentA })).status, 200);
    assert.equal((await request(`/backoffice/platform-announcements/${pa04.data.id}`, { token: studentA })).status, 200);
    assert.ok([403, 404].includes((await request(`/backoffice/platform-announcements/${pa04.data.id}`, { token: inactive })).status));

    const beforeCount = Number(
      (await pool.query(`SELECT count(*)::int AS c FROM platform_announcements`)).rows[0].c,
    );
    const beforeRecipients = Number(
      (await pool.query(`SELECT count(*)::int AS c FROM platform_announcement_recipients`)).rows[0].c,
    );
    const pa05 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: schoolA,
      body: {
        announcementType: "system",
        audienceKey: "all_active_users",
        title: "Forge",
        message: "Interdit",
      },
    });
    assert.equal(pa05.status, 403, `PA-05 non-Superadmin: ${pa05.status}`);
    const countryForge = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: countryA,
      body: {
        announcementType: "administrative",
        audienceKey: "all_admins",
        title: "Forge pays",
        message: "Interdit",
      },
    });
    assert.equal(countryForge.status, 403, "PA-05 Admin Pays 403");
    assert.equal(
      Number((await pool.query(`SELECT count(*)::int AS c FROM platform_announcements`)).rows[0].c),
      beforeCount,
      "PA-05 0 announcement",
    );
    assert.equal(
      Number((await pool.query(`SELECT count(*)::int AS c FROM platform_announcement_recipients`)).rows[0].c),
      beforeRecipients,
      "PA-05 0 recipient",
    );

    const pa06 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "administrative",
        audienceKey: "country_admins",
        title: "Ignore ids",
        message: "Serveur only",
        recipientIds: [TEACHER_A, PARENT_A],
      },
    });
    assert.equal(pa06.status, 400, `PA-06 recipientIds: ${pa06.status}`);
    const pa06Ok = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "administrative",
        audienceKey: "country_admins",
        title: "Snapshot serveur",
        message: "Sans ids client",
      },
    });
    assert.equal(pa06Ok.status, 201, "PA-06 snapshot serveur");
    const pa06Ids = await recipientIds(pool, pa06Ok.data.id);
    assert.ok(!pa06Ids.includes(TEACHER_A) && !pa06Ids.includes(PARENT_A), "PA-06 ids client ignorés");

    const unreadBefore = await request("/backoffice/platform-announcements/unread-count", { token: countryA });
    assert.equal(unreadBefore.status, 200, "PA-07 unread");
    const mark = await request(`/backoffice/platform-announcements/${pa01.data.id}/read`, {
      method: "PATCH",
      token: countryA,
    });
    assert.equal(mark.status, 200, "PA-07 mark read");
    assert.ok(mark.data.readAt, "PA-07 readAt");
    const unreadAfter = await request("/backoffice/platform-announcements/unread-count", { token: countryA });
    assert.ok(Number(unreadAfter.data.count) < Number(unreadBefore.data.count), "PA-07 unread décroît");
    const otherUnread = await request("/backoffice/platform-announcements/unread-count", { token: countryB });
    assert.ok(Number(otherUnread.data.count) >= 1, "PA-07 read individuel");

    const pa08 = await request(`/backoffice/platform-announcements/${pa01.data.id}`, { token: teacherA });
    assert.ok([403, 404].includes(pa08.status), `PA-08 non-recipient GET: ${pa08.status}`);
    const pa08Read = await request(`/backoffice/platform-announcements/${pa01.data.id}/read`, {
      method: "PATCH",
      token: teacherA,
    });
    assert.ok([403, 404].includes(pa08Read.status), "PA-08 non-recipient read");

    const idemKey = randomUUID();
    const idemBody = {
      announcementType: "administrative",
      audienceKey: "school_admins",
      title: "Idempotente",
      message: "une seule",
    };
    const firstIdem = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      headers: { "Idempotency-Key": idemKey },
      body: idemBody,
    });
    const secondIdem = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      headers: { "Idempotency-Key": idemKey },
      body: idemBody,
    });
    assert.ok([200, 201].includes(firstIdem.status), `PA-09 first: ${firstIdem.status}`);
    assert.ok([200, 201].includes(secondIdem.status), `PA-09 second: ${secondIdem.status}`);
    assert.equal(secondIdem.data.id, firstIdem.data.id, "PA-09 même annonce");
    const dupRecipients = Number(
      (
        await pool.query(
          `SELECT count(*)::int AS c FROM platform_announcement_recipients WHERE announcement_id = $1`,
          [firstIdem.data.id],
        )
      ).rows[0].c,
    );
    assert.equal(dupRecipients, (await recipientIds(pool, firstIdem.data.id)).length, "PA-09 pas de duplicate recipient");

    const pdfUp = await uploadFile(superSa, {
      fileName: "../../etc/passwd.pdf",
      mimeType: "application/pdf",
      body: pdfBuffer(),
    });
    assert.equal(pdfUp.status, 201, `PA-10 pdf: ${JSON.stringify(pdfUp.data)}`);
    assert.ok(!String(pdfUp.data.fileName ?? "").includes(".."), "PA-10 traversal neutralisé");
    const pngUp = await uploadFile(superSa, {
      fileName: "photo.png",
      mimeType: "image/png",
      body: pngBuffer(),
    });
    assert.equal(pngUp.status, 201, "PA-10 png");
    const jpegUp = await uploadFile(superSa, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      body: jpegBuffer(),
    });
    assert.equal(jpegUp.status, 201, "PA-10 jpeg");
    const badMime = await uploadFile(superSa, {
      fileName: "virus.exe",
      mimeType: "application/octet-stream",
      body: Buffer.from("MZ executable"),
    });
    assert.equal(badMime.status, 400, "PA-10 MIME invalide");
    const oversize = await uploadFile(superSa, {
      fileName: "big.pdf",
      mimeType: "application/pdf",
      body: Buffer.concat([pdfBuffer(), Buffer.alloc(10 * 1024 * 1024)]),
    });
    assert.equal(oversize.status, 400, "PA-10 oversize");

    const withFiles = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "administrative",
        audienceKey: "country_admins",
        title: "PJ",
        message: "avec fichiers",
        attachmentIds: [pdfUp.data.id, pngUp.data.id, jpegUp.data.id],
      },
    });
    assert.equal(withFiles.status, 201, `PA-10 bind: ${JSON.stringify(withFiles.data)}`);
    const pdfDl = await downloadFile(countryA, pdfUp.data.id);
    assert.equal(pdfDl.status, 200, "PA-10 recipient download");
    const teacherDl = await downloadFile(teacherA, pdfUp.data.id);
    assert.ok([403, 404].includes(teacherDl.status), "PA-10 non-recipient refusé");

    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       SELECT $1, 'BULK-PA-' || i, 'Bulk', i::text, 'bulk-pa-' || i || '@test.local', 'Parent', 'active', FALSE
       FROM generate_series(1, $2) AS i`,
      [fixtures.schoolA, BULK_ACTIVE_USERS],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       SELECT u.id, $1, 'PARENT', 'active'
       FROM users u
       WHERE u.user_code LIKE 'BULK-PA-%'`,
      [fixtures.schoolA],
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_ann_snapshot_probe (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE OR REPLACE FUNCTION platform_ann_probe_statement()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        INSERT INTO platform_ann_snapshot_probe(kind) VALUES ('recipient_insert_statement');
        RETURN NULL;
      END;
      $$;
      DROP TRIGGER IF EXISTS trg_platform_ann_recipients_statement ON platform_announcement_recipients;
      CREATE TRIGGER trg_platform_ann_recipients_statement
      AFTER INSERT ON platform_announcement_recipients
      FOR EACH STATEMENT
      EXECUTE FUNCTION platform_ann_probe_statement();
      TRUNCATE platform_ann_snapshot_probe;
    `);
    const pa14 = await request("/backoffice/platform-announcements", {
      method: "POST",
      token: superSa,
      body: {
        announcementType: "system",
        audienceKey: "all_active_users",
        title: "Snapshot set-based",
        message: "Publication globale sans INSERT unitaire.",
      },
    });
    assert.equal(pa14.status, 201, `PA-14 publish: ${JSON.stringify(pa14.data)}`);
    const pa14Ids = await recipientIds(pool, pa14.data.id);
    const statementCount = Number(
      (await pool.query(`SELECT count(*)::int AS c FROM platform_ann_snapshot_probe WHERE kind = 'recipient_insert_statement'`))
        .rows[0].c,
    );
    assert.equal(statementCount, 1, `PA-14 INSERT set-based (1 statement, pas N unitaires): ${statementCount}`);
    assert.ok(pa14Ids.length >= BULK_ACTIVE_USERS + 8, `PA-14 audience importante: ${pa14Ids.length}`);
    assert.ok(statementCount < pa14Ids.length, "PA-14 preuve: 1 statement << N destinataires");
    assert.equal(Number(pa14.data.recipientCount), pa14Ids.length, "PA-14 recipientCount sans reload JS");
    assert.ok(!pa14Ids.includes(REVOKED_U), "PA-13/PA-14 révoqué toujours exclu");
    assert.ok(!pa14Ids.includes(INACTIVE_U), "PA-14 inactive exclu");

    const c3Still = await request("/backoffice/announcements", { token: schoolA });
    assert.notEqual(c3Still.status, 500, "PA-12 C3 établissement toujours joignable");

    console.log("platformAnnouncements.http.pg.test.js GO — PA-01..PA-14");
  } finally {
    await stopChild(child);
    await pool.end();
    await repo.close?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
