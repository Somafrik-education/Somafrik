"use strict";

/**
 * LOT 1 — Clôture Établissements : plus de CRUD via PUT /state ;
 * /api/backoffice/establishments persiste PostgreSQL (ou mémoire) ;
 * state.schools reste une projection de lecture.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const fs = require("fs");
const { assertBackOfficeStateReadRemoved, assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19571;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  stripLegacySchoolsStateWrite,
  LEGACY_SCHOOLS_STATE_WRITE_CODE,
  LEGACY_SCHOOLS_STATE_WRITE_MESSAGE,
} = require("../lib/legacySchoolsStateWrite");
const {
  COUNTRY_NOT_FOUND_CODE,
  COUNTRY_NOT_FOUND_MESSAGE,
  findCanonicalCountry,
} = require("../lib/schoolsManagement");
const {
  COUNTRY_ADMIN_WRITABLE_ENTITIES,
  evaluateBackOfficeWriteAccess,
  getWritableBackOfficeEntitiesForPrincipal,
} = require("../lib/backOfficeWritableEntities");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
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

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

function runUnitGuards() {
  assert.equal(
    COUNTRY_ADMIN_WRITABLE_ENTITIES.includes("schools"),
    false,
    "schools hors matrice Admin Pays writable",
  );
  assert.equal(
    getWritableBackOfficeEntitiesForPrincipal({ role: "Admin Pays" }).includes("schools"),
    false,
    "Admin Pays ne peut plus écrire schools via PUT state",
  );
  assert.equal(
    getWritableBackOfficeEntitiesForPrincipal(
      { role: "Super Administrateur Somafrik" },
      ["schools", "users", "auditLog"],
    ).includes("schools"),
    false,
    "Super Admin ne peut plus écrire schools via PUT state",
  );
  assert.equal(
    evaluateBackOfficeWriteAccess({ role: "Admin Pays", countryCode: "CD" }, ["schools"]).ok,
    false,
  );

  const onlySchools = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-2026-0999" }] },
    ["schools", "students", "teachers"],
  );
  assert.equal(onlySchools.rejectLegacySchoolsWrite, true);
  assert.equal(onlySchools.strippedSchools, true);

  const mixedUsers = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-HACK" }], users: [{ id: "USER-SENTINEL" }] },
    ["schools", "users", "subscriptions"],
  );
  assert.equal(mixedUsers.rejectLegacySchoolsWrite, true);
  const mixedSubs = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-HACK" }], subscriptions: [{ id: "SUB-SENTINEL" }] },
    ["schools", "users", "subscriptions"],
  );
  assert.equal(mixedSubs.rejectLegacySchoolsWrite, true);
  assert.equal(findCanonicalCountry([{ code: "CD", name: "RDC" }], "FR", "France"), null);

  const schoolsPage = fs.readFileSync(path.join(ROOT, "web/src/pages/SchoolsPage.tsx"), "utf8");
  assert.match(schoolsPage, /establishmentsApi\.create/);
  assert.match(schoolsPage, /establishmentsApi\.update/);
  assert.doesNotMatch(
    schoolsPage,
    /update\(\s*\{[^}]*schools\s*:/,
    "SchoolsPage ne PUT plus schools via DataContext.update",
  );

  const dataContext = fs.readFileSync(path.join(ROOT, "web/src/context/DataContext.tsx"), "utf8");
  assert.match(dataContext, /stripClientSchoolsFromPutPayload/);

  const adminCrud = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/AdminCrudScreen.tsx"), "utf8");
  assert.match(adminCrud, /LEGACY_SCHOOLS_CRUD_RETIRED_MESSAGE/);

  const adminData = fs.readFileSync(path.join(ROOT, "Mobile/src/context/AdminDataContext.tsx"), "utf8");
  const forbiddenMatch = adminData.match(
    /const LOCAL_WRITE_FORBIDDEN_ENTITIES = new Set\(\[([\s\S]*?)\]\s*\)/,
  );
  assert.ok(forbiddenMatch, "LOCAL_WRITE_FORBIDDEN_ENTITIES défini");
  assert.match(forbiddenMatch[1], /["']classes["']/, "classes dans LOCAL_WRITE_FORBIDDEN_ENTITIES");
  assert.match(forbiddenMatch[1], /["']schools["']/, "schools dans LOCAL_WRITE_FORBIDDEN_ENTITIES");
  const createItem = adminData.match(/createItem:\s*\(entity,\s*item\)\s*=>\s*\{([\s\S]*?)\n      \},\n      updateItem:/);
  const updateItem = adminData.match(/updateItem:\s*\(entity,\s*item\)\s*=>\s*\{([\s\S]*?)\n      \},\n      deleteItem:/);
  const deleteItem = adminData.match(/deleteItem:\s*\(entity,\s*id\)\s*=>\s*\{([\s\S]*?)\n      \},\n      upsertPresenceItems:/);
  assert.ok(createItem, "createItem présent");
  assert.ok(updateItem, "updateItem présent");
  assert.ok(deleteItem, "deleteItem présent");
  assert.match(createItem[1], /LOCAL_WRITE_FORBIDDEN_ENTITIES\.has\(entity\)/, "createItem refuse classes/schools");
  assert.match(updateItem[1], /LOCAL_WRITE_FORBIDDEN_ENTITIES\.has\(entity\)/, "updateItem refuse classes/schools");
  assert.match(deleteItem[1], /LOCAL_WRITE_FORBIDDEN_ENTITIES\.has\(entity\)/, "deleteItem refuse classes/schools");

  const mobileApi = fs.readFileSync(path.join(ROOT, "Mobile/src/services/api.ts"), "utf8");
  assert.match(mobileApi, /BACKOFFICE_STATE_WRITE_REMOVED/);

  const backOffice = fs.readFileSync(path.join(ROOT, "BackOffice/app.js"), "utf8");
  assert.doesNotMatch(backOffice, /\/backoffice\/state/);
  assert.doesNotMatch(backOffice, /getBackOfficeStatePayload/);

  const schoolsRepo = fs.readFileSync(path.join(ROOT, "backend/db/schoolsRepository.js"), "utf8");
  assert.doesNotMatch(schoolsRepo, /\+243/);
  assert.doesNotMatch(schoolsRepo, /INSERT INTO countries/);

  const postgresRepo = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  assert.doesNotMatch(
    postgresRepo,
    /backOfficeSchool\.country \?\? "République Démocratique du Congo"/,
  );
  assert.doesNotMatch(
    postgresRepo,
    /VALUES \(\$1, \$2, '\+243', 'CDF'/,
  );

  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(server, /persistEstablishment/);
  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.doesNotMatch(
    server,
    /saveEstablishmentState\(nextState, state, req\.principal\);\n  await auditService\.record\(req, "create_establishment"/,
  );

  console.log("OK unit: guards legacy Établissements CRUD");
}

async function runHttpGuards() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_SKIP_DEMO_SEED: "false",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);

    const login = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "superadmin@somafrik.app", password: "1234" },
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const token = login.data.accessToken || login.data.token;
    assert.ok(token);

    const stamp = Date.now();
    const payload = {
      name: `Lycée Cloture ${stamp}`,
      type: "Lycée",
      country: "RDC",
      countryCode: "CD",
      city: "Kinshasa",
      phone: `+243 99${String(stamp).slice(-7)}`,
      email: `lot1-${stamp}@test.cd`,
      principalName: "Awa Kabila",
      principalEmail: `awa-${stamp}@test.cd`,
      address: "1 av. Test",
      status: "Actif",
      validationStatus: "Validé",
    };

    const created = await request("/backoffice/establishments", {
      method: "POST",
      token,
      body: payload,
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const code = created.data?.school?.code;
    assert.ok(code);
    assert.equal(created.data.school.principalName, "Awa Kabila");

    const listed = await request("/backoffice/establishments", { token });
    assert.equal(listed.status, 200);
    const list = Array.isArray(listed.data) ? listed.data : listed.data?.items ?? listed.data?.data ?? [];
    assert.ok(
      list.some((row) => row.code === code),
      "/api/backoffice/establishments liste l'établissement créé",
    );

    const stateAfter = await request("/backoffice/establishments", { token });
    assert.equal(stateAfter.status, 200);
    const establishmentRows = Array.isArray(stateAfter.data)
      ? stateAfter.data
      : stateAfter.data?.items ?? stateAfter.data?.data ?? [];
    assert.ok(
      establishmentRows.some((row) => row.code === code),
      "/api/backoffice/establishments liste l'établissement créé",
    );

    const patched = await request(`/backoffice/establishments/${encodeURIComponent(code)}`, {
      method: "PATCH",
      token,
      body: { name: `Lycée Cloture Persisté ${stamp}` },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.match(String(patched.data?.school?.name ?? ""), /Persisté/);

    const forbidden = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        schools: [
          ...establishmentRows,
          {
            code: `CD-LEGACY-${stamp}`,
            name: `Legacy Forbidden ${stamp}`,
            country: "RDC",
            city: "Goma",
          },
        ],
      },
    });
    assertBackOfficeStateWriteRemoved(forbidden);

    const france = await request("/backoffice/establishments", {
      method: "POST",
      token,
      body: {
        name: `Lycée France ${stamp}`,
        type: "Lycée",
        country: "France",
        countryCode: "FR",
        city: "Paris",
        phone: "+33 1 00 00 00 00",
        email: `france-${stamp}@test.fr`,
        principalName: "Marie Dupont",
        address: "1 rue de Rivoli",
        status: "Actif",
        validationStatus: "Validé",
      },
    });
    assert.equal(france.status, 400, `pays FR: attendu 400, reçu ${france.status} ${JSON.stringify(france.data)}`);
    assert.equal(france.data?.code, COUNTRY_NOT_FOUND_CODE);
    assert.equal(String(france.data?.message ?? ""), COUNTRY_NOT_FOUND_MESSAGE);

    const countriesList = await request("/backoffice/countries", { token });
    assert.equal(countriesList.status, 200);
    const countryRows = Array.isArray(countriesList.data)
      ? countriesList.data
      : countriesList.data?.items ?? countriesList.data?.data ?? [];
    assert.equal(
      countryRows.some((row) => String(row.code ?? row.iso_code ?? "").toUpperCase() === "FR"),
      false,
      "aucun pays FR créé dans le référentiel",
    );

    const stateAfterFrance = await request("/backoffice/countries", { token });
    assert.equal(stateAfterFrance.status, 200);
    const countryRowsAfter = Array.isArray(stateAfterFrance.data)
      ? stateAfterFrance.data
      : stateAfterFrance.data?.items ?? stateAfterFrance.data?.data ?? [];
    assert.equal(
      countryRowsAfter.some((row) => String(row.code ?? row.iso_code ?? "").toUpperCase() === "FR"),
      false,
    );
    const schoolsAfterFrance = await request("/backoffice/establishments", { token });
    assert.equal(schoolsAfterFrance.status, 200);
    const schoolRowsAfter = Array.isArray(schoolsAfterFrance.data)
      ? schoolsAfterFrance.data
      : schoolsAfterFrance.data?.items ?? schoolsAfterFrance.data?.data ?? [];
    assert.equal(
      schoolRowsAfter.some(
        (row) => String(row.countryCode ?? "").toUpperCase() === "FR" || /france/i.test(String(row.country ?? "")),
      ),
      false,
      "aucun établissement France persisté",
    );

    const usersBaseline = await request("/backoffice/users", { token });
    assert.equal(usersBaseline.status, 200);
    const subscriptionsBaseline = await request("/backoffice/subscriptions", { token });
    assert.equal(subscriptionsBaseline.status, 200);
    const baselineUsers = Array.isArray(usersBaseline.data)
      ? usersBaseline.data
      : usersBaseline.data?.items ?? usersBaseline.data?.data ?? [];
    const baselineSubs = Array.isArray(subscriptionsBaseline.data)
      ? subscriptionsBaseline.data
      : subscriptionsBaseline.data?.items ?? subscriptionsBaseline.data?.data ?? [];
    const userSentinelId = `USER-LOT1-MIXED-${stamp}`;
    const subSentinelId = `SUB-LOT1-MIXED-${stamp}`;
    const userSentinel = {
      id: userSentinelId,
      name: "Sentinel Mixed Schools",
      email: `sentinel-mixed-${stamp}@test.cd`,
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      status: "Actif",
    };
    const subSentinel = {
      id: subSentinelId,
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      country: "RDC",
      plan: "Premium",
      status: "Actif",
    };

    const mixedUsers = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        schools: [
          ...schoolRowsAfter,
          { code: `CD-MIXED-USERS-${stamp}`, name: "Hack Users", country: "RDC", city: "Goma" },
        ],
        users: [...baselineUsers, userSentinel],
      },
    });
    assertBackOfficeStateWriteRemoved(mixedUsers);

    const mixedSubs = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        schools: [
          ...schoolRowsAfter,
          { code: `CD-MIXED-SUBS-${stamp}`, name: "Hack Subs", country: "RDC", city: "Goma" },
        ],
        subscriptions: [...baselineSubs, subSentinel],
      },
    });
    assertBackOfficeStateWriteRemoved(mixedSubs);

    const snapshotPut = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        schools: schoolRowsAfter,
        users: [...baselineUsers, userSentinel],
        subscriptions: [...baselineSubs, subSentinel],
      },
    });
    assertBackOfficeStateWriteRemoved(snapshotPut);

    const usersAfterMixed = await request("/backoffice/users", { token });
    const subsAfterMixed = await request("/backoffice/subscriptions", { token });
    const schoolsAfterMixed = await request("/backoffice/establishments", { token });
    assert.equal(usersAfterMixed.status, 200);
    assert.equal(subsAfterMixed.status, 200);
    assert.equal(schoolsAfterMixed.status, 200);
    const usersRows = Array.isArray(usersAfterMixed.data)
      ? usersAfterMixed.data
      : usersAfterMixed.data?.items ?? usersAfterMixed.data?.data ?? [];
    const subsRows = Array.isArray(subsAfterMixed.data)
      ? subsAfterMixed.data
      : subsAfterMixed.data?.items ?? subsAfterMixed.data?.data ?? [];
    const schoolsRows = Array.isArray(schoolsAfterMixed.data)
      ? schoolsAfterMixed.data
      : schoolsAfterMixed.data?.items ?? schoolsAfterMixed.data?.data ?? [];
    assert.equal(
      usersRows.some((row) => String(row.id) === userSentinelId),
      false,
      "aucune mutation partielle users",
    );
    assert.equal(
      subsRows.some((row) => String(row.id) === subSentinelId),
      false,
      "aucune mutation partielle subscriptions",
    );
    assert.equal(
      schoolsRows.some((row) => String(row.code ?? "").includes("MIXED")),
      false,
      "aucune mutation partielle schools",
    );
    assert.equal(usersRows.length, baselineUsers.length);
    assert.equal(subsRows.length, baselineSubs.length);

    const adminLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
    });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
    const adminToken = adminLogin.data.accessToken || adminLogin.data.token;
    const adminPut = await request("/backoffice/state", {
      method: "PUT",
      token: adminToken,
      body: { schools: [{ code: "CD-HACK", name: "Hack" }] },
    });
    assertBackOfficeStateWriteRemoved(adminPut);

    const teacherLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
    });
    assert.equal(teacherLogin.status, 200);
    const teacherPatch = await request(`/backoffice/establishments/${encodeURIComponent(code)}`, {
      method: "PATCH",
      token: teacherLogin.data.accessToken || teacherLogin.data.token,
      body: { name: "Hack Admin School" },
    });
    assert.equal(
      teacherPatch.status,
      403,
      `Admin School ne peut pas PATCH un autre établissement: ${JSON.stringify(teacherPatch.data)}`,
    );

    console.log(
      "OK http: pays inconnu refusé · PUT schools mixte/snapshot rejeté sans mutation partielle · /establishments OK",
    );
  } finally {
    child.kill("SIGTERM");
    await wait(200);
    if (stderr && process.env.DEBUG_LEGACY_SCHOOLS) {
      console.error(stderr);
    }
  }
}

async function main() {
  runUnitGuards();
  await runHttpGuards();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
