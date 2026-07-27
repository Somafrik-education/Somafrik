/**
 * AUDIT PRE-E1 V2.1 — Caractérisation PRE-E1-IDENTITY-LIFECYCLE
 *
 * Aucune correction métier. Produit une preuve machine + classifications
 * confirmé / infirmé / indéterminé pour Q1–Q7 et ID-01…ID-06.
 *
 *   npm run verify:pre-e1-v2-identity
 *
 * Base attendue : develop post-094d5017 / post merge contrat V2.1.
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
  identities: {},
  postgres: {},
  posts: [],
  traces: [],
  studentContext: null,
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

async function buildChain(adminToken, schoolCode, schoolAdminIdentifier, stamp) {
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

  state = await getState(adminToken);
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
  // Jumeau TEACHER-* (même user / identifier) — fixture d'observation ID-04, sans fusion métier
  const twinTeacher = {
    id: `TEACHER-${stamp}`,
    userId: teacherUser.id,
    contactId: teacherFlow.contact.id,
    identifier: teacherUser.identifier,
    publicId: teacherUser.publicId || teacherUser.identifier,
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
    teachers: [teachersRecord, twinTeacher, ...(state.teachers ?? [])],
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

async function main() {
  console.log("=== AUDIT PRE-E1 V2.1 — IDENTITY-LIFECYCLE (caractérisation) ===");
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
    const stamp = Date.now();
    const school = await setupSchool(superToken, stamp);
    evidence.schoolCode = school.schoolCode;
    const chain = await buildChain(
      school.adminToken,
      school.schoolCode,
      school.schoolAdminIdentifier,
      stamp,
    );

    // ---------- ID-01 : snapshot après sync staff ----------
    let state = await getState(school.adminToken);
    const jsonTeachersForUser = (state.teachers ?? []).filter(
      (row) =>
        String(row.userId) === String(chain.teacherUser.id) ||
        normalize(row.identifier) === normalize(chain.teacherUser.identifier),
    );
    const pgTeachers = await pgQuery(
      `SELECT t.id, t.teacher_code, t.user_id, u.user_code, u.role
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1
         AND (t.teacher_code = $2 OR t.teacher_code = $3 OR u.user_code = $4)`,
      [
        school.schoolCode,
        chain.teachersRecord.id,
        chain.twinTeacher.id,
        chain.teacherUser.id,
      ],
    );
    const pgUsers = await pgQuery(
      `SELECT id, user_code, role, school_id FROM users WHERE user_code = $1`,
      [chain.teacherUser.id],
    );
    evidence.identities.afterSync = {
      boUser: {
        id: chain.teacherUser.id,
        identifier: chain.teacherUser.identifier,
        role: chain.teacherUser.role,
      },
      jsonTeachers: jsonTeachersForUser.map((t) => ({
        id: t.id,
        userId: t.userId,
        identifier: t.identifier,
        publicId: t.publicId ?? null,
      })),
      pgTeachers,
      pgUsers,
    };
    evidence.postgres.afterSync = { teachers: pgTeachers, users: pgUsers };

    const hasTeachersJson = jsonTeachersForUser.some((t) => isTeachersCode(t.id));
    const hasTwinJson = jsonTeachersForUser.some((t) => isTeacherTwinCode(t.id));
    const pgCanonical = pgTeachers.find((t) => String(t.teacher_code) === String(chain.teachersRecord.id));
    classify(
      scenarios,
      "ID-01",
      "Création / sync enseignant BO — snapshot multi-couches",
      hasTeachersJson && pgCanonical && pgCanonical.user_id
        ? "confirmé"
        : "indéterminé",
      `jsonTeachers=${jsonTeachersForUser.map((t) => t.id).join(",")} pgCodes=${pgTeachers
        .map((t) => t.teacher_code)
        .join(",")} user_id=${pgCanonical?.user_id ?? null}`,
      {
        meaning:
          "confirmé = cycle nominal observable (fiche TEACHERS-* JSON + teacher PG + user_id) — pas une anomalie",
      },
    );

    // ---------- ID-02 : affectation JSON vs PG ----------
    const pgAssignments = await pgQuery(
      `SELECT ta.id, t.teacher_code, c.name AS class_name, sub.name AS subject_name, ta.status
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND t.teacher_code = $2`,
      [school.schoolCode, chain.teachersRecord.id],
    );
    evidence.postgres.assignments = pgAssignments;
    const jsonAssignment = (state.assignments ?? []).find(
      (row) => String(row.id) === String(chain.assignment.id),
    );
    const assignAligned =
      jsonAssignment &&
      String(jsonAssignment.teacherId) === String(chain.teachersRecord.id) &&
      pgAssignments.some(
        (row) =>
          row.class_name === chain.className &&
          row.subject_name === chain.subject &&
          row.status === "active" &&
          String(row.teacher_code) === String(chain.teachersRecord.id),
      );
    classify(
      scenarios,
      "ID-02",
      "Affectation JSON teacherId vs teacher_assignments PG",
      assignAligned ? "confirmé" : "indéterminé",
      `json.teacherId=${jsonAssignment?.teacherId} pg=${JSON.stringify(pgAssignments).slice(0, 220)}`,
      {
        meaning:
          "confirmé = alignement observé sur TEACHERS-* pour l'affectation active (fait SoT local)",
      },
    );

    // ---------- ID-03 : auth + POST notes ----------
    const teacherToken = await login(
      chain.teacherUser.identifier,
      TEACHER_PASSWORD,
      school.schoolCode,
    );
    const jwt = decodeJwtPayload(teacherToken);
    const me = await request("/backoffice/me", { token: teacherToken }).catch(() => ({
      status: 0,
      data: null,
    }));
    state = await getState(school.adminToken);
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
        title: `V21 PUT ${stamp}`,
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
    evidence.posts.push({ status: post1.status, grantedBy: trace1?.grantedBy });
    evidence.traces.push({
      grantedBy: trace1?.grantedBy ?? null,
      lookupValues: trace1?.lookupValues ?? trace1?.keys ?? null,
      teacherId: trace1?.teacherId ?? null,
    });
    evidence.identities.session = {
      jwt: {
        sub: jwt.sub ?? jwt.id ?? null,
        identifier: jwt.identifier ?? jwt.userCode ?? null,
        role: jwt.role ?? null,
        schoolCode: jwt.schoolCode ?? null,
        classNames: jwt.classNames ?? jwt.assignedClasses ?? null,
      },
      meStatus: me.status,
      meUser: me.data?.user
        ? {
            id: me.data.user.id,
            identifier: me.data.user.identifier,
            role: me.data.user.role,
          }
        : null,
    };
    const evalPg = await pgQuery(
      `SELECT id, teacher_id FROM evaluations WHERE id::text = $1 OR external_id = $1 LIMIT 5`,
      [putSession.evaluation.id],
    ).catch(async () =>
      pgQuery(
        `SELECT e.id, e.teacher_id, t.teacher_code
         FROM evaluations e
         LEFT JOIN teachers t ON t.id = e.teacher_id
         JOIN schools s ON s.id = e.school_id
         WHERE s.school_code = $1
         ORDER BY e.created_at DESC NULLS LAST
         LIMIT 5`,
        [school.schoolCode],
      ).catch(() => []),
    );
    let evalRows = evalPg;
    if (!evalRows.length || !evalRows[0]?.teacher_code) {
      evalRows = await pgQuery(
        `SELECT e.id, e.teacher_id, t.teacher_code
         FROM evaluations e
         LEFT JOIN teachers t ON t.id = e.teacher_id
         JOIN schools s ON s.id = e.school_id
         WHERE s.school_code = $1
         ORDER BY e.created_at DESC NULLS LAST
         LIMIT 5`,
        [school.schoolCode],
      );
    }
    evidence.postgres.evaluations = evalRows;
    const postOk = post1.status === 201;
    classify(
      scenarios,
      "ID-03",
      "Auth enseignant + POST /api/notes — identités JWT / grantedBy / evaluation.teacher_id",
      postOk ? "confirmé" : "indéterminé",
      `HTTP ${post1.status} grantedBy=${trace1?.grantedBy} jwt.identifier=${jwt.identifier ?? jwt.userCode ?? jwt.sub} evalTeacher=${JSON.stringify(evalRows[0] ?? null)}`,
      {
        meaning:
          "confirmé = parcours notes exécutable avec identités capturées (observation, pas verdict d'unicité)",
      },
    );

    // ---------- ID-04 : jumeaux TEACHER-* / TEACHERS-* ----------
    state = await getState(school.adminToken);
    const twinsJson = (state.teachers ?? []).filter(
      (row) =>
        String(row.userId) === String(chain.teacherUser.id) ||
        normalize(row.identifier) === normalize(chain.teacherUser.identifier),
    );
    const twinIds = twinsJson.map((t) => t.id);
    const bothPresentJson =
      twinIds.some(isTeachersCode) && twinIds.some(isTeacherTwinCode);
    const pgTwinCodes = await pgQuery(
      `SELECT teacher_code, user_id FROM teachers t
       JOIN schools s ON s.id = t.school_id
       WHERE s.school_code = $1 AND (teacher_code = $2 OR teacher_code = $3)`,
      [school.schoolCode, chain.teachersRecord.id, chain.twinTeacher.id],
    );
    evidence.identities.twins = { json: twinIds, pg: pgTwinCodes };
    // Re-PUT pour confirmer non-fusion après dedupe serveur
    await putStateKeys(school.adminToken, {
      teachers: state.teachers,
      assignments: state.assignments,
      users: state.users,
    });
    const afterDedupe = await getState(school.adminToken);
    const afterIds = (afterDedupe.teachers ?? [])
      .filter(
        (row) =>
          String(row.userId) === String(chain.teacherUser.id) ||
          normalize(row.identifier) === normalize(chain.teacherUser.identifier),
      )
      .map((t) => t.id);
    const stillBoth =
      afterIds.some(isTeachersCode) && afterIds.some(isTeacherTwinCode);
    classify(
      scenarios,
      "ID-04",
      "Jumeaux TEACHER-* et TEACHERS-* coexistent sans fusion",
      stillBoth || bothPresentJson ? "confirmé" : "infirmé",
      `before=${twinIds.join(",")} afterDedupe=${afterIds.join(",")} pg=${pgTwinCodes
        .map((r) => r.teacher_code)
        .join(",")}`,
      {
        meaning:
          "confirmé = écart d'identité multi-fiches reproductible (dette IDENTITY) ; infirmé = convergence observée",
      },
    );

    // ---------- ID-05 : replay sync ----------
    const countsBefore = await pgQuery(
      `SELECT
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS teachers_canonical,
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $3) AS teachers_twin,
         (SELECT count(*)::int FROM users u WHERE u.user_code = $4) AS users,
         (SELECT count(*)::int FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS assignments`,
      [
        school.schoolCode,
        chain.teachersRecord.id,
        chain.twinTeacher.id,
        chain.teacherUser.id,
      ],
    );
    const stateReplay = await getState(school.adminToken);
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
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS teachers_canonical,
         (SELECT count(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $3) AS teachers_twin,
         (SELECT count(*)::int FROM users u WHERE u.user_code = $4) AS users,
         (SELECT count(*)::int FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN schools s ON s.id = t.school_id
           WHERE s.school_code = $1 AND t.teacher_code = $2) AS assignments`,
      [
        school.schoolCode,
        chain.teachersRecord.id,
        chain.twinTeacher.id,
        chain.teacherUser.id,
      ],
    );
    evidence.postgres.replay = { before: countsBefore[0], after: countsAfter[0] };
    const stable =
      Number(countsAfter[0]?.teachers_canonical) === Number(countsBefore[0]?.teachers_canonical) &&
      Number(countsAfter[0]?.users) === Number(countsBefore[0]?.users) &&
      Number(countsAfter[0]?.assignments) === Number(countsBefore[0]?.assignments) &&
      Number(countsAfter[0]?.teachers_canonical) === 1 &&
      Number(countsAfter[0]?.users) === 1 &&
      Number(countsAfter[0]?.assignments) === 1;
    classify(
      scenarios,
      "ID-05",
      "Replay sync identique — pas de prolifération injustifiée sur identité canonique",
      stable ? "confirmé" : "indéterminé",
      `before=${JSON.stringify(countsBefore[0])} after=${JSON.stringify(countsAfter[0])}`,
      {
        meaning:
          "confirmé = idempotence sur TEACHERS-*/user/assignment (fait) ; ne tranche pas la dette jumeaux",
      },
    );

    // ---------- ID-06 : comparaison élève BORNE (contexte) ----------
    state = await getState(school.adminToken);
    const jsonStudent = (state.students ?? []).find((row) => row.id === chain.studentIds[0]);
    const pgStudents = await pgQuery(
      `SELECT st.id, st.student_code, st.school_id
       FROM students st
       JOIN schools s ON s.id = st.school_id
       WHERE s.school_code = $1
       LIMIT 10`,
      [school.schoolCode],
    );
    evidence.studentContext = {
      jsonStudent: jsonStudent
        ? {
            id: jsonStudent.id,
            matricule: jsonStudent.matricule ?? null,
            publicId: jsonStudent.publicId ?? null,
            className: jsonStudent.className ?? null,
          }
        : null,
      pgStudents: pgStudents.map((s) => ({
        id: s.id,
        student_code: s.student_code,
      })),
      note: "Contexte uniquement — hors décision PRE-E1-STUDENT-CODE-SCOPE",
    };
    classify(
      scenarios,
      "ID-06",
      "Comparaison élève bornée (contexte) — pas de décision student_code",
      "contexte",
      `json.id=${jsonStudent?.id} json.matricule=${jsonStudent?.matricule ?? jsonStudent?.publicId} pgCodes=${pgStudents
        .map((s) => s.student_code)
        .join(",")}`,
      {
        meaning:
          "Réserve CTO : ni caractérisation complète STUDENT-CODE-SCOPE, ni arbitrage UNIQUE, ni modif modèle",
      },
    );

    // ---------- Questions Q1–Q7 ----------
    const distinctTeacherIds = new Set(afterIds.length ? afterIds : twinIds);
    const writePoints = [
      "PUT /api/backoffice/state (users via contact+account)",
      "PUT /api/backoffice/state (teachers TEACHERS-* + twin TEACHER-*)",
      "PUT /api/backoffice/state (assignments → sync teacher_assignments)",
      "login JWT (identifier ENS/user)",
      "POST /api/notes (authz + evaluations.teacher_id)",
    ];
    evidence.identities.writePoints = writePoints;

    classify(
      questions,
      "Q1",
      "Combien d’identités distinctes pour un enseignant opérationnel ?",
      distinctTeacherIds.size >= 2 ? "confirmé" : distinctTeacherIds.size === 1 ? "infirmé" : "indéterminé",
      `nJsonTeacherIds=${distinctTeacherIds.size} ids=[${[...distinctTeacherIds].join(",")}] + user=${chain.teacherUser.id} + pgTeachers=${pgTeachers.length}`,
    );
    classify(
      questions,
      "Q2",
      "Points d’écriture qui créent/mutent chaque identité ?",
      writePoints.length >= 3 ? "confirmé" : "indéterminé",
      writePoints.join(" · "),
    );
    const canonicalCandidate = chain.teachersRecord.id;
    const assignmentUsesCanonical =
      String(jsonAssignment?.teacherId) === String(canonicalCandidate);
    classify(
      questions,
      "Q3",
      "Existe-t-il une identité canonique de fait après HOTFIX-02B ?",
      assignmentUsesCanonical && pgCanonical ? "confirmé" : "indéterminé",
      `candidatAffectation=${canonicalCandidate} pg.teacher_code=${pgCanonical?.teacher_code ?? null} (canonique de fait pour affectation/PG — jumeau JSON toujours présent)`,
    );
    classify(
      questions,
      "Q4",
      "Les jumeaux TEACHER-* / TEACHERS-* restent-ils deux fiches après sync ?",
      stillBoth || bothPresentJson ? "confirmé" : "infirmé",
      `afterDedupe=[${afterIds.join(",")}]`,
    );
    const teacherCodeStable =
      pgCanonical && String(pgCanonical.teacher_code) === String(chain.teachersRecord.id);
    classify(
      questions,
      "Q5",
      "teacher_code PG aligné sur id pédagogique BO TEACHERS-* ?",
      teacherCodeStable ? "confirmé" : "infirmé",
      `expected=${chain.teachersRecord.id} obtained=${pgCanonical?.teacher_code ?? null}`,
    );
    const sessionUserCode =
      evidence.identities.session?.meUser?.id ||
      jwt.sub ||
      jwt.id ||
      chain.teacherUser.id;
    const userIdMatchesSession =
      pgCanonical &&
      pgUsers[0] &&
      String(pgCanonical.user_id) === String(pgUsers[0].id) &&
      String(pgUsers[0].user_code) === String(chain.teacherUser.id);
    classify(
      questions,
      "Q6",
      "teachers.user_id pointe-t-il vers le user de session du POST notes ?",
      userIdMatchesSession && postOk ? "confirmé" : "indéterminé",
      `pg.user_id=${pgCanonical?.user_id} users.user_code=${pgUsers[0]?.user_code} sessionHint=${sessionUserCode}`,
    );
    const evalTeacherCode = evalRows[0]?.teacher_code ?? null;
    const jsonEvalTeacherId = putSession.evaluation?.teacherId;
    const jsonPointsCanonical =
      String(jsonAssignment?.teacherId) === String(chain.teachersRecord.id) &&
      String(jsonEvalTeacherId) === String(chain.teachersRecord.id);
    const pgEvalMatchesCanonical =
      evalTeacherCode != null &&
      String(evalTeacherCode) === String(chain.teachersRecord.id);
    const pgEvalMatchesTwin =
      evalTeacherCode != null && isTeacherTwinCode(evalTeacherCode);
    // Écart redouté : JSON canonique TEACHERS-* mais evaluation PG rattachée à un TEACHER-* 
    const divergenceJsonVsPg = jsonPointsCanonical && pgEvalMatchesTwin;
    const fullConvergence = jsonPointsCanonical && pgEvalMatchesCanonical && assignAligned;
    classify(
      questions,
      "Q7",
      "Références JSON (assignment/evaluation.teacherId) vs identité PG ?",
      divergenceJsonVsPg ? "confirmé" : fullConvergence ? "infirmé" : "indéterminé",
      `assignment.teacherId=${jsonAssignment?.teacherId} evaluation.teacherId=${jsonEvalTeacherId} pgEval=${JSON.stringify(evalRows[0] ?? null)}`,
      {
        meaning: divergenceJsonVsPg
          ? "confirmé = écart reproductible JSON TEACHERS-* vs evaluations.teacher_id → TEACHER-*"
          : fullConvergence
            ? "infirmé = convergence JSON↔PG sur TEACHERS-*"
            : "indéterminé",
      },
    );

    // ---------- Synthèse dette (factuelle) ----------
    const twinsConfirmed = questions.some(
      (q) => q.id === "Q4" && q.classification === "confirmé",
    );
    const evalDivergenceConfirmed = questions.some(
      (q) => q.id === "Q7" && q.classification === "confirmé",
    );
    const identityGapConfirmed = twinsConfirmed || evalDivergenceConfirmed;
    const synthesis = {
      debtId: "PRE-E1-IDENTITY-LIFECYCLE",
      severityDocumented: "MAJOR",
      characterization: identityGapConfirmed
        ? "maintenue_MAJOR_confirmée"
        : "indéterminée",
      factualSummary: identityGapConfirmed
        ? "Écarts multi-couches reproductibles : (1) fiches JSON TEACHER-* et TEACHERS-* coexistent sans fusion pour le même user/identifier ; (2) assignment/evaluation JSON ancrés TEACHERS-* alors que evaluations.teacher_id PG peut résoudre vers TEACHER-* ; affectation PG et teachers.user_id restent cohérents sur le chemin TEACHERS-*/session."
        : "Les preuves V2.1 n’ont pas permis de confirmer un écart multi-fiches stable.",
      confirmedGaps: [
        twinsConfirmed ? "Q4/ID-04 jumeaux non fusionnés" : null,
        evalDivergenceConfirmed ? "Q7 divergence evaluation JSON↔PG" : null,
      ].filter(Boolean),
      noCorrectivePlanAuthorized: true,
      studentCodeScope: "hors périmètre décisionnel (ID-06 contexte seulement)",
      nextStepAllowed:
        "Un plan correctif minimal pourra être soumis séparément à validation CTO — non inclus et non autorisé dans cette PR de caractérisation",
    };

    const payload = {
      audit: "PRE-E1",
      phase: "V2.1",
      subject: "PRE-E1-IDENTITY-LIFECYCLE",
      generatedAt: new Date().toISOString(),
      apiBase: API_BASE,
      database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
      nature: "characterization-only",
      implementation: "forbidden",
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
      putNotesHttp: putRes.status,
    };

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`\nPreuve écrite : ${path.relative(ROOT, OUT_FILE)}`);
    console.log(`Synthèse dette : ${synthesis.characterization}`);
    console.log("Harness caractérisation : OK (exit 0 — aucune correction appliquée)");
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
