/**
 * HOTFIX-PRE-E1-02B — Gate matérialisation PG + causalité pg_teacher_assignment
 *
 * 1) teacher PG : teacher_code canonique TEACHERS-* + user_id non null
 * 2) teacher_assignment PG active (school/class/subject)
 * 3) POST grantedBy = class:pg_teacher_assignment+evaluation:pg_teacher_assignment
 * 4) Isolation : 02B-LINK / REPLAY / ROLE / TENANT / ACK-ISOLATION
 * 5) Après neutralisation affectation BO : POST toujours 201 via PG
 * 6) Après suppression assignment PG (BO conservé) : documenter fallback
 *
 *   npm run verify:pre-e1-hotfix-02b
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const TRACE_FILE = path.join(EVIDENCE_DIR, "notes-authz-trace-02b.jsonl");
const OUT_FILE = path.join(EVIDENCE_DIR, "pre-e1-hotfix-02b-results.json");
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_02b";
const PORT = String(process.env.SOMAFRIK_PRE_E1_PORT || 5110);
const API_BASE = `http://127.0.0.1:${PORT}/api`;
process.env.SOMAFRIK_API_URL = API_BASE;

const helpers = require("./e2e-api-helpers");
const { buildGradeEntrySession, gradesToLegacyNotes } = require("./e2e-grades-rules");
const { saveContactWithOptionalUserAccount } = require("./e2e-user-account-rules");
const {
  prepareContactForSave,
  assertContactRequiredFields,
  validateContactDuplicate,
} = require("./e2e-contacts-rules");
const { linkContactToOperationalRecord } = require("../backend/lib/contactRegistrySync");

const {
  request,
  login,
  getState,
  newId,
  normalize,
  todayPeriodDate,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
} = helpers;

const ADMIN_PASSWORD = "E2eTest!2026";
const TEACHER_PASSWORD = "E2eTeach1";
const results = [];

function record(id, title, ok, detail = null) {
  results.push({ id, title, ok: Boolean(ok), detail });
  console.log(`  ${ok ? "✓" : "✗"} [${id}] ${title}${detail ? ` — ${detail}` : ""}`);
}

async function pgQuery(sql, params = []) {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    return (await pool.query(sql, params)).rows;
  } finally {
    await pool.end();
  }
}

function ensureDatabase() {
  const parsed = new URL(DATABASE_URL);
  const dbName = parsed.pathname.replace(/^\//, "");
  const adminUrl = `postgresql://somafrik:somafrik@${parsed.hostname}:${parsed.port || 5432}/postgres`;
  const check = spawnSync(
    "psql",
    [adminUrl, "-tAc", `SELECT 1 FROM pg_database WHERE datname='${dbName}'`],
    { encoding: "utf8" },
  );
  if (check.status !== 0) throw new Error(check.stderr || check.stdout);
  if (String(check.stdout).trim() !== "1") {
    const created = spawnSync("psql", [adminUrl, "-c", `CREATE DATABASE ${dbName} OWNER somafrik`], {
      encoding: "utf8",
    });
    if (created.status !== 0) throw new Error(created.stderr || created.stdout);
  }
  const reset = spawnSync(
    "psql",
    [
      DATABASE_URL,
      "-c",
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO somafrik;",
    ],
    { encoding: "utf8" },
  );
  if (reset.status !== 0) throw new Error(reset.stderr || reset.stdout);
}

async function waitForHealth(timeoutMs = 120000) {
  const healthUrl = `${API_BASE.replace(/\/api\/?$/, "")}/api/health`;
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return response.json().catch(() => ({}));
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`API non prête: ${lastError?.message}`);
}

function startBackend() {
  try {
    fs.unlinkSync(TRACE_FILE);
  } catch {
    /* ignore */
  }
  return spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET || "pre-e1-02b-jwt-secret-with-enough-length-32chars",
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "false",
      SOMAFRIK_API_ONLY: "true",
      SOMAFRIK_E2E: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_AUTHZ_TRACE: "1",
      SOMAFRIK_AUTHZ_TRACE_FILE: TRACE_FILE,
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
}

