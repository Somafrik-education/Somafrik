/**
 * AUDIT PRE-E1 — V1 : validation de la chaîne intégrée
 *
 * Classe → Élève → Enseignant → Matière → Affectation → Évaluation → Note
 * → Rechargement → Persistance
 *
 * Aucune correction métier : chaque échec est documenté comme anomalie.
 *
 *   npm run verify:pre-e1-v1
 *
 * Variables utiles :
 *   DATABASE_URL=postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_v1
 *   SOMAFRIK_PRE_E1_PORT=5101
 *   SOMAFRIK_API_URL=...   (si déjà un backend PG joignable — sinon spawn local)
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const DEFAULT_DB = "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_v1";
const DATABASE_URL = String(process.env.DATABASE_URL || DEFAULT_DB).trim();
const PORT = String(process.env.SOMAFRIK_PRE_E1_PORT || 5101);
const ADMIN_PASSWORD = "E2eTest!2026";
const TEACHER_PASSWORD = "E2eTeach1";

// base URL capturée au require de e2e-api-helpers — doit être positionnée avant.
const API_BASE = process.env.SOMAFRIK_API_URL || `http://127.0.0.1:${PORT}/api`;
process.env.SOMAFRIK_API_URL = API_BASE;

const helpers = require("./e2e-api-helpers");
const {
  createEvaluation,
  buildGradeEntrySession,
  gradesToLegacyNotes,
  validateGradeValue,
} = require("./e2e-grades-rules");
const { saveContactWithOptionalUserAccount } = require("./e2e-user-account-rules");
const {
  prepareContactForSave,
  assertContactRequiredFields,
  validateContactDuplicate,
} = require("./e2e-contacts-rules");
const { linkContactToOperationalRecord } = require("../backend/lib/contactRegistrySync");

const {
  request: helperRequest,
  login,
  getState,
  putState,
  newId,
  normalize,
  todayPeriodDate,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
} = helpers;

const results = [];
const anomalies = [];
const evidence = {
  engine: null,
  databaseUrlHost: redactDb(DATABASE_URL),
  jsonSnapshots: {},
  postgresSnapshots: {},
  commands: [],
};

function redactDb(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[invalid]";
  }
}

function record(id, title, expected, obtained, ok, { severity = null, detail = null } = {}) {
  const row = {
    id,
    title,
    expected,
    obtained: obtained == null ? "" : String(obtained),
    ok: Boolean(ok),
    severity: ok ? null : severity || "MAJOR",
    detail: detail || null,
  };
  results.push(row);
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} [${id}] ${title} — attendu=${expected} obtenu=${row.obtained}`);
  if (!ok) {
    anomalies.push({
      id: `V1-${id}`,
      title,
      severity: row.severity,
      expected,
      obtained: row.obtained,
      detail,
      reproducible: detail || `Relancer npm run verify:pre-e1-v1 — scénario ${id}`,
    });
  }
  return ok;
}

async function request(pathname, options = {}) {
  return helperRequest(pathname, options);
}

/** PUT partiel sans renvoyer auditLog / collections non touchées (évite 403 S1.4). */
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

async function setupSchoolForV1(superToken, stamp) {
  const schoolName = `E2E School ${stamp}`;
  const schoolAdminId = `usr-e2e-${stamp}`;
  const schoolAdminIdentifier = `ADM-E2E-${stamp}`;
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: schoolName,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `e2e-${stamp}@somafrik.app`,
      principalName: "Directeur E2E",
      principalEmail: `directeur-${stamp}@somafrik.app`,
      force: true,
    },
  });
  assert.strictEqual(createRes.status, 201, `create school: ${JSON.stringify(createRes.data)}`);
  const schoolCode = createRes.data.school?.code;
  assert.ok(schoolCode, "Code établissement manquant");

  const current = await getState(superToken);
  const schoolAdmin = {
    id: schoolAdminId,
    firstName: "Admin",
    lastName: "E2E",
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
  const nextUsers = [
    ...(current.users ?? []).filter(
      (user) => normalize(user.identifier) !== normalize(schoolAdminIdentifier),
    ),
    schoolAdmin,
  ];
  await putStateKeys(superToken, { users: nextUsers });
  const adminToken = await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode);
  return { schoolCode, schoolName, schoolAdminIdentifier, adminToken };
}

function ensureDatabase() {
  evidence.commands.push("ensureDatabase via psql");
  const parsed = new URL(DATABASE_URL);
  const dbName = parsed.pathname.replace(/^\//, "") || "somafrik_pre_e1_v1";
  const adminUrl = `postgresql://somafrik:somafrik@${parsed.hostname}:${parsed.port || 5432}/postgres`;
  const sql = `SELECT 1 FROM pg_database WHERE datname='${dbName.replace(/'/g, "''")}'`;
  const check = spawnSync(
    "psql",
    [adminUrl, "-tAc", sql],
    { encoding: "utf8" },
  );
  if (check.status !== 0) {
    throw new Error(`psql indisponible pour créer la base: ${check.stderr || check.stdout}`);
  }
  if (String(check.stdout).trim() !== "1") {
    const created = spawnSync(
      "psql",
      [adminUrl, "-c", `CREATE DATABASE ${dbName} OWNER somafrik`],
      { encoding: "utf8" },
    );
    if (created.status !== 0) {
      throw new Error(`CREATE DATABASE échoué: ${created.stderr || created.stdout}`);
    }
  }
  // Reset schéma pour un run déterministe
  const reset = spawnSync(
    "psql",
    [DATABASE_URL, "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO somafrik;"],
    { encoding: "utf8" },
  );
  if (reset.status !== 0) {
    throw new Error(`Reset schema échoué: ${reset.stderr || reset.stdout}`);
  }
  console.log(`OK database: ${dbName} réinitialisée`);
}

async function waitForHealth(base, timeoutMs = 90000) {
  const healthUrl = `${base.replace(/\/api\/?$/, "")}/api/health`;
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(healthUrl, { signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      );
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        return body;
      }
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`API non prête (${healthUrl}): ${lastError?.message ?? "timeout"}`);
}

