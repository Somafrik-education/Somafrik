/**
 * Helpers partagés pour les tests E2E API Somafrik.
 */
const assert = require("assert");

const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";

async function request(path, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, body: data, data };
}

async function login(identifier, password, schoolCode) {
  const data = await loginFull(identifier, password, schoolCode);
  return data.accessToken;
}

function extractApiList(response) {
  const payload = response?.data ?? response?.body ?? response;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

async function loginFull(identifier, password, schoolCode) {
  const tryLogin = (candidatePassword) =>
    request("/backoffice/login", {
      method: "POST",
      body: { identifier, password: candidatePassword, ...(schoolCode ? { schoolCode } : {}) },
    });

  const finalizeLogin = async (res, candidatePassword) => {
    const data = res.data;
    // temporaryPassword n'est plus renvoyé dans user (S1.3) — s'appuyer sur mustChangePassword.
    const needsPasswordChange = Boolean(data?.user?.mustChangePassword);
    if (needsPasswordChange && data?.accessToken) {
      const changeRes = await request("/auth/change-password", {
        method: "POST",
        token: data.accessToken,
        body: { newPassword: candidatePassword },
      });
      if (changeRes.status === 200 && changeRes.data?.accessToken) {
        return {
          ...data,
          ...changeRes.data,
          user: { ...(data.user ?? {}), ...(changeRes.data.user ?? {}), mustChangePassword: false },
          mustChangePassword: false,
        };
      }
    }
    return data;
  };

  const candidates = buildLoginPasswordCandidates(identifier, password);

  let res = null;
  for (const candidatePassword of candidates) {
    res = await tryLogin(candidatePassword);
    if (res.status === 200) {
      return finalizeLogin(res, candidatePassword);
    }
    if (res.status === 423) {
      await clearLoginLockout();
      res = await tryLogin(candidatePassword);
      if (res.status === 200) {
        return finalizeLogin(res, candidatePassword);
      }
      assert.fail(
        `login ${identifier}: compte verrouillé — exécutez « docker compose restart backend » ou « npm run verify:e2e-preflight ».`,
      );
    }
  }

  assert.strictEqual(
    res?.status,
    200,
    `login ${identifier}: ${JSON.stringify(res?.data)} — exécutez « npm run bootstrap:e2e-superadmin » puis « npm run verify:e2e-preflight ».`,
  );
  return res.data;
}

function buildLoginPasswordCandidates(identifier, password) {
  const nonEmpty = (value) => String(value ?? "").trim();
  if (normalize(identifier) === normalize(SUPERADMIN_ID)) {
    const primary = resolveSuperadminPassword(password);
    if (process.env.SOMAFRIK_E2E_TRY_KNOWN_PASSWORDS === "true") {
      return [
        ...new Set(
          [primary, ...KNOWN_SUPERADMIN_PASSWORDS]
            .map(nonEmpty)
            .filter(Boolean),
        ),
      ];
    }
    return [primary];
  }
  if (normalize(identifier) === "admin") {
    return [...new Set([password, ADMIN_PASSWORD, "E2eTest!2026"].map(nonEmpty).filter(Boolean))];
  }
  return [nonEmpty(password)].filter(Boolean);
}

function resolveSuperadminPassword(explicitPassword) {
  const nonEmpty = (value) => String(value ?? "").trim();
  const ordered = [
    explicitPassword,
    process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD,
    process.env.SOMAFRIK_TEST_SUPERADMIN_PASSWORD,
    process.env.BOOTSTRAP_SUPERADMIN_PASSWORD,
    SUPERADMIN_PASSWORD,
  ]
    .map(nonEmpty)
    .filter(Boolean);
  return ordered[0] ?? "E2eTest!2026";
}

async function clearLoginLockout() {
  try {
    await request("/backoffice/e2e/clear-login-lockout", { method: "POST" });
  } catch {
    /* endpoint indisponible hors mode E2E */
  }
}

async function probeBackend() {
  try {
    const response = await fetch(`${base.replace(/\/api$/, "")}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function loginExpect(identifier, password, schoolCode, expectedStatus) {
  const res = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.strictEqual(
    res.status,
    expectedStatus,
    `login ${identifier} (attendu ${expectedStatus}): ${JSON.stringify(res.data)}`,
  );
  return res;
}

async function mobileLogin(role, identifier, pin, schoolCode) {
  const data = await mobileLoginFull(role, identifier, pin, schoolCode);
  return data.accessToken;
}

async function mobileLoginFull(role, identifier, pin, schoolCode) {
  const res = await request("/login", {
    method: "POST",
    body: { role, identifier, pin, schoolCode },
  });
  assert.strictEqual(res.status, 200, `mobile login ${identifier}: ${JSON.stringify(res.data)}`);
  const data = res.data;
  const needsPasswordChange =
    Boolean(data?.user?.mustChangePassword) ||
    Boolean(String(data?.user?.temporaryPassword ?? "").trim());
  if (needsPasswordChange && data?.accessToken) {
    const changeRes = await request("/auth/change-password", {
      method: "POST",
      token: data.accessToken,
      body: { newPassword: pin },
    });
    if (changeRes.status === 200 && changeRes.data?.accessToken) {
      return {
        ...data,
        ...changeRes.data,
        user: { ...(data.user ?? {}), ...(changeRes.data.user ?? {}), mustChangePassword: false },
        accessToken: changeRes.data.accessToken,
      };
    }
  }
  return data;
}

async function mobileIdentify(identifier, schoolCode) {
  const res = await request("/identify", {
    method: "POST",
    body: { identifier, schoolCode },
  });
  assert.strictEqual(res.status, 200, `identify ${identifier}: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function getState(token) {
  const res = await request("/backoffice/state", { token });
  assert.strictEqual(res.status, 200, `state: ${JSON.stringify(res.data)}`);
  return res.data;
}

/**
 * Crée une classe via /api/classes (plus d'écriture legacy state.classes).
 * @returns {{ classRecord: object, state: object }}
 */
async function createClassViaApi(token, draft = {}) {
  const name = String(draft.name ?? "").trim();
  assert.ok(name, "createClassViaApi: name requis");
  const statusRaw = String(draft.status ?? "active").trim().toLowerCase();
  const status =
    statusRaw === "inactive" || statusRaw === "archivée" || statusRaw === "archivee"
      ? "inactive"
      : "active";
  const body = {
    name,
    academicYearName: String(draft.academicYearName ?? draft.schoolYear ?? "2025-2026").trim(),
    status,
  };
  const level = String(draft.level ?? "").trim();
  const section = String(draft.section ?? draft.track ?? "").trim();
  if (level) body.level = level;
  if (section) body.section = section;

  const res = await request("/classes", { method: "POST", token, body });
  if (res.status === 409) {
    const state = await getState(token);
    const existing = (state.classes ?? []).find(
      (row) => normalize(row.name) === normalize(name),
    );
    assert.ok(existing, `classe 409 sans projection: ${name}`);
    return { classRecord: existing, state, created: false };
  }
  assert.strictEqual(res.status, 201, `POST /classes: ${JSON.stringify(res.data)}`);
  const state = await getState(token);
  const classRecord =
    (state.classes ?? []).find(
      (row) =>
        String(row.id ?? row.publicId ?? "") === String(res.data.classCode) ||
        normalize(row.name) === normalize(name),
    ) ?? {
      id: res.data.classCode,
      publicId: res.data.classCode,
      name: res.data.name,
      schoolCode: res.data.schoolCode,
      level: res.data.level,
      track: res.data.section,
      status: res.data.status === "inactive" ? "Archivée" : "Active",
      schoolYear: res.data.academicYearName,
    };
  return { classRecord, state, created: true, api: res.data };
}

async function patchClassViaApi(token, classCode, patch = {}) {
  const body = { ...patch };
  if (body.status != null) {
    const statusRaw = String(body.status).trim().toLowerCase();
    if (
      statusRaw === "inactive" ||
      statusRaw === "archivée" ||
      statusRaw === "archivee" ||
      statusRaw === "archived"
    ) {
      body.status = "inactive";
    } else if (statusRaw === "active" || statusRaw === "actif") {
      body.status = "active";
    }
  }
  if (body.track && !body.section) {
    body.section = body.track;
    delete body.track;
  }
  delete body.schoolYear;
  delete body.schoolCode;
  delete body.id;
  delete body.publicId;
  const res = await request(`/classes/${encodeURIComponent(classCode)}`, {
    method: "PATCH",
    token,
    body,
  });
  assert.ok(res.status >= 200 && res.status < 300, `PATCH /classes: ${JSON.stringify(res.data)}`);
  const state = await getState(token);
  return { api: res.data, state };
}

async function putState(token, body) {
  const res = await request("/backoffice/state", { method: "PUT", token, body });
  assert.strictEqual(res.status, 200, `put state: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function putStatePatch(token, patch) {
  const incoming = patch ?? {};
  let workingPatch = { ...incoming };

  if (Object.prototype.hasOwnProperty.call(workingPatch, "classes")) {
    const current = await getState(token);
    const currentByName = new Map(
      (current.classes ?? []).map((row) => [normalize(row.name), row]),
    );
    for (const row of workingPatch.classes ?? []) {
      const name = String(row?.name ?? "").trim();
      if (!name) continue;
      const existing = currentByName.get(normalize(name));
      if (!existing) {
        const created = await createClassViaApi(token, row);
        if (created.classRecord) {
          currentByName.set(normalize(name), created.classRecord);
        }
        continue;
      }
      const classCode = String(existing.id ?? existing.publicId ?? existing.classCode ?? "").trim();
      const nextStatus = String(row.status ?? "").trim();
      if (classCode && nextStatus) {
        const currentStatus = String(existing.status ?? "").trim();
        if (normalize(currentStatus) !== normalize(nextStatus)) {
          await patchClassViaApi(token, classCode, { status: nextStatus });
        }
      }
    }
    delete workingPatch.classes;
  }

  if (Object.keys(workingPatch).length === 0) {
    return getState(token);
  }

  const current = await getState(token);
  const { classes: _currentClasses, ...currentWithoutClasses } = current;
  return putState(token, { ...currentWithoutClasses, ...workingPatch });
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function todayPeriodDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
}

function pushResult(results, step, expected, obtained, ok) {
  results.push({ Etape: step, Attendu: expected, Obtenu: obtained, OK: ok });
}

const SUPERADMIN_ID = process.env.SOMAFRIK_E2E_SUPERADMIN_ID || "superadmin";
const SUPERADMIN_PASSWORD =
  process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD ||
  process.env.SOMAFRIK_TEST_SUPERADMIN_PASSWORD ||
  "E2eTest!2026";
const ADMIN_PASSWORD =
  process.env.SOMAFRIK_E2E_ADMIN_PASSWORD ||
  process.env.SOMAFRIK_TEST_ADMIN_PASSWORD ||
  "E2eTest!2026";
/** PIN mobile E2E (6 chiffres, non trivial — aligné validatePinPolicy). */
const E2E_PARENT_PIN = process.env.SOMAFRIK_E2E_PARENT_PIN || "847392";
const E2E_TEACHER_PIN = process.env.SOMAFRIK_E2E_TEACHER_PIN || "529481";
const E2E_WRONG_PIN = process.env.SOMAFRIK_E2E_WRONG_PIN || "638274";
/** Mots de passe connus des jeux de données locaux (seed, wipe --bootstrap, E2E). */
const KNOWN_SUPERADMIN_PASSWORDS = ["1234", "E2eTest!2026", "change-me-now"];

async function setupActiveSchool(superToken, stamp) {
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
  const current = await getState(superToken);
  const nextUsers = [
    ...(current.users ?? []).filter(
      (user) => normalize(user.identifier) !== normalize(schoolAdminIdentifier),
    ),
    schoolAdmin,
  ];
  await putStatePatch(superToken, { users: nextUsers });
  const adminToken = await login(schoolAdminIdentifier, ADMIN_PASSWORD, schoolCode);
  return { schoolCode, schoolName, schoolAdminIdentifier, adminToken };
}

async function resolveSchoolContext(superToken) {
  const presetSchool = String(process.env.SOMAFRIK_TEST_SCHOOL_CODE ?? "").trim();
  const presetAdmin = String(process.env.SOMAFRIK_E2E_SCHOOL_ADMIN_ID ?? "admin").trim();

  if (presetSchool) {
    const schoolRes = await request(`/backoffice/establishments/${encodeURIComponent(presetSchool)}`, {
      token: superToken,
    });
    if (schoolRes.status === 200) {
      try {
        const adminToken = await login(presetAdmin, ADMIN_PASSWORD, presetSchool);
        return {
          schoolCode: presetSchool,
          schoolName: schoolRes.data?.name ?? presetSchool,
          schoolAdminIdentifier: presetAdmin,
          adminToken,
        };
      } catch {
        /* recréer ci-dessous */
      }
    }
  }

  return setupActiveSchool(superToken, Date.now());
}

module.exports = {
  base,
  request,
  login,
  loginFull,
  loginExpect,
  mobileLogin,
  mobileLoginFull,
  mobileIdentify,
  getState,
  createClassViaApi,
  patchClassViaApi,
  putState,
  putStatePatch,
  newId,
  normalize,
  todayPeriodDate,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
  E2E_PARENT_PIN,
  E2E_TEACHER_PIN,
  E2E_WRONG_PIN,
  KNOWN_SUPERADMIN_PASSWORDS,
  setupActiveSchool,
  resolveSchoolContext,
  resolveSuperadminPassword,
  clearLoginLockout,
  probeBackend,
  extractApiList,
};
