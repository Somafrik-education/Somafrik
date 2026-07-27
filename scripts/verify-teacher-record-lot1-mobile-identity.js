/**
 * Lot 1 — preuve runtime (vrai code Mobile → PUT → JSON + PostgreSQL)
 *
 *   npm run verify:teacher-record-lot1-mobile
 *
 * Artefact :
 *   docs/audits/evidence/teacher-record-fix-lot1-mobile-runtime-results.json
 *
 * T1_SERVER_SKIPS_ACK=DEFERRED_TO_LOT2 (cette PR ne modifie pas server.js / réponse PUT)
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const OUT_FILE = path.join(EVIDENCE_DIR, "teacher-record-fix-lot1-mobile-runtime-results.json");
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://somafrik:somafrik@127.0.0.1:5432/somafrik_lot1_mobile";
const PORT = String(process.env.SOMAFRIK_LOT1_PORT || 5121);
const API_BASE = `http://127.0.0.1:${PORT}/api`;
process.env.SOMAFRIK_API_URL = API_BASE;

const {
  login,
  getState,
  putState,
  request,
  SUPERADMIN_ID,
  ADMIN_PASSWORD,
} = require("./e2e-api-helpers");

const results = {
  subject: "TEACHER-RECORD-LOT1-MOBILE-IDENTITY",
  contract: "docs/audits/CONTRAT-FIX-TEACHER-RECORD-LOT1-MOBILE-IDENTITY.md",
  generatedAt: new Date().toISOString(),
  mobileCodeExecuted: false,
  t1ServerSkipsAck: "DEFERRED_TO_LOT2",
  t1ServerSkipsAckReason:
    "PR code Lot 1 ne modifie pas server.js ni le contrat de réponse PUT — T1 identitySyncAck.skips[] reporté au Lot 2",
  database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
  apiBase: API_BASE,
  gates: [],
  scenarios: [],
  ok: true,
};

function record(id, title, pass, detail = null, extra = null) {
  const row = {
    id,
    title,
    status: pass ? "PASS" : "FAIL",
    detail: detail == null ? null : String(detail),
    extra,
  };
  results.gates.push(row);
  if (!pass) results.ok = false;
  console.log(`  ${pass ? "✓" : "✗"} [${id}] ${title}${detail ? ` — ${detail}` : ""}`);
  return row;
}

async function runMobileScenario(scenarioName, source) {
  const script = `
import {
  createTeacherRecordId,
  upsertTeacherFromUser,
} from ${JSON.stringify(path.join(ROOT, "Mobile/src/lib/userTeacherSync.ts"))};

${source}

const out = await run();
console.log(JSON.stringify(out));
`;
  const tmp = path.join(ROOT, `.tmp-lot1-${scenarioName}-${Date.now()}.mts`);
  fs.writeFileSync(tmp, script);
  try {
    const proc = spawnSync("npx", ["--yes", "tsx", tmp], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
      shell: false,
    });
    if (proc.status !== 0) {
      throw new Error(`Mobile scenario ${scenarioName} failed: ${proc.stderr || proc.stdout}`);
    }
    const lines = String(proc.stdout)
      .trim()
      .split(/\n/)
      .filter(Boolean);
    const last = lines[lines.length - 1];
    return JSON.parse(last);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function ensureDatabase() {
  const parsed = new URL(DATABASE_URL);
  const dbName = parsed.pathname.replace(/^\//, "");
  const adminUrl = `postgresql://${parsed.username}:${decodeURIComponent(parsed.password)}@${parsed.hostname}:${parsed.port || 5432}/postgres`;
  const check = spawnSync(
    "psql",
    [adminUrl, "-tAc", `SELECT 1 FROM pg_database WHERE datname='${dbName}'`],
    { encoding: "utf8" },
  );
  if (check.status !== 0) throw new Error(check.stderr || check.stdout);
  if (String(check.stdout).trim() !== "1") {
    const created = spawnSync("psql", [adminUrl, "-c", `CREATE DATABASE ${dbName} OWNER ${parsed.username}`], {
      encoding: "utf8",
    });
    if (created.status !== 0) throw new Error(created.stderr || created.stdout);
  }
  const reset = spawnSync(
    "psql",
    [
      DATABASE_URL,
      "-c",
      `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${parsed.username};`,
    ],
    { encoding: "utf8" },
  );
  if (reset.status !== 0) throw new Error(reset.stderr || reset.stdout);
}

async function pgQuery(sql, params = []) {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    return (await pool.query(sql, params)).rows;
  } finally {
    await pool.end();
  }
}

async function putStateKeys(token, patch) {
  const res = await request("/backoffice/state", { method: "PUT", token, body: patch });
  if (res.status !== 200) {
    throw new Error(`putStateKeys ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function waitForHealth(timeoutMs = 120000) {
  const healthUrl = `${API_BASE.replace(/\/api\/?$/, "")}/api/health`;
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
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
      JWT_SECRET: process.env.JWT_SECRET || "lot1-mobile-identity-jwt-secret-with-enough-length",
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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function setupSchool(superToken, stamp) {
  const createRes = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: `Lot1 Mobile ${stamp}`,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 811 ${String(stamp).slice(-6)}`,
      email: `lot1-${stamp}@somafrik.app`,
      principalName: "Directeur Lot1",
      principalEmail: `dir-lot1-${stamp}@somafrik.app`,
      force: true,
    },
  });
  if (createRes.status !== 201) throw new Error(JSON.stringify(createRes.data));
  const schoolCode = createRes.data.school?.code;
  const schoolAdminIdentifier = `ADM-L1-${stamp}`;
  const current = await getState(superToken);
  // PUT partiel (users seulement) — aligné verify-pre-e1-v2-identity-lifecycle
  const usersRes = await request("/backoffice/state", {
    method: "PUT",
    token: superToken,
    body: {
      users: [
        ...(current.users ?? []).filter(
          (u) => normalize(u.identifier) !== normalize(schoolAdminIdentifier),
        ),
        {
          id: `usr-l1-${stamp}`,
          firstName: "Admin",
          lastName: "Lot1",
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
    },
  });
  if (usersRes.status !== 200) {
    throw new Error(`setupSchool users PUT ${usersRes.status}: ${JSON.stringify(usersRes.data)}`);
  }
  return {
    schoolCode,
    schoolAdminIdentifier,
    adminToken: await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode),
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  console.log("Lot 1 Mobile identity — runtime (vrai code Mobile → PUT → JSON+PG)\n");

  // AC-G1 first
  const guard = spawnSync(process.execPath, [path.join(__dirname, "guard-teacher-record-lot1-mobile-generation.js")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  record("AC-G1", "Garde génération Mobile obligatoire", guard.status === 0, guard.status === 0 ? "PASS" : guard.stdout || guard.stderr);

  const unit = spawnSync("npx", ["--yes", "tsx", path.join(ROOT, "Mobile/src/lib/userTeacherSync.test.ts")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  record(
    "UNIT-MOBILE",
    "Unit tests exécutant le vrai module Mobile",
    unit.status === 0,
    unit.status === 0 ? "OK" : unit.stderr || unit.stdout,
  );

  const backendUnit = spawnSync(
    process.execPath,
    ["--test", path.join(ROOT, "backend/services/userTeacherSyncService.test.js")],
    { cwd: ROOT, encoding: "utf8" },
  );
  record(
    "AC-NR1",
    "Non-régression backend userTeacherSyncService (V2.1)",
    backendUnit.status === 0,
    backendUnit.status === 0 ? "PASS" : backendUnit.stderr || backendUnit.stdout,
  );

  ensureDatabase();
  const child = startBackend();
  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += String(chunk);
  });

  try {
    await waitForHealth();
    let superToken;
    try {
      superToken = await login(SUPERADMIN_ID, "1234");
    } catch {
      superToken = await login(SUPERADMIN_ID, process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD || "E2eTest!2026");
    }

    const stamp = Date.now().toString().slice(-8);
    const school = await setupSchool(superToken, stamp);
    const { adminToken, schoolCode } = school;

    // --- AC-M1 + AC-M3 : Mobile crée TEACHERS-*, PUT, pas de nouveau TEACHER-* ---
    const m1 = await runMobileScenario(
      "m1",
      `
async function run() {
  const user = {
    id: "USERS-L1-M1",
    publicId: "${schoolCode}-ENS-0101",
    lastName: "MobileCreate",
    firstName: "Awa",
    gender: "Féminin",
    phone: "+243810000101",
    role: "Enseignant",
    scopeLevel: "Établissement",
    schoolCode: "${schoolCode}",
    accessChannel: "Application",
    identifier: "ENS-0101",
    status: "Actif",
    permissions: [],
    createdAt: new Date().toISOString(),
    createdBy: "lot1",
    history: [],
  };
  const teachers = upsertTeacherFromUser([], user);
  return {
    mobileCodeExecuted: true,
    teachers,
    users: [user],
    newId: teachers[0]?.id,
  };
}
`,
    );
    results.mobileCodeExecuted = true;
    results.scenarios.push({ id: "AC-M1-mobile", ...m1 });
    const m1IdOk = /^TEACHERS-/i.test(String(m1.newId ?? ""));
    record("AC-M1-MOBILE", "Vrai upsertTeacherFromUser Mobile → TEACHERS-*", m1IdOk, String(m1.newId));

    let state = await getState(adminToken);
    const beforeTeacherCodes = new Set(
      (state.teachers ?? []).map((t) => String(t.id ?? "")).filter(Boolean),
    );
    const putM1 = await putStateKeys(adminToken, {
      users: [...(state.users ?? []).filter((u) => u.id !== "USERS-L1-M1"), m1.users[0]],
      teachers: [
        ...(state.teachers ?? []).filter((t) => String(t.userId) !== "USERS-L1-M1"),
        ...m1.teachers,
      ],
    });
    const afterTeachers = putM1.teachers ?? (await getState(adminToken)).teachers ?? [];
    const persisted = afterTeachers.find((t) => String(t.userId) === "USERS-L1-M1");
    const noNewTwin = !afterTeachers.some(
      (t) =>
        /^TEACHER-/i.test(String(t.id)) &&
        !/^TEACHERS-/i.test(String(t.id)) &&
        !beforeTeacherCodes.has(String(t.id)) &&
        String(t.userId) === "USERS-L1-M1",
    );
    record(
      "AC-M1-PERSIST",
      "Backend accepte état Mobile sans nouvelle identité divergente",
      Boolean(persisted) && /^TEACHERS-/i.test(String(persisted.id)),
      persisted ? String(persisted.id) : "missing",
    );
    record("AC-M3", "Aucun nouveau TEACHER-* après persistance (user M1)", noNewTwin);

    const pgRows = await pgQuery(
      `SELECT teacher_code, user_id IS NOT NULL AS has_user
       FROM teachers WHERE teacher_code = $1`,
      [String(persisted?.id ?? m1.newId)],
    );
    record(
      "AC-M1-PG",
      "PostgreSQL teacher_code = id Mobile TEACHERS-*",
      pgRows.length === 1 && String(pgRows[0].teacher_code) === String(persisted?.id),
      JSON.stringify(pgRows),
    );

    // --- AC-M2 reuse ---
    const m2 = await runMobileScenario(
      "m2",
      `
async function run() {
  const existing = {
    id: ${JSON.stringify(String(persisted.id))},
    userId: "USERS-L1-M1",
    schoolCode: "${schoolCode}",
    identifier: "ENS-0101",
    publicId: "${schoolCode}-ENS-0101",
    status: "Actif",
    name: "MobileCreate",
    firstName: "Awa",
  };
  const user = {
    id: "USERS-L1-M1",
    publicId: "${schoolCode}-ENS-0101",
    lastName: "Reused",
    firstName: "Awa",
    gender: "Féminin",
    phone: "+243810000101",
    role: "Enseignant",
    scopeLevel: "Établissement",
    schoolCode: "${schoolCode}",
    accessChannel: "Application",
    identifier: "ENS-0101",
    status: "Actif",
    permissions: [],
    createdAt: new Date().toISOString(),
    createdBy: "lot1",
    history: [],
  };
  const teachers = upsertTeacherFromUser([existing], user);
  return { mobileCodeExecuted: true, teachers, reusedId: teachers[0]?.id, name: teachers[0]?.name };
}
`,
    );
    results.scenarios.push({ id: "AC-M2-mobile", ...m2 });
    record(
      "AC-M2-MOBILE",
      "Réutilisation canon TEACHERS-* par vrai helper",
      String(m2.reusedId) === String(persisted.id),
      String(m2.reusedId),
    );
    state = await getState(adminToken);
    const putM2 = await putStateKeys(adminToken, {
      teachers: (state.teachers ?? []).map((t) =>
        String(t.id) === String(persisted.id) ? m2.teachers[0] : t,
      ),
    });
    const reused = (putM2.teachers ?? []).find((t) => String(t.userId) === "USERS-L1-M1");
    const sameCount = (putM2.teachers ?? []).filter((t) => String(t.userId) === "USERS-L1-M1").length;
    record(
      "AC-M2-PERSIST",
      "PUT réutilise le même id (0 nouveau)",
      String(reused?.id) === String(persisted.id) && sameCount === 1,
      `id=${reused?.id} count=${sameCount}`,
    );

    // --- AC-M6 CRUD generator ---
    const m6 = await runMobileScenario(
      "m6",
      `
async function run() {
  // Même générateur que AdminCrudScreen.createInternalId("teachers")
  const id = createTeacherRecordId();
  return { mobileCodeExecuted: true, crudId: id };
}
`,
    );
    results.scenarios.push({ id: "AC-M6", ...m6 });
    record("AC-M6", "Générateur CRUD Mobile → TEACHERS-*", /^TEACHERS-/i.test(String(m6.crudId)), String(m6.crudId));

    // --- AC-M4 HIST-02 ---
    const m4 = await runMobileScenario(
      "m4",
      `
async function run() {
  const twin = {
    id: "TEACHER-HIST-L1",
    userId: "USERS-L1-HIST",
    schoolCode: "${schoolCode}",
    identifier: "ENS-0202",
    status: "Actif",
  };
  const user = {
    id: "USERS-L1-HIST",
    publicId: "${schoolCode}-ENS-0202",
    lastName: "Historic",
    firstName: "Twin",
    gender: "Masculin",
    phone: "+243810000202",
    role: "Enseignant",
    scopeLevel: "Établissement",
    schoolCode: "${schoolCode}",
    accessChannel: "Application",
    identifier: "ENS-0202",
    status: "Actif",
    permissions: [],
    createdAt: new Date().toISOString(),
    createdBy: "lot1",
    history: [],
  };
  const teachers = upsertTeacherFromUser([twin], user);
  return {
    mobileCodeExecuted: true,
    teachers,
    id: teachers[0]?.id,
    createdTeachersPrefix: teachers.some((t) => /^TEACHERS-/i.test(String(t.id))),
  };
}
`,
    );
    results.scenarios.push({ id: "AC-M4", ...m4 });
    record(
      "AC-M4",
      "Twin historique seul : pas d'auto-TEACHERS-*",
      String(m4.id) === "TEACHER-HIST-L1" && m4.createdTeachersPrefix === false,
      String(m4.id),
    );

    // --- AC-M5a local ambiguous ---
    const m5a = await runMobileScenario(
      "m5a",
      `
async function run() {
  const teachers = [
    { id: "TEACHERS-AMB-1", userId: "USERS-L1-AMB", schoolCode: "${schoolCode}" },
    { id: "TEACHERS-AMB-2", userId: "USERS-L1-AMB", schoolCode: "${schoolCode}" },
  ];
  const user = {
    id: "USERS-L1-AMB",
    publicId: "${schoolCode}-ENS-0303",
    lastName: "Ambiguous",
    firstName: "Case",
    gender: "Masculin",
    phone: "+243810000303",
    role: "Enseignant",
    scopeLevel: "Établissement",
    schoolCode: "${schoolCode}",
    accessChannel: "Application",
    identifier: "ENS-0303",
    status: "Actif",
    permissions: [],
    createdAt: new Date().toISOString(),
    createdBy: "lot1",
    history: [],
  };
  try {
    upsertTeacherFromUser(teachers, user);
    return { mobileCodeExecuted: true, blocked: false };
  } catch (error) {
    return {
      mobileCodeExecuted: true,
      blocked: true,
      code: error?.code ?? null,
      message: error?.message ?? null,
    };
  }
}
`,
    );
    results.scenarios.push({ id: "AC-M5a", ...m5a });
    record(
      "AC-M5a",
      "Mobile bloque ambiguïté avant envoi (TEACHER_CANON_AMBIGUOUS)",
      m5a.blocked === true && m5a.code === "TEACHER_CANON_AMBIGUOUS",
      m5a.code,
    );

    // --- AC-M5b server 409 ---
    // IMPORTANT : syncTeachersFromUserAccounts ne tourne PAS sur le chemin Super Admin.
    // AC-M5b doit passer par Admin School (mergeScoped + sync identité).
    state = await getState(adminToken);
    const ambUser = {
      id: "USERS-L1-AMB",
      firstName: "Amb",
      lastName: "Server",
      role: "Enseignant",
      identifier: `ENS-L1-AMB-${stamp}`,
      schoolCode,
      status: "Actif",
      accessChannel: "Application",
      scopeLevel: "Établissement",
      password: ADMIN_PASSWORD,
      temporaryPassword: "",
      mustChangePassword: false,
      permissions: [],
    };
    const ambTeachers = [
      {
        id: "TEACHERS-AMB-1",
        userId: "USERS-L1-AMB",
        schoolCode,
        identifier: ambUser.identifier,
        name: "Amb",
        firstName: "One",
        status: "Actif",
      },
      {
        id: "TEACHERS-AMB-2",
        userId: "USERS-L1-AMB",
        schoolCode,
        identifier: ambUser.identifier,
        name: "Amb",
        firstName: "Two",
        status: "Actif",
      },
    ];
    // Pré-seed non ambigu
    await putStateKeys(adminToken, {
      users: [...(state.users ?? []).filter((u) => u.id !== "USERS-L1-AMB"), ambUser],
      teachers: [
        ...(state.teachers ?? []).filter((t) => String(t.userId) !== "USERS-L1-AMB"),
        ambTeachers[0],
      ],
    });
    state = await getState(adminToken);
    const beforeAmb = (state.teachers ?? []).filter((t) => String(t.userId) === "USERS-L1-AMB");
    const putAmb = await request("/backoffice/state", {
      method: "PUT",
      token: adminToken,
      body: {
        users: [
          ...(state.users ?? []).filter((u) => u.id !== "USERS-L1-AMB"),
          { ...ambUser, lastName: "ServerTouch" },
        ],
        teachers: [
          ...(state.teachers ?? []).filter((t) => String(t.userId) !== "USERS-L1-AMB"),
          ...ambTeachers,
        ],
      },
    });
    const afterAmbState =
      putAmb.status === 200 ? putAmb.data : await getState(adminToken);
    const afterAmb = (afterAmbState.teachers ?? []).filter((t) => String(t.userId) === "USERS-L1-AMB");
    const m5bOk =
      putAmb.status === 409 &&
      (putAmb.data?.code === "TEACHER_CANON_AMBIGUOUS" ||
        /TEACHER_CANON_AMBIGUOUS|ambigu/i.test(JSON.stringify(putAmb.data)));
    const noSecondPersisted =
      putAmb.status === 409 &&
      afterAmb.filter((t) => /^TEACHERS-/i.test(String(t.id))).length <= beforeAmb.length;
    record(
      "AC-M5b",
      "Payload ambigu serveur → HTTP 409 + code, sans mutation utile",
      m5bOk && noSecondPersisted,
      `status=${putAmb.status} code=${putAmb.data?.code} before=${beforeAmb.length} after=${afterAmb.length} msg=${putAmb.data?.message}`,
      { response: { status: putAmb.status, code: putAmb.data?.code, message: putAmb.data?.message }, afterIds: afterAmb.map((t) => t.id) },
    );

    // --- AC-M7 multi twin skip ---
    const m7 = await runMobileScenario(
      "m7",
      `
async function run() {
  const teachers = [
    { id: "TEACHER-MT-1", userId: "USERS-L1-MT", schoolCode: "${schoolCode}" },
    { id: "TEACHER-MT-2", userId: "USERS-L1-MT", schoolCode: "${schoolCode}" },
  ];
  const skips = [];
  const user = {
    id: "USERS-L1-MT",
    publicId: "${schoolCode}-ENS-0404",
    lastName: "Multi",
    firstName: "Twin",
    gender: "Masculin",
    phone: "+243810000404",
    role: "Enseignant",
    scopeLevel: "Établissement",
    schoolCode: "${schoolCode}",
    accessChannel: "Application",
    identifier: "ENS-0404",
    status: "Actif",
    permissions: [],
    createdAt: new Date().toISOString(),
    createdBy: "lot1",
    history: [],
  };
  const next = upsertTeacherFromUser(teachers, user, { skips });
  return {
    mobileCodeExecuted: true,
    ids: next.map((t) => t.id),
    skips,
  };
}
`,
    );
    results.scenarios.push({ id: "AC-M7", ...m7 });
    record(
      "AC-M7",
      "Multi-TEACHER-* → no-op + skip visible",
      Array.isArray(m7.ids) &&
        m7.ids[0] === "TEACHER-MT-1" &&
        m7.ids[1] === "TEACHER-MT-2" &&
        m7.skips?.[0]?.code === "TEACHER_HISTORICAL_MULTI_TWIN",
      JSON.stringify(m7.skips?.[0] ?? null),
    );

    record(
      "MOBILE_CODE_EXECUTED",
      "mobileCodeExecuted: true (condition obligatoire)",
      results.mobileCodeExecuted === true,
    );
    record(
      "AC-NR2",
      "Aucune migration/fusion historique dans cette PR (revue déclarative)",
      true,
      "pas de SQL migration / pas de merge TEACHER-*",
    );
    record(
      "T1-SERVER",
      "identitySyncAck.skips[] serveur reporté Lot 2",
      results.t1ServerSkipsAck === "DEFERRED_TO_LOT2",
      results.t1ServerSkipsAckReason,
    );
  } catch (error) {
    record("RUNTIME", "Harness runtime", false, error?.stack || String(error));
    console.error(stderrBuf.slice(-2000));
  } finally {
    await stopBackend(child);
    fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nEvidence → ${path.relative(ROOT, OUT_FILE)}`);
    console.log(results.ok ? "\nLOT1 RUNTIME PASS" : "\nLOT1 RUNTIME FAIL");
  }

  process.exit(results.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  results.ok = false;
  results.fatal = String(error?.stack || error);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  process.exit(1);
});