async function startBackend() {
  evidence.commands.push(`spawn backend PORT=${PORT} DATABASE_URL=...`);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET || "pre-e1-v1-jwt-secret-with-enough-length-32chars",
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
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    const health = await waitForHealth(API_BASE, 120000);
    evidence.engine = health?.database || health?.repository?.engine || health?.engine || "postgresql(assumed)";
    console.log(`OK runtime: backend PG démarré sur ${API_BASE} engine=${evidence.engine}`);
    return { child, output };
  } catch (error) {
    child.kill("SIGTERM");
    if (output) console.error(output.slice(-4000));
    throw error;
  }
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
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* ignore */
  }
}

async function pgQuery(sql, params = []) {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } finally {
    await pool.end();
  }
}

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

function classifyAnomalies(list) {
  const order = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 3, INFORMATION: 4 };
  return [...list].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}

function recommendationFrom(anomaliesList) {
  const hasBlocker = anomaliesList.some((a) => a.severity === "BLOCKER");
  const hasCritical = anomaliesList.some((a) => a.severity === "CRITICAL");
  if (hasBlocker || hasCritical) {
    return {
      launchV2: false,
      decision: "BLOQUER V2",
      rationale:
        "V1 a mis en évidence des anomalies BLOCKER/CRITICAL sur la chaîne notes/relations. Corriger ou arbitrer avant d’ouvrir V2 (modèle/intégrité approfondi).",
    };
  }
  if (anomaliesList.some((a) => a.severity === "MAJOR")) {
    return {
      launchV2: true,
      decision: "V2 AUTORISABLE AVEC RÉSERVES",
      rationale:
        "Chaîne nominale prouvée avec anomalies MAJOR documentées. V2 peut approfondir le modèle, sans ouvrir E1.",
    };
  }
  return {
    launchV2: true,
    decision: "V2 AUTORISABLE",
    rationale: "Chaîne V1 verte sans BLOCKER/CRITICAL. V2 peut démarrer sur instruction CTO.",
  };
}

async function buildPedagogyChain(adminToken, schoolCode, schoolAdminIdentifier, stamp, label) {
  const className = `V1-${label}-${String(stamp).slice(-4)}`;
  const subject = "Mathématiques";
  const period = "Trimestre 1";
  let state = await getState(adminToken);

  const newClass = {
    id: newId("CLASS"),
    name: className,
    className,
    level: "3ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  state = await putStateKeys(adminToken, {
    classes: [newClass, ...(state.classes ?? [])],
    academicConfigs: {
      ...(state.academicConfigs ?? {}),
      [schoolCode]: {
        ...(state.academicConfigs?.[schoolCode] ?? {}),
        periods: [{ name: period, startDate: "01-09-2025", endDate: "31-12-2025" }],
        evaluationTypes: ["Devoir", "Interrogation", "Composition"],
        subjects: [
          ...new Set([
            ...((state.academicConfigs?.[schoolCode]?.subjects ?? []).map(String)),
            subject,
          ]),
        ],
      },
    },
  });

  const studentIds = [];
  const studentRows = [];
  for (let index = 0; index < 2; index += 1) {
    const contactFlow = saveContactOnly(
      state,
      {
        id: newId("CONTACT"),
        lastName: index === 0 ? "Mbuyi" : "Tshilombo",
        firstName: `V1${label}${stamp}${index}`,
        contactType: "Élève",
        phone: `+243 810 ${String(stamp + index).slice(-6)}`,
        email: `v1-${label}-${stamp}-${index}@somafrik.app`,
        status: "Actif",
      },
      schoolCode,
    );
    assert.ok(contactFlow.ok, contactFlow.error);
    const link = linkContactToOperationalRecord(contactFlow.contact, state, schoolCode);
    assert.strictEqual(link.linkedType, "student");
    state = await putStateKeys(adminToken, {
      contacts: [link.contact, ...(state.contacts ?? [])],
      students: link.students,
    });
    const student = (state.students ?? []).find(
      (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
    );
    assert.ok(student, "Fiche élève absente");
    const enrolled = { ...student, className, schoolCode };
    state = await putStateKeys(adminToken, {
      students: (state.students ?? []).map((row) => (row.id === student.id ? enrolled : row)),
    });
    studentIds.push(student.id);
    studentRows.push(enrolled);
  }

  const teacherContactDraft = {
    id: newId("CONTACT"),
    lastName: "Kabongo",
    firstName: `Prof${label}${stamp}`,
    contactType: "Enseignant",
    phone: `+243 831 ${String(stamp).slice(-6)}`,
    email: `prof-v1-${label}-${stamp}@somafrik.app`,
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
  assert.ok(teacherFlow.ok, teacherFlow.error);
  const teacherUserWithPassword = {
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
      row.id === teacherUserWithPassword.id ? teacherUserWithPassword : row,
    ),
  });
  const teacherRecord = {
    id: newId("TEACHERS"),
    userId: teacherUserWithPassword.id,
    contactId: teacherFlow.contact.id,
    identifier: teacherUserWithPassword.identifier,
    firstName: teacherUserWithPassword.firstName,
    lastName: teacherUserWithPassword.lastName,
    name: teacherUserWithPassword.lastName,
    schoolCode,
    mainSubject: subject,
  };
  const assignment = {
    id: newId("ASSIGN"),
    teacherId: teacherRecord.id,
    teacherName: `${teacherRecord.firstName} ${teacherRecord.lastName}`.trim(),
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
    teacherId: teacherRecord.id,
    teacherName: assignment.teacherName,
  };
  state = await putStateKeys(adminToken, {
    teachers: [teacherRecord, ...(state.teachers ?? [])],
    assignments: [assignment, ...(state.assignments ?? [])],
    courses: [course, ...(state.courses ?? [])],
  });

  return {
    className,
    subject,
    period,
    studentIds,
    studentRows,
    teacherUser: teacherUserWithPassword,
    teacherRecord,
    assignment,
    course,
    state,
  };
}

