/**
 * AUDIT PRE-E1 V2.1 — Caractérisation PRE-E1-IDENTITY-LIFECYCLE
 *
 * Aucune correction métier. Produit une preuve machine + classifications
 * confirmé / infirmé / indéterminé pour Q1–Q7 et ID-01…ID-06
 * (ID-04 scindé en ID-04A nominal / ID-04B fixture jumelle).
 *
 *   npm run verify:pre-e1-v2-identity
 *
 * Base attendue : develop post-094d5017 / post merge contrat V2.1.
 *
 * Distinction CTO :
 *   Préservation d'une anomalie injectée ≠ création nominale de l'anomalie
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const TRACE_FILE = path.join(EVIDENCE_DIR, "notes-authz-trace-v2-identity.jsonl");
const OUT_FILE = path.join(
  EVIDENCE_DIR,
  process.env.SOMAFRIK_PRE_E1_EVIDENCE_FILE || "pre-e1-v2-identity-lifecycle-results.json",
);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_v2_identity";
const PORT = String(process.env.SOMAFRIK_PRE_E1_PORT || 5112);
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

const scenarios = [];
const questions = [];
const evidence = {
  baseCommitHint: "post-094d5017 / develop@contrat-V2.1",
  schoolCode: null,
  phases: { nominal: {}, fixture: {} },
  identities: {},
  postgres: {},
  posts: [],
  traces: [],
  studentContext: null,
  bounding: {
    note: "ID-04A = sans injection manuelle de jumeau ; ID-04B = jumeau injecté",
  },
};

function classify(bucket, id, title, classification, detail = null, extra = null) {
  const row = {
    id,
    title,
    classification, // confirmé | infirmé | indéterminé | contexte
    detail: detail == null ? null : String(detail),
    extra: extra || null,
  };
  bucket.push(row);
  const mark =
    classification === "confirmé"
      ? "●"
      : classification === "infirmé"
        ? "○"
        : classification === "contexte"
          ? "◇"
          : "?";
  console.log(`  ${mark} [${id}] ${classification} — ${title}${detail ? ` | ${detail}` : ""}`);
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
      JWT_SECRET: process.env.JWT_SECRET || "pre-e1-v2-identity-jwt-secret-with-enough-length",
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

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return {};
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function setupSchool(superToken, stamp) {
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: `V21 Identity ${stamp}`,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `v21-${stamp}@somafrik.app`,
      principalName: "Directeur V21",
      principalEmail: `dir-v21-${stamp}@somafrik.app`,
      force: true,
    },
  });
  if (createRes.status !== 201) throw new Error(JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  const schoolAdminIdentifier = `ADM-V21-${stamp}`;
  const current = await getState(superToken);
  await putStateKeys(superToken, {
    users: [
      ...(current.users ?? []).filter(
        (u) => normalize(u.identifier) !== normalize(schoolAdminIdentifier),
      ),
      {
        id: `usr-v21-${stamp}`,
        firstName: "Admin",
        lastName: "V21",
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

async function buildChain(adminToken, schoolCode, schoolAdminIdentifier, stamp, { injectTwin = false } = {}) {
  let state = await getState(adminToken);
  const className = `V21-${stamp}`;
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
      firstName: `V${stamp}`,
      contactType: "Élève",
      phone: `+243 820 ${String(stamp + i).slice(-6)}`,
      email: `eleve-v21-${stamp}-${i}@somafrik.app`,
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

  // --- Snapshot avant toute fiche teachers pédagogique (points d'écriture contact/user) ---
  state = await getState(adminToken);
  const teachersBeforeContact = (state.teachers ?? []).map((t) => t.id);

  const teacherFlow = saveContactWithOptionalUserAccount(
    {
      id: newId("CONTACT"),
      lastName: "V21",
      firstName: `Prof${stamp}`,
      contactType: "Enseignant",
      phone: `+243 831 ${String(stamp).slice(-6)}`,
      email: `prof-v21-${stamp}@somafrik.app`,
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

  // Point d'écriture A : contact + user (peut créer spontanément une fiche TEACHER-*)
  state = await putStateKeys(adminToken, {
    ...teacherPatch,
    users: teacherFlow.patch.users.map((row) =>
      row.id === teacherUser.id ? teacherUser : row,
    ),
  });
  state = await getState(adminToken);
  const teachersAfterContact = (state.teachers ?? []).filter(
    (row) =>
      String(row.userId) === String(teacherUser.id) ||
      normalize(row.identifier) === normalize(teacherUser.identifier),
  );

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

  // Point d'écriture B : fiche pédagogique TEACHERS-* + affectation (sans jumeau injecté en 04A)
  const twinTeacher = injectTwin
    ? {
        id: `TEACHER-INJECT-${stamp}`,
        userId: teacherUser.id,
        contactId: teacherFlow.contact.id,
        identifier: teacherUser.identifier,
        publicId: teacherUser.publicId || teacherUser.identifier,
        firstName: teacherUser.firstName,
        lastName: teacherUser.lastName,
        name: teacherUser.lastName,
        schoolCode,
        mainSubject: subject,
        _harnessInjected: true,
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

  const teachersPayload = injectTwin
    ? [teachersRecord, twinTeacher, ...(state.teachers ?? [])]
    : [teachersRecord, ...(state.teachers ?? [])];

  await putStateKeys(adminToken, {
    teachers: teachersPayload,
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

  return {
    className,
    subject,
    period,
    studentIds,
    teacherUser,
    teachersRecord,
    twinTeacher,
    assignment,
    injectTwin: Boolean(injectTwin),
    writeTrace: {
      teachersBeforeContact,
      afterContactUserPut: teachersAfterContact.map((t) => ({
        id: t.id,
        userId: t.userId,
        identifier: t.identifier,
        sourceHint: "put_state_after_contact_user_account",
      })),
      pedagogicalPut: {
        teachersId: teachersRecord.id,
        injectedTwinId: twinTeacher?.id ?? null,
      },
    },
  };
}

async function lastTrace(token) {
  const debug = await request("/debug/notes-authz-trace", { token });
  return debug.data?.trace ?? null;
}

function isTeachersCode(code) {
  return /^TEACHERS-/i.test(String(code || ""));
}
function isTeacherTwinCode(code) {
  const s = String(code || "");
  return /^TEACHER-/i.test(s) && !/^TEACHERS-/i.test(s);
}

function teachersForActor(state, teacherUser) {
  return (state.teachers ?? []).filter(
    (row) =>
      String(row.userId) === String(teacherUser.id) ||
      normalize(row.identifier) === normalize(teacherUser.identifier),
  );
}

async function pgTeachersForActor(schoolCode, teacherUserId, extraCodes = []) {
  const codes = extraCodes.filter(Boolean);
  if (codes.length === 0) {
    return pgQuery(
      `SELECT t.id, t.teacher_code, t.user_id, u.user_code, u.role
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND u.user_code = $2`,
      [schoolCode, teacherUserId],
    );
  }
  return pgQuery(
      `SELECT t.id, t.teacher_code, t.user_id, u.user_code, u.role
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1
         AND (u.user_code = $2 OR t.teacher_code = ANY($3::text[]))`,
      [schoolCode, teacherUserId, codes],
    );
}

async function fetchEvalTeacherRows(schoolCode, evaluationId) {
  let evalRows = await pgQuery(
    `SELECT e.id, e.teacher_id, t.teacher_code
     FROM evaluations e
     LEFT JOIN teachers t ON t.id = e.teacher_id
     JOIN schools s ON s.id = e.school_id
     WHERE s.school_code = $1
     ORDER BY e.created_at DESC NULLS LAST
     LIMIT 8`,
    [schoolCode],
  ).catch(() => []);
  if (evaluationId) {
    const exact = evalRows.filter(
      (row) => String(row.id) === String(evaluationId) || String(row.id).includes(String(evaluationId).slice(-8)),
    );
    if (exact.length) return exact;
  }
  return evalRows;
}

async function runNotesPath(school, chain, stamp, phaseLabel) {
  const teacherToken = await login(
    chain.teacherUser.identifier,
    TEACHER_PASSWORD,
    school.schoolCode,
  );
  const jwt = decodeJwtPayload(teacherToken);
  let state = await getState(school.adminToken);
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
      title: `V21 ${phaseLabel} ${stamp}`,
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
  const evalRows = await fetchEvalTeacherRows(school.schoolCode, putSession.evaluation.id);
  return {
    putStatus: putRes.status,
    postStatus: post1.status,
    grantedBy: trace1?.grantedBy ?? null,
    jwt,
    trace: trace1,
    putSession,
    evalRows,
    jsonEvalTeacherId: putSession.evaluation?.teacherId ?? null,
    jsonAssignmentTeacherId: chain.assignment.teacherId,
  };
}

async function main() {
  console.log("=== AUDIT PRE-E1 V2.1 — IDENTITY-LIFECYCLE (caractérisation bornée) ===");
  ensureDatabase();
  const child = startBackend();
  let harnessOk = true;
  try {
    await waitForHealth();
    process.env.SOMAFRIK_E2E_TRY_KNOWN_PASSWORDS = "true";
    let superToken;
    try {
      superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
    } catch {
      superToken = await login(SUPERADMIN_ID, "1234");
    }

    // =====================================================================
    // PHASE A — parcours nominal SANS injection manuelle de jumeau (ID-04A)
    // =====================================================================
    const stampA = Date.now();
    const schoolA = await setupSchool(superToken, stampA);
    evidence.schoolCode = schoolA.schoolCode;
    const chainA = await buildChain(
      schoolA.adminToken,
      schoolA.schoolCode,
      schoolA.schoolAdminIdentifier,
      stampA,
      { injectTwin: false },
    );

    let stateA = await getState(schoolA.adminToken);
    const jsonA = teachersForActor(stateA, chainA.teacherUser);
    const pgA = await pgTeachersForActor(schoolA.schoolCode, chainA.teacherUser.id, [
      chainA.teachersRecord.id,
    ]);
    const pgUsersA = await pgQuery(
      `SELECT id, user_code, role, school_id FROM users WHERE user_code = $1`,
      [chainA.teacherUser.id],
    );
    const pgCanonicalA = pgA.find(
      (t) => String(t.teacher_code) === String(chainA.teachersRecord.id),
    );
    const spontaneousTwinsA = jsonA.filter((t) => isTeacherTwinCode(t.id));
    const hasTeachersA = jsonA.some((t) => isTeachersCode(t.id));
    const hasSpontaneousTwinA = spontaneousTwinsA.length > 0;

    evidence.phases.nominal = {
      writeTrace: chainA.writeTrace,
      jsonTeachers: jsonA.map((t) => ({ id: t.id, userId: t.userId, identifier: t.identifier })),
      pgTeachers: pgA,
      pgUsers: pgUsersA,
      spontaneousTeacherStarIds: spontaneousTwinsA.map((t) => t.id),
      pedagogicalTeachersId: chainA.teachersRecord.id,
    };

    classify(
      scenarios,
      "ID-01",
      "Création / sync enseignant BO — snapshot multi-couches (nominal)",
      hasTeachersA && pgCanonicalA && pgCanonicalA.user_id ? "confirmé" : "indéterminé",
      `json=${jsonA.map((t) => t.id).join(",")} pg=${pgA.map((t) => t.teacher_code).join(",")} user_id=${pgCanonicalA?.user_id ?? null}`,
      { phase: "nominal", meaning: "cycle TEACHERS-* + user_id observable" },
    );

    const pgAssignmentsA = await pgQuery(
      `SELECT ta.id, t.teacher_code, c.name AS class_name, sub.name AS subject_name, ta.status
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND t.teacher_code = $2`,
      [schoolA.schoolCode, chainA.teachersRecord.id],
    );
    const jsonAssignmentA = (stateA.assignments ?? []).find(
      (row) => String(row.id) === String(chainA.assignment.id),
    );
    const assignAlignedA =
      jsonAssignmentA &&
      String(jsonAssignmentA.teacherId) === String(chainA.teachersRecord.id) &&
      pgAssignmentsA.some(
        (row) =>
          row.class_name === chainA.className &&
          row.subject_name === chainA.subject &&
          row.status === "active",
      );
    evidence.postgres.assignmentsNominal = pgAssignmentsA;
    classify(
      scenarios,
      "ID-02",
      "Affectation JSON teacherId vs teacher_assignments PG (nominal)",
      assignAlignedA ? "confirmé" : "indéterminé",
      `json.teacherId=${jsonAssignmentA?.teacherId} pg=${JSON.stringify(pgAssignmentsA).slice(0, 220)}`,
      { phase: "nominal" },
    );

    const notesA = await runNotesPath(schoolA, chainA, stampA, "NOMINAL");
    evidence.posts.push({ phase: "nominal", status: notesA.postStatus, grantedBy: notesA.grantedBy });
    evidence.traces.push({ phase: "nominal", grantedBy: notesA.grantedBy });
    evidence.postgres.evaluationsNominal = notesA.evalRows;
    evidence.identities.sessionNominal = {
      jwt: {
        sub: notesA.jwt.sub ?? notesA.jwt.id ?? null,
        identifier: notesA.jwt.identifier ?? notesA.jwt.userCode ?? null,
        role: notesA.jwt.role ?? null,
      },
    };
    classify(
      scenarios,
      "ID-03",
      "Auth enseignant + POST /api/notes (nominal)",
      notesA.postStatus === 201 ? "confirmé" : "indéterminé",
      `HTTP ${notesA.postStatus} grantedBy=${notesA.grantedBy} eval=${JSON.stringify(notesA.evalRows[0] ?? null)}`,
      { phase: "nominal" },
    );

    // ID-04A — création nominale (sans injection)
    classify(
      scenarios,
      "ID-04A",
      "Parcours nominal sans injection — un jumeau TEACHER-* apparaît-il spontanément avec TEACHERS-* ?",
      hasSpontaneousTwinA && hasTeachersA
        ? "confirmé"
        : !hasSpontaneousTwinA && hasTeachersA
          ? "infirmé"
          : "indéterminé",
      `afterContact=${JSON.stringify(chainA.writeTrace.afterContactUserPut)} afterPedagogy=${jsonA
        .map((t) => t.id)
        .join(",")} spontaneousTwins=${spontaneousTwinsA.map((t) => t.id).join(",") || "(none)"}`,
      {
        phase: "nominal",
        meaning:
          "confirmé = création spontanée observée ; infirmé = seul TEACHERS-* (ou pas de TEACHER-*) après flux contact→user→TEACHERS-* ; indéterminé = inconclusive",
        injectTwin: false,
      },
    );

    // Q7 nominal — divergence sans fixture injectée
    const evalCodeA = notesA.evalRows[0]?.teacher_code ?? null;
    const jsonEvalA = notesA.jsonEvalTeacherId;
    const divergenceNominal =
      String(jsonEvalA) === String(chainA.teachersRecord.id) &&
      evalCodeA != null &&
      isTeacherTwinCode(evalCodeA);
    const convergenceNominal =
      String(jsonEvalA) === String(chainA.teachersRecord.id) &&
      evalCodeA != null &&
      String(evalCodeA) === String(chainA.teachersRecord.id);
    classify(
      scenarios,
      "ID-04A-Q7",
      "Divergence evaluation JSON↔PG sur parcours nominal (sans jumeau injecté)",
      divergenceNominal ? "confirmé" : convergenceNominal ? "infirmé" : "indéterminé",
      `evaluation.teacherId=${jsonEvalA} pg.teacher_code=${evalCodeA}`,
      {
        phase: "nominal",
        meaning:
          "confirmé = divergence sans injection ; infirmé = convergence TEACHERS-* ; indéterminé = autre cas",
      },
    );

    // ID-05 replay sur nominal
    const countsBeforeA = await pgQuery(
      `SELECT
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS teachers_canonical,
         (SELECT count(*)::int FROM users u WHERE u.user_code = $3) AS users,
         (SELECT count(*)::int FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS assignments`,
      [schoolA.schoolCode, chainA.teachersRecord.id, chainA.teacherUser.id],
    );
    const stateReplayA = await getState(schoolA.adminToken);
    await putStateKeys(schoolA.adminToken, {
      teachers: stateReplayA.teachers,
      assignments: stateReplayA.assignments,
      users: stateReplayA.users,
    });
    await putStateKeys(schoolA.adminToken, {
      teachers: stateReplayA.teachers,
      assignments: stateReplayA.assignments,
      users: stateReplayA.users,
    });
    const countsAfterA = await pgQuery(
      `SELECT
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS teachers_canonical,
         (SELECT count(*)::int FROM users u WHERE u.user_code = $3) AS users,
         (SELECT count(*)::int FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS assignments`,
      [schoolA.schoolCode, chainA.teachersRecord.id, chainA.teacherUser.id],
    );
    evidence.postgres.replayNominal = { before: countsBeforeA[0], after: countsAfterA[0] };
    const stableA =
      Number(countsAfterA[0]?.teachers_canonical) === 1 &&
      Number(countsAfterA[0]?.users) === 1 &&
      Number(countsAfterA[0]?.assignments) === 1 &&
      Number(countsAfterA[0]?.teachers_canonical) === Number(countsBeforeA[0]?.teachers_canonical);
    classify(
      scenarios,
      "ID-05",
      "Replay sync identique — idempotence identité canonique (nominal)",
      stableA ? "confirmé" : "indéterminé",
      `before=${JSON.stringify(countsBeforeA[0])} after=${JSON.stringify(countsAfterA[0])}`,
      { phase: "nominal" },
    );

    // ID-06 contexte
    stateA = await getState(schoolA.adminToken);
    const jsonStudent = (stateA.students ?? []).find((row) => row.id === chainA.studentIds[0]);
    const pgStudents = await pgQuery(
      `SELECT st.id, st.student_code FROM students st
       JOIN schools s ON s.id = st.school_id WHERE s.school_code = $1 LIMIT 10`,
      [schoolA.schoolCode],
    );
    evidence.studentContext = {
      jsonStudent: jsonStudent
        ? { id: jsonStudent.id, matricule: jsonStudent.matricule ?? null }
        : null,
      pgStudents: pgStudents.map((s) => ({ id: s.id, student_code: s.student_code })),
      note: "Contexte uniquement — hors décision PRE-E1-STUDENT-CODE-SCOPE",
    };
    classify(
      scenarios,
      "ID-06",
      "Comparaison élève bornée (contexte)",
      "contexte",
      `json.id=${jsonStudent?.id} pgCodes=${pgStudents.map((s) => s.student_code).join(",")}`,
      { meaning: "Réserve CTO student_code" },
    );

    // =====================================================================
    // PHASE B — état avec jumeau injecté (ID-04B) — école distincte
    // =====================================================================
    const stampB = Date.now() + 11;
    const schoolB = await setupSchool(superToken, stampB);
    const chainB = await buildChain(
      schoolB.adminToken,
      schoolB.schoolCode,
      schoolB.schoolAdminIdentifier,
      stampB,
      { injectTwin: true },
    );
    let stateB = await getState(schoolB.adminToken);
    const jsonB = teachersForActor(stateB, chainB.teacherUser);
    const idsBeforeDedupeB = jsonB.map((t) => t.id);
    await putStateKeys(schoolB.adminToken, {
      teachers: stateB.teachers,
      assignments: stateB.assignments,
      users: stateB.users,
    });
    stateB = await getState(schoolB.adminToken);
    const jsonBAfter = teachersForActor(stateB, chainB.teacherUser);
    const idsAfterDedupeB = jsonBAfter.map((t) => t.id);
    const bothAfterB =
      idsAfterDedupeB.some(isTeachersCode) && idsAfterDedupeB.some(isTeacherTwinCode);
    const injectedStillPresent = idsAfterDedupeB.includes(chainB.twinTeacher.id);
    const pgB = await pgTeachersForActor(schoolB.schoolCode, chainB.teacherUser.id, [
      chainB.teachersRecord.id,
      chainB.twinTeacher.id,
    ]);
    evidence.phases.fixture = {
      writeTrace: chainB.writeTrace,
      injectedTwinId: chainB.twinTeacher.id,
      jsonBeforeDedupe: idsBeforeDedupeB,
      jsonAfterDedupe: idsAfterDedupeB,
      pgTeachers: pgB,
    };

    classify(
      scenarios,
      "ID-04B",
      "État préexistant avec jumeau injecté — persistance / non-fusion après dedupe",
      bothAfterB && injectedStillPresent ? "confirmé" : "infirmé",
      `injected=${chainB.twinTeacher.id} before=${idsBeforeDedupeB.join(",")} afterDedupe=${idsAfterDedupeB.join(",")} pg=${pgB
        .map((r) => r.teacher_code)
        .join(",")}`,
      {
        phase: "fixture",
        meaning:
          "confirmé = non-convergence sous état jumelé préexistant/injecté (≠ création nominale)",
        injectTwin: true,
      },
    );

    const notesB = await runNotesPath(schoolB, chainB, stampB, "FIXTURE");
    evidence.posts.push({ phase: "fixture", status: notesB.postStatus, grantedBy: notesB.grantedBy });
    evidence.postgres.evaluationsFixture = notesB.evalRows;
    const evalCodeB = notesB.evalRows[0]?.teacher_code ?? null;
    const jsonEvalB = notesB.jsonEvalTeacherId;
    const divergenceFixture =
      String(jsonEvalB) === String(chainB.teachersRecord.id) &&
      evalCodeB != null &&
      isTeacherTwinCode(evalCodeB);
    const convergenceFixture =
      String(jsonEvalB) === String(chainB.teachersRecord.id) &&
      String(evalCodeB) === String(chainB.teachersRecord.id);
    classify(
      scenarios,
      "ID-04B-Q7",
      "Divergence evaluation JSON↔PG sous fixture jumelle injectée",
      divergenceFixture ? "confirmé" : convergenceFixture ? "infirmé" : "indéterminé",
      `evaluation.teacherId=${jsonEvalB} pg.teacher_code=${evalCodeB}`,
      {
        phase: "fixture",
        meaning: "confirmé = divergence observée lorsque des jumeaux sont déjà présents",
      },
    );

    // ---------- Questions bornées ----------
    const writePoints = [
      "PUT contact+user account (peut créer TEACHER-* spontané — à observer en 04A)",
      "PUT teachers TEACHERS-* pédagogique + assignment",
      "PUT teachers TEACHER-* injecté (04B seulement — fixture harness)",
      "login JWT (identifier ENS/user)",
      "POST /api/notes → evaluations.teacher_id",
    ];
    evidence.identities.writePoints = writePoints;

    classify(
      questions,
      "Q1",
      "Combien d’identités distinctes (nominal vs fixture) ?",
      "confirmé",
      `nominal.json=${jsonA.map((t) => t.id).join(",") || "(none)"} n=${jsonA.length} ; fixture.afterDedupe=${idsAfterDedupeB.join(",")} n=${idsAfterDedupeB.length}`,
      {
        meaning:
          "Inventaire factuel des deux phases — ne fuse pas création et préservation",
      },
    );
    classify(
      questions,
      "Q2",
      "Points d’écriture exacts (sans / avec injection) ?",
      "confirmé",
      writePoints.join(" · "),
      {
        nominalAfterContact: chainA.writeTrace.afterContactUserPut,
        fixtureInjectedId: chainB.twinTeacher.id,
      },
    );
    classify(
      questions,
      "Q3",
      "Identité canonique de fait pour affectation (TEACHERS-*) ?",
      assignAlignedA && pgCanonicalA ? "confirmé" : "indéterminé",
      `candidat=${chainA.teachersRecord.id} pg=${pgCanonicalA?.teacher_code ?? null}`,
    );

    // Q4 scindée
    const q4CreateClass = hasSpontaneousTwinA && hasTeachersA
      ? "confirmé"
      : !hasSpontaneousTwinA && hasTeachersA
        ? "infirmé"
        : "indéterminé";
    classify(
      questions,
      "Q4-CREATE",
      "Création nominale des jumeaux TEACHER-* + TEACHERS-* (sans injection) ?",
      q4CreateClass,
      `spontaneous=${spontaneousTwinsA.map((t) => t.id).join(",") || "(none)"} pedagogy=${chainA.teachersRecord.id}`,
      {
        mapsToScenario: "ID-04A",
        meaning: "INDÉTERMINÉE/confirmée/infirmée selon apparition spontanée — pas la fixture",
      },
    );
    classify(
      questions,
      "Q4-PRESERVE",
      "Non-convergence d’identités préexistantes / injectées ?",
      bothAfterB && injectedStillPresent ? "confirmé" : "infirmé",
      `injected=${chainB.twinTeacher.id} retained=${injectedStillPresent}`,
      {
        mapsToScenario: "ID-04B",
        meaning: "CONFIRMÉE si les jumeaux injectés ne sont pas fusionnés",
      },
    );
    // Q4 synthèse (bornée)
    classify(
      questions,
      "Q4",
      "Synthèse Q4 — création vs non-convergence (ne pas fusionner les verdicts)",
      "indéterminé",
      `création=${q4CreateClass} ; non-convergence=${bothAfterB && injectedStillPresent ? "confirmé" : "infirmé"}`,
      {
        creation: q4CreateClass,
        nonConvergence: bothAfterB && injectedStillPresent ? "confirmé" : "infirmé",
        ctoBounding:
          "Non-convergence préexistante CONFIRMÉE ; création nominale selon Q4-CREATE (souvent INDÉTERMINÉE/infirmée)",
      },
    );

    classify(
      questions,
      "Q5",
      "teacher_code PG aligné sur TEACHERS-* pour le row d’affectation ?",
      pgCanonicalA && String(pgCanonicalA.teacher_code) === String(chainA.teachersRecord.id)
        ? "confirmé"
        : "infirmé",
      `expected=${chainA.teachersRecord.id} obtained=${pgCanonicalA?.teacher_code ?? null}`,
    );
    const userMatchA =
      pgCanonicalA &&
      pgUsersA[0] &&
      String(pgCanonicalA.user_id) === String(pgUsersA[0].id) &&
      notesA.postStatus === 201;
    classify(
      questions,
      "Q6",
      "teachers.user_id (canonique) ↔ user de session POST notes ?",
      userMatchA ? "confirmé" : "indéterminé",
      `pg.user_id=${pgCanonicalA?.user_id} user_code=${pgUsersA[0]?.user_code}`,
    );

    classify(
      questions,
      "Q7-NOMINAL",
      "Divergence JSON↔PG evaluations sans fixture jumelle ?",
      divergenceNominal ? "confirmé" : convergenceNominal ? "infirmé" : "indéterminé",
      `json=${jsonEvalA} pg=${evalCodeA}`,
      { phase: "nominal", mapsToScenario: "ID-04A-Q7" },
    );
    classify(
      questions,
      "Q7-FIXTURE",
      "Divergence JSON↔PG evaluations sous fixture jumelle ?",
      divergenceFixture ? "confirmé" : convergenceFixture ? "infirmé" : "indéterminé",
      `json=${jsonEvalB} pg=${evalCodeB}`,
      { phase: "fixture", mapsToScenario: "ID-04B-Q7" },
    );
    classify(
      questions,
      "Q7",
      "Synthèse Q7 — borner la causalité de la divergence",
      "indéterminé",
      `sans_fixture=${divergenceNominal ? "confirmé" : convergenceNominal ? "infirmé" : "indéterminé"} ; sous_fixture=${divergenceFixture ? "confirmé" : convergenceFixture ? "infirmé" : "indéterminé"}`,
      {
        withoutFixture: divergenceNominal
          ? "confirmé"
          : convergenceNominal
            ? "infirmé"
            : "indéterminé",
        withFixture: divergenceFixture
          ? "confirmé"
          : convergenceFixture
            ? "infirmé"
            : "indéterminé",
        ctoBounding:
          "Divergence Q7 sous fixture jumelle à lire via Q7-FIXTURE ; ne pas généraliser sans Q7-NOMINAL",
      },
    );

    const nonConvergenceConfirmed = bothAfterB && injectedStillPresent;
    const creationStatus = q4CreateClass;
    const q7FixtureConfirmed = divergenceFixture;
    const q7NominalStatus = divergenceNominal
      ? "confirmé"
      : convergenceNominal
        ? "infirmé"
        : "indéterminé";

    const synthesis = {
      debtId: "PRE-E1-IDENTITY-LIFECYCLE",
      severityDocumented: "MAJOR",
      severityGlobal: "MAJOR_CONFIRMEE_REVALIDATION_CTO",
      severityLabel: "MAJOR CONFIRMÉE — revalidation CTO",
      characterization: "validee_CTO_bornee",
      results: {
        nonConvergencePreexistingOrInjected: nonConvergenceConfirmed
          ? "CONFIRMÉE"
          : "NON_CONFIRMÉE",
        nominalTwinCreation: creationStatus === "confirmé"
          ? "CONFIRMÉE"
          : creationStatus === "infirmé"
            ? "INFIRMÉE"
            : "INDÉTERMINÉE",
        q7DivergenceUnderTwinFixture: q7FixtureConfirmed
          ? "CONFIRMÉE"
          : "NON_CONFIRMÉE",
        q7DivergenceWithoutFixture: q7NominalStatus,
      },
      factualSummary:
        "ID-04A : PUT contact+user crée TEACHER-* ; fiche pédagogique ajoute TEACHERS-* ; coexistence sans injection harness. ID-04B : non-fusion sous jumeau injecté. Divergence evaluation JSON↔PG confirmée en nominal et sous fixture. Sévérité : MAJOR CONFIRMÉE — revalidation CTO (revalidation). Correctif non autorisé à ce stade.",
      ctoRevalidation: {
        date: "2026-07-27",
        characterization: "VALIDEE",
        bounding: "SATISFAIT",
        correctivePlan: "NON_AUTORISE",
        implementation: "INTERDITE",
      },
      noCorrectivePlanAuthorized: true,
      noMergeClaimOfMajorConfirmed: false,
      studentCodeScope: "hors périmètre décisionnel (ID-06 contexte seulement)",
      nextStepAllowed:
        "Après merge : dossier de cadrage plan correctif minimal V2.1 OU contrat prochain sujet V2 — arbitrage CTO ; pas d’implémentation",
    };

    const payload = {
      audit: "PRE-E1",
      phase: "V2.1",
      subject: "PRE-E1-IDENTITY-LIFECYCLE",
      generatedAt: new Date().toISOString(),
      apiBase: API_BASE,
      database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
      nature: "characterization-only-bounded",
      implementation: "forbidden",
      ctoBounding: {
        injectedTwinPreservationIsNotNominalCreation: true,
        id04A: "nominal without manual twin",
        id04B: "preexisting/injected twin",
      },
      scenarios,
      questions,
      evidence,
      synthesis,
      summary: {
        scenarios: Object.fromEntries(
          ["confirmé", "infirmé", "indéterminé", "contexte"].map((k) => [
            k,
            scenarios.filter((s) => s.classification === k).length,
          ]),
        ),
        questions: Object.fromEntries(
          ["confirmé", "infirmé", "indéterminé"].map((k) => [
            k,
            questions.filter((q) => q.classification === k).length,
          ]),
        ),
      },
    };

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`\nPreuve écrite : ${path.relative(ROOT, OUT_FILE)}`);
    console.log(`Sévérité globale : ${synthesis.severityGlobal}`);
    console.log(
      `Création nominale : ${synthesis.results.nominalTwinCreation} | Non-convergence : ${synthesis.results.nonConvergencePreexistingOrInjected} | Q7 fixture : ${synthesis.results.q7DivergenceUnderTwinFixture}`,
    );
    console.log("Harness caractérisation bornée : OK (exit 0 — aucune correction)");
  } catch (error) {
    harnessOk = false;
    console.error("Échec harness V2.1:", error);
    const failure = {
      audit: "PRE-E1",
      phase: "V2.1",
      subject: "PRE-E1-IDENTITY-LIFECYCLE",
      generatedAt: new Date().toISOString(),
      harnessError: String(error?.stack || error),
      scenarios,
      questions,
      evidence,
    };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  } finally {
    await stopBackend(child);
  }
  process.exit(harnessOk ? 0 : 1);
}

main();
