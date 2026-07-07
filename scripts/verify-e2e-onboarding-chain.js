/**
 * E2E : Création établissement → Admin Pays → Admin School
 *
 * Chaîne complète :
 * 1. Super Admin crée un établissement
 * 2. Super Admin crée un Admin Pays (RDC)
 * 3. Admin Pays se connecte et crée un Admin School pour l'établissement
 * 4. Admin School reste « En attente de validation » et ne peut pas se connecter
 * 5. Super Admin valide → Admin School peut se connecter
 *
 * Prérequis : backend accessible (Docker ou local).
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api node scripts/verify-e2e-onboarding-chain.js
 */
const assert = require("assert");

const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
const PENDING = "En attente de validation";
const COUNTRY = "RDC";
const SUPERADMIN_ID = process.env.SOMAFRIK_E2E_SUPERADMIN_ID || process.env.SOMAFRIK_TEST_SUPERADMIN_ID || "superadmin";
const SUPERADMIN_PASSWORD =
  process.env.SOMAFRIK_E2E_SUPERADMIN_PASSWORD ||
  process.env.SOMAFRIK_TEST_SUPERADMIN_PASSWORD ||
  "E2eTest!2026";

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
  const res = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.strictEqual(res.status, 200, `login ${identifier}: ${JSON.stringify(res.data)}`);
  return res.data.accessToken;
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