async function stopBackend(child) {
  if (!child || child.exitCode != null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* ignore */
  }
}

async function putStateKeys(token, patch) {
  const res = await request("/backoffice/state", { method: "PUT", token, body: patch });
  if (res.status !== 200) {
    throw new Error(`putStateKeys ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return {
    ok: true,
    contact: prepared,
    contacts: [...(state.contacts ?? []).filter((c) => c.id !== prepared.id), prepared],
  };
}

async function setupSchool(superToken, stamp) {
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: `HF02B School ${stamp}`,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `hf02b-${stamp}@somafrik.app`,
      principalName: "Directeur HF02B",
      principalEmail: `dir-02b-${stamp}@somafrik.app`,
      force: true,
    },
  });
  if (createRes.status !== 201) throw new Error(JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  const schoolAdminIdentifier = `ADM-02B-${stamp}`;
  const current = await getState(superToken);
  await putStateKeys(superToken, {
    users: [
      ...(current.users ?? []).filter(
        (u) => normalize(u.identifier) !== normalize(schoolAdminIdentifier),
      ),
      {
        id: `usr-02b-${stamp}`,
        firstName: "Admin",
        lastName: "HF02B",
        role: "Admin School",
        identifier: schoolAdminIdentifier,
        email: `${schoolAdminIdentifier.toLowerCase()}@somafrik.app`,
        schoolCode,
        countryScope: "RDC",
        scopeLevel: "Établissement",
        accessChannel: "Application",
        status: "Actif",
        validationStatus: "Validé",
        password: ADMIN_PASSWORD,
        temporaryPassword: "",
        mustChangePassword: false,
        permissions: [],
      },
    ],
  });
  return {
    schoolCode,
    schoolAdminIdentifier,
    adminToken: await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode),
  };
}

async function buildChain(adminToken, schoolCode, schoolAdminIdentifier, stamp) {
  let state = await getState(adminToken);
  const className = `HF02B-${stamp}`;
  const subject = "Mathématiques";
  const period = "Trimestre 1";
  state = await putStateKeys(adminToken, {
    classes: [
      {
        id: newId("CLASS"),
        name: className,
        schoolCode,
        level: "6ème",
        academicYear: "2025-2026",
        status: "Active",
      },
      ...(state.classes ?? []),
    ],
  });
  const studentIds = [];
  for (let i = 0; i < 2; i += 1) {
    state = await getState(adminToken);
    const draft = {
      id: newId("CONTACT"),
      lastName: `Eleve${i}`,
      firstName: `B${stamp}`,
      contactType: "Élève",
      phone: `+243 820 ${String(stamp + i).slice(-6)}`,
      email: `eleve-02b-${stamp}-${i}@somafrik.app`,
      hasAccess: "Non",
      status: "Actif",
    };
    const contactFlow = saveContactOnly(state, draft, schoolCode);
    if (!contactFlow.ok) throw new Error(contactFlow.error);
    state = await putStateKeys(adminToken, { contacts: contactFlow.contacts });
    const link = linkContactToOperationalRecord(contactFlow.contact, state, {
      actor: { identifier: schoolAdminIdentifier, role: "Admin School", schoolCode },
    });
    state = await putStateKeys(adminToken, {
      contacts: [link.contact, ...(state.contacts ?? [])],
      students: link.students,
    });
    const student = (state.students ?? []).find(
      (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
    );
    state = await putStateKeys(adminToken, {
      students: (state.students ?? []).map((row) =>
        row.id === student.id ? { ...row, className, schoolCode } : row,
      ),
    });
    studentIds.push(student.id);
  }

  state = await getState(adminToken);
  const teacherFlow = saveContactWithOptionalUserAccount(
    {
      id: newId("CONTACT"),
      lastName: "HF02B",
      firstName: `Prof${stamp}`,
      contactType: "Enseignant",
      phone: `+243 831 ${String(stamp).slice(-6)}`,
      email: `prof-02b-${stamp}@somafrik.app`,
      hasAccess: "Oui",
      role: "Enseignant",
      status: "Actif",
      password: TEACHER_PASSWORD,
      temporaryPassword: TEACHER_PASSWORD,
    },
    state,
    schoolCode,
    { identifier: schoolAdminIdentifier, role: "Admin School", schoolCode },
  );
  if (!teacherFlow.ok) throw new Error(teacherFlow.error);
  const teacherUser = {
    ...teacherFlow.user,
    password: TEACHER_PASSWORD,
    temporaryPassword: TEACHER_PASSWORD,
    mustChangePassword: false,
  };
  const teacherPatch = { ...teacherFlow.patch };
  delete teacherPatch.auditLog;
  state = await putStateKeys(adminToken, {
    ...teacherPatch,
    users: teacherFlow.patch.users.map((row) =>
      row.id === teacherUser.id ? teacherUser : row,
    ),
  });
  // FIX V2.1 IDENTITY — réutiliser le TEACHERS-* créé par le sync contact+user
  // (AC-NEW-02) ; ne pas injecter un second id lié au même userId.
  const syncedCanon =
    (state.teachers ?? []).find(
      (row) =>
        String(row.userId ?? "") === String(teacherUser.id) &&
        /^TEACHERS-/i.test(String(row.id ?? "")),
    ) ?? null;
  const teachersRecord = {
    ...(syncedCanon ?? {}),
    id: syncedCanon?.id ?? newId("TEACHERS"),
    userId: teacherUser.id,
    contactId: teacherFlow.contact.id,
    identifier: teacherUser.identifier,
    firstName: teacherUser.firstName,
    lastName: teacherUser.lastName,
    name: teacherUser.lastName,
    schoolCode,
    mainSubject: subject,
  };
  const assignment = {
    id: newId("ASSIGN"),
    teacherId: teachersRecord.id,
    teacherName: `${teachersRecord.firstName} ${teachersRecord.lastName}`.trim(),
    className,
    course: subject,
    subject,
    schoolCode,
    academicYear: "2025-2026",
  };
  await putStateKeys(adminToken, {
    teachers: [
      teachersRecord,
      ...(state.teachers ?? []).filter((row) => String(row.id) !== String(teachersRecord.id)),
    ],
    assignments: [assignment, ...(state.assignments ?? [])],
    courses: [
      {
        id: newId("COURSE"),
        name: subject,
        className,
        schoolCode,
        coefficient: 2,
        status: "Actif",
        teacherId: teachersRecord.id,
        teacherName: assignment.teacherName,
      },
      ...(state.courses ?? []),
    ],
  });
  return { className, subject, period, studentIds, teacherUser, teachersRecord, assignment };
}

async function lastTrace(token) {
  const debug = await request("/debug/notes-authz-trace", { token });
  return debug.data?.trace ?? null;
}

async function main() {
  console.log("=== VERIFY HOTFIX-PRE-E1-02B ===");
  ensureDatabase();
  const child = startBackend();
  const evidence = { pg: {}, posts: [], traces: [] };
  try {
    await waitForHealth();
    process.env.SOMAFRIK_E2E_TRY_KNOWN_PASSWORDS = "true";
    let superToken;
    try {
      superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
    } catch {
      superToken = await login(SUPERADMIN_ID, "1234");
    }
    const stamp = Date.now();
    const school = await setupSchool(superToken, stamp);
    const chain = await buildChain(
      school.adminToken,
      school.schoolCode,
      school.schoolAdminIdentifier,
      stamp,
    );

    const pgTeachers = await pgQuery(
      `SELECT t.id, t.teacher_code, t.user_id
       FROM teachers t JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND t.teacher_code LIKE 'TEACHERS-%'`,
      [school.schoolCode],
    );
    const pgAssignments = await pgQuery(
      `SELECT ta.id, t.teacher_code, c.name AS class_name, sub.name AS subject_name, ta.status,
              s.id AS school_id, ta.class_id, ta.subject_id
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND t.teacher_code LIKE 'TEACHERS-%'`,
      [school.schoolCode],
    );
    evidence.pg.afterStaffSync = { teachers: pgTeachers, assignments: pgAssignments };

    record(
      "PG-TEACHER-CODE",
      "teacher PG avec teacher_code TEACHERS-*",
      pgTeachers.some((row) => String(row.teacher_code) === String(chain.teachersRecord.id)),
      `codes=${pgTeachers.map((r) => r.teacher_code).join(",")}`,
    );
    record(
      "PG-TEACHER-USER",
      "teachers.user_id non null",
      pgTeachers.some((row) => row.user_id),
      `user_ids=${pgTeachers.map((r) => r.user_id).join(",")}`,
    );
    record(
      "PG-ASSIGN",
      "teacher_assignment PG active classe+matière",
      pgAssignments.some(
        (row) =>
          row.class_name === chain.className &&
          row.subject_name === chain.subject &&
          row.status === "active",
      ),
      JSON.stringify(pgAssignments).slice(0, 240),
    );

    const teacherToken = await login(
      chain.teacherUser.identifier,
      TEACHER_PASSWORD,
      school.schoolCode,
    );
    const state = await getState(school.adminToken);
    const storedTeacher =
      (state.teachers ?? []).find((row) => String(row.id) === String(chain.teachersRecord.id)) ??
      chain.teachersRecord;
    const putSession = buildGradeEntrySession({
      state,
      author: {
        id: chain.teacherUser.id,
        identifier: chain.teacherUser.identifier,
        firstName: chain.teacherUser.firstName,
        lastName: chain.teacherUser.lastName,
        role: "Enseignant",
        schoolCode: school.schoolCode,
      },
      evaluationInput: {
        schoolCode: school.schoolCode,
        className: chain.className,
        subject: chain.subject,
        period: chain.period,
        evaluationType: "Devoir",
        title: `HF02B PUT ${stamp}`,
        date: todayPeriodDate(),
        scale: 20,
        coefficient: 1,
        teacherId: storedTeacher.id,
        teacherName: `${storedTeacher.firstName ?? ""} ${storedTeacher.lastName ?? ""}`.trim(),
        status: "Publiée",
      },
      studentGrades: [
        { studentId: chain.studentIds[0], value: 14 },
        { studentId: chain.studentIds[1], value: 11 },
      ],
    });
    if (!putSession.ok) throw new Error(putSession.error);
    const putRes = await request("/backoffice/state", {
      method: "PUT",
      token: teacherToken,
      body: {
        evaluations: [putSession.evaluation],
        notes: gradesToLegacyNotes(putSession.grades),
      },
    });
    record("PUT-NOTES", "PUT évaluations+notes enseignant", putRes.status === 200, `HTTP ${putRes.status}`);

    const student1 = (await getState(school.adminToken)).students?.find(
      (row) => row.id === chain.studentIds[0],
    );
    const postBody = {
      studentId: student1?.matricule ?? student1?.publicId ?? chain.studentIds[0],
      subject: chain.subject,
      className: chain.className,
      schoolCode: school.schoolCode,
      value: 16,
      scale: 20,
      coefficient: 1,
      evaluationCoefficient: 1,
      evaluationId: putSession.evaluation.id,
      period: chain.period,
      date: todayPeriodDate(),
    };

    const post1 = await request("/notes", { method: "POST", token: teacherToken, body: postBody });
    const trace1 = await lastTrace(teacherToken);
    evidence.posts.push({ phase: "nominal", status: post1.status, grantedBy: trace1?.grantedBy });
    evidence.traces.push(trace1);
    const expectedGranted =
      "class:pg_teacher_assignment+evaluation:pg_teacher_assignment";
    record(
      "POST-PG-AUTHZ",
      "POST autorisé via pg_teacher_assignment (classe+matière)",
      post1.status === 201 && trace1?.grantedBy === expectedGranted,
      `HTTP ${post1.status} grantedBy=${trace1?.grantedBy}`,
    );

    const linkRows = await pgQuery(
      `SELECT t.teacher_code, t.user_id, u.user_code, u.school_id AS user_school_id, s.school_code
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND t.teacher_code = $2`,
      [school.schoolCode, chain.teachersRecord.id],
    );
    record(
      "02B-LINK-01",
      "teacher.user_id correspond au user BO attendu",
      linkRows.length === 1 &&
        String(linkRows[0].user_code) === String(chain.teacherUser.id),
      JSON.stringify(linkRows[0] ?? null),
    );

    // 02B-REPLAY-01 — plusieurs PUT staff identiques
    const countsBefore = await pgQuery(
      `SELECT
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS teachers,
         (SELECT count(*)::int FROM users u WHERE u.user_code = $3) AS users,
         (SELECT count(*)::int FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS assignments`,
      [school.schoolCode, chain.teachersRecord.id, chain.teacherUser.id],
    );
    const stateReplay = await getState(school.adminToken);
    const teacherRow = (stateReplay.teachers ?? []).find(
      (row) => String(row.id) === String(chain.teachersRecord.id),
    );
    const assignmentRow = (stateReplay.assignments ?? []).find(
      (row) => String(row.id) === String(chain.assignment.id),
    );
    await putStateKeys(school.adminToken, {
      teachers: stateReplay.teachers,
      assignments: stateReplay.assignments,
      users: stateReplay.users,
    });
    await putStateKeys(school.adminToken, {
      teachers: stateReplay.teachers,
      assignments: stateReplay.assignments,
      users: stateReplay.users,
    });
    const countsAfter = await pgQuery(
      `SELECT
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS teachers,
         (SELECT count(*)::int FROM users u WHERE u.user_code = $3) AS users,
         (SELECT count(*)::int FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS assignments`,
      [school.schoolCode, chain.teachersRecord.id, chain.teacherUser.id],
    );
    record(
      "02B-REPLAY-01",
      "Plusieurs synchronisations identiques → 1 user, 1 teacher, 1 assignment",
      Number(countsAfter[0]?.teachers) === 1 &&
        Number(countsAfter[0]?.users) === 1 &&
        Number(countsAfter[0]?.assignments) === 1 &&
        Number(countsAfter[0]?.teachers) === Number(countsBefore[0]?.teachers) &&
        Number(countsAfter[0]?.users) === Number(countsBefore[0]?.users) &&
        Number(countsAfter[0]?.assignments) === Number(countsBefore[0]?.assignments),
      `before=${JSON.stringify(countsBefore[0])} after=${JSON.stringify(countsAfter[0])} teacherRow=${Boolean(teacherRow)} assignmentRow=${Boolean(assignmentRow)}`,
    );

    // 02B-ROLE-01 — compte existant non enseignant, même école
    const roleUserCode = `USERS-ROLE-${stamp}`;
    const insertedRoleUser = await pgQuery(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       SELECT s.id, $2, 'Keep', 'Role', $3, NULL, NULL, NULL, 'PARENT', 'active'
       FROM schools s WHERE s.school_code = $1
       RETURNING id, role, school_id`,
      [school.schoolCode, roleUserCode, `role-${stamp}@somafrik.app`],
    );
    const roleTeacherId = newId("TEACHERS");
    const stateRole = await getState(school.adminToken);
    const rolePut = await putStateKeys(school.adminToken, {
      users: [
        {
          id: roleUserCode,
          identifier: `ROLE-${stamp}`,
          firstName: "Keep",
          lastName: "Role",
          role: "Parent",
          schoolCode: school.schoolCode,
          status: "Actif",
        },
        ...(stateRole.users ?? []),
      ],
      teachers: [
        {
          id: roleTeacherId,
          userId: roleUserCode,
          identifier: `ROLE-${stamp}`,
          firstName: "Keep",
          lastName: "Role",
          schoolCode: school.schoolCode,
          mainSubject: chain.subject,
        },
        ...(stateRole.teachers ?? []),
      ],
    });
    const roleAfter = await pgQuery(
      `SELECT id, role, school_id FROM users WHERE user_code = $1`,
      [roleUserCode],
    );
    const roleTeacherRows = await pgQuery(
      `SELECT t.teacher_code, t.user_id
       FROM teachers t
       WHERE t.teacher_code = $1 OR t.user_id = $2`,
      [roleTeacherId, insertedRoleUser[0]?.id],
    );
    const roleSyncRejected =
      Array.isArray(rolePut?.syncAck?.rejected) &&
      rolePut.syncAck.rejected.some(
        (row) =>
          row.entity === "teachers" &&
          (row.code === "TEACHER_USER_ROLE_CONFLICT" ||
            String(row.error || "").includes("non enseignant")),
      );
    const roleNoTeacherLink = roleTeacherRows.every(
      (row) =>
        row.user_id == null || String(row.user_id) !== String(insertedRoleUser[0]?.id),
    );
    record(
      "02B-ROLE-01",
      "Compte PARENT inchangé + aucun teacher.user_id + TEACHER_USER_ROLE_CONFLICT",
      roleAfter[0]?.role === "PARENT" &&
        String(roleAfter[0]?.school_id) === String(insertedRoleUser[0]?.school_id) &&
        roleNoTeacherLink &&
        roleSyncRejected,
      `role=${roleAfter[0]?.role} syncRejected=${roleSyncRejected} teacherRows=${JSON.stringify(roleTeacherRows)}`,
    );

    // 02B-TENANT-01 — même user_code dans école B
    const schoolB = await setupSchool(superToken, stamp + 77);
    const userABefore = await pgQuery(
      `SELECT id, school_id, role, user_code FROM users WHERE user_code = $1`,
      [chain.teacherUser.id],
    );
    const stateB = await getState(schoolB.adminToken);
    const tenantTeacherId = newId("TEACHERS");
    const tenantPut = await putStateKeys(schoolB.adminToken, {
      users: [
        {
          id: chain.teacherUser.id,
          identifier: chain.teacherUser.identifier,
          firstName: "Intrus",
          lastName: "Tenant",
          role: "Enseignant",
          schoolCode: schoolB.schoolCode,
          status: "Actif",
        },
        ...(stateB.users ?? []),
      ],
      teachers: [
        {
          id: tenantTeacherId,
          userId: chain.teacherUser.id,
          identifier: chain.teacherUser.identifier,
          firstName: "Intrus",
          lastName: "Tenant",
          schoolCode: schoolB.schoolCode,
          mainSubject: chain.subject,
        },
        ...(stateB.teachers ?? []),
      ],
      assignments: [
        {
          id: newId("ASSIGN"),
          teacherId: tenantTeacherId,
          className: "X-B",
          subject: chain.subject,
          course: chain.subject,
          schoolCode: schoolB.schoolCode,
        },
        ...(stateB.assignments ?? []),
      ],
      classes: [
        {
          id: newId("CLASS"),
          name: "X-B",
          schoolCode: schoolB.schoolCode,
          level: "5ème",
          academicYear: "2025-2026",
          status: "Active",
        },
        ...(stateB.classes ?? []),
      ],
    });
    const userAAfter = await pgQuery(
      `SELECT id, school_id, role, user_code FROM users WHERE user_code = $1`,
      [chain.teacherUser.id],
    );
    const teacherB = await pgQuery(
      `SELECT t.teacher_code, t.user_id, s.school_code
       FROM teachers t JOIN schools s ON s.id = t.school_id
       WHERE t.teacher_code = $1`,
      [tenantTeacherId],
    );
    const syncRejected =
      Array.isArray(tenantPut?.syncAck?.rejected) &&
      tenantPut.syncAck.rejected.some(
        (row) =>
          row.entity === "teachers" &&
          (row.code === "TEACHER_USER_TENANT_CONFLICT" ||
            String(row.error || "").includes("multi-tenant")),
      );
    const tenantOk =
      String(userAAfter[0]?.school_id) === String(userABefore[0]?.school_id) &&
      String(userAAfter[0]?.role) === String(userABefore[0]?.role) &&
      (teacherB.length === 0 ||
        teacherB[0].user_id == null ||
        String(teacherB[0].user_id) !== String(userABefore[0]?.id));
    record(
      "02B-TENANT-01",
      "Compte école A inchangé + aucun lien école B + TEACHER_USER_TENANT_CONFLICT observé",
      tenantOk && syncRejected,
      `schoolABefore=${userABefore[0]?.school_id} after=${userAAfter[0]?.school_id} syncRejected=${syncRejected} teacherB=${JSON.stringify(teacherB[0] ?? null)} rejected=${JSON.stringify((tenantPut?.syncAck?.rejected || []).filter((r) => r.entity === "teachers").slice(0, 3))}`,
    );

    // 02B-ACK-ISOLATION-01 — syncAck strictement lié à la requête (pas de lastSyncAck global)
    const ackMarkerTeacherId = newId("TEACHERS");
    const ackMarkers = {
      teacherId: ackMarkerTeacherId,
      codes: ["TEACHER_USER_ROLE_CONFLICT", "TEACHER_USER_TENANT_CONFLICT"],
    };
    const stateAForAck = await getState(school.adminToken);
    const stateBForAck = await getState(schoolB.adminToken);
    const putAAck = request("/backoffice/state", {
      method: "PUT",
      token: school.adminToken,
      body: {
        teachers: [
          {
            id: ackMarkerTeacherId,
            userId: roleUserCode,
            identifier: `ACK-ISO-${stamp}`,
            firstName: "Ack",
            lastName: "Leak",
            schoolCode: school.schoolCode,
            mainSubject: chain.subject,
          },
          ...(stateAForAck.teachers ?? []),
        ],
      },
    });
    const putBAck = request("/backoffice/state", {
      method: "PUT",
      token: schoolB.adminToken,
      body: {
        classes: [
          {
            id: newId("CLASS"),
            name: `ACK-ISO-B-${stamp}`,
            schoolCode: schoolB.schoolCode,
            level: "5ème",
            academicYear: "2025-2026",
            status: "Active",
          },
          ...(stateBForAck.classes ?? []),
        ],
      },
    });
    const [resAAck, resBAck] = await Promise.all([putAAck, putBAck]);
    if (resAAck.status !== 200 || resBAck.status !== 200) {
      throw new Error(
        `02B-ACK-ISOLATION put fail A=${resAAck.status} B=${resBAck.status}`,
      );
    }
    const ackARejected = resAAck.data?.syncAck?.rejected ?? [];
    const ackBRaw = JSON.stringify(resBAck.data?.syncAck ?? null);
    const ackAHasMarker =
      Array.isArray(ackARejected) &&
      ackARejected.some(
        (row) =>
          String(row.id) === String(ackMarkerTeacherId) &&
          row.code === "TEACHER_USER_ROLE_CONFLICT",
      );
    // B peut avoir ses propres rejets — interdit seulement les marqueurs de la requête A.
    const ackBLeaksA =
      ackBRaw.includes(String(ackMarkerTeacherId)) ||
      ackBRaw.includes(String(roleUserCode)) ||
      (Array.isArray(resBAck.data?.syncAck?.rejected) &&
        resBAck.data.syncAck.rejected.some(
          (row) => String(row.id ?? "") === String(ackMarkerTeacherId),
        ));
    record(
      "02B-ACK-ISOLATION-01",
      "PUT concurrent A (rejet) / B (benign) → réponse B sans ACK-A",
      resAAck.status === 200 &&
        resBAck.status === 200 &&
        ackAHasMarker &&
        !ackBLeaksA,
      `ackAMarker=${ackAHasMarker} ackBLeak=${ackBLeaksA} codesA=${ackMarkers.codes.join(",")} ackB=${ackBRaw.slice(0, 240)}`,
    );

    // Neutraliser affectation BO (conserver PG)
    const stateBeforeNeutral = await getState(school.adminToken);
    await putStateKeys(school.adminToken, {
      assignments: (stateBeforeNeutral.assignments ?? []).filter(
        (row) => String(row.id) !== String(chain.assignment.id),
      ),
    });
    const boAssignGone = !(await getState(school.adminToken)).assignments?.some(
      (row) => String(row.id) === String(chain.assignment.id),
    );
    const pgAssignStill = await pgQuery(
      `SELECT count(*)::int AS n FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND t.teacher_code = $2 AND ta.status = 'active'`,
      [school.schoolCode, chain.teachersRecord.id],
    );
    record(
      "BO-NEUTRALIZED",
      "Affectation BO retirée, assignment PG toujours active",
      boAssignGone && Number(pgAssignStill[0]?.n) >= 1,
      `boGone=${boAssignGone} pgN=${pgAssignStill[0]?.n}`,
    );

    const post2 = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: { ...postBody, value: 15 },
    });
    const trace2 = await lastTrace(teacherToken);
    evidence.posts.push({
      phase: "bo_neutralized",
      status: post2.status,
      grantedBy: trace2?.grantedBy,
    });
    evidence.traces.push(trace2);
    record(
      "POST-WITHOUT-BO",
      "POST 201 via PG après neutralisation BO",
      post2.status === 201 && trace2?.grantedBy === expectedGranted,
      `HTTP ${post2.status} grantedBy=${trace2?.grantedBy}`,
    );

    // Restaurer BO, supprimer assignment PG — documenter fallback
    await putStateKeys(school.adminToken, {
      assignments: [chain.assignment, ...((await getState(school.adminToken)).assignments ?? [])],
    });
    await pgQuery(
      `DELETE FROM teacher_assignments ta
       USING teachers t, schools s
       WHERE ta.teacher_id = t.id AND t.school_id = s.id
         AND s.school_code = $1 AND t.teacher_code = $2`,
      [school.schoolCode, chain.teachersRecord.id],
    );
    const post3 = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: { ...postBody, value: 14 },
    });
    const trace3 = await lastTrace(teacherToken);
    evidence.posts.push({
      phase: "pg_removed_bo_kept",
      status: post3.status,
      grantedBy: trace3?.grantedBy,
    });
    evidence.traces.push(trace3);
    const fallbackUsed =
      post3.status === 201 && String(trace3?.grantedBy || "").includes("bo_assignment");
    record(
      "FALLBACK-DOC",
      "Sans assignment PG + BO conservé : fallback BO encore actif (observé)",
      fallbackUsed,
      `HTTP ${post3.status} grantedBy=${trace3?.grantedBy} fallbackUsed=${fallbackUsed}`,
    );
  } finally {
    await stopBackend(child);
  }

  function scrubAuthzTrace(value) {
    if (Array.isArray(value)) return value.map(scrubAuthzTrace);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, nested] of Object.entries(value)) {
        const nextKey = key === "key" ? "lookupValue" : key === "keys" ? "lookupValues" : key;
        out[nextKey] = scrubAuthzTrace(nested);
      }
      return out;
    }
    return value;
  }
  const report = {
    hotfix: "HOTFIX-PRE-E1-02B",
    notClosingAudit: true,
    generatedAt: new Date().toISOString(),
    results,
    evidence: scrubAuthzTrace(evidence),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nRapport: ${OUT_FILE}`);
  console.log(`Résumé: ${report.summary.passed}/${report.summary.total}`);
  process.exitCode = report.summary.failed ? 1 : 0;
}

main().catch((error) => {
  console.error("HARNESS FAIL:", error?.stack || error);
  process.exit(2);
});
