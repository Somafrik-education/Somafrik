/**
 * S1.3 — Vérifie la sanitization centralisée des réponses utilisateur.
 * 1) Tests unitaires du sanitizer
 * 2) Tests HTTP contre une API locale (SOMAFRIK_API_URL) si joignable
 *
 * Usage:
 *   node backend/scripts/verify-sanitize-user-responses.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api node backend/scripts/verify-sanitize-user-responses.js
 */
const assert = require("assert");
const path = require("path");

const {
  SENSITIVE_USER_FIELDS,
  sanitizeUserForResponse,
  sanitizeUsersForResponse,
  sanitizeCredentialBearingStateForResponse,
  sanitizeAuthPayloadForResponse,
  stripSensitiveFieldsDeep,
  collectSensitiveUserFieldPaths,
} = require("../lib/sanitizeUserForResponse");

function assertNoSensitiveFields(payload, label, options = {}) {
  const leaks = collectSensitiveUserFieldPaths(payload, "", options);
  assert.deepStrictEqual(
    leaks,
    [],
    `${label}: champs secrets exposés → ${leaks.join(", ") || "(aucun)"}`,
  );
}

async function runServiceLoginTests() {
  const data = require("../data");
  const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
  const { AuthService } = require("../services/authService");

  // Injecte des hashes / PIN pour prouver qu'ils sont retirés même s'ils existent en mémoire.
  const userAccounts = data.userAccounts.map((account) => ({
    ...account,
    passwordHash: account.passwordHash || "scrypt$testsalt$00",
    pinHash: account.pinHash || "scrypt$testsalt$01",
    pin: account.pin || "1234",
  }));
  const students = (data.students ?? []).map((student) => ({
    ...student,
    pin: student.pin || "1234",
    pinHash: student.pinHash || "scrypt$testsalt$02",
    passwordHash: student.passwordHash || "scrypt$testsalt$03",
  }));
  const school = data.school;
  const schools = data.platformSchools;

  const backOffice = new BackOfficeAccessService({
    school,
    schools,
    userAccounts,
    students,
    relations: [],
    countries: data.countries ?? [],
    subscriptions: data.subscriptions ?? [],
    notifications: data.platformNotifications ?? [],
  });

  const login = await backOffice.login({
    identifier: "superadmin@somafrik.app",
    password: "1234",
  });
  assertNoSensitiveFields(login.user, "BackOfficeAccessService.login.user");
  assert.ok(login.user?.role, "role présent après sanitization");

  const auth = new AuthService({
    school,
    schools,
    userAccounts,
    students,
    teachers: data.teachers,
    relations: [],
    assignments: data.teacherAssignments ?? [],
    countries: data.countries ?? [],
    subscriptions: data.subscriptions ?? [],
  });
  const mobile = await auth.login({
    role: "school_admin",
    schoolCode: school.code,
    identifier: "admin",
    pin: "1234",
  });
  assertNoSensitiveFields(mobile.user, "AuthService.login.user");

  console.log("OK service: login payloads sanitizés");
}

