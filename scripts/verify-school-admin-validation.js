/**
 * Vérifie la règle métier : un Admin École créé par un Admin Pays est autorisé,
 * mais reste « En attente de validation » et ne peut pas se connecter tant que le
 * Super Admin ne l'a pas validé.
 *
 * Prérequis : backend démarré (mode mémoire ou PostgreSQL).
 *   SOMAFRIK_API_URL=http://127.0.0.1:5057/api node scripts/verify-school-admin-validation.js
 */
const assert = require("assert");

const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
const SCHOOL_CODE = process.env.SOMAFRIK_TEST_SCHOOL_CODE || "CD-2026-0001";
const PENDING = "En attente de validation";

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

async function getUsers(token) {
  const res = await request("/backoffice/state", { token });
  assert.strictEqual(res.status, 200, `state: ${JSON.stringify(res.data)}`);
  return res.data.users ?? [];
}

async function putState(token, state) {
  const res = await request("/backoffice/state", { method: "PUT", token, body: state });
  assert.strictEqual(res.status, 200, `put state: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const identifier = `ADM-VALID-${stamp}`;
  const temporaryPassword = `SF-${stamp}`;

  // 1) Connexion Admin Pays RDC
  const countryToken = await login("admin-rdc", "1234", SCHOOL_CODE);

  // 2) L'Admin Pays crée un Admin École
  const countryState = await request("/backoffice/state", { token: countryToken });
  const newUser = {
    id: `usr-${stamp}`,
    firstName: "Test",
    lastName: "Validation",
    role: "Admin School",
    identifier,
    email: `${identifier.toLowerCase()}@somafrik.app`,
    schoolCode: SCHOOL_CODE,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif", // tentative volontaire de créer un compte actif
    temporaryPassword,
    permissions: [],
  };
  await putState(countryToken, {
    ...countryState.data,
    users: [newUser, ...(countryState.data.users ?? [])],
  });

  // 3) Le compte doit être stocké « En attente de validation » (et non Actif)
  const superToken = await login("superadmin@somafrik.app", "1234");
  let stored = (await getUsers(superToken)).find((u) => u.identifier === identifier);
  assert.ok(stored, "Compte créé introuvable côté Super Admin");
  results.push({
    Etape: "Création par Admin Pays",
    Attendu: PENDING,
    Obtenu: stored.status,
    OK: stored.status === PENDING && stored.validationStatus === PENDING,
  });

  const superStateAfterCreate = await request("/backoffice/state", { token: superToken });
  const validationAlert = (superStateAfterCreate.data.notifications ?? []).find(
    (notification) => notification.id === `NOTIF-VAL-USER-${newUser.id}`,
  );
  results.push({
    Etape: "Alerte Super Admin (notification)",
    Attendu: "Non lu",
    Obtenu: validationAlert?.status ?? "absente",
    OK: Boolean(validationAlert) && validationAlert.status === "Non lu",
  });

  // 4) Connexion impossible tant que non validé
  const blocked = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password: temporaryPassword, schoolCode: SCHOOL_CODE },
  });
  results.push({
    Etape: "Connexion avant validation",
    Attendu: "403",
    Obtenu: String(blocked.status),
    OK: blocked.status === 403,
  });

  // 4b) Aucune action possible tant que non validé (ex: réinitialisation MDP refusée)
  const resetBlocked = await request(`/users/${newUser.id}/reset-password`, {
    method: "POST",
    token: superToken,
    body: { temporaryPassword: "Soma1234" },
  });
  results.push({
    Etape: "Action (reset MDP) avant validation",
    Attendu: "409",
    Obtenu: String(resetBlocked.status),
    OK: resetBlocked.status === 409,
  });

  // 5) L'Admin Pays ne peut PAS auto-valider (re-sync en forçant Actif)
  const reState = await request("/backoffice/state", { token: countryToken });
  await putState(countryToken, {
    ...reState.data,
    users: (reState.data.users ?? []).map((u) =>
      u.identifier === identifier ? { ...u, status: "Actif", validationStatus: "Validé" } : u,
    ),
  });
  stored = (await getUsers(superToken)).find((u) => u.identifier === identifier);
  results.push({
    Etape: "Auto-validation Admin Pays refusée",
    Attendu: PENDING,
    Obtenu: stored.status,
    OK: stored.status === PENDING,
  });

  // 6) Le Super Admin valide le compte
  const superState = await request("/backoffice/state", { token: superToken });
  await putState(superToken, {
    ...superState.data,
    users: (superState.data.users ?? []).map((u) =>
      u.identifier === identifier
        ? { ...u, status: "Actif", validationStatus: "Validé" }
        : u,
    ),
  });
  stored = (await getUsers(superToken)).find((u) => u.identifier === identifier);
  results.push({
    Etape: "Validation par Super Admin",
    Attendu: "Actif/Validé",
    Obtenu: `${stored.status}/${stored.validationStatus}`,
    OK: stored.status === "Actif" && stored.validationStatus === "Validé",
  });

  const superStateAfterValidate = await request("/backoffice/state", { token: superToken });
  const resolvedAlert = (superStateAfterValidate.data.notifications ?? []).find(
    (notification) => notification.id === `NOTIF-VAL-USER-${newUser.id}`,
  );
  results.push({
    Etape: "Alerte marquée lue après validation",
    Attendu: "Lu",
    Obtenu: resolvedAlert?.status ?? "absente",
    OK: resolvedAlert?.status === "Lu",
  });

  // 7) Connexion désormais possible
  const allowed = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password: temporaryPassword, schoolCode: SCHOOL_CODE },
  });
  results.push({
    Etape: "Connexion après validation",
    Attendu: "200",
    Obtenu: String(allowed.status),
    OK: allowed.status === 200,
  });

  console.table(results);
  const failures = results.filter((r) => !r.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("Règle de validation Admin École: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
