"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { drainOutbox } = require("./communicationsNotificationsService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_COM_C4_IT_DATABASE ?? "somafrik_com_c4_it")
  .trim().replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_COM_C4_HTTP_PORT ?? 19885);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ADMIN_A = "a4000000-0000-4000-8000-000000000001";
const PARENT_A = "a4000000-0000-4000-8000-000000000002";
const PARENT_A2 = "a4000000-0000-4000-8000-000000000003";
const STUDENT_USER_A = "a4000000-0000-4000-8000-000000000004";
const ADMIN_B = "b4000000-0000-4000-8000-000000000001";
const PARENT_B = "b4000000-0000-4000-8000-000000000002";
const SUPER_SA = "c4000000-0000-4000-8000-000000000001";
const CLASS_A = "d4000000-0000-4000-8000-000000000001";
const TEACHER_ROW_A = "e4000000-0000-4000-8000-000000000001";
const SUBJECT_A = "f4000000-0000-4000-8000-000000000001";
const TERM_A = "14000000-0000-4000-8000-000000000001";
const YEAR_A = "24000000-0000-4000-8000-000000000001";
const STUDENT_A = "34000000-0000-4000-8000-000000000001";
const STUDENT_A2 = "34000000-0000-4000-8000-000000000002";

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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function uploadNotificationFile(token, { fileName, mimeType, body, query = "" }) {
  const response = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/internal-notifications/attachments${query}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType, "X-Filename": fileName },
      body,
    },
  );
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function downloadNotificationFile(token, attachmentId, query = "") {
  const response = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/internal-notifications/attachments/${encodeURIComponent(attachmentId)}${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
}

function unwrap(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early ${child.exitCode}\n${stderrRef.value}`);
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.on("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function setRoleModuleGrant(pool, roleKey, moduleKey, { create = false, read = false, update = false } = {}) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key)=upper($1) AND module_key=$2 AND scope_type='global' AND status='active' LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions SET can_create=$2, can_read=$3, can_update=$4, can_delete=FALSE, updated_at=NOW()
       WHERE id=$1`,
      [existing.rows[0].id, create, read, update],
    );
  } else {
    await pool.query(
      `INSERT INTO role_module_permissions
       (role_key,scope_type,module_key,can_create,can_read,can_update,can_delete,updated_by)
       VALUES ($1,'global',$2,$3,$4,$5,FALSE,'com-c4')`,
      [roleKey, moduleKey, create, read, update],
    );
  }
}

function mint(tokens, overrides) {
  return tokens.createAccessToken({
    mustChangePassword: false,
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Notifications:READ", "Notifications:CREATE", "Notifications:UPDATE"],
    ...overrides,
  });
}