async function getState(token) {
  const res = await request("/backoffice/state", { token });
  assert.strictEqual(res.status, 200, `state: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function putUsers(token, users) {
  const res = await request("/backoffice/state", { method: "PUT", token, body: { users } });
  assert.strictEqual(res.status, 200, `put users: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function putUsersFromState(token, users) {
  const current = await getState(token);
  const res = await request("/backoffice/state", {
    method: "PUT",
    token,
    body: { ...current, users },
  });
  assert.strictEqual(res.status, 200, `put users (full state): ${JSON.stringify(res.data)}`);
  return res.data;
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const schoolName = `E2E École ${stamp}`;
  const countryAdminId = `usr-country-${stamp}`;
  const countryAdminIdentifier = `ADM-PAYS-${stamp}`;
  const countryAdminPassword = `SF-PAYS-${stamp}`;
  const schoolAdminId = `usr-school-${stamp}`;
  const schoolAdminIdentifier = `ADM-SCHOOL-${stamp}`;
  const schoolAdminPassword = `SF-SCHOOL-${stamp}`;

  // ── 1) Super Admin ──────────────────────────────────────────────────────
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  results.push({ Etape: "1. Login Super Admin", Attendu: "200", Obtenu: "200", OK: true });

  // ── 2) Création établissement ───────────────────────────────────────────
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
  assert.strictEqual(createRes.status, 201, `create establishment: ${JSON.stringify(createRes.data)}`);
  const schoolCode = createRes.data.school?.code;
  assert.ok(schoolCode, "Code établissement manquant");
  results.push({
    Etape: "2. Création établissement",
    Attendu: "201 + Validé",
    Obtenu: `${createRes.status} / ${createRes.data.school?.validationStatus ?? createRes.data.school?.status}`,
    OK:
      createRes.status === 201 &&
      (createRes.data.school?.validationStatus === "Validé" ||
        createRes.data.school?.status === "Actif"),
  });

  // ── 3) Création Admin Pays ──────────────────────────────────────────────
  const countryAdmin = {
    id: countryAdminId,
    firstName: "Admin",
    lastName: "Pays E2E",
    role: "Admin Pays",
    identifier: countryAdminIdentifier,
    email: `${countryAdminIdentifier.toLowerCase()}@somafrik.app`,
    schoolCode: "*",
    countryScope: COUNTRY,
    scopeLevel: "Pays",
    accessChannel: "Application",
    status: "Actif",
    validationStatus: "Validé",
    password: countryAdminPassword,
    temporaryPassword: countryAdminPassword,
    permissions: [],
  };
  await putUsers(superToken, [countryAdmin]);
  const superState = await getState(superToken);
  const storedCountryAdmin = (superState.users ?? []).find((u) => u.identifier === countryAdminIdentifier);
  assert.ok(storedCountryAdmin, "Admin Pays introuvable après création");
  results.push({
    Etape: "3. Création Admin Pays",
    Attendu: "Actif",
    Obtenu: storedCountryAdmin.status,
    OK: storedCountryAdmin.status === "Actif" && storedCountryAdmin.role === "Admin Pays",
  });

  // ── 4) Login Admin Pays ─────────────────────────────────────────────────
  const countryToken = await login(countryAdminIdentifier, countryAdminPassword);
  results.push({ Etape: "4. Login Admin Pays", Attendu: "200", Obtenu: "200", OK: true });

  // Admin Pays voit l'établissement créé
  const establishmentsRes = await request("/backoffice/establishments", { token: countryToken });
  const visibleSchool = (establishmentsRes.data ?? []).find((s) => s.code === schoolCode);
  results.push({
    Etape: "4b. Admin Pays voit l'établissement",
    Attendu: schoolCode,
    Obtenu: visibleSchool?.code ?? "—",
    OK: Boolean(visibleSchool),
  });

  // ── 5) Admin Pays crée Admin School ─────────────────────────────────────
  const schoolAdmin = {
    id: schoolAdminId,
    firstName: "Admin",
    lastName: "École E2E",
    role: "Admin School",
    identifier: schoolAdminIdentifier,
    email: `${schoolAdminIdentifier.toLowerCase()}@somafrik.app`,
    schoolCode,
    countryScope: COUNTRY,
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    temporaryPassword: schoolAdminPassword,
    permissions: [],
  };
  const countryStateForSchoolAdmin = await getState(countryToken);
  await putUsersFromState(countryToken, [
    schoolAdmin,
    ...(countryStateForSchoolAdmin.users ?? []),
  ]);

  const storedSchoolAdmin = (await getState(superToken)).users?.find(
    (u) => u.identifier === schoolAdminIdentifier,
  );
  assert.ok(storedSchoolAdmin, "Admin School introuvable après création");
  results.push({
    Etape: "5. Création Admin School (Admin Pays)",
    Attendu: PENDING,
    Obtenu: storedSchoolAdmin.status,
    OK:
      storedSchoolAdmin.status === PENDING && storedSchoolAdmin.validationStatus === PENDING,
  });

  // ── 6) Connexion Admin School bloquée ───────────────────────────────────
  const blocked = await loginExpect(
    schoolAdminIdentifier,
    schoolAdminPassword,
    schoolCode,
    403,
  );
  results.push({
    Etape: "6. Connexion Admin School avant validation",
    Attendu: "403",
    Obtenu: String(blocked.status),
    OK: blocked.status === 403,
  });

  // ── 7) Super Admin valide Admin School ──────────────────────────────────
  const usersBeforeValidate = (await getState(superToken)).users ?? [];
  await putUsers(
    superToken,
    usersBeforeValidate.map((u) =>
      u.identifier === schoolAdminIdentifier
        ? { ...u, status: "Actif", validationStatus: "Validé" }
        : u,
    ),
  );
  const validatedAdmin = (await getState(superToken)).users?.find(
    (u) => u.identifier === schoolAdminIdentifier,
  );
  results.push({
    Etape: "7. Validation Admin School (Super Admin)",
    Attendu: "Actif/Validé",
    Obtenu: `${validatedAdmin?.status}/${validatedAdmin?.validationStatus}`,
    OK: validatedAdmin?.status === "Actif" && validatedAdmin?.validationStatus === "Validé",
  });

  // ── 8) Connexion Admin School OK ────────────────────────────────────────
  const schoolAdminToken = await login(schoolAdminIdentifier, schoolAdminPassword, schoolCode);
  assert.ok(schoolAdminToken, "Token Admin School manquant");
  results.push({
    Etape: "8. Connexion Admin School après validation",
    Attendu: "200",
    Obtenu: "200",
    OK: true,
  });

  // Admin School accède à son établissement
  const schoolRes = await request(`/backoffice/establishments/${encodeURIComponent(schoolCode)}`, {
    token: schoolAdminToken,
  });
  results.push({
    Etape: "8b. Admin School accède à son établissement",
    Attendu: schoolCode,
    Obtenu: schoolRes.data?.code ?? String(schoolRes.status),
    OK: schoolRes.status === 200 && schoolRes.data?.code === schoolCode,
  });

  console.log("\n=== E2E Onboarding : Établissement → Admin Pays → Admin School ===");
  console.log(`Établissement : ${schoolCode} (${schoolName})`);
  console.log(`Admin Pays    : ${countryAdminIdentifier}`);
  console.log(`Admin School  : ${schoolAdminIdentifier}\n`);
  console.table(results);

  const failures = results.filter((r) => !r.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("Chaîne E2E onboarding : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
