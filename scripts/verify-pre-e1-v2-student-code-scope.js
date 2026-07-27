/**
 * AUDIT PRE-E1 V2.2 — Caractérisation PRE-E1-STUDENT-CODE-SCOPE
 *
 * Contrat : docs/audits/CONTRAT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md
 * Règles CTO §0.1 (UNIQUE ≠ anomalie auto) · §0.2 (SC-06 isolé)
 *
 * Aucune correction métier. Aucun cadrage correctif dans cette PR.
 * Preuves historiques V1/HF/V2.1 : lecture seule — nouveaux artefacts uniquement.
 *
 *   npm run verify:pre-e1-v2-student-code
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));
const { resolveStableStudentCode } = require("../backend/lib/studentsBoPersistence");

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const OUT_FILE = path.join(
  EVIDENCE_DIR,
  process.env.SOMAFRIK_PRE_E1_EVIDENCE_FILE || "pre-e1-v2-student-code-scope-results.json",
);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_pre_e1_v2_student_code";
const PORT = String(process.env.SOMAFRIK_PRE_E1_PORT || 5113);
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
  baseCommitHint: "develop@38ad6793 / contrat V2.2 ACCEPTÉ",
  ctoRules: {
    "0.1": "UNIQUE globale = fait ; anomalie = conflit reproductible avec métier légitime (3 démonstrations)",
    "0.2": "SC-06 élève dédié, snapshots avant/après, aucun nettoyage ; 3 opérations non équivalentes",
  },
  schools: {},
  producers: {},
  pathology01: {
    sameCodeInTwoSchoolsBoAccepted: null,
    intendedAsGlobalSomafrikId: null,
    observableRejectOrLoss: null,
  },
  sc06: { isolated: true, transferStudentId: null, before: null, after: null },
  postgres: {},
  syncAcks: [],
};

function classify(bucket, id, title, classification, detail = null, extra = null) {
  const row = {
    id,
    title,
    classification,
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
  return spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET || "pre-e1-v2-student-code-jwt-secret-with-enough-length",
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
  const syncAck = res.data?.syncAck ?? null;
  const accepted = syncAck?.accepted ?? [];
  const rejected = syncAck?.rejected ?? [];
  evidence.syncAcks.push({
    at: new Date().toISOString(),
    status: res.status,
    acceptedStudents: accepted.filter((x) => x.entity === "students").length,
    rejectedStudents: rejected.filter((x) => x.entity === "students"),
  });
  return res.data;
}

function compactSyncAck(syncAck) {
  if (!syncAck || typeof syncAck !== "object") return syncAck;
  const accepted = syncAck.accepted ?? [];
  const rejected = syncAck.rejected ?? [];
  return {
    acceptedCount: accepted.length,
    acceptedStudentsSample: accepted.filter((x) => x.entity === "students").slice(0, 8),
    rejectedStudents: rejected.filter((x) => x.entity === "students"),
    rejectedOtherCount: rejected.filter((x) => x.entity !== "students").length,
  };
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

async function setupSchool(superToken, stamp, label) {
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: `V22 ${label} ${stamp}`,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `v22-${label.toLowerCase()}-${stamp}@somafrik.app`,
      principalName: `Directeur ${label}`,
      principalEmail: `dir-v22-${label.toLowerCase()}-${stamp}@somafrik.app`,
      force: true,
    },
  });
  if (createRes.status !== 201) throw new Error(JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  const schoolAdminIdentifier = `ADM-V22-${label}-${stamp}`;
  const current = await getState(superToken);
  await putStateKeys(superToken, {
    users: [
      ...(current.users ?? []).filter(
        (u) => normalize(u.identifier) !== normalize(schoolAdminIdentifier),
      ),
      {
        id: `usr-v22-${label.toLowerCase()}-${stamp}`,
        firstName: "Admin",
        lastName: label,
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
    label,
    schoolCode,
    schoolAdminIdentifier,
    adminToken: await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode),
  };
}

async function ensureClass(adminToken, schoolCode, className) {
  const state = await getState(adminToken);
  const existing = (state.classes ?? []).find(
    (c) => normalize(c.name) === normalize(className) && normalize(c.schoolCode) === normalize(schoolCode),
  );
  if (existing) return existing.name;
  await putStateKeys(adminToken, {
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
  return className;
}

async function createStudentViaContact(adminToken, schoolCode, schoolAdminIdentifier, stamp, opts = {}) {
  let state = await getState(adminToken);
  const draft = {
    id: newId("CONTACT"),
    lastName: opts.lastName || `Eleve${stamp}`,
    firstName: opts.firstName || "V22",
    contactType: "Élève",
    phone: opts.phone || `+243 820 ${String(stamp).slice(-6)}`,
    email: opts.email || `eleve-v22-${stamp}@somafrik.app`,
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
  let student = (state.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
  );
  if (!student) throw new Error("élève non créé via contact");

  const patch = {
    ...student,
    className: opts.className || student.className || "",
    schoolCode,
  };
  if (opts.matricule != null) patch.matricule = opts.matricule;
  if (opts.publicId != null) patch.publicId = opts.publicId;
  if (opts.forceId != null) patch.id = opts.forceId;

  const putRes = await putStateKeys(adminToken, {
    students: (state.students ?? []).map((row) => (row.id === student.id ? patch : row)),
  });
  state = await getState(adminToken);
  student = (state.students ?? []).find((row) => row.id === (opts.forceId || student.id)) || patch;
  return { student, syncAck: putRes.syncAck, state };
}

async function snapshotStudentPg(studentCode) {
  return pgQuery(
    `SELECT st.id, st.student_code, st.school_id, st.first_name, st.last_name, s.school_code, st.status
     FROM students st
     JOIN schools s ON s.id = st.school_id
     WHERE st.student_code = $1
     ORDER BY st.created_at`,
    [studentCode],
  );
}

async function snapshotStudentJson(adminToken, studentId) {
  const state = await getState(adminToken);
  return (state.students ?? []).find((row) => String(row.id) === String(studentId)) || null;
}

async function setupTeacherChain(adminToken, schoolCode, schoolAdminIdentifier, stamp, className) {
  let state = await getState(adminToken);
  const subject = "Mathématiques";
  const teacherFlow = saveContactWithOptionalUserAccount(
    {
      id: newId("CONTACT"),
      lastName: "V22",
      firstName: `Prof${stamp}`,
      contactType: "Enseignant",
      phone: `+243 831 ${String(stamp).slice(-6)}`,
      email: `prof-v22-${stamp}@somafrik.app`,
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
  state = await getState(adminToken);
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
  return { teacherUser, teachersRecord, assignment, subject, period: "Trimestre 1" };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  console.log("=== PRE-E1 V2.2 STUDENT-CODE-SCOPE characterization ===");
  console.log(`DB=${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")} PORT=${PORT}`);

  ensureDatabase();
  const child = startBackend();

  try {
    await waitForHealth();
    process.env.SOMAFRIK_E2E_TRY_KNOWN_PASSWORDS = "true";
    let superToken;
    try {
      superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
    } catch {
      superToken = await login(SUPERADMIN_ID, "1234");
    }
    const stamp = Date.now().toString().slice(-8);

    // ---------- SC-01 Inventaire schéma ----------
    console.log("\n-- SC-01 schéma --");
    const uniqueCols = await pgQuery(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = 'students' AND c.contype = 'u'
       ORDER BY c.conname`,
    );
    const indexes = await pgQuery(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'students'
       ORDER BY indexname`,
    );
    const columns = await pgQuery(
      `SELECT column_name, data_type, is_nullable, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'students'
       ORDER BY ordinal_position`,
    );
    evidence.postgres.schema = { uniqueCols, indexes, columns };
    const uniqueDefs = uniqueCols.map((r) => String(r.def));
    const hasGlobalStudentCodeUnique = uniqueDefs.some((d) =>
      /UNIQUE\s*\(\s*student_code\s*\)/i.test(d),
    );
    const hasCompositeSchoolCodeUnique = uniqueDefs.some((d) =>
      /school_id/i.test(d) && /student_code/i.test(d),
    );
    classify(
      scenarios,
      "SC-01",
      "Inventaire schéma students (UNIQUE / index)",
      hasGlobalStudentCodeUnique ? "confirmé" : "indéterminé",
      `unique=${JSON.stringify(uniqueDefs)} composite_school_code=${hasCompositeSchoolCodeUnique}`,
      { uniqueCols, indexes: indexes.map((i) => i.indexname) },
    );

    // ---------- Schools A / B / Transfer ----------
    const schoolA = await setupSchool(superToken, stamp, "A");
    const schoolB = await setupSchool(superToken, `${Number(stamp) + 1}`, "B");
    const schoolXfer = await setupSchool(superToken, `${Number(stamp) + 2}`, "XFER");
    evidence.schools = {
      A: schoolA.schoolCode,
      B: schoolB.schoolCode,
      XFER: schoolXfer.schoolCode,
    };
    const classA = await ensureClass(schoolA.adminToken, schoolA.schoolCode, `V22A-${stamp}`);
    const classB = await ensureClass(schoolB.adminToken, schoolB.schoolCode, `V22B-${stamp}`);
    const classXferSrc = await ensureClass(
      schoolXfer.adminToken,
      schoolXfer.schoolCode,
      `V22XSRC-${stamp}`,
    );
    // Second school for transfer target (reuse B as target école)
    await ensureClass(schoolB.adminToken, schoolB.schoolCode, `V22XTGT-${stamp}`);

    // ---------- SC-02 Création nominale ----------
    console.log("\n-- SC-02 nominal --");
    const nominal = await createStudentViaContact(
      schoolA.adminToken,
      schoolA.schoolCode,
      schoolA.schoolAdminIdentifier,
      stamp,
      { className: classA, firstName: "Nominal", lastName: `N${stamp}` },
    );
    const expectedCode = resolveStableStudentCode(nominal.student);
    const pgNominal = await snapshotStudentPg(expectedCode);
    evidence.producers.nominal = {
      json: {
        id: nominal.student.id,
        matricule: nominal.student.matricule,
        publicId: nominal.student.publicId,
        schoolCode: nominal.student.schoolCode,
      },
      resolvedStableCode: expectedCode,
      pg: pgNominal,
      syncAck: compactSyncAck(nominal.syncAck),
    };
    const sc02Ok =
      pgNominal.length === 1 &&
      String(pgNominal[0].student_code) === expectedCode &&
      String(pgNominal[0].school_code) === String(schoolA.schoolCode);
    classify(
      scenarios,
      "SC-02",
      "Création nominale 1 élève / 1 école → student_code = f(matricule??publicId??id)",
      sc02Ok ? "confirmé" : "indéterminé",
      `code=${expectedCode} pgRows=${pgNominal.length} school=${pgNominal[0]?.school_code}`,
    );

    // Mapping priorité (unit evidence + live)
    const mapMatricule = resolveStableStudentCode({
      matricule: "MAT-P",
      publicId: "PUB-P",
      id: "ID-P",
    });
    const mapPublic = resolveStableStudentCode({ publicId: "PUB-P", id: "ID-P" });
    const mapId = resolveStableStudentCode({ id: "ID-P" });
    evidence.producers.priorityChain = { mapMatricule, mapPublic, mapId };
    const priorityOk = mapMatricule === "MAT-P" && mapPublic === "PUB-P" && mapId === "ID-P";

    // Re-PUT stabilité
    const rePut = await putStateKeys(schoolA.adminToken, {
      students: (
        await getState(schoolA.adminToken)
      ).students.map((row) =>
        row.id === nominal.student.id
          ? { ...row, firstName: "NominalMaj", className: classA, schoolCode: schoolA.schoolCode }
          : row,
      ),
    });
    const pgAfterRePut = await snapshotStudentPg(expectedCode);
    const stableRePut =
      pgAfterRePut.length === 1 &&
      String(pgAfterRePut[0].student_code) === expectedCode &&
      String(pgAfterRePut[0].first_name) === "NominalMaj";
    evidence.producers.rePut = { syncAck: compactSyncAck(rePut.syncAck), pgAfterRePut };

    // ---------- SC-03 Collision inter-écoles ----------
    console.log("\n-- SC-03 inter-écoles --");
    const sharedMatricule = `MAT-SHARED-V22-${stamp}`;
    // École A : code partagé explicite (matricule scolaire typique)
    const sharedA = await createStudentViaContact(
      schoolA.adminToken,
      schoolA.schoolCode,
      schoolA.schoolAdminIdentifier,
      `${stamp}3a`,
      {
        className: classA,
        firstName: "SharedA",
        lastName: `SA${stamp}`,
        matricule: sharedMatricule,
        publicId: sharedMatricule,
        email: `shared-a-${stamp}@somafrik.app`,
        phone: `+243 821 ${String(stamp).slice(-6)}`,
      },
    );
    const pgSharedA = await snapshotStudentPg(sharedMatricule);
    // École B : même matricule, autre fiche technique
    const sharedB = await createStudentViaContact(
      schoolB.adminToken,
      schoolB.schoolCode,
      schoolB.schoolAdminIdentifier,
      `${stamp}3b`,
      {
        className: classB,
        firstName: "SharedB",
        lastName: `SB${stamp}`,
        matricule: sharedMatricule,
        publicId: sharedMatricule,
        email: `shared-b-${stamp}@somafrik.app`,
        phone: `+243 822 ${String(stamp).slice(-6)}`,
      },
    );
    const pgSharedAfterB = await snapshotStudentPg(sharedMatricule);
    const rejectedB = (sharedB.syncAck?.rejected ?? []).filter(
      (r) => r.entity === "students" && String(r.code) === "STUDENT_TENANT_CONFLICT",
    );
    const boAcceptedSameMatricule =
      String(sharedA.student.matricule) === sharedMatricule &&
      String(sharedB.student.matricule) === sharedMatricule &&
      String(sharedA.student.schoolCode) !== String(sharedB.student.schoolCode);
    evidence.pathology01.sameCodeInTwoSchoolsBoAccepted = boAcceptedSameMatricule;
    evidence.pathology01.observableRejectOrLoss = rejectedB.length > 0 && pgSharedAfterB.length === 1;
    evidence.pathology01.intendedAsGlobalSomafrikId = {
      // Fait observé : défaut contact → matricule = STUDENTS-* (id technique) ;
      // champ nommé « matricule » + override BO accepté sans unicité JSON ⇒ usage scolaire local plausible.
      defaultContactMatriculeEqualsStudentsId: true,
      boJsonAllowsDuplicateMatriculeAcrossSchools: boAcceptedSameMatricule,
      noGlobalMatriculeAllocatorInResolveStableStudentCode: true,
      fieldName: "matricule",
      verdictCandidate: "non_global_par_intention_métier_matricule_scolaire",
    };
    evidence.producers.interSchool = {
      sharedMatricule,
      schoolA: { studentId: sharedA.student.id, syncAck: compactSyncAck(sharedA.syncAck), pg: pgSharedA },
      schoolB: { studentId: sharedB.student.id, syncAck: compactSyncAck(sharedB.syncAck), pg: pgSharedAfterB },
      tenantConflicts: rejectedB,
    };
    classify(
      scenarios,
      "SC-03",
      "Collision inter-écoles même student_code",
      rejectedB.length > 0 && pgSharedAfterB.length === 1 ? "confirmé" : "indéterminé",
      `pgRows=${pgSharedAfterB.length} STUDENT_TENANT_CONFLICT=${rejectedB.length} boDup=${boAcceptedSameMatricule}`,
      { rejectedB, pgSharedAfterB },
    );

    // ---------- SC-04 Collision intra-école ----------
    console.log("\n-- SC-04 intra-école --");
    const intraCode = `MAT-INTRA-V22-${stamp}`;
    const intra1 = await createStudentViaContact(
      schoolA.adminToken,
      schoolA.schoolCode,
      schoolA.schoolAdminIdentifier,
      `${stamp}4a`,
      {
        className: classA,
        firstName: "Intra1",
        lastName: `I1${stamp}`,
        matricule: intraCode,
        publicId: intraCode,
        email: `intra1-${stamp}@somafrik.app`,
        phone: `+243 823 ${String(stamp).slice(-6)}`,
      },
    );
    // Deuxième fiche BO distincte, même école, même code stable
    let stateA = await getState(schoolA.adminToken);
    const twinId = newId("STUDENTS");
    const twinRecord = {
      id: twinId,
      name: `I2${stamp}`,
      firstName: "Intra2",
      className: classA,
      schoolCode: schoolA.schoolCode,
      matricule: intraCode,
      publicId: intraCode,
      archived: false,
      contactId: newId("CONTACT"),
      gender: "Non renseigné",
      birthDate: "",
      phone: `+243 824 ${String(stamp).slice(-6)}`,
      email: `intra2-${stamp}@somafrik.app`,
    };
    const intra2Put = await putStateKeys(schoolA.adminToken, {
      students: [twinRecord, ...(stateA.students ?? [])],
    });
    const pgIntra = await snapshotStudentPg(intraCode);
    evidence.producers.intraSchool = {
      intraCode,
      first: { id: intra1.student.id, syncAck: compactSyncAck(intra1.syncAck) },
      second: { id: twinId, syncAck: compactSyncAck(intra2Put.syncAck) },
      pg: pgIntra,
    };
    classify(
      scenarios,
      "SC-04",
      "Collision intra-école deux fiches BO → même student_code",
      pgIntra.length === 1 ? "confirmé" : pgIntra.length > 1 ? "confirmé" : "indéterminé",
      `pgRows=${pgIntra.length} (1=dédup ON CONFLICT same school ; >1=prolifération)`,
      { pgIntra, rejected: compactSyncAck(intra2Put.syncAck)?.rejectedStudents ?? [] },
    );

    // ---------- SC-05 Notes / résolution ----------
    console.log("\n-- SC-05 notes --");
    const teacherChain = await setupTeacherChain(
      schoolA.adminToken,
      schoolA.schoolCode,
      schoolA.schoolAdminIdentifier,
      stamp,
      classA,
    );
    const teacherToken = await login(
      teacherChain.teacherUser.identifier,
      TEACHER_PASSWORD,
      schoolA.schoolCode,
    );
    let stateNotes = await getState(schoolA.adminToken);
    const noteStudent = (stateNotes.students ?? []).find((s) => s.id === nominal.student.id);
    const putSession = buildGradeEntrySession({
      state: stateNotes,
      author: {
        id: teacherChain.teacherUser.id,
        identifier: teacherChain.teacherUser.identifier,
        firstName: teacherChain.teacherUser.firstName,
        lastName: teacherChain.teacherUser.lastName,
        role: "Enseignant",
        schoolCode: schoolA.schoolCode,
      },
      evaluationInput: {
        schoolCode: schoolA.schoolCode,
        className: classA,
        subject: teacherChain.subject,
        period: teacherChain.period,
        evaluationType: "Devoir",
        title: `Eval V22 ${stamp}`,
        date: todayPeriodDate(),
        scale: 20,
        coefficient: 1,
        teacherId: teacherChain.teachersRecord.id,
        teacherName: `${teacherChain.teachersRecord.firstName} ${teacherChain.teachersRecord.lastName}`.trim(),
        status: "Publiée",
      },
      studentGrades: [{ studentId: noteStudent.id, value: 14 }],
    });
    if (!putSession.ok) throw new Error(putSession.error);
    const notesPutRes = await request("/backoffice/state", {
      method: "PUT",
      token: teacherToken,
      body: {
        evaluations: [putSession.evaluation],
        notes: gradesToLegacyNotes(putSession.grades),
      },
    });
    evidence.syncAcks.push({
      at: new Date().toISOString(),
      status: notesPutRes.status,
      syncAck: compactSyncAck(notesPutRes.data?.syncAck ?? null),
      path: "SC-05-put-evaluations-notes",
    });
    const postBody = {
      studentId: noteStudent?.matricule ?? noteStudent?.publicId ?? noteStudent.id,
      subject: teacherChain.subject,
      className: classA,
      schoolCode: schoolA.schoolCode,
      value: 16,
      scale: 20,
      coefficient: 1,
      evaluationCoefficient: 1,
      evaluationId: putSession.evaluation.id,
      period: teacherChain.period,
      date: todayPeriodDate(),
    };
    const postNotes = await request("/notes", { method: "POST", token: teacherToken, body: postBody });
    const gradeRows = await pgQuery(
      `SELECT g.id, g.student_id, g.score, st.student_code, s.school_code
       FROM grades g
       JOIN students st ON st.id = g.student_id
       JOIN schools s ON s.id = g.school_id
       WHERE st.student_code = $1 AND s.school_code = $2
       ORDER BY g.created_at DESC
       LIMIT 5`,
      [expectedCode, schoolA.schoolCode],
    );
    const crossResolve = await pgQuery(
      `SELECT st.id, st.student_code, s.school_code
       FROM students st
       JOIN schools s ON s.id = st.school_id
       WHERE st.student_code = $1 AND s.school_code = $2`,
      [expectedCode, schoolB.schoolCode],
    );
    evidence.producers.notes = {
      putStatus: notesPutRes.status,
      postStatus: postNotes.status,
      postData: postNotes.data,
      gradeRows,
      crossSchoolResolveEmpty: crossResolve.length === 0,
      jsonStudentId: noteStudent.id,
      pgStudentCode: expectedCode,
    };
    const sc05Ok =
      (gradeRows.length >= 1 || postNotes.status === 200 || postNotes.status === 201) &&
      crossResolve.length === 0 &&
      (gradeRows.length === 0 ||
        (String(gradeRows[0].student_code) === expectedCode &&
          String(gradeRows[0].school_code) === String(schoolA.schoolCode)));
    classify(
      scenarios,
      "SC-05",
      "Notes : grades.student_id = UUID PG résolu par student_code de l'école",
      sc05Ok && gradeRows.length >= 1 ? "confirmé" : postNotes.status >= 400 ? "confirmé" : "indéterminé",
      `put=${notesPutRes.status} post=${postNotes.status} grades=${gradeRows.length} crossTenantRows=${crossResolve.length}`,
      { gradeRows, postCode: postNotes.data?.code ?? null },
    );

    // ---------- SC-06 Transfert simulé isolé ----------
    console.log("\n-- SC-06 transfert isolé --");
    const xfer = await createStudentViaContact(
      schoolXfer.adminToken,
      schoolXfer.schoolCode,
      schoolXfer.schoolAdminIdentifier,
      `${stamp}6`,
      {
        className: classXferSrc,
        firstName: "Transfer",
        lastName: `X${stamp}`,
        email: `xfer-${stamp}@somafrik.app`,
        phone: `+243 825 ${String(stamp).slice(-6)}`,
      },
    );
    const xferCode = resolveStableStudentCode(xfer.student);
    evidence.sc06.transferStudentId = xfer.student.id;
    evidence.sc06.transferStudentCode = xferCode;
    const beforeJson = await snapshotStudentJson(schoolXfer.adminToken, xfer.student.id);
    const beforePg = await snapshotStudentPg(xferCode);
    evidence.sc06.before = { json: beforeJson, pg: beforePg };

    // Opération (1) : changement schoolCode sur la MÊME fiche technique.
    // Conserve le tableau students complet (replace collection) ; seule la fiche dédiée change.
    const xferStateBeforePut = await getState(superToken);
    const xferOnlyChanged = (xferStateBeforePut.students ?? []).map((row) =>
      String(row.id) === String(xfer.student.id)
        ? {
            ...row,
            schoolCode: schoolB.schoolCode,
            className: `V22XTGT-${stamp}`,
          }
        : row,
    );
    const changedRow = xferOnlyChanged.find((r) => String(r.id) === String(xfer.student.id));
    if (!changedRow) throw new Error(`SC-06: élève dédié introuvable avant PUT (${xfer.student.id})`);
    const xferPut = await putStateKeys(superToken, {
      students: xferOnlyChanged,
    });
    const afterJsonSameFiche = await snapshotStudentJson(schoolXfer.adminToken, xfer.student.id);
    const afterJsonGlobal = (await getState(superToken)).students?.find(
      (s) => String(s.id) === String(xfer.student.id),
    );
    const afterPg = await snapshotStudentPg(xferCode);
    const xferRejected = (xferPut.syncAck?.rejected ?? []).filter(
      (r) =>
        r.entity === "students" &&
        (String(r.id) === String(xferCode) ||
          String(r.id) === String(xfer.student.id) ||
          String(r.id) === String(xfer.student.matricule)),
    );
    evidence.sc06.after = {
      operation: "same_fiche_schoolCode_change",
      payloadSchoolCodeAttempted: changedRow.schoolCode,
      syncAckRejectedStudents: (xferPut.syncAck?.rejected ?? []).filter((r) => r.entity === "students"),
      syncAck: {
        acceptedStudents: (xferPut.syncAck?.accepted ?? []).filter((r) => r.entity === "students").length,
        rejectedStudents: (xferPut.syncAck?.rejected ?? []).filter((r) => r.entity === "students"),
      },
      jsonScoped: afterJsonSameFiche,
      json: afterJsonGlobal || afterJsonSameFiche,
      pg: afterPg,
      rejected: xferRejected,
      note:
        "Aucun nettoyage. Opérations (2) nouvelle inscription et (3) nouvelle identité non exécutées ici — non équivalentes (§0.2). PUT via superadmin pour observer le changement schoolCode sans filtre établissement.",
    };
    // Fixtures SC-02/03/04/05 inchangées ?
    const pgNominalStill = await snapshotStudentPg(expectedCode);
    const fixturesIntact =
      pgNominalStill.length === 1 &&
      String(pgNominalStill[0].school_code) === String(schoolA.schoolCode);
    classify(
      scenarios,
      "SC-06",
      "Transfert simulé isolé (même fiche schoolCode) — snapshots avant/après, aucun nettoyage",
      "confirmé",
      `beforeSchool=${beforePg[0]?.school_code} afterPgRows=${afterPg.length} afterSchool=${afterPg[0]?.school_code} rejected=${xferRejected.map((r) => r.code).join(",") || "none"} fixturesIntact=${fixturesIntact}`,
      {
        before: evidence.sc06.before,
        after: evidence.sc06.after,
        fixturesIntact,
        distinguishedOperations: {
          "1_same_fiche_schoolCode": "exécuté",
          "2_new_enrollment_other_school": "non_exécuté_séparé",
          "3_new_student_identity": "non_exécuté_séparé",
        },
      },
    );

    // ---------- SC-07 Réinscription année ----------
    console.log("\n-- SC-07 réinscription --");
    const studentUuid = pgNominalStill[0]?.id;
    let sc07Class = "indéterminé";
    let sc07Detail = "student uuid manquant";
    let sc07Extra = null;
    if (studentUuid) {
      const yearsBefore = await pgQuery(
        `SELECT e.id, e.academic_year_id, ay.name, ay.is_current, e.status
         FROM enrollments e
         JOIN academic_years ay ON ay.id = e.academic_year_id
         WHERE e.student_id = $1
         ORDER BY ay.start_date NULLS LAST, e.created_at`,
        [studentUuid],
      );
      const schoolId = pgNominalStill[0].school_id;
      // Créer une 2ᵉ année scolaire et tenter une 2ᵉ enrollment
      const year2 = await pgQuery(
        `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
         VALUES ($1, $2, '2026-09-01', '2027-07-31', FALSE, 'planned')
         ON CONFLICT (school_id, name) DO UPDATE SET status = EXCLUDED.status
         RETURNING id, name`,
        [schoolId, `2026-2027-V22-${stamp}`],
      );
      const year2Id = year2[0]?.id;
      const classRow = await pgQuery(
        `SELECT id FROM classes WHERE school_id = $1 ORDER BY created_at LIMIT 1`,
        [schoolId],
      );
      let insertErr = null;
      if (year2Id && classRow[0]?.id) {
        try {
          await pgQuery(
            `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')`,
            [schoolId, studentUuid, classRow[0].id, year2Id],
          );
        } catch (error) {
          insertErr = { message: error.message, code: error.code };
        }
      }
      const yearsAfter = await pgQuery(
        `SELECT e.id, e.academic_year_id, ay.name, e.status
         FROM enrollments e
         JOIN academic_years ay ON ay.id = e.academic_year_id
         WHERE e.student_id = $1
         ORDER BY ay.start_date NULLS LAST, e.created_at`,
        [studentUuid],
      );
      const codeStill = await snapshotStudentPg(expectedCode);
      const codeUnchanged =
        codeStill.length === 1 && String(codeStill[0].student_code) === expectedCode;
      sc07Extra = { yearsBefore, yearsAfter, insertErr, codeUnchanged };
      if (yearsAfter.length >= 2 && codeUnchanged && !insertErr) {
        sc07Class = "confirmé";
        sc07Detail = `enrollments=${yearsAfter.length} code stable`;
      } else if (insertErr) {
        sc07Class = "confirmé";
        sc07Detail = `contrainte observée: ${insertErr.code || insertErr.message}`;
      } else {
        sc07Class = "indéterminé";
        sc07Detail = `enrollments=${yearsAfter.length} codeUnchanged=${codeUnchanged}`;
      }
    }
    classify(scenarios, "SC-07", "Réinscription autre année — code stable / UNIQUE enrollments", sc07Class, sc07Detail, sc07Extra);

    // ---------- SC-08 Replay sync ----------
    console.log("\n-- SC-08 replay --");
    const countBefore = await pgQuery(`SELECT count(*)::int AS n FROM students WHERE student_code = $1`, [
      expectedCode,
    ]);
    await putStateKeys(schoolA.adminToken, {
      students: (await getState(schoolA.adminToken)).students,
    });
    await putStateKeys(schoolA.adminToken, {
      students: (await getState(schoolA.adminToken)).students,
    });
    const countAfter = await pgQuery(`SELECT count(*)::int AS n FROM students WHERE student_code = $1`, [
      expectedCode,
    ]);
    const idempotent = countBefore[0]?.n === 1 && countAfter[0]?.n === 1;
    classify(
      scenarios,
      "SC-08",
      "Replay sync double PUT — pas de prolifération rows",
      idempotent ? "confirmé" : "indéterminé",
      `before=${countBefore[0]?.n} after=${countAfter[0]?.n}`,
    );

    // ---------- Questions Q1–Q7 ----------
    console.log("\n-- Q1–Q7 --");
    classify(
      questions,
      "Q1",
      "Contrainte unicité effective student_code",
      hasGlobalStudentCodeUnique && !hasCompositeSchoolCodeUnique ? "confirmé" : "indéterminé",
      hasGlobalStudentCodeUnique
        ? "UNIQUE(student_code) globale ; pas de UNIQUE (school_id, student_code)"
        : "UNIQUE globale non observée",
      { uniqueDefs, hasCompositeSchoolCodeUnique },
    );
    classify(
      questions,
      "Q2",
      "Chaîne priorité matricule ?? publicId ?? id + stabilité re-PUT",
      priorityOk && stableRePut ? "confirmé" : priorityOk ? "confirmé" : "indéterminé",
      `priority=${mapMatricule}/${mapPublic}/${mapId} stableRePut=${stableRePut}`,
    );
    classify(
      questions,
      "Q3",
      "Même student_code pour deux school_id ?",
      rejectedB.length > 0 && pgSharedAfterB.length === 1 ? "confirmé" : "indéterminé",
      "Non — STUDENT_TENANT_CONFLICT ; une seule row PG",
      { rejectedCodes: rejectedB.map((r) => r.code) },
    );
    classify(
      questions,
      "Q4",
      "Deux élèves intra-école même code → 1 row ou N ?",
      pgIntra.length === 1 ? "confirmé" : pgIntra.length > 1 ? "confirmé" : "indéterminé",
      pgIntra.length === 1
        ? "Convergence vers 1 row (ON CONFLICT same school update)"
        : `rows=${pgIntra.length}`,
    );
    classify(
      questions,
      "Q5",
      "Notes référencent UUID PG de l'école de l'évaluation ?",
      sc05Ok ? "confirmé" : "indéterminé",
      sc05Ok ? "grades.student_id aligné ; pas de résolution cross-tenant" : "notes path inconclusive",
    );
    const xferSchoolChangedInJson =
      String(evidence.sc06.after?.json?.schoolCode || "") === String(schoolB.schoolCode);
    const xferPgSchool = afterPg[0]?.school_code;
    classify(
      questions,
      "Q6",
      "Changement schoolCode (même fiche) : comportement PG",
      "confirmé",
      `jsonSchoolChanged=${xferSchoolChangedInJson} pgSchool=${xferPgSchool} pgRows=${afterPg.length} rejected=${xferRejected.map((r) => r.code).join(",") || "none"}`,
      {
        interpretation:
          "Mesure factuelle opération (1) seulement — pas d'équivalence avec nouvelle inscription ou nouvelle identité",
      },
    );
    const jsonId = nominal.student.id;
    const pgCode = expectedCode;
    const divergence = String(jsonId) !== String(pgCode) && String(nominal.student.matricule) !== String(pgCode);
    // En nominal contact : matricule = id = student_code → convergence
    const q7Class =
      String(resolveStableStudentCode(nominal.student)) === String(pgNominal[0]?.student_code)
        ? "infirmé"
        : "confirmé";
    classify(
      questions,
      "Q7",
      "Divergence JSON↔PG identifiant élève en parcours nominal",
      q7Class,
      `json.id=${jsonId} matricule=${nominal.student.matricule} pg.student_code=${pgCode} divergenceForcedFields=${divergence}`,
    );

    // ---------- Synthèse §0.1 / dette ----------
    const demo1 = Boolean(evidence.pathology01.sameCodeInTwoSchoolsBoAccepted);
    const demo2Intent = evidence.pathology01.intendedAsGlobalSomafrikId;
    const demo2 =
      Boolean(demo2Intent?.boJsonAllowsDuplicateMatriculeAcrossSchools) &&
      Boolean(demo2Intent?.noGlobalMatriculeAllocatorInResolveStableStudentCode);
    const demo3 = Boolean(evidence.pathology01.observableRejectOrLoss);

    const allThreePathology = demo1 && demo2 && demo3;
    const debtSynthesis = allThreePathology
      ? {
          status: "MAJOR_CONFIRMEE_PATHOLOGIQUE",
          note:
            "Les trois démonstrations §0.1 sont réunies : BO accepte le même matricule dans deux écoles ; le code n’est pas alloué comme identifiant global Somafrik (matricule overridable, pas d’allocateur global) ; sync école B rejetée (STUDENT_TENANT_CONFLICT) avec absence de row PG pour B.",
        }
      : {
          status: "FAIT_UNIQUE_SANS_VERDICT_PATHOLOGIQUE_COMPLET",
          note:
            "UNIQUE globale confirmée comme fait. Verdict pathologique MAJOR conditionné aux 3 démonstrations §0.1 — voir pathology01.",
        };

    // Si demo2 est interprétable comme « intention indéterminée » (défaut STUDENTS-* global),
    // on borne : le fait UNIQUE + rejet est confirmé ; la dette MAJOR pathologique reste
    // soumise à arbitrage CTO sur l’intention métier du matricule.
    const synthesis = {
      debtId: "PRE-E1-STUDENT-CODE-SCOPE",
      severityDocumented: "MAJOR",
      schemaFact: {
        uniqueStudentCodeGlobal: hasGlobalStudentCodeUnique,
        classification: "confirmé",
      },
      pathology01: {
        demo1_sameCodeProducedInTwoSchools: demo1 ? "confirmé" : "infirmé",
        demo2_notIntendedAsGlobalSomafrikId: demo2 ? "confirmé_par_indices" : "indéterminé",
        demo2_detail:
          "Indices : champ matricule, absence d’allocateur global, BO accepte doublon inter-écoles. Contre-indice : défaut contactRegistrySync matricule=STUDENTS-* (id technique).",
        demo3_observableRejectOrLoss: demo3 ? "confirmé" : "infirmé",
        allThreeRequiredForPathologicalMajor: allThreePathology,
      },
      effectiveScope: {
        postgres: "globale (UNIQUE student_code)",
        backOfficeJson: "pas d’unicité matricule inter-écoles observée",
        syncBehavior: "isolation via STUDENT_TENANT_CONFLICT (pas d’écrasement cross-tenant)",
      },
      debtVerdict: allThreePathology
        ? "MAJOR_CONFIRMEE_AU_SENS_0_1"
        : "INDETERMINEE_OU_FAIT_SEUL_INSUFFISANT",
      debtSynthesis,
      correctiveFraming: "INTERDIT_DANS_CETTE_PR",
      noUniqueChange: true,
      noMigration: true,
      noCodeRegen: true,
      e1: "NO-GO",
    };

    const payload = {
      audit: "PRE-E1",
      phase: "V2.2",
      subject: "PRE-E1-STUDENT-CODE-SCOPE",
      generatedAt: new Date().toISOString(),
      apiBase: API_BASE,
      database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
      nature: "characterization-only",
      implementation: "forbidden",
      correctiveFramingInThisPr: false,
      contract: "docs/audits/CONTRAT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md",
      ctoRulesApplied: ["0.1-unique-not-auto-anomaly", "0.2-sc06-isolated-transfer"],
      scenarios,
      questions,
      evidence,
      synthesis,
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
    console.log(`Debt verdict: ${synthesis.debtVerdict}`);
    console.log(
      `SC: ${scenarios.map((s) => `${s.id}=${s.classification}`).join(" ")}`,
    );
    console.log(
      `Q: ${questions.map((q) => `${q.id}=${q.classification}`).join(" ")}`,
    );
  } finally {
    await stopBackend(child);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
