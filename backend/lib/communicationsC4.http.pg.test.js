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

async function downloadCrossTypeAttachment(token, entity, attachmentId) {
  const response = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/api/backoffice/${entity}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: response.status };
}

function pdfBuffer() {
  return Buffer.from("%PDF-1.4\nC4\n%%EOF\n");
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
    `INSERT INTO schools (country_id,school_code,login_code,name,status) VALUES ($1,'CI-ECA-26-001','CI-ECA-26-001','École C4 A','active') RETURNING id`,
    [countryA],
  )).rows[0].id;
  const schoolB = (await pool.query(
    `INSERT INTO schools (country_id,school_code,login_code,name,status) VALUES ($1,'FR-ECB-26-001','FR-ECB-26-001','École C4 B','active') RETURNING id`,
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
  const studentARow = (await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status)
     VALUES ($1,$2,'PENDING','Élève','A','active') RETURNING id, student_code`,
    [STUDENT_A, schoolA],
  )).rows[0];
  const studentA2Row = (await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status)
     VALUES ($1,$2,'PENDING','Élève','A2','active') RETURNING id, student_code`,
    [STUDENT_A2, schoolA],
  )).rows[0];
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status,must_change_password)
     VALUES ($1,$2,$3,'Élève','A','stu-c4-a@test.local','Élève / Étudiant','active',FALSE)`,
    [STUDENT_USER_A, schoolA, studentARow.student_code],
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
  await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "announcements", { create: true, read: true, update: true });
  await setRoleModuleGrant(pool, "PARENT", "announcements", { create: false, read: true, update: false });

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

    const adminA = mint(tokens, { sub: ADMIN_A, schoolCode: "CI-ECA-26-001", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] });
    const parentA = mint(tokens, { sub: PARENT_A, schoolCode: "CI-ECA-26-001", role: "Parent", roleKeys: ["PARENT"], permissions: ["Notifications:READ","Messages:READ","Messages:CREATE","Announcements:READ"] });
    const parentA2 = mint(tokens, { sub: PARENT_A2, schoolCode: "CI-ECA-26-001", role: "Parent", roleKeys: ["PARENT"], permissions: ["Notifications:READ"] });
    const studentA = mint(tokens, { sub: STUDENT_USER_A, schoolCode: "CI-ECA-26-001", role: "Élève / Étudiant", roleKeys: ["STUDENT"], permissions: ["Notifications:READ"] });
    const adminB = mint(tokens, { sub: ADMIN_B, schoolCode: "FR-ECB-26-001", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] });
    const parentB = mint(tokens, { sub: PARENT_B, schoolCode: "FR-ECB-26-001", role: "Parent", roleKeys: ["PARENT"], permissions: ["Notifications:READ"] });
    const superSa = mint(tokens, { sub: SUPER_SA, schoolCode: "*", role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], permissions: ["ALL_PRIVILEGES"] });

    const store = repo.getClientsStore();
    async function outboxCount(sourceId) {
      return count(pool, `SELECT count(*)::int c FROM communication_event_outbox WHERE source_entity_id=$1`, [sourceId]);
    }
    async function notificationCount(eventKey) {
      return count(pool, `SELECT count(*)::int c FROM communication_notifications WHERE event_key=$1`, [eventKey]);
    }

    // C4-01 — vrai POST Message -> outbox -> notification Parent A uniquement.
    const message = await request("/backoffice/conversations", {
      method: "POST", token: adminA,
      body: { message: "Message C4", participantUserIds: [PARENT_A] },
    });
    assert.equal(message.status, 201, `C4-01 message: ${JSON.stringify(message.data)}`);
    assert.equal(await count(pool, `SELECT count(*)::int c FROM school_messages WHERE id=$1`, [message.data.id]), 1, "C4-01 school_messages persisté");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_event_outbox WHERE event_type='communication.message.created' AND source_entity_id=$1`, [message.data.id]), 1);
    await drainOutbox(store, { limit: 20 });
    const parentAfterMessage = await request("/backoffice/internal-notifications", { token: parentA });
    assert.equal(parentAfterMessage.status, 200, `C4-01 list: ${JSON.stringify(parentAfterMessage.data)}`);
    const messageN = unwrap(parentAfterMessage.data).find((row) => row.sourceEntityId === message.data.id);
    assert.ok(messageN, "C4-01 notification message Parent A");
    assert.equal(messageN.eventType, "communication.message.created");
    assert.equal(messageN.senderType, "system");
    assert.equal(messageN.senderUserId, null);
    assert.equal(messageN.senderName, "Somafrik");
    assert.match(messageN.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(messageN.navigationTarget?.type, "conversation", "C4-01 navigation conversation exacte");
    assert.ok(messageN.navigationTarget?.conversationId, "C4-01 conversationId présent");
    const adminOwnMessageN = unwrap((await request("/backoffice/internal-notifications", { token: adminA })).data)
      .find((row) => row.sourceEntityId === message.data.id);
    assert.equal(adminOwnMessageN, undefined, "C4-01 expéditeur non destinataire");
    await drainOutbox(store, { limit: 20 });
    assert.equal(await notificationCount(`communication.message.created:${message.data.id}`), 1, "C4-13 retry dispatcher sans doublon");

    // C4-02 — annonce : destinataires exactement snapshot C3, y compris l'auteur.
    const announcementDraftId = randomUUID();
    await pool.query(
      `INSERT INTO announcements (id,school_id,title,message,created_by,status,audience_payload)
       VALUES ($1,$2,'Brouillon C4','Pas encore',$3,'draft','{}'::jsonb)`,
      [announcementDraftId, fixtures.schoolA, ADMIN_A],
    );
    assert.equal(await outboxCount(announcementDraftId), 0, "C4-02 draft sans outbox");

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
    await drainOutbox(store, { limit: 20 });
    const announcementRecipients = (await pool.query(
      `SELECT user_id FROM announcement_recipients WHERE announcement_id=$1 ORDER BY user_id`, [announcementId],
    )).rows.map((row) => row.user_id);
    const notificationRecipients = (await pool.query(
      `SELECT r.user_id FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.source_entity_id=$1 ORDER BY r.user_id`, [announcementId],
    )).rows.map((row) => row.user_id);
    assert.deepEqual(notificationRecipients, announcementRecipients, "C4-02 snapshot announcement_recipients exact");
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 Parent A reçoit annonce");
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: adminA })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 auteur présent dans snapshot reçoit annonce");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentA2 })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 Parent A2 hors snapshot");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentB })).data).some((row) => row.sourceEntityId === announcementId), "C4-02 école B isolée");

    await pool.query(`UPDATE announcements SET title='Annonce C4 modifiée' WHERE id=$1`, [announcementId]);
    await pool.query(`UPDATE announcements SET status='published' WHERE id=$1`, [announcementId]);
    assert.equal(await outboxCount(announcementId), 1, "C4-02 UPDATE déjà published n'ajoute pas d'event");
    await drainOutbox(store, { limit: 20 });
    assert.equal(await notificationCount(`communication.announcement.published:${announcementId}`), 1, "C4-02 UPDATE published sans nouvelle notification");

    await pool.query(`UPDATE announcements SET status='published', published_by=$2, published_at=NOW() WHERE id=$1`, [announcementDraftId, ADMIN_A]);
    await pool.query(
      `INSERT INTO announcement_recipients (announcement_id,school_id,user_id,recipient_kind,created_at)
       VALUES ($1,$2,$3,'parent',NOW())`,
      [announcementDraftId, fixtures.schoolA, PARENT_A],
    );
    assert.equal(await outboxCount(announcementDraftId), 1, "C4-02 première publication d'un draft émet 1 event");
    await drainOutbox(store, { limit: 20 });

    // C4-03 — absence -> parent lié uniquement.
    const attendanceId = randomUUID();
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-08-28','absent',$5)`,
      [attendanceId,fixtures.schoolA,STUDENT_A,CLASS_A,ADMIN_A],
    );
    await drainOutbox(store, { limit: 20 });
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).some((row) => row.sourceEntityId === attendanceId), "C4-03 parent lié reçoit absence");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentA2 })).data).some((row) => row.sourceEntityId === attendanceId), "C4-03 parent non lié exclu");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentB })).data).some((row) => row.sourceEntityId === attendanceId), "C4-03 école B isolée");
    await pool.query(`UPDATE attendance SET status='absent' WHERE id=$1`, [attendanceId]);
    assert.equal(await outboxCount(attendanceId), 1, "C4-03 UPDATE absent identique sans nouvel event");

    // C4-04 — note publiée -> parent + élève, contenu sans score. Draft/UPDATE idempotents.
    const draftGradeId = randomUUID();
    await pool.query(
      `INSERT INTO grades
       (id,school_id,student_id,class_id,subject_id,teacher_id,term_id,grade_type,score,max_score,grade_status,publication_status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Devoir',9,20,'graded','draft',$8)`,
      [draftGradeId,fixtures.schoolA,STUDENT_A,CLASS_A,SUBJECT_A,TEACHER_ROW_A,TERM_A,ADMIN_A],
    );
    assert.equal(await outboxCount(draftGradeId), 0, "C4-04 grade draft sans notification");
    await pool.query(`UPDATE grades SET score=11 WHERE id=$1`, [draftGradeId]);
    assert.equal(await outboxCount(draftGradeId), 0, "C4-04 UPDATE score d'un draft sans event");

    const gradeId = randomUUID();
    await pool.query(
      `INSERT INTO grades
       (id,school_id,student_id,class_id,subject_id,teacher_id,term_id,grade_type,score,max_score,grade_status,publication_status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Devoir',14,20,'graded','published',$8)`,
      [gradeId,fixtures.schoolA,STUDENT_A,CLASS_A,SUBJECT_A,TEACHER_ROW_A,TERM_A,ADMIN_A],
    );
    await drainOutbox(store, { limit: 20 });
    const parentGrade = unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).find((row) => row.sourceEntityId === gradeId);
    const studentGrade = unwrap((await request("/backoffice/internal-notifications", { token: studentA })).data).find((row) => row.sourceEntityId === gradeId);
    assert.ok(parentGrade && studentGrade, "C4-04 parent + élève reçoivent note");
    assert.ok(!String(parentGrade.body).includes("14"), "C4-04 score non exposé dans le corps");
    assert.ok(!String(parentGrade.body).includes("20"), "C4-04 max score non exposé");
    await pool.query(`UPDATE grades SET score=16, publication_status='published' WHERE id=$1`, [gradeId]);
    assert.equal(await outboxCount(gradeId), 1, "C4-04 UPDATE note déjà published sans nouvel event");
    await drainOutbox(store, { limit: 20 });
    assert.equal(await notificationCount(`pedagogy.grade.published:${gradeId}`), 1);

    await pool.query(`UPDATE grades SET publication_status='published' WHERE id=$1`, [draftGradeId]);
    assert.equal(await outboxCount(draftGradeId), 1, "C4-04 première publication d'un draft émet 1 event");
    await drainOutbox(store, { limit: 20 });

    // C4-05 — paiement paid -> parent lié. Pending et UPDATE déjà paid n'émettent pas.
    const pendingPaymentId = randomUUID();
    await pool.query(
      `INSERT INTO payments
       (id,school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date,created_by)
       VALUES ($1,$2,$3,'PAY-C4-PEND',50,'XOF','cash','pending','2026-08-28',$4)`,
      [pendingPaymentId,fixtures.schoolA,STUDENT_A,ADMIN_A],
    );
    assert.equal(await outboxCount(pendingPaymentId), 0, "C4-05 pending sans notification");

    const paymentId = randomUUID();
    await pool.query(
      `INSERT INTO payments
       (id,school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date,created_by)
       VALUES ($1,$2,$3,'PAY-C4-001',100,'XOF','cash','paid','2026-08-28',$4)`,
      [paymentId,fixtures.schoolA,STUDENT_A,ADMIN_A],
    );
    await drainOutbox(store, { limit: 20 });
    assert.ok(unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data).some((row) => row.sourceEntityId === paymentId), "C4-05 paiement Parent A");
    assert.ok(!unwrap((await request("/backoffice/internal-notifications", { token: parentA2 })).data).some((row) => row.sourceEntityId === paymentId), "C4-05 paiement Parent A2 exclu");
    assert.equal(await notificationCount(`finance.payment.recorded:${paymentId}`), 1);
    await pool.query(`UPDATE payments SET amount=180, payment_status='paid' WHERE id=$1`, [paymentId]);
    assert.equal(await outboxCount(paymentId), 1, "C4-05 UPDATE déjà paid sans nouvel event");
    await drainOutbox(store, { limit: 20 });
    assert.equal(await notificationCount(`finance.payment.recorded:${paymentId}`), 1, "C4-05 retry sans doublon");

    await pool.query(`UPDATE payments SET payment_status='paid' WHERE id=$1`, [pendingPaymentId]);
    assert.equal(await outboxCount(pendingPaymentId), 1, "C4-05 passage pending→paid émet 1 event");
    await drainOutbox(store, { limit: 20 });

    // C4-06 — read individuel + réponse immédiate. Autre destinataire inchangé.
    const announcementRow = unwrap((await request("/backoffice/internal-notifications", { token: parentA })).data)
      .find((row) => row.sourceEntityId === announcementId);
    assert.ok(announcementRow, "C4-06 annonce visible Parent A");
    const beforeUnread = await request("/backoffice/internal-notifications/unread-count", { token: parentA });
    assert.equal(beforeUnread.status, 200);
    assert.ok(beforeUnread.data.count >= 4, "C4-06 plusieurs unread");
    const adminUnreadBefore = await request("/backoffice/internal-notifications/unread-count", { token: adminA });
    const markRead = await request(`/backoffice/internal-notifications/${announcementRow.id}/read`, { method: "PATCH", token: parentA });
    assert.equal(markRead.status, 200, `C4-06 mark read: ${JSON.stringify(markRead.data)}`);
    assert.match(markRead.data.readAt, /^\d{4}-\d{2}-\d{2}T/, "C4-06 readAt immédiat ISO");
    const afterUnread = await request("/backoffice/internal-notifications/unread-count", { token: parentA });
    assert.equal(afterUnread.data.count, beforeUnread.data.count - 1);
    const adminUnreadAfter = await request("/backoffice/internal-notifications/unread-count", { token: adminA });
    assert.equal(adminUnreadAfter.data.count, adminUnreadBefore.data.count, "C4-06 autre destinataire inchangé");

    // C4-07 — convergence API Web/Mobile : même notification, même readAt, même unread.
    const parentGet = await request(`/backoffice/internal-notifications/${announcementRow.id}`, { token: parentA });
    assert.equal(parentGet.status, 200);
    assert.equal(parentGet.data.readAt, markRead.data.readAt, "C4-07 même readAt via GET");
    assert.equal(parentGet.data.id, announcementRow.id);
    const parentUnreadAgain = await request("/backoffice/internal-notifications/unread-count", { token: parentA });
    assert.equal(parentUnreadAgain.data.count, afterUnread.data.count, "C4-07 unread-count stable");
    assert.equal(parentGet.data.senderType, "system");
    assert.equal(parentGet.data.senderName, "Somafrik");

    // C4-08 — sender système exact sur événement auto.
    assert.equal(messageN.senderType, "system", "C4-08 senderType system");
    assert.equal(messageN.senderUserId, null, "C4-08 senderUserId null");
    assert.equal(messageN.senderName, "Somafrik", "C4-08 senderName Somafrik");
    assert.equal(parentGrade.senderType, "system");
    assert.equal(parentGrade.senderUserId, null);
    assert.equal(parentGrade.senderName, "Somafrik");

    // C4-09/10 — notification humaine + PJ sécurisée + spoof ignoré.
    const upload = await uploadNotificationFile(adminA, { fileName: "../../etc/c4.pdf", mimeType: "application/pdf", body: pdfBuffer() });
    assert.equal(upload.status, 201, `C4-10 upload ${JSON.stringify(upload.data)}`);
    assert.equal(upload.data.fileName, "c4.pdf", "C4-10 path traversal neutralisé");
    const manualKey = randomUUID();
    const manual = await request("/backoffice/internal-notifications", {
      method: "POST", token: adminA,
      headers: { "Idempotency-Key": manualKey },
      body: {
        title: "Document C4",
        body: "Document disponible",
        recipientKinds: ["parent"],
        attachmentIds: [upload.data.id],
        senderType: "system",
        senderUserId: PARENT_A,
        senderName: "Hacker",
      },
    });
    assert.equal(manual.status, 201, `C4-09 manual ${JSON.stringify(manual.data)}`);
    assert.equal(manual.data.senderType, "user", "C4-09 senderType user");
    assert.equal(manual.data.senderUserId, ADMIN_A, "C4-09 spoof senderUserId ignoré");
    assert.equal(manual.data.senderName, "Admin A", "C4-09 spoof senderName ignoré");
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
    const studentDownload = await downloadNotificationFile(studentA, upload.data.id);
    assert.ok([403,404].includes(studentDownload.status), "C4-10 même école non recipient bloqué");
    const bDownload = await downloadNotificationFile(parentB, upload.data.id);
    assert.ok([403,404].includes(bDownload.status), "C4-10 école B bloquée");

    const exe = await uploadNotificationFile(adminA, { fileName: "virus.exe", mimeType: "application/pdf", body: Buffer.from("MZ executable") });
    assert.equal(exe.status, 400, "C4-10 .exe refusé");
    const badMime = await uploadNotificationFile(adminA, { fileName: "ok.pdf", mimeType: "application/x-msdownload", body: pdfBuffer() });
    assert.equal(badMime.status, 400, "C4-10 MIME interdit");
    const tooBig = await uploadNotificationFile(adminA, { fileName: "big.pdf", mimeType: "application/pdf", body: Buffer.alloc(10 * 1024 * 1024 + 8, 0x25) });
    assert.equal(tooBig.status, 400, "C4-10 fichier trop gros");

    // C4-11 — révocation live Notifications:READ, même JWT. Messages/Annonces ne donnent pas la PJ.
    await setRoleModuleGrant(pool, "PARENT", "notifications", { read: false, create: false, update: false });
    const revokedList = await request("/backoffice/internal-notifications", { token: parentA });
    assert.equal(revokedList.status, 403, "C4-11 list 403");
    const revokedGet = await request(`/backoffice/internal-notifications/${manual.data.id}`, { token: parentA });
    assert.equal(revokedGet.status, 403, "C4-11 get 403");
    const revokedDownload = await downloadNotificationFile(parentA, upload.data.id);
    assert.equal(revokedDownload.status, 403, "C4-11 PJ refusée après revoke même si recipient");
    const messagesStill = await request("/backoffice/conversations", { token: parentA });
    assert.ok(messagesStill.status < 400, `C4-11 Messages:READ conservé: ${messagesStill.status}`);
    const announcementsStill = await request("/backoffice/announcements", { token: parentA });
    assert.ok(announcementsStill.status < 400, `C4-11 Announcements:READ conservé: ${announcementsStill.status}`);
    const viaMessages = await downloadCrossTypeAttachment(parentA, "messages", upload.data.id);
    assert.ok([403,404].includes(viaMessages.status), "C4-11 Messages:READ ne débloque pas PJ notification");
    const viaAnnouncements = await downloadCrossTypeAttachment(parentA, "announcements", upload.data.id);
    assert.ok([403,404].includes(viaAnnouncements.status), "C4-11 Announcements:READ ne débloque pas PJ notification");
    await setRoleModuleGrant(pool, "PARENT", "notifications", { read: true, create: false, update: false });

    // C4-12 — Superadmin request-scoped sur list/get/read/archive/upload/download.
    const superBare = await request("/backoffice/internal-notifications", { token: superSa });
    assert.equal(superBare.status, 400, "C4-12 super * sans établissement");
    const superBareGet = await request(`/backoffice/internal-notifications/${messageN.id}`, { token: superSa });
    assert.equal(superBareGet.status, 400, "C4-12 get sans scope");
    const superBareRead = await request(`/backoffice/internal-notifications/${messageN.id}/read`, { method: "PATCH", token: superSa });
    assert.equal(superBareRead.status, 400, "C4-12 read sans scope");
    const superBareArchive = await request(`/backoffice/internal-notifications/${announcementRow.id}/archive`, { method: "PATCH", token: superSa });
    assert.equal(superBareArchive.status, 400, "C4-12 archive sans scope");
    const superBareUpload = await uploadNotificationFile(superSa, { fileName: "c4-sa.pdf", mimeType: "application/pdf", body: pdfBuffer() });
    assert.equal(superBareUpload.status, 400, "C4-12 upload sans scope");
    const superA = await request("/backoffice/internal-notifications?effectiveSchoolCode=CI-ECA-26-001", { token: superSa });
    assert.equal(superA.status, 200, "C4-12 super scoped A");
    const superGetA = await request(`/backoffice/internal-notifications/${manual.data.id}?effectiveSchoolCode=CI-ECA-26-001`, { token: superSa });
    assert.equal(superGetA.status, 200, "C4-12 get scoped A");
    const superUpload = await uploadNotificationFile(superSa, {
      fileName: "c4-sa.pdf", mimeType: "application/pdf", body: pdfBuffer(), query: "?effectiveSchoolCode=CI-ECA-26-001",
    });
    assert.equal(superUpload.status, 201, `C4-12 upload scoped: ${JSON.stringify(superUpload.data)}`);
    const superDownload = await downloadNotificationFile(superSa, upload.data.id, "?effectiveSchoolCode=CI-ECA-26-001");
    assert.equal(superDownload.status, 200, "C4-12 download scoped A");
    const superWrong = await request(`/backoffice/internal-notifications/${messageN.id}?effectiveSchoolCode=FR-ECB-26-001`, { token: superSa });
    assert.ok([403,404].includes(superWrong.status), "C4-12 ressource A sous scope B refusée");
    const superWrongDownload = await downloadNotificationFile(superSa, upload.data.id, "?effectiveSchoolCode=FR-ECB-26-001");
    assert.ok([403,404].includes(superWrongDownload.status), "C4-12 download A sous scope B");

    // C4-13 — concurrence dispatcher : deux drains du même event → 1 notification.
    const concurrentAttendance = randomUUID();
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-08-30','absent',$5)`,
      [concurrentAttendance,fixtures.schoolA,STUDENT_A,CLASS_A,ADMIN_A],
    );
    await Promise.all([drainOutbox(store, { limit: 20 }), drainOutbox(store, { limit: 20 })]);
    assert.equal(await notificationCount(`attendance.student.absent:${concurrentAttendance}`), 1, "C4-13 concurrence 1 notification");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM notification_recipients r JOIN communication_notifications n ON n.id=r.notification_id WHERE n.source_entity_id=$1 AND r.user_id=$2`, [concurrentAttendance, PARENT_A]), 1, "C4-13 1 recipient par user");

    // C4-15 — IDOR même école non destinataire + école B sans mutation.
    const parentA2Direct = await request(`/backoffice/internal-notifications/${messageN.id}`, { token: parentA2 });
    assert.ok([403,404].includes(parentA2Direct.status), "C4-15 non-destinataire même école GET");
    const parentA2Read = await request(`/backoffice/internal-notifications/${messageN.id}/read`, { method: "PATCH", token: parentA2 });
    assert.ok([403,404].includes(parentA2Read.status), "C4-15 non-destinataire PATCH read");
    const adminBDirect = await request(`/backoffice/internal-notifications/${messageN.id}`, { token: adminB });
    assert.ok([403,404].includes(adminBDirect.status), "C4-15 école B GET");
    const adminBRead = await request(`/backoffice/internal-notifications/${messageN.id}/read`, { method: "PATCH", token: adminB });
    assert.ok([403,404].includes(adminBRead.status), "C4-15 école B read");
    const adminBArchive = await request(`/backoffice/internal-notifications/${messageN.id}/archive`, { method: "PATCH", token: adminB });
    assert.ok([403,404].includes(adminBArchive.status), "C4-15 école B archive");
    const adminBDownload = await downloadNotificationFile(adminB, upload.data.id);
    assert.ok([403,404].includes(adminBDownload.status), "C4-15 école B PJ");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM notification_recipients WHERE notification_id=$1 AND user_id=$2 AND read_at IS NULL`, [messageN.id, PARENT_A]), 1, "C4-15 aucune mutation IDOR");

    // C4-16 — archive utilisateur, historique physique conservé.
    const archiveResult = await request(`/backoffice/internal-notifications/${messageN.id}/archive`, { method: "PATCH", token: parentA });
    assert.equal(archiveResult.status, 200);
    assert.match(archiveResult.data.archivedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(await count(pool, `SELECT count(*)::int c FROM communication_notifications WHERE id=$1`, [messageN.id]), 1, "C4-16 notification non supprimée");
    assert.equal(await count(pool, `SELECT count(*)::int c FROM notification_recipients WHERE notification_id=$1 AND user_id=$2 AND archived_at IS NOT NULL AND read_at IS NULL`, [messageN.id,PARENT_A]), 1);
    assert.equal(await count(pool, `SELECT count(*)::int c FROM notification_recipients WHERE notification_id=$1`, [messageN.id]), 1, "C4-16 pas de DELETE physique");

    // C4-14 — rollback : trigger event fait partie de la transaction métier.
    const rollbackAttendance = randomUUID();
    await pool.query("BEGIN");
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-08-29','absent',$5)`,
      [rollbackAttendance,fixtures.schoolA,STUDENT_A,CLASS_A,ADMIN_A],
    );
    await pool.query("ROLLBACK");
    assert.equal(await outboxCount(rollbackAttendance), 0, "C4-14 rollback sans event");

    const committedPending = randomUUID();
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-08-31','absent',$5)`,
      [committedPending,fixtures.schoolA,STUDENT_A,CLASS_A,ADMIN_A],
    );
    assert.equal(await outboxCount(committedPending), 1, "C4-14 event commité avant drain");
    assert.equal(await notificationCount(`attendance.student.absent:${committedPending}`), 0, "C4-14 pas encore dispatché");
    await drainOutbox(store, { limit: 20 });
    assert.equal(await notificationCount(`attendance.student.absent:${committedPending}`), 1, "C4-14 dispatcher ultérieur crée la notification");

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