function runUnitTests() {
  const dirtyUser = {
    id: "u1",
    identifier: "admin",
    role: "Admin School",
    password: "plain",
    temporaryPassword: "tmp-1234",
    passwordHash: "scrypt$salt$hash",
    pin: "1234",
    pinHash: "scrypt$salt$pin",
    refreshToken: "should-not-nest",
    refreshTokenHash: "hash",
    children: [
      {
        id: "s1",
        name: "Élève",
        pin: "9999",
        pinHash: "scrypt$x$y",
        passwordHash: "scrypt$a$b",
        password: "nope",
      },
    ],
  };

  const safe = sanitizeUserForResponse(dirtyUser);
  assert.strictEqual(safe.identifier, "admin");
  assert.strictEqual(safe.hasTemporaryPassword, true);
  assert.strictEqual(safe.children.length, 1);
  assert.strictEqual(safe.children[0].name, "Élève");
  for (const field of SENSITIVE_USER_FIELDS) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(safe, field), false, `user.${field}`);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(safe.children[0], field),
      false,
      `children[0].${field}`,
    );
  }
  assertNoSensitiveFields(safe, "sanitizeUserForResponse");

  const users = sanitizeUsersForResponse([dirtyUser, null, "x"]);
  assert.strictEqual(users.length, 3);
  assertNoSensitiveFields(users[0], "sanitizeUsersForResponse[0]");

  const state = sanitizeCredentialBearingStateForResponse({
    users: [dirtyUser],
    teachers: [{ id: "t1", passwordHash: "x", name: "Prof" }],
    students: [{ id: "s2", pin: "0000", name: "Kid" }],
    schools: [{ code: "CD-1" }],
  });
  assert.strictEqual(state.schools[0].code, "CD-1");
  assertNoSensitiveFields(state.users, "state.users");
  assertNoSensitiveFields(state.teachers, "state.teachers");
  assertNoSensitiveFields(state.students, "state.students");

  const auth = sanitizeAuthPayloadForResponse({
    user: dirtyUser,
    users: [dirtyUser],
    refreshToken: "KEEP_TOP_LEVEL",
    accessToken: "KEEP_ACCESS",
  });
  assert.strictEqual(auth.refreshToken, "KEEP_TOP_LEVEL");
  assert.strictEqual(auth.accessToken, "KEEP_ACCESS");
  assertNoSensitiveFields(auth.user, "auth.user");
  assertNoSensitiveFields(auth.users, "auth.users");

  const deep = stripSensitiveFieldsDeep({
    latePayers: [{ id: "s3", pinHash: "x", balance: { remainingAmount: 10 } }],
    nested: { user: { password: "z", ok: true } },
    refreshToken: "top",
  }, { preserveTopLevelKeys: ["refreshToken"] });
  assert.strictEqual(deep.refreshToken, "top");
  assert.strictEqual(deep.latePayers[0].balance.remainingAmount, 10);
  assert.strictEqual(deep.nested.user.ok, true);
  assertNoSensitiveFields(deep, "stripSensitiveFieldsDeep", {
    ignoreTopLevelKeys: ["refreshToken"],
  });

  // Idempotence
  assert.deepStrictEqual(sanitizeUserForResponse(safe), safe);

  console.log("OK unit: sanitizeUserForResponse");
}

async function runHttpTestsIfAvailable() {
  const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
  let health;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    health = await fetch(`${base.replace(/\/api\/?$/, "")}/api/health`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch {
    console.log("SKIP http: API non joignable (lancez le backend pour la vérif HTTP)");
    return;
  }
  if (!health.ok) {
    console.log("SKIP http: /api/health non OK");
    return;
  }

  const helpersPath = path.join(__dirname, "..", "..", "scripts", "e2e-api-helpers.js");
  const { request, loginFull, extractApiList } = require(helpersPath);

  const login = await loginFull(
    process.env.SOMAFRIK_VERIFY_IDENTIFIER || "superadmin@somafrik.app",
    process.env.SOMAFRIK_VERIFY_PASSWORD || "1234",
  );
  assert.ok(login?.accessToken, "login accessToken attendu");
  assert.ok(login.refreshToken, "refreshToken top-level attendu");
  assertNoSensitiveFields(login.user, "HTTP login.user");
  // refreshToken / accessToken top-level autorisés (contrat auth), jamais dans user.
  assertNoSensitiveFields(login, "HTTP login payload", {
    ignoreTopLevelKeys: ["refreshToken", "accessToken"],
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(login.user ?? {}, "refreshToken"),
    false,
    "refreshToken ne doit pas être dans user",
  );

  const token = login.accessToken;
  const endpoints = [
    { path: "/backoffice/state", pick: (body) => body },
    { path: "/users", pick: (body) => extractApiList({ body }) },
    { path: "/students", pick: (body) => extractApiList({ body }) },
    { path: "/teachers", pick: (body) => extractApiList({ body }) },
    { path: "/mvp/snapshot", pick: (body) => body },
    { path: "/mvp/dashboard", pick: (body) => body },
  ];

  for (const endpoint of endpoints) {
    const res = await request(endpoint.path, { token });
    if (res.status === 403 || res.status === 404) {
      console.log(`SKIP http ${endpoint.path}: status ${res.status}`);
      continue;
    }
    assert.strictEqual(res.status, 200, `${endpoint.path} status`);
    assertNoSensitiveFields(endpoint.pick(res.body ?? res.data), `HTTP ${endpoint.path}`);
  }

  const schools = extractApiList(await request("/backoffice/establishments", { token }));
  const schoolCode = schools[0]?.code;
  if (schoolCode) {
    const usersRes = await request(`/backoffice/establishments/${encodeURIComponent(schoolCode)}/users`, {
      token,
    });
    if (usersRes.status === 200) {
      assertNoSensitiveFields(usersRes.body ?? usersRes.data, "HTTP establishment users");
    }
  }

  console.log("OK http: réponses sans champs secrets");
}

async function main() {
  runUnitTests();
  await runServiceLoginTests();
  await runHttpTestsIfAvailable();
  console.log("verify-sanitize-user-responses: SUCCESS");
}

main().catch((error) => {
  console.error("verify-sanitize-user-responses: FAIL");
  console.error(error);
  process.exit(1);
});