async function seed(pool) {
  const countryA = (await pool.query(
    `INSERT INTO countries (name,iso_code,phone_code,currency) VALUES ('C4 A','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  const countryB = (await pool.query(
    `INSERT INTO countries (name,iso_code,phone_code,currency) VALUES ('C4 B','FR','+33','EUR') RETURNING id`,
  )).rows[0].id;
  const schoolA = (await pool.query(
    `INSERT INTO schools (country_id,school_code,name,status) VALUES ($1,'SCH-C4-A','École C4 A','active') RETURNING id`,
    [countryA],
  )).rows[0].id;
  const schoolB = (await pool.query(
    `INSERT INTO schools (country_id,school_code,name,status) VALUES ($1,'SCH-C4-B','École C4 B','active') RETURNING id`,
    [countryB],
  )).rows[0].id;

  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status,must_change_password) VALUES
      ($1,$7,'ADM-C4-A','Admin','A','adm-c4-a@test.local','Admin School','active',FALSE),
      ($2,$7,'PAR-C4-A','Parent','A','par-c4-a@test.local','Parent','active',FALSE),
      ($3,$7,'PAR-C4-A2','Parent','A2','par-c4-a2@test.local','Parent','active',FALSE),
      ($4,$8,'ADM-C4-B','Admin','B','adm-c4-b@test.local','Admin School','active',FALSE),
      ($5,$8,'PAR-C4-B','Parent','B','par-c4-b@test.local','Parent','active',FALSE),
      ($6,NULL,'SUPER-C4','Super','Admin','super-c4@test.local','Super Administrateur Somafrik','active',FALSE)`,
    [ADMIN_A,PARENT_A,PARENT_A2,ADMIN_B,PARENT_B,SUPER_SA,schoolA,schoolB],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,school_id,role_key,status) VALUES
      ($1,$7,'SCHOOL_ADMIN','active'),($2,$7,'PARENT','active'),($3,$7,'PARENT','active'),
      ($4,$8,'SCHOOL_ADMIN','active'),($5,$8,'PARENT','active'),($6,NULL,'SUPER_ADMIN','active')`,
    [ADMIN_A,PARENT_A,PARENT_A2,ADMIN_B,PARENT_B,SUPER_SA,schoolA,schoolB],
  );

  await pool.query(
    `INSERT INTO academic_years (id,school_id,name,status) VALUES ($1,$2,'2025-2026','open')`,
    [YEAR_A, schoolA],
  );
  await pool.query(
    `INSERT INTO terms (id,academic_year_id,name,start_date,end_date,status)
     VALUES ($1,$2,'Trimestre 1','2025-09-01','2025-12-31','active')`,
    [TERM_A, YEAR_A],
  );
  await pool.query(
    `INSERT INTO classes (id,school_id,academic_year_id,class_code,name,status) VALUES ($1,$2,$3,'C4-CLS-A','6ème A','active')`,
    [CLASS_A, schoolA, YEAR_A],
  );
  await pool.query(
    `INSERT INTO subjects (id,school_id,subject_code,name,status) VALUES ($1,$2,'C4-MATH','Mathématiques','active')`,
    [SUBJECT_A, schoolA],
  );
  await pool.query(
    `INSERT INTO teachers (id,school_id,user_id,teacher_code,status) VALUES ($1,$2,$3,'C4-TCH-A','active')`,
    [TEACHER_ROW_A, schoolA, ADMIN_A],
  );
  await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status) VALUES
      ($1,$3,'STU-C4-A','Élève','A','active'),($2,$3,'STU-C4-A2','Élève','A2','active')`,
    [STUDENT_A, STUDENT_A2, schoolA],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status,must_change_password)
     VALUES ($1,$2,'STU-C4-A','Élève','A','stu-c4-a@test.local','Élève / Étudiant','active',FALSE)`,
    [STUDENT_USER_A, schoolA],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,school_id,role_key,status) VALUES ($1,$2,'STUDENT','active')`,
    [STUDENT_USER_A, schoolA],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,status)
     VALUES ($1,$2,$3,$4,'2025-09-01','active'),($1,$5,$3,$4,'2025-09-01','active')`,
    [schoolA, STUDENT_A, CLASS_A, YEAR_A, STUDENT_A2],
  );

  const contactA = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','A','Parent','+22501010101','active',$3) RETURNING id`,
    [schoolA,countryA,PARENT_A],
  )).rows[0].id;
  const contactA2 = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','A2','Parent','+22502020202','active',$3) RETURNING id`,
    [schoolA,countryA,PARENT_A2],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO contact_relations (school_id,country_id,relation_type,contact_id,student_id,status)
     VALUES ($1,$2,'parent_student',$3,$4,'active'),($1,$2,'parent_student',$5,$6,'active')`,
    [schoolA,countryA,contactA,STUDENT_A,contactA2,STUDENT_A2],
  );

  for (const role of ["SCHOOL_ADMIN","PARENT","STUDENT","SUPER_ADMIN"]) {
    await setRoleModuleGrant(pool, role, "notifications", { create: role === "SCHOOL_ADMIN" || role === "SUPER_ADMIN", read: true, update: role === "SCHOOL_ADMIN" || role === "SUPER_ADMIN" });
  }
  await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "messages", { create: true, read: true, update: true });
  await setRoleModuleGrant(pool, "PARENT", "messages", { create: true, read: true, update: true });

  return { schoolA, schoolB, countryA };
}

async function count(pool, sql, params = []) {
  return Number((await pool.query(sql, params)).rows[0].c || 0);
}

async function main() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL requis pour communicationsC4.http.pg.test.js");
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally { await reset.end(); }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = path.join(os.tmpdir(), `somafrik-c4-${randomUUID()}`);
  const repo = createPostgresRepository(isolatedUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  const tokens = new TokenService({ secret: JWT_SECRET });
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
        SOMAFRIK_COMMUNICATION_STORAGE: process.env.SOMAFRIK_COMMUNICATION_STORAGE,
        COMMUNICATION_NOTIFICATIONS_WORKER: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => { stderrRef.value += String(chunk); });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderrRef);

    const adminA = mint(tokens, { sub: ADMIN_A, schoolCode: "SCH-C4-A", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] });
    const parentA = mint(tokens, { sub: PARENT_A, schoolCode: "SCH-C4-A", role: "Parent", roleKeys: ["PARENT"], permissions: ["Notifications:READ","Messages:READ","Messages:CREATE"] });
    const parentA2 = mint(tokens, { sub: PARENT_A2, schoolCode: "SCH-C4-A", role: "Parent", roleKeys: ["PARENT"], permissions: ["Notifications:READ"] });
    const studentA = mint(tokens, { sub: STUDENT_USER_A, schoolCode: "SCH-C4-A", role: "Élève / Étudiant", roleKeys: ["STUDENT"], permissions: ["Notifications:READ"] });
    const adminB = mint(tokens, { sub: ADMIN_B, schoolCode: "SCH-C4-B", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] });
    const parentB = mint(tokens, { sub: PARENT_B, schoolCode: "SCH-C4-B", role: "Parent", roleKeys: ["PARENT"], permissions: ["Notifications:READ"] });
    const superSa = mint(tokens, { sub: SUPER_SA, schoolCode: "*", role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], permissions: ["ALL_PRIVILEGES"] });

    // C4-01 — vrai POST Message -> outbox -> notification Parent A uniquement.
    const message = await request("/backoffice/conversations", {
      method: "POST", token: adminA,
      body: { message: "Message C4", participantUserIds: [PARENT_A] },
    });
    assert.equal(message.status, 201, `C4-01 message: ${JSON.stringify(message.data)}`);
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_event_outbox WHERE event_type='communication.message.created' AND source_entity_id=$1`, [message.data.id]), 1);
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
    const parentAfterMessage = await request("/backoffice/internal-notifications", { token: parentA });
    assert.equal(parentAfterMessage.status, 200, `C4-01 list: ${JSON.stringify(parentAfterMessage.data)}`);
    const messageN = unwrap(parentAfterMessage.data).find((row) => row.sourceEntityId === message.data.id);
    assert.ok(messageN, "C4-01 notification message Parent A");
    assert.equal(messageN.eventType, "communication.message.created");
    assert.equal(messageN.senderType, "system");
    assert.equal(messageN.senderUserId, null);
    assert.equal(messageN.senderName, "Somafrik");
    assert.match(messageN.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
    const adminOwnMessageN = unwrap((await request("/backoffice/internal-notifications", { token: adminA })).data)
      .find((row) => row.sourceEntityId === message.data.id);
    assert.equal(adminOwnMessageN, undefined, "C4-01 expéditeur non destinataire");
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_notifications WHERE event_key=$1`, [`communication.message.created:${message.data.id}`]), 1, "C4-13 retry sans doublon");

    // C4-02 — annonce : destinataires exactement snapshot C3.
    const announcementId = randomUUID();
    await pool.query("BEGIN");
    try {
      await pool.query(
        `INSERT INTO announcements (id,school_id,title,message,created_by,published_by,published_at,status,audience_payload)
         VALUES ($1,$2,'Annonce C4','Parents ciblés',$3,$3,NOW(),'published',$4::jsonb)`,
        [announcementId, fixtures.schoolA, ADMIN_A, JSON.stringify({ scope: "classes", classIds: [CLASS_A], recipientKinds: ["parent"] })],
      );
      await pool.query(
        `INSERT INTO announcement_recipients (announcement_id,school_id,user_id,recipient_kind,created_at)
         VALUES ($1,$2,$3,'parent',NOW()),($1,$2,$4,'staff',NOW())`,
        [announcementId, fixtures.schoolA, PARENT_A, ADMIN_A],
      );
      await pool.query("COMMIT");
    } catch (error) { await pool.query("ROLLBACK"); throw error; }
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 Parent A reçoit annonce");
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: adminA })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 auteur présent dans snapshot reçoit annonce");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentA2 })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 Parent A2 hors snapshot");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentB })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 école B isolée");

    // C4-03 — absence -> parent lié uniquement.
    const attendanceId = randomUUID();
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-08-28','absent',$5)`,
      [attendanceId,fixtures.schoolA,STUDENT_A,CLASS_A,ADMIN_A],
    );
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).some((row) => row.sourceEntityId === attendanceId), "C4-03 parent lié reçoit absence");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentA2 })).data).some((row) => row.sourceEntityId === attendanceId), "C4-03 parent non lié exclu");

    // C4-04 — note publiée -> parent + élève, contenu sans score.
    const gradeId = randomUUID();
    await pool.query(
      `INSERT INTO grades
       (id,school_id,student_id,class_id,subject_id,teacher_id,term_id,grade_type,score,max_score,grade_status,publication_status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Devoir',14,20,'graded','published',$8)`,
      [gradeId,fixtures.schoolA,STUDENT_A,CLASS_A,SUBJECT_A,TEACHER_ROW_A,TERM_A,ADMIN_A],
    );
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
    const parentGrade = unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).find((row) => row.sourceEntityId === gradeId);
    const studentGrade = unwrap((await request("/backoffice/internal-notifications", { token: studentA })).data).find((row) => row.sourceEntityId === gradeId);
    assert.ok(parentGrade && studentGrade, "C4-04 parent + élève reçoivent note");
    assert.ok(!String(parentGrade.body).includes("14"), "C4-04 score non exposé dans le corps");

    // C4-05 — paiement paid -> parent lié, retry idempotent.
    const paymentId = randomUUID();
    await pool.query(
      `INSERT INTO payments
       (id,school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date,created_by)
       VALUES ($1,$2,$3,'PAY-C4-001',100,'XOF','cash','paid','2026-08-28',$4)`,
      [paymentId,fixtures.schoolA,STUDENT_A,ADMIN_A],
    );
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).some((row) => row.sourceEntityId === paymentId), "C4-05 paiement Parent A");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentA2 })).data).some((row) => row.sourceEntityId === paymentId), "C4-05 paiement Parent A2 exclu");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_notifications WHERE event_key=$1`, [`finance.payment.recorded:${paymentId}`]), 1);

    // C4-06 — read individuel + réponse immédiate.
    const beforeUnread = await request("/backoffice/internal-notifications/unread-count", { token: parentA });
    assert.equal(beforeUnread.status, 200);
    assert.ok(beforeUnread.data.count >= 4, "C4-06 plusieurs unread");
    const markRead = await request(`/backoffice/internal-notifications/${messageN.id}/read`, { method: "PATCH", token: parentA });
    assert.equal(markRead.status, 200, `C4-06 mark read: ${JSON.stringify(markRead.data)}`);
    assert.match(markRead.data.readAt, /^\d{4}-\d{2}-\d{2}T/, "C4-06 readAt immédiat ISO");
    const afterUnread = await request("/backoffice/internal-notifications/unread-count", { token: parentA });
    assert.equal(afterUnread.data.count, beforeUnread.data.count - 1);

    // C4-09/10 — notification humaine + PJ sécurisée.
    const pdf = Buffer.from("%PDF-1.4\nC4\n%%EOF\n");
    const upload = await uploadNotificationFile(adminA, { fileName: "c4.pdf", mimeType: "application/pdf", body: pdf });
    assert.equal(upload.status, 201, `C4-10 upload ${JSON.stringify(upload.data)}`);
    const manualKey = randomUUID();
    const manual = await request("/backoffice/internal-notifications", {
      method: "POST", token: adminA,
      headers: { "Idempotency-Key": manualKey },
      body: { title: "Document C4", body: "Document disponible", recipientKinds: ["parent"], attachmentIds: [upload.data.id] },
    });
    assert.equal(manual.status, 201, `C4-09 manual ${JSON.stringify(manual.data)}`);
    assert.equal(manual.data.senderType, "user");
    assert.equal(manual.data.senderUserId, ADMIN_A);
    assert.equal(manual.data.senderName, "Admin A");
    const manualRetry = await request("/backoffice/internal-notifications", {
      method: "POST", token: adminA,
      headers: { "Idempotency-Key": manualKey },
      body: { title: "Document C4", body: "Document disponible", recipientKinds: ["parent"], attachmentIds: [upload.data.id] },
    });
    assert.equal(manualRetry.status, 201);
    assert.equal(manualRetry.data.id, manual.data.id, "C4-13 idempotence manuelle");
    const parentManual = unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).find((row) => row.id === manual.data.id);
    assert.ok(parentManual?.attachments?.length === 1, "C4-10 PJ visible recipient");
    const parentDownload = await downloadNotificationFile(parentA, upload.data.id);
    assert.equal(parentDownload.status, 200, "C4-10 recipient télécharge");
    const bDownload = await downloadNotificationFile(parentB, upload.data.id);
    assert.ok([403,404].includes(bDownload.status), "C4-10 école B bloquée");

    // C4-11 — révocation live Notifications:READ, même JWT.
    await setRoleModuleGrant(pool, "PARENT", "notifications", { read: false, create: false, update: false });
    const revokedList = await request("/backoffice/internal-notifications", { token: parentA });
    assert.equal(revokedList.status, 403, "C4-11 READ révoqué live");
    const revokedDownload = await downloadNotificationFile(parentA, upload.data.id);
    assert.equal(revokedDownload.status, 403, "C4-11 PJ refusée après revoke même si recipient");
    await setRoleModuleGrant(pool, "PARENT", "notifications", { read: true, create: false, update: false });

    // C4-12 — Superadmin request-scoped.
    const superBare = await request("/backoffice/internal-notifications", { token: superSa });
    assert.equal(superBare.status, 400, "C4-12 super * sans établissement");
    const superA = await request("/backoffice/internal-notifications?effectiveSchoolCode=SCH-C4-A", { token: superSa });
    assert.equal(superA.status, 200, "C4-12 super scoped A");
    const superWrong = await request(`/backoffice/internal-notifications/${messageN.id}?effectiveSchoolCode=SCH-C4-B`, { token: superSa });
    assert.ok([403,404].includes(superWrong.status), "C4-12 ressource A sous scope B refusée");

    // C4-15 — IDOR même école non destinataire.
    const parentA2Direct = await request(`/backoffice/internal-notifications/${messageN.id}`, { token: parentA2 });
    assert.ok([403,404].includes(parentA2Direct.status), "C4-15 non-destinataire même école");
    const adminBDirect = await request(`/backoffice/internal-notifications/${messageN.id}`, { token: adminB });
    assert.ok([403,404].includes(adminBDirect.status), "C4-15 école B");

    // C4-16 — archive utilisateur, historique physique conservé.
    const archiveResult = await request(`/backoffice/internal-notifications/${messageN.id}/archive`, { method: "PATCH", token: parentA });
    assert.equal(archiveResult.status, 200);
    assert.match(archiveResult.data.archivedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_notifications WHERE id=$1`, [messageN.id]), 1, "C4-16 notification non supprimée");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM notification_recipients WHERE notification_id=$1 AND user_id=$2 AND archived_at IS NOT NULL`, [messageN.id,PARENT_A]), 1);

    // C4-14 — rollback : trigger event fait partie de la transaction métier.
    const rollbackAttendance = randomUUID();
    await pool.query("BEGIN");
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-08-29','absent',$5)`,
      [rollbackAttendance,fixtures.schoolA,STUDENT_A,CLASS_A,ADMIN_A],
    );
    await pool.query("ROLLBACK");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_event_outbox WHERE source_entity_id=$1`, [rollbackAttendance]), 0, "C4-14 rollback sans event");

    console.log("COM-C4 GO — notifications internes, outbox, read/unread, tenant, RBAC et PJ validés.");
  } finally {
    await stopChild(child);
    await pool.end();
    await repo.close?.();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
