"use strict";

/**
 * PR2 — Clôture reconstruction Élèves : le CRUD legacy via state / EntityPage / Mobile
 * AdminCrud ne doit plus être accessible. Inscription uniquement via
 * POST /api/classes/:classCode/students ; lecture/édition canonique via /api/students.
 *
 * Projections read-only conservées (state.students) pour modules non reconstruits :
 * notes, présences, paiements, bulletins PDF, parent children, dashboards, Mobile lecture.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19563;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  stripLegacyStudentsStateWrite,
  LEGACY_STUDENTS_STATE_WRITE_CODE,
  LEGACY_STUDENTS_STATE_WRITE_MESSAGE,
} = require("../lib/legacyStudentsStateWrite");
const {
  ADMIN_SCHOOL_WRITABLE_ENTITIES,
  PREFET_WRITABLE_ENTITIES,
  SECRETARY_WRITABLE_ENTITIES,
  evaluateBackOfficeWriteAccess,
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

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function runUnitGuards() {
  assert.equal(
    ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("students"),
    false,
    "students hors matrice Admin School writable",
  );
  assert.equal(
    PREFET_WRITABLE_ENTITIES.includes("students"),
    false,
    "students hors matrice Préfet writable",
  );
  assert.equal(
    SECRETARY_WRITABLE_ENTITIES.includes("students"),
    false,
    "students hors matrice Secrétaire writable",
  );
  assert.equal(
    evaluateBackOfficeWriteAccess({ role: "Admin School", schoolCode: "CD-2026-0001" }, ["students"])
      .ok,
    false,
    "écriture state students refusée (matrice)",
  );

  const onlyStudents = stripLegacyStudentsStateWrite(
    { students: [{ id: "s1", name: "Legacy" }] },
    ["classes", "students", "teachers"],
  );
  assert.equal(onlyStudents.rejectLegacyStudentsWrite, true);
  assert.equal(onlyStudents.strippedStudents, true);
  assert.equal(Object.prototype.hasOwnProperty.call(onlyStudents.body, "students"), false);

  const mixed = stripLegacyStudentsStateWrite(
    { students: [{ id: "s1" }], teachers: [{ id: "t1" }] },
    ["classes", "students", "teachers"],
  );
  assert.equal(mixed.rejectLegacyStudentsWrite, false);
  assert.equal(mixed.strippedStudents, true);
  assert.equal(Object.prototype.hasOwnProperty.call(mixed.body, "students"), false);
  assert.ok(Array.isArray(mixed.body.teachers));

  const entityPage = read("web/src/pages/EntityPage.tsx");
  assert.match(
    entityPage,
    /props\.entity === "students"[\s\S]*Navigate to="\/etablissement\/eleves"/,
    "EntityPage redirige Élèves vers /etablissement/eleves",
  );
  assert.doesNotMatch(entityPage, /adaptLegacyStudents/);
  assert.doesNotMatch(
    entityPage,
    /EntityPage\s+entity=["']students["']/,
  );

  const appTsx = read("web/src/App.tsx");
  assert.doesNotMatch(appTsx, /EntityPage\s+entity=["']students["']/);
  assert.match(appTsx, /StudentsListPage/);

  const listPage = read("web/src/pages/etablissement/StudentsListPage.tsx");
  assert.doesNotMatch(listPage, /EntityPage/);
  assert.doesNotMatch(listPage, />\s*Ajouter\s*</);
  assert.doesNotMatch(listPage, /depuis un contact/i);
  assert.match(listPage, /studentsApi/);
  assert.match(listPage, /primaryActions=\{null\}/);

  const workspaceFiles = [
    "web/src/pages/etablissement/StudentWorkspacePage.tsx",
    "web/src/hooks/useStudentWorkspace.ts",
  ].filter((rel) => fs.existsSync(path.join(ROOT, rel)));
  for (const rel of workspaceFiles) {
    const src = read(rel);
    assert.doesNotMatch(src, /studentsApi\.create|POST\s*\/api\/students[^/]/);
    assert.doesNotMatch(src, />\s*Ajouter\s*</);
  }

  const entityModules = read("web/src/lib/entityModules.ts");
  assert.match(
    entityModules,
    /key:\s*"students"[\s\S]*?fields:\s*\[\s*\]/,
    "module students sans formulaire EntityPage",
  );

  const contacts = read("web/src/lib/contacts.ts");
  assert.match(
    contacts,
    /STUDENT_CONTACT_TYPES\.has\(contactType\)\)\s*\{\s*return \{ contact \};/,
    "contacts Élève ne mutent plus state.students",
  );

  const presences = read("web/src/pages/PresencesPage.tsx");
  assert.doesNotMatch(presences, /assignStudentToClass/);
  assert.doesNotMatch(presences, /update\(\s*\{\s*students\s*:/);

  const contactRegistry = read("backend/lib/contactRegistrySync.js");
  assert.match(
    contactRegistry,
    /STUDENT_CONTACT_TYPES\.has\(contactType\)\)\s*\{\s*return \{ contact, students: null, teachers: null \};/,
  );
  assert.doesNotMatch(
    contactRegistry,
    /next\.students\s*=\s*next\.students\.filter/,
  );

  const adminCrud = read("Mobile/src/screens/AdminCrudScreen.tsx");
  assert.match(adminCrud, /LEGACY_STUDENTS_CRUD_RETIRED_MESSAGE/);
  assert.match(adminCrud, /entity === "students"/);
  assert.doesNotMatch(adminCrud, /updateItem\(\s*["']students["']/);

  const studentsScreen = read("Mobile/src/screens/StudentsScreen.tsx");
  assert.doesNotMatch(studentsScreen, /navigate\(\s*["']AdminCrud["'][\s\S]*entity:\s*["']students["']/);
  assert.doesNotMatch(studentsScreen, /canManageStudents\s*&&/);

  const contactProv = read("Mobile/src/lib/contactProvisioning.ts");
  assert.doesNotMatch(contactProv, /["']students["']/);

  const home = read("Mobile/src/screens/HomeScreen.tsx");
  assert.doesNotMatch(home, /AdminCrud["']\s*,\s*\{\s*entity:\s*["']students["']/);

  const menu = read("Mobile/src/screens/MenuScreen.tsx");
  assert.doesNotMatch(menu, /entity:\s*["']students["']/);

  const schoolMgmt = read("Mobile/src/screens/SchoolManagementScreen.tsx");
  assert.doesNotMatch(schoolMgmt, /entity:\s*["']students["']/);

  const syncRepo = read("backend/db/postgresRepository.js");
  assert.match(
    syncRepo,
    /async syncStudentsDomainFromBackOffice[\s\S]*studentCount:\s*0/,
    "syncStudentsDomainFromBackOffice est un no-op",
  );

  console.log("OK unit: guards legacy Élèves CRUD");
}

async function runHttpGuards() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
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
      body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const token = login.data.accessToken || login.data.token;
    assert.ok(token);

    const stateBefore = await request("/backoffice/state", { token });
    assert.equal(stateBefore.status, 200);
    assert.ok(Array.isArray(stateBefore.data.students), "state.students projection lecture");

    const addForbidden = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        students: [
          ...(stateBefore.data.students ?? []),
          {
            id: `STU-LEGACY-${Date.now()}`,
            name: `Legacy Forbidden ${Date.now()}`,
            schoolCode: "CD-2026-0001",
            className: "6ème A",
          },
        ],
      },
    });
    assert.equal(addForbidden.status, 400, `ajout attendu 400, reçu ${addForbidden.status}`);
    assert.equal(addForbidden.data?.code, LEGACY_STUDENTS_STATE_WRITE_CODE);
    assert.equal(String(addForbidden.data?.message ?? ""), LEGACY_STUDENTS_STATE_WRITE_MESSAGE);

    const replaceForbidden = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: { students: [] },
    });
    assert.equal(replaceForbidden.status, 400);
    assert.equal(replaceForbidden.data?.code, LEGACY_STUDENTS_STATE_WRITE_CODE);

    const mutateForbidden = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        students: (stateBefore.data.students ?? []).map((row, index) =>
          index === 0 ? { ...row, name: `Mutated-${Date.now()}` } : row,
        ),
      },
    });
    assert.equal(mutateForbidden.status, 400);
    assert.equal(mutateForbidden.data?.code, LEGACY_STUDENTS_STATE_WRITE_CODE);

    const mixedStrip = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        students: [{ id: "SHOULD-STRIP", schoolCode: "CD-2026-0001" }],
        academicConfigs: stateBefore.data.academicConfigs ?? {},
      },
    });
    assert.ok(
      mixedStrip.status >= 200 && mixedStrip.status < 300,
      `PUT mixte (students strip) doit passer: ${mixedStrip.status} ${JSON.stringify(mixedStrip.data)}`,
    );
    assert.ok(
      !(mixedStrip.data.students ?? []).some((row) => String(row.id) === "SHOULD-STRIP"),
      "écriture indirecte students ne doit pas persister",
    );

    const postStudents = await request("/students", {
      method: "POST",
      token,
      body: { firstName: "Hors", lastName: "Classe" },
    });
    assert.ok(
      postStudents.status === 404 || postStudents.status === 405 || postStudents.status === 400,
      `création hors classe refusée, reçu ${postStudents.status}`,
    );

    const stamp = Date.now();
    const createdClass = await request("/classes", {
      method: "POST",
      token,
      body: {
        name: `Classe Eleves Cloture ${stamp}`,
        academicYearName: "2025-2026",
        level: "6ème",
        section: "Z",
        status: "active",
      },
    });
    assert.equal(createdClass.status, 201, JSON.stringify(createdClass.data));
    assert.ok(createdClass.data.classCode);

    const enrolled = await request(
      `/classes/${encodeURIComponent(createdClass.data.classCode)}/students`,
      {
        method: "POST",
        token,
        body: {
          firstName: "Awa",
          lastName: `LegacyCleanup${stamp}`,
          gender: "Féminin",
          birthDate: "2012-04-12",
        },
      },
    );
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = enrolled.data.studentCode;
    assert.ok(studentCode);

    const list = await request("/students", { token });
    assert.equal(list.status, 200);
    const listRows = Array.isArray(list.data) ? list.data : list.data?.items ?? list.data?.data ?? [];
    assert.ok(listRows.some((row) => row.studentCode === studentCode), "liste PG");

    const detail = await request(`/students/${encodeURIComponent(studentCode)}`, { token });
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.studentCode, studentCode);
    assert.ok(Array.isArray(detail.data.enrollments), "historique inscriptions");
    assert.ok(Array.isArray(detail.data.guardians), "responsables");
    assert.ok(detail.data.medical, "médical");
    assert.ok(Array.isArray(detail.data.documents), "documents");
    assert.ok(detail.data.access?.notesPath, "accès notes");
    assert.ok(detail.data.access?.presencesPath || detail.data.access?.paymentsPath, "accès présences/paiements");

    const updated = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token,
      body: {
        parentPhone: "+24380009999",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.parentPhone, "+24380009999");

    const tokenBi = (
      await request("/backoffice/login", {
        method: "POST",
        body: { identifier: "admin", password: "1234", schoolCode: "BI-2026-0002" },
      })
    );
    // BI school may not exist in memory seed — isolation check best-effort via forged schoolCode patch
    const forgedSchool = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token,
      body: {
        parentPhone: "+24380000000",
        schoolCode: "BI-2026-0002",
        expectedUpdatedAt: updated.data.updatedAt,
      },
    });
    assert.equal(forgedSchool.status, 400, JSON.stringify(forgedSchool.data));

    if (tokenBi.status === 200) {
      const biToken = tokenBi.data.accessToken || tokenBi.data.token;
      const cross = await request(`/students/${encodeURIComponent(studentCode)}`, { token: biToken });
      assert.ok(cross.status === 403 || cross.status === 404, `isolation inter-établissements: ${cross.status}`);
    }

    const notes = await request(`/students/${encodeURIComponent(studentCode)}/notes`, { token });
    assert.ok(notes.status === 200 || notes.status === 403, `notes accessibles: ${notes.status}`);
    const presences = await request(`/students/${encodeURIComponent(studentCode)}/presences`, { token });
    assert.ok(presences.status === 200 || presences.status === 403, `présences: ${presences.status}`);
    const payments = await request(`/students/${encodeURIComponent(studentCode)}/payments`, { token });
    assert.ok(payments.status === 200 || payments.status === 403, `paiements: ${payments.status}`);

    console.log("OK http: legacy state write bloqué · inscription classe + fiche PG OK");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
    if (stderr && process.env.DEBUG_LEGACY_STUDENTS) {
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
