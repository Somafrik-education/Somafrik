"use strict";

/**
 * LOT 0 RED — Issue #676 — contrat `GET /api/v2/school-setup/status`.
 *
 * Ces tests décrivent le contrat cible (D1, D4). Ils doivent échouer tant que
 * le module et la route sont absents. Ne pas inverser les assertions.
 * Aucune implémentation GREEN dans ce lot.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SERVER_PATH = path.join(ROOT, "backend/server.js");
const SCHEMA_PATH = path.join(ROOT, "backend/db/schema.sql");
const RBAC_PATH = path.join(ROOT, "backend/services/rbacService.js");
const MODULE_PATH = path.join(__dirname, "schoolSetupStatus.js");
const ROUTE_PATH = "/api/v2/school-setup/status";
const ROUTE_GET = `GET ${ROUTE_PATH}`;
const ROUTE_DECL = `app.get("${ROUTE_PATH}"`;

const SCHOOL_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SCHOOL_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "CD-EL-26-002";

const CORE_KEYS = Object.freeze(["academicYear", "structure", "classes"]);
const OPTIONAL_KEYS = Object.freeze([
  "periods",
  "subjects",
  "teachers",
  "students",
  "feeGrids",
  "notifications",
]);
const PAYLOAD_KEYS = Object.freeze(["core", "optional", "progress", "status"]);
const USER_KEYS = Object.freeze([
  "mustChangePassword",
  "must_change_password",
  "lastLoginAt",
  "last_login_at",
  "firstLogin",
  "hasSeenWizard",
]);
const ROUTE_KEYS = Object.freeze([
  "webRoute",
  "mobileRoute",
  "webPath",
  "mobilePath",
  "mobileScreen",
  "routes",
  "wizardPath",
  "dashboardPath",
]);

const SERVER = fs.readFileSync(SERVER_PATH, "utf8");
const SCHEMA = fs.readFileSync(SCHEMA_PATH, "utf8");
const RBAC = fs.readFileSync(RBAC_PATH, "utf8");

function loadSchoolSetupStatus() {
  try {
    return require("./schoolSetupStatus");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND" && String(error.message).includes("schoolSetupStatus")) {
      return null;
    }
    throw error;
  }
}

function requireContract() {
  const mod = loadSchoolSetupStatus();
  assert.ok(mod, "backend/lib/schoolSetupStatus.js manquant — contrat LOT 0 non implémenté");
  assert.equal(typeof mod.deriveSchoolSetupStatus, "function", "deriveSchoolSetupStatus manquant");
  assert.equal(typeof mod.resolveSchoolSetupTenant, "function", "resolveSchoolSetupTenant manquant");
  assert.equal(typeof mod.getSchoolSetupStatus, "function", "getSchoolSetupStatus manquant");
  return mod;
}

function snapshot(overrides = {}) {
  return {
    hasCurrentOrOpenAcademicYear: false,
    activatedLevelCount: 0,
    activatedGroupCount: 0,
    classCount: 0,
    termCount: 0,
    subjectCount: 0,
    teacherCount: 0,
    studentCount: 0,
    feeGridCount: 0,
    notificationsConfigured: false,
    ...overrides,
  };
}

function readyCore(overrides = {}) {
  return snapshot({
    hasCurrentOrOpenAcademicYear: true,
    activatedLevelCount: 1,
    activatedGroupCount: 1,
    classCount: 1,
    ...overrides,
  });
}

function fullOptional() {
  return {
    termCount: 3,
    subjectCount: 4,
    teacherCount: 2,
    studentCount: 12,
    feeGridCount: 1,
    notificationsConfigured: true,
  };
}

function schoolAdminA(overrides = {}) {
  return {
    role: "Admin School",
    sub: "admin-a-1",
    schoolId: SCHOOL_A_ID,
    schoolCode: LOGIN_A,
    effectiveSchoolId: SCHOOL_A_ID,
    effectiveSchoolCode: LOGIN_A,
    usersSchoolId: SCHOOL_A_ID,
    usersLoginCode: LOGIN_A,
    mustChangePassword: true,
    lastLoginAt: null,
    permissions: ["Paramètres Établissement:READ"],
    ...overrides,
  };
}

function schoolAdminB(overrides = {}) {
  return schoolAdminA({
    sub: "admin-b-1",
    schoolId: SCHOOL_B_ID,
    schoolCode: LOGIN_B,
    effectiveSchoolId: SCHOOL_B_ID,
    effectiveSchoolCode: LOGIN_B,
    usersSchoolId: SCHOOL_B_ID,
    usersLoginCode: LOGIN_B,
    ...overrides,
  });
}

function clientSchoolCodeSurfaces(code) {
  return {
    query: { schoolCode: code },
    body: { schoolCode: code },
    headers: {
      "x-somafrik-school-code": code,
      "x-school-code": code,
    },
    params: { schoolCode: code },
  };
}

function collectKeys(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const keys = [];
  for (const [key, nested] of Object.entries(value)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    keys.push(pathKey);
    keys.push(...collectKeys(nested, pathKey));
  }
  return keys;
}

function assertPayloadShape(payload) {
  assert.ok(payload && typeof payload === "object", "payload objet requis");
  assert.deepEqual(Object.keys(payload).sort(), [...PAYLOAD_KEYS]);
  assert.ok(["NOT_STARTED", "IN_PROGRESS", "READY"].includes(payload.status), payload.status);
  assert.deepEqual(Object.keys(payload.core).sort(), [...CORE_KEYS].sort());
  assert.deepEqual(Object.keys(payload.optional).sort(), [...OPTIONAL_KEYS].sort());
  assert.deepEqual(Object.keys(payload.progress).sort(), ["coreDone", "coreTotal"]);
  for (const key of CORE_KEYS) assert.equal(typeof payload.core[key], "boolean", key);
  for (const key of OPTIONAL_KEYS) assert.equal(typeof payload.optional[key], "boolean", key);
  assert.equal(payload.progress.coreTotal, 3);
  const expectedDone = CORE_KEYS.filter((key) => payload.core[key]).length;
  assert.equal(payload.progress.coreDone, expectedDone);
  if (payload.status === "READY") {
    assert.equal(payload.core.academicYear, true);
    assert.equal(payload.core.structure, true);
    assert.equal(payload.core.classes, true);
    assert.equal(payload.progress.coreDone, 3);
  } else if (payload.status === "NOT_STARTED") {
    assert.equal(payload.core.academicYear, false);
    assert.equal(payload.core.structure, false);
    assert.equal(payload.core.classes, false);
    assert.equal(payload.progress.coreDone, 0);
  } else {
    assert.ok(payload.progress.coreDone >= 1 && payload.progress.coreDone < 3);
  }
}

function assertNoUserOrRouteLeak(payload) {
  const keys = collectKeys(payload);
  for (const forbidden of [...USER_KEYS, ...ROUTE_KEYS]) {
    assert.ok(
      !keys.some((key) => key === forbidden || key.endsWith(`.${forbidden}`)),
      `champ interdit dans le payload: ${forbidden}`,
    );
  }
  const encoded = JSON.stringify(payload);
  assert.doesNotMatch(encoded, /\/parametres\/|\/etablissement\/|SchoolYearSettings|SchoolingHub/);
  assert.doesNotMatch(encoded, /mustChangePassword|last_login_at|must_change_password/);
}

function assertHas(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

function assertLacks(source, needle, message) {
  assert.ok(!source.includes(needle), message);
}

function routeSnippet() {
  const start = SERVER.indexOf(ROUTE_DECL);
  assert.ok(start >= 0, `${ROUTE_DECL} absent de backend/server.js`);
  return SERVER.slice(start, start + 1600);
}

function isClosedStatus(statusCode) {
  return statusCode === 400 || statusCode === 403 || statusCode === 401;
}

async function resolveTenant(mod, input) {
  const result = mod.resolveSchoolSetupTenant(input);
  return typeof result?.then === "function" ? await result : result;
}

function jwtOnlyAdmin({ sub, leftoverSchoolCode }) {
  return {
    role: "Admin School",
    sub,
    schoolCode: leftoverSchoolCode,
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Paramètres Établissement:READ"],
  };
}

function assertJwtOnlyPrincipal(principal) {
  for (const key of [
    "usersSchoolId",
    "usersLoginCode",
    "effectiveSchoolId",
    "effectiveSchoolCode",
    "schoolId",
    "academicYearSchoolId",
    "academicYearLoginCode",
  ]) {
    assert.equal(principal[key], undefined, `champ synthétique interdit sur le principal JWT: ${key}`);
  }
}

function membershipOneBySub(rowsBySub) {
  return async (sql, params = []) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) {
      const sub = String(params[0] ?? "");
      return rowsBySub[sub] ?? null;
    }
    return null;
  };
}

const MEMBERSHIP_A = {
  school_id: SCHOOL_A_ID,
  login_code: LOGIN_A,
  id: SCHOOL_A_ID,
};
const MEMBERSHIP_LOOKUP = membershipOneBySub({
  "admin-a-1": MEMBERSHIP_A,
  "admin-a-2": MEMBERSHIP_A,
});

async function assertTenantIsAOrClosed(resolveOrMod, input) {
  const resolve =
    typeof resolveOrMod === "function"
      ? resolveOrMod
      : (payload) => resolveTenant(resolveOrMod, payload);
  try {
    const tenant = await resolve(input);
    assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
    assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
    return tenant;
  } catch (error) {
    assert.ok(
      isClosedStatus(error.statusCode),
      `schoolCode client: ignorer (tenant membership) ou 400/403, jamais école B (status=${error.statusCode})`,
    );
    return null;
  }
}

async function snapshotsBySchool() {
  return {
    [SCHOOL_A_ID]: readyCore({ termCount: 0, teacherCount: 0 }),
    [SCHOOL_B_ID]: snapshot({ teacherCount: 9, studentCount: 40, feeGridCount: 2 }),
  };
}

// ---------------------------------------------------------------------------
// Source / wiring — doivent échouer tant que la route et le module n'existent pas
// ---------------------------------------------------------------------------

test("contrat — GET /api/v2/school-setup/status est déclaré (auth + permission, sans :schoolCode)", () => {
  assertHas(SERVER, ROUTE_DECL, `${ROUTE_DECL} absent de backend/server.js`);
  assertLacks(
    SERVER,
    'app.get("/api/v2/school-setup/:schoolCode',
    "path :schoolCode interdit sur school-setup",
  );
  assertLacks(
    SERVER,
    "/api/v2/schools/:schoolCode/setup/status",
    "tenant school-setup ne passe pas par :schoolCode",
  );
  const snippet = routeSnippet();
  assertHas(snippet, "requireAuth", "requireAuth manquant sur GET school-setup/status");
  assertHas(
    snippet,
    `requirePermission("${ROUTE_GET}")`,
    `requirePermission("${ROUTE_GET}") manquant`,
  );
  assertHas(snippet, "schoolSetupStatus", "handler school-setup n'utilise pas schoolSetupStatus");
  assertLacks(snippet, ":schoolCode", "snippet handler school-setup contient :schoolCode");
});

test("contrat — RBAC mappe la route sur Paramètres Établissement:READ (permission existante)", () => {
  const line = RBAC.split("\n").find((entry) => entry.includes(`"${ROUTE_GET}"`));
  assert.ok(line, `entrée routePermissions "${ROUTE_GET}" manquante`);
  assert.match(line, /Paramètres Établissement:READ/);
  assert.doesNotMatch(line, /COUNTRY_PRIVILEGES/);
  assert.doesNotMatch(line, /ALL_PRIVILEGES/);
  const rhs = line.slice(line.indexOf("[")).replace(/,\s*$/, "");
  assert.deepEqual(JSON.parse(rhs), ["Paramètres Établissement:READ"]);
});

test("invariant — aucune colonne persistée setup_status (état dérivé, pas stocké)", () => {
  assertLacks(SCHEMA, "setup_status", "colonne setup_status interdite — état dérivé uniquement");
});

test("ST-08 — handler/module sans localStorage/AsyncStorage", () => {
  assert.ok(fs.existsSync(MODULE_PATH), "backend/lib/schoolSetupStatus.js manquant");
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  assert.doesNotMatch(src, /localStorage|AsyncStorage/);
  const snippet = routeSnippet();
  assert.doesNotMatch(snippet, /localStorage|AsyncStorage/);
});

test("contrat — module schoolSetupStatus exporte derive / resolveTenant / getStatus", () => {
  requireContract();
});

// ---------------------------------------------------------------------------
// D1 — deriveSchoolSetupStatus
// ---------------------------------------------------------------------------

test("ST-01 — école persistée vide → NOT_STARTED, core 0/3", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const payload = deriveSchoolSetupStatus(snapshot());
  assertPayloadShape(payload);
  assert.equal(payload.status, "NOT_STARTED");
  assert.equal(payload.core.academicYear, false);
  assert.equal(payload.core.structure, false);
  assert.equal(payload.core.classes, false);
  assert.equal(payload.progress.coreDone, 0);
  assert.equal(payload.progress.coreTotal, 3);
  for (const key of OPTIONAL_KEYS) assert.equal(payload.optional[key], false);
});

test("ST-02 — année courante/open seule → IN_PROGRESS", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const payload = deriveSchoolSetupStatus(snapshot({ hasCurrentOrOpenAcademicYear: true }));
  assertPayloadShape(payload);
  assert.equal(payload.status, "IN_PROGRESS");
  assert.equal(payload.core.academicYear, true);
  assert.equal(payload.core.structure, false);
  assert.equal(payload.core.classes, false);
  assert.equal(payload.progress.coreDone, 1);
});

test("ST-02 — structure = niveau ET groupe ; un seul des deux ne suffit pas", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const levelOnly = deriveSchoolSetupStatus(
    snapshot({
      hasCurrentOrOpenAcademicYear: true,
      activatedLevelCount: 2,
      activatedGroupCount: 0,
      classCount: 1,
    }),
  );
  assert.equal(levelOnly.status, "IN_PROGRESS");
  assert.equal(levelOnly.core.structure, false);
  assert.equal(levelOnly.core.classes, true);

  const groupOnly = deriveSchoolSetupStatus(
    snapshot({
      hasCurrentOrOpenAcademicYear: true,
      activatedLevelCount: 0,
      activatedGroupCount: 3,
      classCount: 1,
    }),
  );
  assert.equal(groupOnly.core.structure, false);
  assert.equal(groupOnly.status, "IN_PROGRESS");
});

test("ST-03 — année + niveau/groupe activés + classe, sans terms → READY, optional.periods=false", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const payload = deriveSchoolSetupStatus(readyCore({ termCount: 0 }));
  assertPayloadShape(payload);
  assert.equal(payload.status, "READY");
  assert.equal(payload.core.academicYear, true);
  assert.equal(payload.core.structure, true);
  assert.equal(payload.core.classes, true);
  assert.equal(payload.optional.periods, false);
  assert.equal(payload.progress.coreDone, 3);
});

test("ST-03b — mêmes core + terms → READY inchangé, optional.periods=true", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const withoutTerms = deriveSchoolSetupStatus(readyCore({ termCount: 0 }));
  const withTerms = deriveSchoolSetupStatus(readyCore({ termCount: 3 }));
  assert.equal(withoutTerms.status, "READY");
  assert.equal(withTerms.status, "READY");
  assert.equal(withoutTerms.optional.periods, false);
  assert.equal(withTerms.optional.periods, true);
  assert.deepEqual(withTerms.core, withoutTerms.core);
  assert.deepEqual(withTerms.progress, withoutTerms.progress);
});

test("ST-04 — perte d'un signal core après READY → IN_PROGRESS ou NOT_STARTED", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const ready = deriveSchoolSetupStatus(readyCore());
  assert.equal(ready.status, "READY");

  const lostYear = deriveSchoolSetupStatus(readyCore({ hasCurrentOrOpenAcademicYear: false }));
  assert.equal(lostYear.status, "IN_PROGRESS");
  assert.equal(lostYear.core.academicYear, false);
  assert.equal(lostYear.core.structure, true);
  assert.equal(lostYear.core.classes, true);

  const lostClasses = deriveSchoolSetupStatus(readyCore({ classCount: 0 }));
  assert.equal(lostClasses.status, "IN_PROGRESS");
  assert.equal(lostClasses.core.classes, false);

  const lostStructure = deriveSchoolSetupStatus(readyCore({ activatedLevelCount: 0, activatedGroupCount: 0 }));
  assert.equal(lostStructure.status, "IN_PROGRESS");
  assert.equal(lostStructure.core.structure, false);

  const emptyAgain = deriveSchoolSetupStatus(snapshot());
  assert.equal(emptyAgain.status, "NOT_STARTED");
});

test("ST-12 — optional.* ne change jamais status", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const readyPlain = deriveSchoolSetupStatus(readyCore());
  const readyFull = deriveSchoolSetupStatus(readyCore(fullOptional()));
  assert.equal(readyPlain.status, "READY");
  assert.equal(readyFull.status, "READY");
  assert.equal(readyFull.optional.teachers, true);
  assert.equal(readyFull.optional.students, true);
  assert.equal(readyFull.optional.feeGrids, true);
  assert.equal(readyFull.optional.subjects, true);
  assert.equal(readyFull.optional.notifications, true);

  const emptyFull = deriveSchoolSetupStatus(snapshot(fullOptional()));
  assert.equal(emptyFull.status, "NOT_STARTED");
  assert.equal(emptyFull.progress.coreDone, 0);

  const yearOnlyFull = deriveSchoolSetupStatus(
    snapshot({ hasCurrentOrOpenAcademicYear: true, ...fullOptional() }),
  );
  assert.equal(yearOnlyFull.status, "IN_PROGRESS");
  assert.equal(yearOnlyFull.core.academicYear, true);
  assert.equal(yearOnlyFull.core.structure, false);
  assert.equal(yearOnlyFull.core.classes, false);
});

// ---------------------------------------------------------------------------
// D4 — tenant JWT / membership only
// ---------------------------------------------------------------------------

test("ST-06 — schoolCode client (query/body/header/params) ignoré ou 400/403 ; jamais l'école B", async () => {
  const mod = requireContract();
  const principal = schoolAdminA();
  const surfaces = clientSchoolCodeSurfaces(LOGIN_B);
  await assertTenantIsAOrClosed(mod, { principal, ...surfaces, one: MEMBERSHIP_LOOKUP });
  await assertTenantIsAOrClosed(mod, { principal, query: { schoolCode: LOGIN_B }, one: MEMBERSHIP_LOOKUP });
  await assertTenantIsAOrClosed(mod, { principal, body: { schoolCode: SCHOOL_B_ID }, one: MEMBERSHIP_LOOKUP });
  await assertTenantIsAOrClosed(mod, {
    principal,
    headers: { "x-somafrik-school-code": LOGIN_B },
    one: MEMBERSHIP_LOOKUP,
  });
});

test("ST-06 — leftover JWT schoolCode B + membership A → tenant A, jamais B", async () => {
  const mod = requireContract();
  const leftover = schoolAdminA({
    schoolCode: LOGIN_B,
    schoolId: SCHOOL_B_ID,
  });
  assert.equal(leftover.usersSchoolId, SCHOOL_A_ID);
  assert.equal(leftover.effectiveSchoolId, SCHOOL_A_ID);
  const tenant = await resolveTenant(mod, { principal: leftover, query: {}, body: {}, headers: {} });
  assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
  assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
});

test("ST-06b — token école A → données A uniquement ; pas de path :schoolCode", async () => {
  assertHas(SERVER, ROUTE_DECL, `${ROUTE_DECL} absent de backend/server.js`);
  assertLacks(SERVER, "school-setup/:schoolCode", "path school-setup/:schoolCode interdit");
  const { getSchoolSetupStatus } = requireContract();
  const stores = await snapshotsBySchool();
  const seen = [];
  const payload = await getSchoolSetupStatus({
    principal: schoolAdminA(),
    query: {},
    body: {},
    headers: {},
    loadSnapshot: async (tenant) => {
      seen.push(tenant);
      assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
      return stores[tenant.schoolId];
    },
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "READY");
  assert.equal(payload.optional.teachers, false);
  assert.equal(seen.length, 1);
  assert.equal(String(seen[0].schoolId), SCHOOL_A_ID);
});

test("ST-06 — getSchoolSetupStatus ne charge jamais le snapshot de B depuis un token A", async () => {
  const { getSchoolSetupStatus } = requireContract();
  const stores = await snapshotsBySchool();
  try {
    const payload = await getSchoolSetupStatus({
      principal: schoolAdminA(),
      ...clientSchoolCodeSurfaces(LOGIN_B),
      loadSnapshot: async (tenant) => {
        assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
        return stores[tenant.schoolId] ?? snapshot();
      },
    });
    assert.equal(payload.status, "READY", "école A READY, pas le NOT_STARTED/optional de B");
    assert.equal(payload.optional.students, false);
  } catch (error) {
    assert.ok(isClosedStatus(error.statusCode), `status=${error.statusCode}`);
  }
});

test("ST-06-RT-01 — membership PG autoritaire : principal JWT = sub + leftover schoolCode, sans champs synthétiques", async () => {
  const mod = requireContract();
  const principal = jwtOnlyAdmin({ sub: "admin-a-1", leftoverSchoolCode: LOGIN_B });
  assertJwtOnlyPrincipal(principal);
  const tenant = await resolveTenant(mod, {
    principal,
    query: {},
    body: {},
    headers: {},
    one: MEMBERSHIP_LOOKUP,
  });
  assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
  assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
  const stores = await snapshotsBySchool();
  const payload = await mod.getSchoolSetupStatus({
    principal,
    query: {},
    body: {},
    headers: {},
    one: MEMBERSHIP_LOOKUP,
    loadSnapshot: async (resolved) => {
      assert.equal(String(resolved.schoolId), SCHOOL_A_ID);
      return stores[resolved.schoolId];
    },
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "READY");
});

test("ST-06-RT-02 — JWT forgé : sub A + leftover schoolCode B → 403 ou payload A, jamais B", async () => {
  const mod = requireContract();
  const principal = jwtOnlyAdmin({ sub: "admin-a-1", leftoverSchoolCode: LOGIN_B });
  assertJwtOnlyPrincipal(principal);
  const stores = await snapshotsBySchool();
  try {
    const tenant = await resolveTenant(mod, {
      principal,
      query: {},
      body: {},
      headers: {},
      one: MEMBERSHIP_LOOKUP,
    });
    assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
    const payload = await mod.getSchoolSetupStatus({
      principal,
      one: MEMBERSHIP_LOOKUP,
      loadSnapshot: async (resolved) => {
        assert.notEqual(String(resolved.schoolId), SCHOOL_B_ID);
        return stores[resolved.schoolId] ?? snapshot();
      },
    });
    assert.equal(payload.status, "READY");
    assert.equal(payload.optional.students, false);
  } catch (error) {
    assert.ok(isClosedStatus(error.statusCode), `JWT forgé: 403/400/401 ou payload A, jamais B (status=${error.statusCode})`);
  }
});

test("ST-06-RT-03 — header X-Somafrik-School-Code B forgé : 400/403 ou payload A, jamais B", async () => {
  const mod = requireContract();
  const principal = jwtOnlyAdmin({ sub: "admin-a-1", leftoverSchoolCode: LOGIN_A });
  assertJwtOnlyPrincipal(principal);
  const stores = await snapshotsBySchool();
  try {
    const payload = await mod.getSchoolSetupStatus({
      principal,
      query: {},
      body: {},
      headers: { "X-Somafrik-School-Code": LOGIN_B, "x-somafrik-school-code": LOGIN_B },
      one: MEMBERSHIP_LOOKUP,
      loadSnapshot: async (tenant) => {
        assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
        return stores[tenant.schoolId] ?? snapshot();
      },
    });
    assert.equal(payload.status, "READY");
    assert.equal(payload.optional.students, false);
  } catch (error) {
    assert.ok(
      isClosedStatus(error.statusCode),
      `header forgé: 400/403 (middleware) ou payload A, jamais B (status=${error.statusCode})`,
    );
  }
});

test("ST-06-RT-04 — membership absent/invalide → fail-closed 401/403, jamais fallback leftover JWT", async () => {
  const mod = requireContract();
  const leftoverA = jwtOnlyAdmin({ sub: "admin-orphan", leftoverSchoolCode: LOGIN_A });
  assertJwtOnlyPrincipal(leftoverA);
  const emptyOne = membershipOneBySub({});
  await assert.rejects(
    () =>
      resolveTenant(mod, {
        principal: leftoverA,
        query: {},
        body: {},
        headers: {},
        one: emptyOne,
      }),
    (error) => error.statusCode === 401 || error.statusCode === 403,
  );
  await assert.rejects(
    () =>
      mod.getSchoolSetupStatus({
        principal: leftoverA,
        one: emptyOne,
        loadSnapshot: async () => readyCore(),
      }),
    (error) => error.statusCode === 401 || error.statusCode === 403,
  );
});

// ---------------------------------------------------------------------------
// Payload canonique — multi-admin, user vs école, parité Web/Mobile
// ---------------------------------------------------------------------------

test("ST-05 — deux admins du même school_id → JSON métier identique", async () => {
  const { getSchoolSetupStatus } = requireContract();
  const snap = readyCore({ termCount: 0, teacherCount: 1 });
  const loadSnapshot = async (tenant) => {
    assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
    return snap;
  };
  const first = await getSchoolSetupStatus({
    principal: schoolAdminA({ sub: "admin-a-1", mustChangePassword: true }),
    loadSnapshot,
  });
  const second = await getSchoolSetupStatus({
    principal: schoolAdminA({ sub: "admin-a-2", mustChangePassword: false, lastLoginAt: "2026-09-01T00:00:00Z" }),
    loadSnapshot,
  });
  assertPayloadShape(first);
  assertPayloadShape(second);
  assert.deepEqual(first, second);
});

test("ST-09 — mustChangePassword / last_login_at absents du payload", async () => {
  const { deriveSchoolSetupStatus, getSchoolSetupStatus } = requireContract();
  const derived = deriveSchoolSetupStatus(
    snapshot({
      mustChangePassword: true,
      last_login_at: null,
      lastLoginAt: null,
    }),
  );
  assertNoUserOrRouteLeak(derived);
  const payload = await getSchoolSetupStatus({
    principal: schoolAdminA({ mustChangePassword: true, lastLoginAt: null }),
    loadSnapshot: async () => readyCore(),
  });
  assertPayloadShape(payload);
  assertNoUserOrRouteLeak(payload);
});

test("ST-10 — même snapshot PG → même JSON Web et Mobile", async () => {
  const { deriveSchoolSetupStatus, getSchoolSetupStatus } = requireContract();
  const snap = readyCore({ termCount: 1, subjectCount: 2 });
  const fromDerive = deriveSchoolSetupStatus(snap);
  const fromWeb = await getSchoolSetupStatus({
    principal: schoolAdminA(),
    headers: { "user-agent": "SomafrikWeb" },
    client: "web",
    loadSnapshot: async () => snap,
  });
  const fromMobile = await getSchoolSetupStatus({
    principal: schoolAdminA(),
    headers: { "user-agent": "SomafrikMobile/1.0" },
    client: "mobile",
    loadSnapshot: async () => snap,
  });
  assert.deepEqual(fromWeb, fromDerive);
  assert.deepEqual(fromMobile, fromDerive);
  assert.deepEqual(fromWeb, fromMobile);
});

test("ST-11 — payload sans routes Web/Mobile", () => {
  const { deriveSchoolSetupStatus } = requireContract();
  const payload = deriveSchoolSetupStatus(readyCore(fullOptional()));
  assertPayloadShape(payload);
  assertNoUserOrRouteLeak(payload);
});

test("G1 — RBAC LOT 0 = Paramètres Établissement:READ uniquement", () => {
  const line = RBAC.split("\n").find((entry) => entry.includes(`"${ROUTE_GET}"`));
  assert.ok(line, `entrée routePermissions "${ROUTE_GET}" manquante`);
  const rhs = line.slice(line.indexOf("[")).replace(/,\s*$/, "");
  assert.deepEqual(JSON.parse(rhs), ["Paramètres Établissement:READ"]);
  assert.doesNotMatch(line, /COUNTRY_PRIVILEGES|ALL_PRIVILEGES/);
});

test("G2 — effectiveSchoolId / academicYearSchoolId ne sont pas l'autorité tenant", async () => {
  const mod = requireContract();
  const forged = jwtOnlyAdmin({ sub: "admin-a-1", leftoverSchoolCode: LOGIN_B });
  Object.assign(forged, {
    schoolId: SCHOOL_B_ID,
    effectiveSchoolId: SCHOOL_B_ID,
    effectiveSchoolCode: LOGIN_B,
    academicYearSchoolId: SCHOOL_B_ID,
    academicYearLoginCode: LOGIN_B,
    usersSchoolId: SCHOOL_B_ID,
    usersLoginCode: LOGIN_B,
  });
  const tenant = await resolveTenant(mod, {
    principal: forged,
    query: {},
    body: {},
    headers: {},
    one: MEMBERSHIP_LOOKUP,
  });
  assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
  assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);

  await assert.rejects(
    () =>
      resolveTenant(mod, {
        principal: {
          role: "Admin School",
          sub: "admin-orphan",
          schoolCode: LOGIN_A,
          effectiveSchoolId: SCHOOL_A_ID,
          academicYearSchoolId: SCHOOL_A_ID,
        },
        one: membershipOneBySub({}),
      }),
    (error) => error.statusCode === 401 || error.statusCode === 403,
  );

  await assert.rejects(
    () =>
      resolveTenant(mod, {
        principal: {
          role: "Admin School",
          sub: "admin-x",
          effectiveSchoolId: SCHOOL_A_ID,
          academicYearSchoolId: SCHOOL_A_ID,
        },
      }),
    (error) => error.statusCode === 401 || error.statusCode === 403,
  );
});

test("G3 — erreur SQL ne devient pas NOT_STARTED", async () => {
  const { getSchoolSetupStatus, loadSchoolSetupSnapshot } = requireContract();
  const boom = Object.assign(new Error("SQL down"), { code: "ECONNREFUSED" });
  const one = async (sql) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) return MEMBERSHIP_A;
    throw boom;
  };
  await assert.rejects(
    () => loadSchoolSetupSnapshot(one, SCHOOL_A_ID),
    (error) => error === boom || error.code === "ECONNREFUSED",
  );
  await assert.rejects(
    () =>
      getSchoolSetupStatus({
        principal: jwtOnlyAdmin({ sub: "admin-a-1", leftoverSchoolCode: LOGIN_A }),
        one,
      }),
    (error) => error === boom || error.code === "ECONNREFUSED" || error.statusCode === 503,
  );
});

test("G4 — année = is_current TRUE ou status open (pas active)", async () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  const yearQuery = src.slice(src.indexOf("FROM academic_years"), src.indexOf("FROM school_levels"));
  assert.match(yearQuery, /is_current = TRUE/);
  assert.match(yearQuery, /lower\(btrim\(COALESCE\(status, ''\)\)\) = 'open'/);
  assert.doesNotMatch(yearQuery, /'active'/);
  assert.doesNotMatch(yearQuery, /IN\s*\(\s*'open'/i);

  const { loadSchoolSetupSnapshot, deriveSchoolSetupStatus } = requireContract();
  const one = async (sql) => {
    const text = String(sql);
    if (/FROM academic_years/i.test(text) && !/FROM classes/i.test(text) && !/FROM terms/i.test(text)) {
      assert.doesNotMatch(text, /'active'/);
      return { c: 0 };
    }
    if (/school_levels|school_class_groups/i.test(text)) return { c: 1 };
    if (/FROM classes/i.test(text)) return { c: 1 };
    return { c: 0 };
  };
  const snap = await loadSchoolSetupSnapshot(one, SCHOOL_A_ID);
  assert.equal(snap.hasCurrentOrOpenAcademicYear, false);
  const payload = deriveSchoolSetupStatus(snap);
  assert.equal(payload.core.academicYear, false);
  assert.notEqual(payload.status, "READY");
  assert.equal(payload.status, "IN_PROGRESS");
});

test("G6 — classe historique Y1 ne satisfait pas core.classes de Y2 current/open", async () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  const classQuery = src.slice(src.indexOf("FROM classes"), src.indexOf("FROM terms"));
  assert.match(classQuery, /INNER JOIN academic_years y ON y.id = c.academic_year_id/);
  assert.match(classQuery, /c\.school_id::text = \$1/);
  assert.match(classQuery, /y\.school_id::text = \$1/);
  assert.match(classQuery, /y.is_current = TRUE OR lower\(btrim\(COALESCE\(y.status, ''\)\)\) = 'open'/);
  assert.doesNotMatch(classQuery, /c\.status\s*=\s*'active'/);
  assert.doesNotMatch(classQuery, /FROM classes WHERE school_id/);

  const { loadSchoolSetupSnapshot, deriveSchoolSetupStatus } = requireContract();

  const oneWithoutY2Class = async (sql) => {
    const text = String(sql);
    if (/FROM academic_years/i.test(text) && !/FROM classes/i.test(text) && !/FROM terms/i.test(text)) {
      return { c: 1 };
    }
    if (/school_levels|school_class_groups/i.test(text)) return { c: 1 };
    if (/FROM classes/i.test(text)) {
      assert.match(text, /INNER JOIN academic_years y ON y.id = c.academic_year_id/);
      assert.match(text, /y.is_current = TRUE OR lower\(btrim\(COALESCE\(y.status, ''\)\)\) = 'open'/);
      return { c: 0 };
    }
    return { c: 0 };
  };
  const emptyY2 = deriveSchoolSetupStatus(await loadSchoolSetupSnapshot(oneWithoutY2Class, SCHOOL_A_ID));
  assert.equal(emptyY2.core.academicYear, true);
  assert.equal(emptyY2.core.structure, true);
  assert.equal(emptyY2.core.classes, false);
  assert.equal(emptyY2.status, "IN_PROGRESS");

  const oneWithY2Class = async (sql) => {
    const text = String(sql);
    if (/FROM academic_years/i.test(text) && !/FROM classes/i.test(text) && !/FROM terms/i.test(text)) {
      return { c: 1 };
    }
    if (/school_levels|school_class_groups|FROM classes/i.test(text)) return { c: 1 };
    return { c: 0 };
  };
  const readyY2 = deriveSchoolSetupStatus(await loadSchoolSetupSnapshot(oneWithY2Class, SCHOOL_A_ID));
  assert.equal(readyY2.core.classes, true);
  assert.equal(readyY2.status, "READY");
});

test("ST-05/ST-10 — token école B ne reproduit pas le JSON de A", async () => {
  const { getSchoolSetupStatus } = requireContract();
  const stores = await snapshotsBySchool();
  const payloadA = await getSchoolSetupStatus({
    principal: schoolAdminA(),
    loadSnapshot: async (tenant) => stores[tenant.schoolId],
  });
  const payloadB = await getSchoolSetupStatus({
    principal: schoolAdminB(),
    loadSnapshot: async (tenant) => stores[tenant.schoolId],
  });
  assert.equal(payloadA.status, "READY");
  assert.equal(payloadB.status, "NOT_STARTED");
  assert.notDeepEqual(payloadA, payloadB);
});
