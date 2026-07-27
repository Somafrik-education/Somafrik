/**
 * Audit de causalité — Pourquoi POST /api/notes réussit-il réellement ?
 *
 * ≠ validation CTO. Active SOMAFRIK_AUTHZ_TRACE=1 et capture la source
 * d'autorisation (JWT / PG teacher / PG assignment / fallback BO).
 *
 *   node scripts/audit-pre-e1-notes-authz-causality.js
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const TRACE_FILE = path.join(EVIDENCE_DIR, "notes-authz-trace.jsonl");
const OUT_FILE = path.join(EVIDENCE_DIR, "pre-e1-notes-authz-causality.json");
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_causality";
const PORT = String(process.env.SOMAFRIK_PRE_E1_PORT || 5109);
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
  const child = spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET || "pre-e1-causality-jwt-secret-with-enough-length-32",
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
  return child;
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
      name: `Causality School ${stamp}`,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `causality-${stamp}@somafrik.app`,
      principalName: "Directeur Causality",
      principalEmail: `dir-c-${stamp}@somafrik.app`,
      force: true,
    },
  });
  if (createRes.status !== 201) throw new Error(JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  const schoolAdminIdentifier = `ADM-CAUS-${stamp}`;
  const current = await getState(superToken);
  const schoolAdmin = {
    id: `usr-caus-${stamp}`,
    firstName: "Admin",
    lastName: "Causality",
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
  };
  await putStateKeys(superToken, {
    users: [
      ...(current.users ?? []).filter(
        (u) => normalize(u.identifier) !== normalize(schoolAdminIdentifier),
      ),
      schoolAdmin,
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
  const className = `CAUS-${stamp}`;
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
      firstName: `Caus${stamp}`,
      contactType: "Élève",
      phone: `+243 820 ${String(stamp + i).slice(-6)}`,
      email: `eleve-caus-${stamp}-${i}@somafrik.app`,
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
    const enrolled = { ...student, className, schoolCode };
    state = await putStateKeys(adminToken, {
      students: (state.students ?? []).map((row) => (row.id === student.id ? enrolled : row)),
    });
    studentIds.push(student.id);
  }

  state = await getState(adminToken);
  const teacherFlow = saveContactWithOptionalUserAccount(
    {
      id: newId("CONTACT"),
      lastName: "Causality",
      firstName: `Prof${stamp}`,
      contactType: "Enseignant",
      phone: `+243 831 ${String(stamp).slice(-6)}`,
      email: `prof-caus-${stamp}@somafrik.app`,
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
  const teachersRecord = {
    id: newId("TEACHERS"),
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
    teachers: [teachersRecord, ...(state.teachers ?? [])],
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

function readLastTraceFromFile() {
  if (!fs.existsSync(TRACE_FILE)) return null;
  const lines = fs
    .readFileSync(TRACE_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
}

function interpret(trace, pgSnapshot) {
  const grantedBy = trace?.grantedBy ?? null;
  const usesPgAssignment =
    String(grantedBy || "").includes("pg_teacher_assignment") ||
    (trace?.steps ?? []).some(
      (step) => step.result === "allow" && step.via === "pg_teacher_assignment",
    );
  const usesBo =
    String(grantedBy || "").includes("bo_assignment") ||
    (trace?.steps ?? []).some(
      (step) =>
        step.result === "allow" &&
        String(step.via || "").startsWith("bo_"),
    );
  const usesJwt =
    String(grantedBy || "").includes("jwt_classNames") ||
    (trace?.steps ?? []).some((step) => step.result === "allow" && step.via === "jwt_classNames");
  return {
    question: "Pourquoi le POST réussit-il réellement ?",
    grantedBy,
    decision: trace?.decision ?? null,
    sources: {
      postgresqlTeacherAssignment: usesPgAssignment,
      backOfficeSnapshot: usesBo,
      jwtAssignedClasses: usesJwt,
      fusion: [usesPgAssignment, usesBo, usesJwt].filter(Boolean).length > 1,
    },
    pgFactsAtPost: pgSnapshot,
    conclusion:
      usesPgAssignment && !usesBo && !usesJwt
        ? "CAUSE_APPARENTE_PG_ASSIGNMENT"
        : usesBo && !usesPgAssignment
          ? "CAUSE_APPARENTE_FALLBACK_BO"
          : usesJwt && !usesPgAssignment && !usesBo
            ? "CAUSE_APPARENTE_JWT_CLASSNAMES"
            : usesPgAssignment || usesBo || usesJwt
              ? "CAUSE_MIXTE_OU_FUSION"
              : "CAUSE_INDETERMINEE",
    matchesHotfix02Narrative:
      usesPgAssignment &&
      Number(pgSnapshot?.assignmentCount ?? 0) > 0 &&
      !usesBo &&
      !usesJwt,
  };
}

async function main() {
  console.log("=== AUDIT CAUSALITÉ POST /api/notes (≠ validation CTO) ===");
  ensureDatabase();
  const child = startBackend();
  const report = {
    kind: "PRE_E1_NOTES_AUTHZ_CAUSALITY",
    notACtoValidation: true,
    generatedAt: null,
    apiBase: API_BASE,
    database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
    post: null,
    debugEndpoint: null,
    fileTrace: null,
    pgBeforePost: null,
    interpretation: null,
  };
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
    const teacherToken = await login(
      chain.teacherUser.identifier,
      TEACHER_PASSWORD,
      school.schoolCode,
    );

    const state = await getState(school.adminToken);
    const storedTeacher =
      (state.teachers ?? []).find(
        (row) =>
          String(row.userId) === String(chain.teacherUser.id) &&
          String(row.id).startsWith("TEACHERS-"),
      ) ??
      (state.teachers ?? []).find((row) => String(row.userId) === String(chain.teacherUser.id)) ??
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
        title: `Causality PUT ${stamp}`,
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
    if (putRes.status !== 200) {
      throw new Error(`PUT failed ${putRes.status}: ${JSON.stringify(putRes.data)}`);
    }

    const pgTeachers = await pgQuery(
      `SELECT t.teacher_code, t.user_id IS NOT NULL AS has_user
       FROM teachers t JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1`,
      [school.schoolCode],
    );
    const pgAssignments = await pgQuery(
      `SELECT t.teacher_code, c.name AS class_name, sub.name AS subject_name
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1`,
      [school.schoolCode],
    );
    report.pgBeforePost = {
      teachers: pgTeachers,
      assignments: pgAssignments,
      teacherCount: pgTeachers.length,
      assignmentCount: pgAssignments.length,
    };

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
    const postRes = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: postBody,
    });
    report.post = {
      status: postRes.status,
      message: postRes.data?.message ?? null,
      ok: postRes.status === 201,
    };

    const debug = await request("/debug/notes-authz-trace", { token: teacherToken });
    report.debugEndpoint = {
      status: debug.status,
      body: debug.data,
    };
    report.fileTrace = readLastTraceFromFile();
    const trace = debug.data?.trace ?? report.fileTrace;
    report.interpretation = interpret(trace, report.pgBeforePost);

    console.log(`POST status: ${postRes.status}`);
    console.log(`grantedBy: ${report.interpretation.grantedBy}`);
    console.log(`conclusion: ${report.interpretation.conclusion}`);
    console.log(
      `matchesHotfix02Narrative: ${report.interpretation.matchesHotfix02Narrative}`,
    );
    console.log(
      `PG teachers=${report.pgBeforePost.teacherCount} assignments=${report.pgBeforePost.assignmentCount}`,
    );
  } finally {
    await stopBackend(child);
  }

  report.generatedAt = new Date().toISOString();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nEvidence: ${OUT_FILE}`);
  if (fs.existsSync(TRACE_FILE)) {
    console.log(`Trace JSONL: ${TRACE_FILE}`);
  }
  process.exitCode = report.post?.ok ? 0 : 1;
}

main().catch((error) => {
  console.error("HARNESS FAIL:", error?.stack || error);
  process.exit(2);
});
