/**
 * INSPECTION INDÉPENDANTE — HOTFIX-PRE-E1-02 (#87 / #88)
 *
 * Ne constitue PAS une validation CTO.
 * Rejoue des contrôles depuis une base propre, inspecte PostgreSQL,
 * et produit des observations brutes (PASS/FAIL/GAP) sous docs/audits/evidence/.
 *
 *   node scripts/inspect-pre-e1-hotfix-02-independent.js
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_inspect";
const PORT = String(process.env.SOMAFRIK_PRE_E1_PORT || 5107);
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
const observations = [];
const report = {
  kind: "INDEPENDENT_INSPECTION",
  subject: "HOTFIX-PRE-E1-02 / PR #87+#88",
  notACtoValidation: true,
  generatedAt: null,
  database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
  apiBase: API_BASE,
  observations: observations,
  pgSnapshots: {},
  summary: {},
};

function observe(id, title, status, detail = null, evidence = null) {
  const row = { id, title, status, detail, evidence };
  observations.push(row);
  const mark = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "·";
  console.log(`  ${mark} [${id}] ${status} — ${title}${detail ? ` | ${detail}` : ""}`);
  return row;
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
  const check = spawnSync("psql", [adminUrl, "-tAc", `SELECT 1 FROM pg_database WHERE datname='${dbName}'`], {
    encoding: "utf8",
  });
  if (check.status !== 0) throw new Error(`psql: ${check.stderr || check.stdout}`);
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
  console.log(`OK database reset: ${dbName}`);
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
  const child = spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET || "pre-e1-inspect-jwt-secret-with-enough-length-32",
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "false",
      SOMAFRIK_API_ONLY: "true",
      SOMAFRIK_E2E: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (c) => {
    output += c.toString();
  });
  child.stderr.on("data", (c) => {
    output += c.toString();
  });
  return { child, getOutput: () => output };
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
    const err = new Error(`putStateKeys ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = res.status;
    err.data = res.data;
    throw err;
  }
  return res.data;
}

async function setupSchool(superToken, stamp) {
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: `Inspect School ${stamp}`,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `inspect-${stamp}@somafrik.app`,
      principalName: "Directeur Inspect",
      principalEmail: `dir-${stamp}@somafrik.app`,
      force: true,
    },
  });
  if (createRes.status !== 201) throw new Error(JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  const schoolAdminIdentifier = `ADM-INSP-${stamp}`;
  const current = await getState(superToken);
  const schoolAdmin = {
    id: `usr-insp-${stamp}`,
    firstName: "Admin",
    lastName: "Inspect",
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
  const adminToken = await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode);
  return { schoolCode, schoolAdminIdentifier, adminToken };
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

async function buildChain(adminToken, schoolCode, schoolAdminIdentifier, stamp, { dualTeacherIdentity = true } = {}) {
  let state = await getState(adminToken);
  const className = `INSP-${stamp}`;
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
      firstName: `Insp${stamp}`,
      contactType: "Élève",
      phone: `+243 820 ${String(stamp + i).slice(-6)}`,
      email: `eleve-insp-${stamp}-${i}@somafrik.app`,
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
  const teacherContactDraft = {
    id: newId("CONTACT"),
    lastName: "Inspect",
    firstName: `Prof${stamp}`,
    contactType: "Enseignant",
    phone: `+243 831 ${String(stamp).slice(-6)}`,
    email: `prof-insp-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Enseignant",
    status: "Actif",
  };
  const teacherFlow = saveContactWithOptionalUserAccount(
    { ...teacherContactDraft, password: TEACHER_PASSWORD, temporaryPassword: TEACHER_PASSWORD },
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

  // Identité canonique pédagogique TEACHERS-*
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
  // Identité parasite TEACHER-* (simule userTeacherSync) liée au même user, SANS affectation
  const parasiteTeacher = dualTeacherIdentity
    ? {
        id: `TEACHER-${stamp}`,
        userId: teacherUser.id,
        contactId: teacherFlow.contact.id,
        identifier: teacherUser.identifier,
        firstName: teacherUser.firstName,
        lastName: teacherUser.lastName,
        name: teacherUser.lastName,
        schoolCode,
        mainSubject: subject,
      }
    : null;
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
  const course = {
    id: newId("COURSE"),
    name: subject,
    className,
    schoolCode,
    coefficient: 2,
    status: "Actif",
    teacherId: teachersRecord.id,
    teacherName: assignment.teacherName,
  };
  const teachers = parasiteTeacher
    ? [parasiteTeacher, teachersRecord, ...(state.teachers ?? [])]
    : [teachersRecord, ...(state.teachers ?? [])];
  state = await putStateKeys(adminToken, {
    teachers,
    assignments: [assignment, ...(state.assignments ?? [])],
    courses: [course, ...(state.courses ?? [])],
  });

  return {
    className,
    subject,
    period,
    studentIds,
    teacherUser,
    teachersRecord,
    parasiteTeacher,
    assignment,
    course,
  };
}

async function decodeJwtPayload(token) {
  const part = String(token).split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function runInspection() {
  process.env.SOMAFRIK_E2E_TRY_KNOWN_PASSWORDS = "true";
  ensureDatabase();
  let runtime = startBackend();
  let child = runtime.child;
  try {
    await waitForHealth();
    observe("BOOT", "Backend PG healthy", "PASS");

    let superToken;
    try {
      superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
    } catch {
      superToken = await login(SUPERADMIN_ID, "1234");
    }

    const stamp = Date.now();
    const schoolA = await setupSchool(superToken, stamp);
    const schoolB = await setupSchool(superToken, stamp + 1);
    const chain = await buildChain(
      schoolA.adminToken,
      schoolA.schoolCode,
      schoolA.schoolAdminIdentifier,
      stamp,
      { dualTeacherIdentity: true },
    );

    // --- Login enseignant : session assignedClasses + JWT classNames
    const teacherToken = await login(
      chain.teacherUser.identifier,
      TEACHER_PASSWORD,
      schoolA.schoolCode,
    );
    const teacherLogin = await request("/backoffice/me", { token: teacherToken }).catch(() => ({
      status: 0,
      data: null,
    }));
    // Fallback: decode JWT if /me absent
    const jwt = await decodeJwtPayload(teacherToken);
    const assignedFromJwt = jwt.classNames || jwt.assignedClasses || [];
    const jwtHasChainClass = assignedFromJwt.some(
      (name) => normalize(String(name)) === normalize(chain.className),
    );
    observe(
      "SESS-01",
      "JWT enseignant porte classNames non vide après login BO",
      Array.isArray(assignedFromJwt) && assignedFromJwt.length > 0 ? "PASS" : "FAIL",
      `classNames=${JSON.stringify(assignedFromJwt)} role=${jwt.role}`,
      { jwtKeys: Object.keys(jwt), teacherLoginStatus: teacherLogin.status },
    );
    observe(
      "SESS-01b",
      "JWT classNames inclut la classe de la chaîne d'inspection (pas seulement seed démo)",
      jwtHasChainClass ? "PASS" : "FAIL",
      `expectedClass=${chain.className} jwt=${JSON.stringify(assignedFromJwt)}`,
    );

    // --- Tentative d'enrichissement session / escalation
    const escalate = await request("/backoffice/state", {
      method: "PUT",
      token: teacherToken,
      body: {
        teachers: [
          {
            id: chain.teachersRecord.id,
            userId: chain.teacherUser.id,
            assignedClasses: ["HACK-CLASS", chain.className],
            schoolCode: schoolA.schoolCode,
          },
        ],
        assignments: [
          {
            id: newId("ASSIGN"),
            teacherId: chain.teachersRecord.id,
            className: "HACK-CLASS",
            subject: "Physique",
            course: "Physique",
            schoolCode: schoolA.schoolCode,
          },
        ],
        rolePermissions: { Enseignant: ["*"] },
      },
    });
    observe(
      "SESS-02",
      "Enseignant ne peut pas PUT teachers/assignments/rolePermissions",
      escalate.status === 403 || escalate.status === 400 ? "PASS" : "FAIL",
      `HTTP ${escalate.status} ${JSON.stringify(escalate.data?.message ?? escalate.data).slice(0, 200)}`,
    );

    // --- Publish eval + notes via PUT (même API client que verify:pre-e1-v1)
    const stateBeforePut = await getState(schoolA.adminToken);
    const storedTeacher =
      (stateBeforePut.teachers ?? []).find(
        (row) =>
          String(row.userId) === String(chain.teacherUser.id) &&
          String(row.id).startsWith("TEACHERS-"),
      ) ??
      (stateBeforePut.teachers ?? []).find(
        (row) => String(row.userId) === String(chain.teacherUser.id),
      ) ??
      chain.teachersRecord;
    const teacherSessionUser = {
      id: chain.teacherUser.id,
      identifier: chain.teacherUser.identifier,
      firstName: chain.teacherUser.firstName,
      lastName: chain.teacherUser.lastName,
      role: "Enseignant",
      schoolCode: schoolA.schoolCode,
    };
    const putSession = buildGradeEntrySession({
      state: stateBeforePut,
      author: teacherSessionUser,
      evaluationInput: {
        schoolCode: schoolA.schoolCode,
        className: chain.className,
        subject: chain.subject,
        period: chain.period,
        evaluationType: "Devoir",
        title: `Inspect PUT ${stamp}`,
        date: todayPeriodDate(),
        scale: 20,
        coefficient: 1,
        teacherId: storedTeacher.id,
        teacherName: `${storedTeacher.firstName ?? ""} ${storedTeacher.lastName ?? ""}`.trim(),
        status: "Publiée",
      },
      studentGrades: [
        { studentId: chain.studentIds[0], value: 14.5 },
        { studentId: chain.studentIds[1], value: 11 },
      ],
    });
    observe(
      "PUT-00",
      "Construction session évaluation+notes (client rules)",
      putSession.ok ? "PASS" : "FAIL",
      putSession.ok ? "ok" : String(putSession.error),
    );
    if (!putSession.ok) throw new Error(`putSession: ${putSession.error}`);
    const publishedEval = putSession.evaluation;
    const putNotes = gradesToLegacyNotes(putSession.grades);
    const putRes = await request("/backoffice/state", {
      method: "PUT",
      token: teacherToken,
      body: { evaluations: [publishedEval], notes: putNotes },
    });
    observe(
      "PUT-01",
      "PUT state enseignant évaluations+notes accepté",
      putRes.status === 200 ? "PASS" : "FAIL",
      `HTTP ${putRes.status} ${JSON.stringify(putRes.data?.message ?? "").slice(0, 160)}`,
    );

    // --- Inspect PG rows (teachers, assignments, enrollments, evaluations, grades)
    const pgTeachers = await pgQuery(
      `SELECT t.id, t.teacher_code, t.user_id, s.school_code
       FROM teachers t JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 ORDER BY t.teacher_code`,
      [schoolA.schoolCode],
    );
    const pgAssignments = await pgQuery(
      `SELECT ta.id, t.teacher_code, c.name AS class_name, sub.name AS subject_name, ta.status
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1`,
      [schoolA.schoolCode],
    );
    const pgEnrollments = await pgQuery(
      `SELECT e.id, st.student_code, c.name AS class_name
       FROM enrollments e
       JOIN students st ON st.id = e.student_id
       JOIN classes c ON c.id = e.class_id
       JOIN schools s ON s.id = st.school_id
       WHERE s.school_code = $1`,
      [schoolA.schoolCode],
    );
    const pgEvals = await pgQuery(
      `SELECT id, legacy_json_id, teacher_id, title, status
       FROM evaluations WHERE legacy_json_id = $1 OR title = $2`,
      [publishedEval.id, publishedEval.title],
    );
    const pgEvalId = pgEvals[0]?.id ?? null;
    const pgGrades = pgEvalId
      ? await pgQuery(
          `SELECT id, student_id, score, evaluation_id FROM grades WHERE evaluation_id = $1 ORDER BY id`,
          [pgEvalId],
        )
      : [];

    report.pgSnapshots.afterPut = {
      teachers: pgTeachers,
      assignments: pgAssignments,
      enrollments: pgEnrollments,
      evaluations: pgEvals,
      grades: pgGrades,
    };

    observe(
      "PG-TEACHERS",
      "Lignes teachers PG présentes pour l'école A",
      pgTeachers.length >= 1 ? "PASS" : "FAIL",
      `count=${pgTeachers.length} codes=${pgTeachers.map((t) => t.teacher_code).join(",")}`,
      { teachers: pgTeachers },
    );
    const hasTeachersCode = pgTeachers.some((t) => String(t.teacher_code).startsWith("TEACHERS-"));
    const hasTeacherCode = pgTeachers.some(
      (t) => String(t.teacher_code).startsWith("TEACHER-") && !String(t.teacher_code).startsWith("TEACHERS-"),
    );
    observe(
      "ID-DUAL",
      "Coexistence / matérialisation TEACHER-* et TEACHERS-* en PG",
      "OBSERVED",
      `TEACHERS-*=${hasTeachersCode} TEACHER-*=${hasTeacherCode} n=${pgTeachers.length}`,
      {
        boTeachersId: chain.teachersRecord.id,
        boParasiteId: chain.parasiteTeacher?.id ?? null,
        pgCodes: pgTeachers.map((t) => t.teacher_code),
      },
    );
    observe(
      "PG-ASSIGN",
      "teacher_assignments PG liés classe+matière",
      pgAssignments.some(
        (a) => a.class_name === chain.className && a.subject_name === chain.subject && a.status === "active",
      )
        ? "PASS"
        : "FAIL",
      JSON.stringify(pgAssignments).slice(0, 300),
    );
    observe(
      "PG-ENROLL",
      "enrollments PG pour les 2 élèves",
      pgEnrollments.length >= 2 ? "PASS" : "FAIL",
      `count=${pgEnrollments.length}`,
    );
    observe(
      "PG-EVAL",
      "evaluations.teacher_id non null",
      Boolean(pgEvals[0]?.teacher_id) ? "PASS" : "FAIL",
      `teacher_id=${pgEvals[0]?.teacher_id ?? "null"}`,
    );
    observe(
      "PG-GRADES",
      "2 grades PG après PUT",
      pgGrades.length === 2 ? "PASS" : "FAIL",
      `count=${pgGrades.length}`,
    );

    // Lien teacher_id évaluation → teacher_code
    if (pgEvals[0]?.teacher_id) {
      const evalTeacher = await pgQuery(`SELECT teacher_code FROM teachers WHERE id = $1`, [
        pgEvals[0].teacher_id,
      ]);
      const code = evalTeacher[0]?.teacher_code ?? "";
      observe(
        "ID-EVAL-TEACHER",
        "evaluation.teacher_id pointe vers TEACHERS-* (affectation) plutôt que parasite TEACHER-*",
        String(code).startsWith("TEACHERS-") ? "PASS" : String(code) ? "FAIL" : "FAIL",
        `teacher_code=${code}`,
      );
    }

    // --- POST nominal
    const stateA = await getState(schoolA.adminToken);
    const student1 = (stateA.students ?? []).find((row) => row.id === chain.studentIds[0]);
    const studentApiId = student1?.matricule ?? student1?.publicId ?? chain.studentIds[0];
    const postBody = {
      studentId: studentApiId,
      subject: chain.subject,
      className: chain.className,
      schoolCode: schoolA.schoolCode,
      value: 16,
      scale: 20,
      coefficient: 1,
      evaluationCoefficient: 1,
      evaluationId: publishedEval.id,
      period: chain.period,
      date: todayPeriodDate(),
    };
    const postOk = await request("/notes", { method: "POST", token: teacherToken, body: postBody });
    observe(
      "POST-NOMINAL",
      "POST /api/notes autorisé pour affectation correcte",
      postOk.status === 201 ? "PASS" : "FAIL",
      `HTTP ${postOk.status} ${JSON.stringify(postOk.data?.message ?? "").slice(0, 120)}`,
    );

    // --- Négatifs (hors données « heureuses » seules)
    const foreignStudent = {
      id: newId("CONTACT"),
      lastName: "HorsClasse",
      firstName: "X",
      contactType: "Élève",
      phone: `+243 840 ${String(stamp).slice(-6)}`,
      email: `hors-${stamp}@somafrik.app`,
      hasAccess: "Non",
      status: "Actif",
    };
    let adminState = await getState(schoolA.adminToken);
    const foreignContact = saveContactOnly(adminState, foreignStudent, schoolA.schoolCode);
    adminState = await putStateKeys(schoolA.adminToken, { contacts: foreignContact.contacts });
    const foreignLink = linkContactToOperationalRecord(foreignContact.contact, adminState, {
      actor: { identifier: schoolA.schoolAdminIdentifier, role: "Admin School", schoolCode: schoolA.schoolCode },
    });
    adminState = await putStateKeys(schoolA.adminToken, {
      contacts: [foreignLink.contact, ...(adminState.contacts ?? [])],
      students: foreignLink.students.map((s) =>
        s.id === foreignLink.students.find((x) => x.contactId === foreignContact.contact.id)?.id
          ? { ...s, className: `OTHER-${stamp}`, schoolCode: schoolA.schoolCode }
          : s,
      ),
    });
    // ensure OTHER class exists
    adminState = await getState(schoolA.adminToken);
    await putStateKeys(schoolA.adminToken, {
      classes: [
        {
          id: newId("CLASS"),
          name: `OTHER-${stamp}`,
          schoolCode: schoolA.schoolCode,
          level: "5ème",
          academicYear: "2025-2026",
          status: "Active",
        },
        ...(adminState.classes ?? []),
      ],
    });
    const foreignStu = (await getState(schoolA.adminToken)).students?.find(
      (s) => s.contactId === foreignContact.contact.id,
    );
    const negHorsClasse = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        ...postBody,
        studentId: foreignStu?.matricule ?? foreignStu?.id,
        className: `OTHER-${stamp}`,
      },
    });
    observe(
      "NEG-HORS-CLASSE",
      "403 élève hors classe (élève réel autre classe, même école)",
      negHorsClasse.status === 403 ? "PASS" : "FAIL",
      `HTTP ${negHorsClasse.status} ${JSON.stringify(negHorsClasse.data?.message ?? "").slice(0, 160)}`,
    );

    const negMatiere = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: { ...postBody, subject: "Physique" },
    });
    observe(
      "NEG-MATIERE",
      "403 matière non affectée (Physique)",
      negMatiere.status === 403 ? "PASS" : "FAIL",
      `HTTP ${negMatiere.status} ${JSON.stringify(negMatiere.data?.message ?? "").slice(0, 160)}`,
    );

    // School B student isolation — create minimal student in B via admin B
    const chainB = await buildChain(
      schoolB.adminToken,
      schoolB.schoolCode,
      schoolB.schoolAdminIdentifier,
      stamp + 50,
      { dualTeacherIdentity: false },
    );
    const stateB = await getState(schoolB.adminToken);
    const studentB = (stateB.students ?? []).find((s) => s.id === chainB.studentIds[0]);
    const iso = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        ...postBody,
        studentId: studentB?.matricule ?? studentB?.id,
        className: chainB.className,
        schoolCode: schoolB.schoolCode,
        subject: chainB.subject,
        evaluationId: publishedEval.id,
      },
    });
    observe(
      "NEG-ISO-AB",
      "403 isolation enseignant A → élève établissement B",
      iso.status === 403 || iso.status === 400 || iso.status === 404 ? "PASS" : "FAIL",
      `HTTP ${iso.status} ${JSON.stringify(iso.data?.message ?? "").slice(0, 160)}`,
    );

    // --- Idempotence indépendante
    const before = await pgQuery(
      `SELECT id, student_id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );
    const sameHeader = `insp-same-${stamp}`;
    const firstSame = await request("/notes", {
      method: "POST",
      token: teacherToken,
      headers: { "Idempotency-Key": sameHeader },
      body: { ...postBody, value: 15 },
    });
    const afterFirst = await pgQuery(
      `SELECT id, student_id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );
    const secondSame = await request("/notes", {
      method: "POST",
      token: teacherToken,
      headers: { "Idempotency-Key": sameHeader },
      body: { ...postBody, value: 15 },
    });
    const afterSecond = await pgQuery(
      `SELECT id, student_id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );
    const diffHeader = `insp-diff-${stamp}`;
    const differentKey = await request("/notes", {
      method: "POST",
      token: teacherToken,
      headers: { "Idempotency-Key": diffHeader },
      body: { ...postBody, value: 15 },
    });
    const afterDiff = await pgQuery(
      `SELECT id, student_id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );
    const noKey = await request("/notes", {
      method: "POST",
      token: teacherToken,
      body: { ...postBody, value: 15 },
    });
    const afterNoKey = await pgQuery(
      `SELECT id, student_id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );

    // Concurrent same header
    const concurrentHeader = `insp-conc-${stamp}`;
    const concurrentBodies = { ...postBody, value: 13 };
    const [c1, c2, c3] = await Promise.all([
      request("/notes", {
        method: "POST",
        token: teacherToken,
        headers: { "Idempotency-Key": concurrentHeader },
        body: concurrentBodies,
      }),
      request("/notes", {
        method: "POST",
        token: teacherToken,
        headers: { "Idempotency-Key": concurrentHeader },
        body: concurrentBodies,
      }),
      request("/notes", {
        method: "POST",
        token: teacherToken,
        headers: { "Idempotency-Key": concurrentHeader },
        body: concurrentBodies,
      }),
    ]);
    const afterConcurrent = await pgQuery(
      `SELECT id, student_id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );

    const ids = (rows) => rows.map((r) => r.id).sort().join(",");
    report.pgSnapshots.idempotency = {
      before: { count: before.length, ids: before.map((r) => r.id), rows: before },
      afterFirstSameHeader: {
        status: firstSame.status,
        count: afterFirst.length,
        ids: afterFirst.map((r) => r.id),
      },
      afterSecondSameHeader: {
        status: secondSame.status,
        count: afterSecond.length,
        ids: afterSecond.map((r) => r.id),
      },
      afterDifferentHeader: {
        status: differentKey.status,
        count: afterDiff.length,
        ids: afterDiff.map((r) => r.id),
      },
      afterNoHeader: { status: noKey.status, count: afterNoKey.length, ids: afterNoKey.map((r) => r.id) },
      concurrent: {
        statuses: [c1.status, c2.status, c3.status],
        count: afterConcurrent.length,
        ids: afterConcurrent.map((r) => r.id),
      },
    };

    observe(
      "IDEM-SAME",
      "Même en-tête idempotence : pas de ligne supplémentaire",
      afterFirst.length === before.length &&
        afterSecond.length === before.length &&
        ids(afterSecond) === ids(before) &&
        (firstSame.status === 201 || firstSame.status === 200) &&
        (secondSame.status === 201 || secondSame.status === 200)
        ? "PASS"
        : "FAIL",
      `avant=${before.length} après1=${afterFirst.length} après2=${afterSecond.length} HTTP ${firstSame.status}/${secondSame.status}`,
    );
    observe(
      "IDEM-DIFF",
      "En-tête différent + même payload : pas de ligne supplémentaire (upsert métier)",
      afterDiff.length === before.length && ids(afterDiff) === ids(before) ? "PASS" : "FAIL",
      `count=${afterDiff.length} HTTP ${differentKey.status}`,
    );
    observe(
      "IDEM-NONE",
      "Sans en-tête : pas de ligne supplémentaire",
      afterNoKey.length === before.length && ids(afterNoKey) === ids(before) ? "PASS" : "FAIL",
      `count=${afterNoKey.length} HTTP ${noKey.status}`,
    );
    observe(
      "IDEM-CONC",
      "Appels concurrents même en-tête : pas de lignes supplémentaires",
      afterConcurrent.length === before.length ? "PASS" : "FAIL",
      `count=${afterConcurrent.length} statuses=${[c1.status, c2.status, c3.status].join(",")}`,
    );

    // --- Restart backend + compare JSON vs PG
    const jsonBeforeRestart = await getState(schoolA.adminToken);
    const jsonNotesBefore = (jsonBeforeRestart.notes ?? []).filter(
      (n) => n.evaluationId === publishedEval.id,
    );
    const pgBeforeRestart = await pgQuery(
      `SELECT id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );
    await stopBackend(child);
    runtime = startBackend();
    child = runtime.child;
    await waitForHealth();
    const adminRelogin = await login(
      schoolA.schoolAdminIdentifier,
      ADMIN_PASSWORD,
      schoolA.schoolCode,
    );
    const jsonAfter = await getState(adminRelogin);
    const jsonNotesAfter = (jsonAfter.notes ?? []).filter((n) => n.evaluationId === publishedEval.id);
    const pgAfterRestart = await pgQuery(
      `SELECT id, score FROM grades WHERE evaluation_id = $1 ORDER BY id`,
      [pgEvalId],
    );
    const pgEvalAfter = await pgQuery(`SELECT id, teacher_id FROM evaluations WHERE id = $1`, [
      pgEvalId,
    ]);
    report.pgSnapshots.afterRestart = {
      jsonNotesCount: jsonNotesAfter.length,
      pgGrades: pgAfterRestart,
      evaluation: pgEvalAfter[0] ?? null,
    };
    observe(
      "RESTART-JSON",
      "Notes JSON présentes après redémarrage backend",
      jsonNotesAfter.length === jsonNotesBefore.length && jsonNotesAfter.length >= 1 ? "PASS" : "FAIL",
      `before=${jsonNotesBefore.length} after=${jsonNotesAfter.length}`,
    );
    observe(
      "RESTART-PG",
      "Grades PG inchangés après redémarrage",
      pgAfterRestart.length === pgBeforeRestart.length &&
        ids(pgAfterRestart) === ids(pgBeforeRestart)
        ? "PASS"
        : "FAIL",
      `before=${pgBeforeRestart.length} after=${pgAfterRestart.length}`,
    );
    observe(
      "RESTART-SOT",
      "Cohérence JSON notes vs PG grades après restart",
      jsonNotesAfter.length === pgAfterRestart.length && jsonNotesAfter.length > 0 ? "PASS" : "FAIL",
      `json=${jsonNotesAfter.length} pg=${pgAfterRestart.length}`,
    );

    // Meta: unit tests are stubs
    observe(
      "META-UNIT-STUB",
      "Suite verify:pre-e1-hotfix-02 utilise un stub mémoire (pas de PG réel)",
      "GAP",
      "pedagogyStaffSyncRepository.test.js → createInjectablePostgresRepository / repo.tables.*",
    );
    observe(
      "META-V1-ASSERT",
      "DUP-01 V1 n'exige pas clé différente ni concurrence ; idsUnchanged calculé mais non gating",
      "GAP",
      "voir scripts/verify-pre-e1-v1.js — idemOk sans idsUnchangedWithKey ; pas IDEM-DIFF/CONC",
    );
  } finally {
    await stopBackend(child);
  }
}

async function main() {
  console.log("=== INSPECTION INDÉPENDANTE HOTFIX-PRE-E1-02 (≠ validation CTO) ===");
  try {
    await runInspection();
  } catch (error) {
    observe("HARNESS", "Harness inspection", "FAIL", String(error?.stack || error));
  }
  report.generatedAt = new Date().toISOString();
  const pass = observations.filter((o) => o.status === "PASS").length;
  const fail = observations.filter((o) => o.status === "FAIL").length;
  const gap = observations.filter((o) => o.status === "GAP" || o.status === "OBSERVED").length;
  report.summary = {
    total: observations.length,
    pass,
    fail,
    gapOrObserved: gap,
    ctoDecision: "NOT_CLAIMED",
    note: "Rapport Cursor ≠ validation CTO. Ce fichier est une affirmation d'inspection à arbitrer.",
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const out = path.join(EVIDENCE_DIR, "pre-e1-hotfix-02-independent-inspection.json");
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nEvidence: ${out}`);
  console.log(`Summary: PASS=${pass} FAIL=${fail} GAP/OBSERVED=${gap} (CTO decision NOT claimed)`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