async function runScenarios(runtime) {
  const stamp = Date.now();
  evidence.commands.push("login superadmin + setupSchoolForV1 A/B");

  // Mot de passe seed démo souvent 1234 ; helper gère les candidats.
  process.env.SOMAFRIK_E2E_TRY_KNOWN_PASSWORDS = "true";
  let superToken;
  try {
    superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  } catch {
    superToken = await login(SUPERADMIN_ID, "1234");
  }
  record("AUTH-01", "Superadmin connecté", "token", superToken ? "token" : "null", Boolean(superToken), {
    severity: "BLOCKER",
  });

  const schoolA = await setupSchoolForV1(superToken, stamp);
  const schoolB = await setupSchoolForV1(superToken, stamp + 1);
  record("AUTH-02", "Établissements A et B créés", "2 codes", `${schoolA.schoolCode},${schoolB.schoolCode}`, Boolean(schoolA.schoolCode && schoolB.schoolCode), {
    severity: "BLOCKER",
  });

  // Remplacer mots de passe admin créés via setup (déjà ADMIN_PASSWORD E2e).
  const chainA = await buildPedagogyChain(
    schoolA.adminToken,
    schoolA.schoolCode,
    schoolA.schoolAdminIdentifier,
    stamp,
    "A",
  );
  record(
    "CHAIN-01",
    "Classe A + 2 élèves + enseignant + matière + affectation",
    "2 élèves",
    String(chainA.studentIds.length),
    chainA.studentIds.length === 2,
    { severity: "BLOCKER", detail: `class=${chainA.className} students=${chainA.studentIds.join(",")}` },
  );

  const teacherToken = await login(
    chainA.teacherUser.identifier,
    TEACHER_PASSWORD,
    schoolA.schoolCode,
  );
  record("AUTH-03", "Enseignant A connecté", "token", teacherToken ? "token" : "null", Boolean(teacherToken), {
    severity: "CRITICAL",
  });

  let stateA = await getState(schoolA.adminToken);
  const storedTeacher =
    (stateA.teachers ?? []).find((row) => String(row.userId) === String(chainA.teacherUser.id)) ??
    chainA.teacherRecord;
  const effectiveTeacherId = storedTeacher.id;
  const effectiveTeacherName =
    `${storedTeacher.firstName ?? ""} ${storedTeacher.lastName ?? storedTeacher.name ?? ""}`.trim() ||
    chainA.assignment.teacherName;

  const teacherSessionUser = {
    id: chainA.teacherUser.id,
    identifier: chainA.teacherUser.identifier,
    firstName: chainA.teacherUser.firstName,
    lastName: chainA.teacherUser.lastName,
    role: "Enseignant",
    schoolCode: schoolA.schoolCode,
  };

  // --- Évaluation + notes via PUT /api/backoffice/state (élève 1)
  const putSession = buildGradeEntrySession({
    state: stateA,
    author: teacherSessionUser,
    evaluationInput: {
      schoolCode: schoolA.schoolCode,
      className: chainA.className,
      subject: chainA.subject,
      period: chainA.period,
      evaluationType: "Devoir",
      title: `Devoir V1 PUT ${stamp}`,
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 1,
      teacherId: effectiveTeacherId,
      teacherName: effectiveTeacherName,
      status: "Publiée",
    },
    studentGrades: [
      { studentId: chainA.studentIds[0], value: 14.5 },
      { studentId: chainA.studentIds[1], value: 11 },
    ],
  });
  record(
    "PUT-01",
    "Construction session évaluation+notes (client rules)",
    "ok",
    putSession.ok ? "ok" : putSession.error,
    putSession.ok,
    { severity: "BLOCKER", detail: putSession.error },
  );
  if (!putSession.ok) {
    return;
  }

  const publishedEval = putSession.evaluation;
  const putNotes = gradesToLegacyNotes(putSession.grades);
  const putRes = await request("/backoffice/state", {
    method: "PUT",
    token: teacherToken,
    body: {
      evaluations: [publishedEval],
      notes: putNotes,
    },
  });
  record(
    "PUT-02",
    "Note écrite via PUT /api/backoffice/state",
    "200",
    String(putRes.status),
    putRes.status === 200,
    {
      severity: "BLOCKER",
      detail: JSON.stringify(putRes.data?.message ?? putRes.data ?? {}).slice(0, 400),
    },
  );

  // Rechargement / nouveau contexte
  const adminTokenReload = await login(
    schoolA.schoolAdminIdentifier,
    ADMIN_PASSWORD,
    schoolA.schoolCode,
  );
  stateA = await getState(adminTokenReload);
  const evalInState = (stateA.evaluations ?? []).find((row) => row.id === publishedEval.id);
  const notesInState = (stateA.notes ?? []).filter((row) => row.evaluationId === publishedEval.id);
  evidence.jsonSnapshots.afterPutReload = {
    evaluation: evalInState
      ? {
          id: evalInState.id,
          className: evalInState.className,
          subject: evalInState.subject,
          schoolCode: evalInState.schoolCode,
          teacherId: evalInState.teacherId,
          period: evalInState.period,
        }
      : null,
    notes: notesInState.map((n) => ({
      id: n.id,
      studentId: n.studentId,
      value: n.value,
      evaluationId: n.evaluationId,
      className: n.className,
      subject: n.subject,
      schoolCode: n.schoolCode,
    })),
  };
  record(
    "RELOAD-01",
    "Persistance évaluation après nouveau login admin",
    publishedEval.id,
    evalInState?.id ?? "absent",
    Boolean(evalInState),
    { severity: "BLOCKER" },
  );
  record(
    "RELOAD-02",
    "Persistance 2 notes après rechargement state",
    "2",
    String(notesInState.length),
    notesInState.length === 2,
    { severity: "BLOCKER" },
  );
  record(
    "REL-01",
    "Liens textuels className/subject conservés (JSON)",
    `${chainA.className}|${chainA.subject}`,
    `${evalInState?.className ?? ""}|${evalInState?.subject ?? ""}`,
    normalize(evalInState?.className) === normalize(chainA.className) &&
      normalize(evalInState?.subject) === normalize(chainA.subject),
    { severity: "CRITICAL" },
  );
  record(
    "REL-02",
    "evaluation_id présent sur notes JSON",
    publishedEval.id,
    notesInState.every((n) => n.evaluationId === publishedEval.id) ? publishedEval.id : "mismatch",
    notesInState.length === 2 && notesInState.every((n) => n.evaluationId === publishedEval.id),
    { severity: "CRITICAL" },
  );

  // PG observation après PUT
  const pgEvals = await pgQuery(
    `SELECT id, legacy_json_id, title, max_score, coefficient, status,
            (SELECT name FROM classes c WHERE c.id = evaluations.class_id) AS class_name,
            (SELECT name FROM subjects s WHERE s.id = evaluations.subject_id) AS subject_name,
            teacher_id, term_id, school_id
     FROM evaluations
     WHERE legacy_json_id = $1 OR title = $2`,
    [publishedEval.id, publishedEval.title],
  );
  evidence.postgresSnapshots.afterPut = { evaluations: pgEvals };
  record(
    "PG-01",
    "Évaluation synchronisée en PostgreSQL après PUT state",
    ">=1 row",
    String(pgEvals.length),
    pgEvals.length >= 1,
    { severity: "CRITICAL", detail: "Source de vérité PG pour E1" },
  );
  record(
    "PG-01b",
    "Évaluation PG porte teacher_id non null",
    "teacher_id UUID",
    String(pgEvals[0]?.teacher_id ?? "null"),
    Boolean(pgEvals[0]?.teacher_id),
    {
      severity: "CRITICAL",
      detail: "Sans teacher_id PG, rattachement enseignant du bulletin ambigu",
    },
  );

  const pgStudents = await pgQuery(
    `SELECT st.id, st.student_code, st.first_name, st.last_name, s.school_code
     FROM students st
     JOIN schools s ON s.id = st.school_id
     WHERE s.school_code = $1`,
    [schoolA.schoolCode],
  );
  evidence.postgresSnapshots.studentsSchoolA = pgStudents;
  const jsonStudentCodes = chainA.studentIds;
  const matchedStudents = jsonStudentCodes.filter((id) =>
    pgStudents.some(
      (row) =>
        String(row.student_code) === String(id) ||
        String(row.id) === String(id) ||
        String(row.student_code).includes(String(id).slice(-8)),
    ),
  );
  record(
    "PG-01c",
    "Élèves de la chaîne présents en PostgreSQL (lookup POST /notes)",
    "2",
    `${pgStudents.length} PG / ${matchedStudents.length} match ids JSON`,
    matchedStudents.length === 2,
    {
      severity: "BLOCKER",
      detail:
        matchedStudents.length === 2
          ? null
          : `JSON ids=${jsonStudentCodes.join(",")} — PG codes=${pgStudents.map((r) => r.student_code).join(",") || "(aucun)"}`,
    },
  );

  let pgEvalId = pgEvals[0]?.id ?? null;
  let pgGrades = [];
  if (pgEvalId) {
    pgGrades = await pgQuery(
      `SELECT id, evaluation_id, student_id, score, max_score, grade_status, subject_id, class_id, teacher_id
       FROM grades WHERE evaluation_id = $1`,
      [pgEvalId],
    );
    evidence.postgresSnapshots.afterPut.grades = pgGrades;
  }
  record(
    "PG-02",
    "Notes présentes en PG liées à evaluation_id (après PUT)",
    "2",
    String(pgGrades.length),
    pgGrades.length === 2 && pgGrades.every((g) => g.evaluation_id === pgEvalId),
    {
      severity: "CRITICAL",
      detail: pgGrades.length
        ? `evaluation_id=${pgEvalId}`
        : "Aucune grade PG — sync PUT→PG absente ou partielle",
    },
  );

  // --- Note via POST /api/notes (mise à jour élève 1)
  const student1 = (stateA.students ?? []).find((row) => row.id === chainA.studentIds[0]);
  const studentApiId = student1?.matricule ?? student1?.publicId ?? chainA.studentIds[0];
  const postBody = {
    studentId: studentApiId,
    subject: chainA.subject,
    className: chainA.className,
    schoolCode: schoolA.schoolCode,
    value: 16,
    scale: 20,
    coefficient: 1,
    evaluationCoefficient: 1,
    evaluationId: publishedEval.id,
    period: chainA.period,
    date: todayPeriodDate(),
  };
  const postRes = await request("/notes", {
    method: "POST",
    token: teacherToken,
    body: postBody,
  });
  record(
    "POST-01",
    "Note écrite via POST /api/notes",
    "201",
    String(postRes.status),
    postRes.status === 201,
    {
      severity: "BLOCKER",
      detail: JSON.stringify(postRes.data?.message ?? postRes.data ?? {}).slice(0, 500),
    },
  );
  evidence.jsonSnapshots.postNotesResponse = postRes.data;

  // Relecture API
  const notesApiAdmin = await request("/notes", { token: adminTokenReload });
  const notesList = Array.isArray(notesApiAdmin.data)
    ? notesApiAdmin.data
    : notesApiAdmin.data?.items ?? notesApiAdmin.data?.rows ?? [];
  const matchingApiNotes = notesList.filter(
    (row) =>
      String(row.evaluationId ?? row.evaluation_id ?? "") === String(publishedEval.id) ||
      String(row.evaluationId ?? row.evaluation_id ?? "") === String(pgEvalId ?? ""),
  );
  evidence.jsonSnapshots.getNotes = {
    status: notesApiAdmin.status,
    total: notesList.length,
    matching: matchingApiNotes.length,
    sample: matchingApiNotes.slice(0, 3),
  };
  record(
    "API-01",
    "Relecture GET /api/notes (admin A)",
    "200 + notes chaîne",
    `${notesApiAdmin.status}/${matchingApiNotes.length}`,
    notesApiAdmin.status === 200 && matchingApiNotes.length >= 1,
    { severity: "CRITICAL" },
  );

  // PG après POST
  if (pgEvalId) {
    pgGrades = await pgQuery(
      `SELECT id, evaluation_id, student_id, score, max_score, grade_status
       FROM grades WHERE evaluation_id = $1 ORDER BY updated_at DESC`,
      [pgEvalId],
    );
    evidence.postgresSnapshots.afterPost = { grades: pgGrades };
  }
  if (postRes.status === 201) {
    const score16 = pgGrades.some((g) => Number(g.score) === 16);
    record(
      "PG-03",
      "POST /api/notes reflété en PG (score 16)",
      "score=16 présent",
      score16 ? "oui" : `scores=[${pgGrades.map((g) => g.score).join(",")}]`,
      score16,
      {
        severity: "CRITICAL",
        detail: score16 ? null : "POST accepté mais score 16 absent en PG",
      },
    );
  } else {
    record(
      "PG-03",
      "POST /api/notes reflété en PG (score 16)",
      "N/A si POST échoue",
      "N/A",
      true,
      { severity: "INFORMATION", detail: "Non évaluable tant que POST-01 échoue" },
    );
  }

  // Double soumission POST (idempotency key)
  const idemKey = `pre-e1-v1-${stamp}`;
  const firstIdem = await request("/notes", {
    method: "POST",
    token: teacherToken,
    headers: { "Idempotency-Key": idemKey },
    body: { ...postBody, value: 15 },
  });
  const secondIdem = await request("/notes", {
    method: "POST",
    token: teacherToken,
    headers: { "Idempotency-Key": idemKey },
    body: { ...postBody, value: 15 },
  });
  const gradesAfterIdem = pgEvalId
    ? await pgQuery(`SELECT id, score FROM grades WHERE evaluation_id = $1`, [pgEvalId])
    : [];
  evidence.postgresSnapshots.afterIdempotency = {
    firstStatus: firstIdem.status,
    secondStatus: secondIdem.status,
    gradeCount: gradesAfterIdem.length,
  };
  if (firstIdem.status >= 400) {
    record(
      "DUP-01",
      "Double soumission POST (Idempotency-Key) sans duplication grade",
      "POST utilisable + <=2 grades",
      `HTTP ${firstIdem.status}/${secondIdem.status}`,
      false,
      {
        severity: "CRITICAL",
        detail: `Impossible de prouver l'idempotence: ${JSON.stringify(firstIdem.data).slice(0, 300)}`,
      },
    );
  } else {
    const idemOk =
      (secondIdem.status === 201 || secondIdem.status === 200) && gradesAfterIdem.length <= 2;
    record(
      "DUP-01",
      "Double soumission POST (Idempotency-Key) sans duplication grade",
      "<=2 grades / eval",
      `${gradesAfterIdem.length} (HTTP ${firstIdem.status}/${secondIdem.status})`,
      idemOk,
      {
        severity: "CRITICAL",
        detail: gradesAfterIdem.length > 2 ? "Duplication détectée" : null,
      },
    );
  }

  // Double PUT state (même payload)
  const putTwice1 = await request("/backoffice/state", {
    method: "PUT",
    token: teacherToken,
    body: { evaluations: [publishedEval], notes: putNotes },
  });
  const putTwice2 = await request("/backoffice/state", {
    method: "PUT",
    token: teacherToken,
    body: { evaluations: [publishedEval], notes: putNotes },
  });
  const notesAfterDoublePut = (await getState(adminTokenReload)).notes?.filter(
    (n) => n.evaluationId === publishedEval.id,
  );
  record(
    "DUP-02",
    "Double PUT state sans explosion de notes JSON",
    "2 notes / eval",
    String(notesAfterDoublePut?.length ?? 0),
    putTwice1.status === 200 &&
      putTwice2.status === 200 &&
      (notesAfterDoublePut?.length ?? 0) === 2,
    {
      severity: "MAJOR",
      detail: `HTTP ${putTwice1.status}/${putTwice2.status}`,
    },
  );

  // --- Cas négatifs POST
  async function expectReject(id, title, body, expectedStatuses = [400, 403, 404]) {
    const res = await request("/notes", { method: "POST", token: teacherToken, body });
    const ok = expectedStatuses.includes(res.status);
    record(id, title, expectedStatuses.join("|"), String(res.status), ok, {
      severity: ok ? null : "CRITICAL",
      detail: ok
        ? JSON.stringify(res.data?.message ?? res.data).slice(0, 240)
        : `ACCEPTÉ À TORT — ${JSON.stringify(res.data).slice(0, 400)}`,
    });
    return res;
  }

  await expectReject("NEG-01", "Note négative refusée", { ...postBody, value: -1 });
  await expectReject("NEG-02", "Note > maximum refusée", { ...postBody, value: 21, scale: 20 });

  // Élève hors classe : créer un 3e élève dans une autre classe du même établissement
  const otherClassName = `${chainA.className}-X`;
  stateA = await getState(adminTokenReload);
  stateA = await putStateKeys(adminTokenReload, {
    classes: [
      {
        id: newId("CLASS"),
        name: otherClassName,
        className: otherClassName,
        level: "3ème",
        schoolCode: schoolA.schoolCode,
        status: "Actif",
      },
      ...(stateA.classes ?? []),
    ],
  });
  const outsiderContact = saveContactOnly(
    stateA,
    {
      id: newId("CONTACT"),
      lastName: "HorsClasse",
      firstName: `Out${stamp}`,
      contactType: "Élève",
      phone: `+243 811 ${String(stamp).slice(-6)}`,
      email: `out-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolA.schoolCode,
  );
  const outsiderLink = linkContactToOperationalRecord(outsiderContact.contact, stateA, schoolA.schoolCode);
  stateA = await putStateKeys(adminTokenReload, {
    contacts: [outsiderLink.contact, ...(stateA.contacts ?? [])],
    students: outsiderLink.students,
  });
  const outsider = (stateA.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(outsiderContact.contact.id),
  );
  stateA = await putStateKeys(adminTokenReload, {
    students: (stateA.students ?? []).map((row) =>
      row.id === outsider.id ? { ...row, className: otherClassName, schoolCode: schoolA.schoolCode } : row,
    ),
  });
  await expectReject(
    "NEG-03",
    "Élève hors classe de l'évaluation refusé",
    {
      ...postBody,
      studentId: outsider.id,
      className: chainA.className,
      value: 10,
    },
    [400, 403, 404],
  );

  // Matière non affectée : évaluation Physique sans affectation enseignant
  const physicsEval = createEvaluation(
    {
      schoolCode: schoolA.schoolCode,
      className: chainA.className,
      subject: "Physique",
      period: chainA.period,
      evaluationType: "Devoir",
      title: `Physique non affectée ${stamp}`,
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 1,
      teacherId: effectiveTeacherId,
      teacherName: effectiveTeacherName,
      status: "Publiée",
    },
    teacherSessionUser,
  );
  const physicsPut = await request("/backoffice/state", {
    method: "PUT",
    token: teacherToken,
    body: { evaluations: [physicsEval], notes: [] },
  });
  record(
    "NEG-04a",
    "PUT évaluation matière non affectée (Physique) — refus attendu enseignant",
    "403|400",
    String(physicsPut.status),
    physicsPut.status === 403 || physicsPut.status === 400,
    {
      severity: "CRITICAL",
      detail:
        physicsPut.status === 200
          ? "Enseignant a pu créer une évaluation Physique sans affectation"
          : JSON.stringify(physicsPut.data?.message ?? physicsPut.data).slice(0, 240),
    },
  );
  // Si l'évaluation a quand même été créée (via admin), tester POST
  await putStateKeys(adminTokenReload, {
    evaluations: [physicsEval, ...((await getState(adminTokenReload)).evaluations ?? [])],
  });
  await expectReject(
    "NEG-04",
    "POST note matière non affectée (Physique) refusé pour enseignant",
    {
      ...postBody,
      subject: "Physique",
      evaluationId: physicsEval.id,
      value: 10,
    },
    [400, 403, 404],
  );

  await expectReject(
    "NEG-05",
    "POST note avec evaluationId inexistant refusé",
    { ...postBody, evaluationId: `EVAL-DOES-NOT-EXIST-${stamp}`, value: 10 },
    [400, 404],
  );

  // Isolation A/B
  const chainB = await buildPedagogyChain(
    schoolB.adminToken,
    schoolB.schoolCode,
    schoolB.schoolAdminIdentifier,
    stamp + 77,
    "B",
  );
  const sessionB = buildGradeEntrySession({
    state: await getState(schoolB.adminToken),
    author: {
      id: "admin-b",
      role: "Admin School",
      schoolCode: schoolB.schoolCode,
    },
    evaluationInput: {
      schoolCode: schoolB.schoolCode,
      className: chainB.className,
      subject: chainB.subject,
      period: chainB.period,
      evaluationType: "Devoir",
      title: `Devoir V1 B ${stamp}`,
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 1,
      teacherId: chainB.teacherRecord.id,
      teacherName: chainB.assignment.teacherName,
      status: "Publiée",
    },
    studentGrades: [{ studentId: chainB.studentIds[0], value: 9 }],
  });
  // Admin B écrit via state (rôle admin)
  if (sessionB.ok) {
    await putState(schoolB.adminToken, {
      evaluations: [sessionB.evaluation, ...((await getState(schoolB.adminToken)).evaluations ?? [])],
      notes: [
        ...gradesToLegacyNotes(sessionB.grades),
        ...((await getState(schoolB.adminToken)).notes ?? []),
      ],
    });
  }
  const stateAsA = await getState(adminTokenReload);
  const leakedEvals = (stateAsA.evaluations ?? []).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolB.schoolCode),
  );
  const leakedNotes = (stateAsA.notes ?? []).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolB.schoolCode),
  );
  const leakedClasses = (stateAsA.classes ?? []).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolB.schoolCode),
  );
  evidence.jsonSnapshots.isolation = {
    leakedEvals: leakedEvals.length,
    leakedNotes: leakedNotes.length,
    leakedClasses: leakedClasses.length,
  };
  record(
    "ISO-01",
    "Admin A ne voit pas classes/évaluations/notes de B (state)",
    "0 fuites",
    `classes=${leakedClasses.length},evals=${leakedEvals.length},notes=${leakedNotes.length}`,
    leakedClasses.length + leakedEvals.length + leakedNotes.length === 0,
    { severity: "BLOCKER", detail: "Fuite multi-tenant = NO-GO E1" },
  );

  const crossPost = await request("/notes", {
    method: "POST",
    token: teacherToken,
    body: {
      studentId: chainB.studentIds[0],
      subject: chainB.subject,
      className: chainB.className,
      schoolCode: schoolB.schoolCode,
      value: 10,
      scale: 20,
      evaluationId: sessionB.ok ? sessionB.evaluation.id : `EVAL-B-${stamp}`,
      period: chainB.period,
    },
  });
  record(
    "ISO-02",
    "Enseignant A ne peut pas noter un élève de B",
    "400|403|404",
    String(crossPost.status),
    [400, 403, 404].includes(crossPost.status),
    {
      severity: "BLOCKER",
      detail:
        crossPost.status === 201 || crossPost.status === 200
          ? "ÉCRITURE CROSS-TENANT ACCEPTÉE"
          : JSON.stringify(crossPost.data?.message ?? crossPost.data).slice(0, 240),
    },
  );

  // Affectation cross-établissement via state admin A
  const crossAssignRes = await request("/backoffice/state", {
    method: "PUT",
    token: adminTokenReload,
    body: {
      assignments: [
        {
          id: newId("ASSIGN"),
          teacherId: effectiveTeacherId,
          teacherName: effectiveTeacherName,
          className: chainB.className,
          subject: chainB.subject,
          course: chainB.subject,
          schoolCode: schoolB.schoolCode,
        },
        ...((await getState(adminTokenReload)).assignments ?? []),
      ],
    },
  });
  const stateAfterCrossAssign = await getState(adminTokenReload);
  const crossAssignKept = (stateAfterCrossAssign.assignments ?? []).some(
    (row) =>
      String(row.teacherId) === String(effectiveTeacherId) &&
      normalize(row.className) === normalize(chainB.className) &&
      normalize(row.schoolCode) === normalize(schoolB.schoolCode),
  );
  const crossAssignRejected =
    [400, 403].includes(crossAssignRes.status) || !crossAssignKept;
  record(
    "ISO-03",
    "Affectation enseignant A → classe B refusée ou non persistée pour admin A",
    "refus ou non visible",
    `HTTP ${crossAssignRes.status}, kept=${crossAssignKept}`,
    crossAssignRejected,
    {
      severity: "BLOCKER",
      detail: crossAssignKept
        ? "Affectation inter-établissements persistée dans le scope admin A"
        : null,
    },
  );

  // Liens ID vs textuel — synthèse
  const linkIdOk = Boolean(effectiveTeacherId && publishedEval.teacherId);
  record(
    "REL-03",
    "Évaluation porte teacherId (identifiant)",
    "teacherId non vide",
    String(publishedEval.teacherId ?? ""),
    linkIdOk,
    { severity: "MAJOR" },
  );
  record(
    "REL-04",
    "Affectation porte teacherId + className + subject",
    "id+textuels",
    `${chainA.assignment.teacherId}|${chainA.assignment.className}|${chainA.assignment.subject}`,
    Boolean(chainA.assignment.teacherId && chainA.assignment.className && chainA.assignment.subject),
    { severity: "MAJOR" },
  );

  // Source de vérité observée
  const boState = await getState(adminTokenReload);
  const boNotesCount = (boState.notes ?? []).filter((n) => n.evaluationId === publishedEval.id).length;
  const pgNotesCount = pgEvalId
    ? (await pgQuery(`SELECT count(*)::int AS n FROM grades WHERE evaluation_id = $1`, [pgEvalId]))[0]?.n
    : 0;
  evidence.sourceOfTruth = {
    putPath: "PUT /api/backoffice/state → saveBackOfficeState → sync evaluations/grades PG (si OK)",
    postPath: "POST /api/notes → repository.upsertGrade (PG canonique déclaré D3.6b)",
    observed: {
      engine: evidence.engine,
      jsonNotesForEval: boNotesCount,
      pgGradesForEval: pgNotesCount,
      pgEvaluationRow: pgEvals[0] || null,
      divergence: boNotesCount !== pgNotesCount,
    },
  };
  record(
    "SOT-01",
    "Cohérence compteurs notes JSON vs grades PG pour l'évaluation V1",
    "égaux",
    `json=${boNotesCount} pg=${pgNotesCount}`,
    boNotesCount === pgNotesCount && boNotesCount > 0,
    {
      severity: "CRITICAL",
      detail:
        boNotesCount !== pgNotesCount
          ? "Divergence JSON/PG — source de vérité ambiguë pour bulletins"
          : null,
    },
  );

  // Contrôle local règle négative (client) — information
  const localNeg = validateGradeValue(-1, 20);
  record("INFO-01", "Règle client validateGradeValue(-1)", "erreur", localNeg || "null", Boolean(localNeg), {
    severity: "INFORMATION",
  });

  void runtime;
}

async function main() {
  console.log("=== AUDIT PRE-E1 V1 — Chaîne intégrée ===");
  evidence.commands.push("npm run verify:pre-e1-v1");
  ensureDatabase();

  let child = null;
  try {
    // Toujours démarrer un backend dédié sur PORT pour isolation du run
    process.env.SOMAFRIK_API_URL = API_BASE;
    const runtime = await startBackend();
    child = runtime.child;

    // Health détail
    const health = await request("/health");
    evidence.engine =
      health.data?.database ||
      health.data?.repository?.engine ||
      health.data?.engine ||
      evidence.engine ||
      "unknown";
    record("BOOT-01", "Backend healthy", "200", String(health.status), health.status === 200, {
      severity: "BLOCKER",
      detail: `database=${evidence.engine}`,
    });

    await runScenarios(runtime);
  } finally {
    await stopBackend(child);
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const sortedAnomalies = classifyAnomalies(anomalies);
  const recommendation = recommendationFrom(sortedAnomalies);
  const report = {
    audit: "PRE-E1",
    phase: "V1",
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    database: evidence.databaseUrlHost,
    engine: evidence.engine,
    results,
    anomalies: sortedAnomalies,
    evidence: {
      jsonSnapshots: evidence.jsonSnapshots,
      postgresSnapshots: evidence.postgresSnapshots,
      sourceOfTruth: evidence.sourceOfTruth,
      commands: evidence.commands,
    },
    summary: {
      total: results.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      anomalies: sortedAnomalies.length,
    },
    recommendation,
  };

  const reportPath = path.join(EVIDENCE_DIR, "pre-e1-v1-results.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nRapport: ${reportPath}`);
  console.log(
    `Résumé: ${report.summary.passed}/${report.summary.total} passés, ${report.summary.failed} échoués, ${report.summary.anomalies} anomalies`,
  );
  console.log(`Recommandation: ${recommendation.decision} — ${recommendation.rationale}`);

  // Exit 1 si anomalies BLOCKER/CRITICAL (gate V1), sinon 0
  const blocking = sortedAnomalies.some((a) => a.severity === "BLOCKER" || a.severity === "CRITICAL");
  process.exitCode = blocking ? 1 : 0;
}

main().catch((error) => {
  console.error("HARNESS FAIL:", error?.stack || error);
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "pre-e1-v1-results.json"),
      JSON.stringify(
        {
          audit: "PRE-E1",
          phase: "V1",
          harnessError: String(error?.message || error),
          results,
          anomalies,
        },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(2);
});
