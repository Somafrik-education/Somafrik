/**
 * Helpers partagés pour les tests E2E API Somafrik.
 */
const assert = require("assert");

const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return { status: response.status, data };
}

async function login(identifier, password, schoolCode) {
  const data = await loginFull(identifier, password, schoolCode);
  return data.accessToken;
}

async function loginFull(identifier, password, schoolCode) {
  const res = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.strictEqual(res.status, 200, `login ${identifier}: ${JSON.stringify(res.data)}`);
  return res.data;
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
  const res = await request("/login", {
    method: "POST",
    body: { role, identifier, pin, schoolCode },
  });
  assert.strictEqual(res.status, 200, `mobile login ${identifier}: ${JSON.stringify(res.data)}`);
  return res.data.accessToken;
}

async function getState(token) {
  const res = await request("/backoffice/state", { token });
  assert.strictEqual(res.status, 200, `state: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function putState(token, body) {
  const res = await request("/backoffice/state", { method: "PUT", token, body });
  assert.strictEqual(res.status, 200, `put state: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function putStatePatch(token, patch) {
  const current = await getState(token);
  return putState(token, { ...current, ...patch });
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
  process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD ||
  process.env.SOMAFRIK_TEST_ADMIN_PASSWORD ||
  "E2eTest!2026";

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
    temporaryPassword: ADMIN_PASSWORD,
    permissions: [],
  };
  await putState(superToken, { users: [schoolAdmin] });
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
  getState,
  putState,
  putStatePatch,
  newId,
  normalize,
  todayPeriodDate,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
  setupActiveSchool,
  resolveSchoolContext,
};
