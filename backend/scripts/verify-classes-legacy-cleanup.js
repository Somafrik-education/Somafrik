"use strict";

/**
 * Clôture reconstruction Classes — le CRUD legacy via state / EntityPage
 * ne doit plus être accessible ; /api/classes et la projection lecture restent.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { assertBackOfficeStateReadRemoved, assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19561;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  stripLegacyClassesStateWrite,
  LEGACY_CLASSES_STATE_WRITE_CODE,
  LEGACY_CLASSES_STATE_WRITE_MESSAGE,
} = require("../lib/legacyClassesStateWrite");
const {
  ADMIN_SCHOOL_WRITABLE_ENTITIES,
  PREFET_WRITABLE_ENTITIES,
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

function runUnitGuards() {
  assert.equal(
    ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("classes"),
    false,
    "classes hors matrice Admin School writable",
  );
  assert.equal(
    PREFET_WRITABLE_ENTITIES.includes("classes"),
    false,
    "classes hors matrice Préfet writable",
  );
  assert.equal(
    evaluateBackOfficeWriteAccess({ role: "Admin School", schoolCode: "CD-2026-0001" }, ["classes"])
      .ok,
    false,
    "écriture state classes refusée (matrice)",
  );

  const onlyClasses = stripLegacyClassesStateWrite(
    { classes: [{ id: "c1", name: "6ème A" }] },
    ["classes", "students", "teachers"],
  );
  assert.equal(onlyClasses.rejectLegacyClassesWrite, true);
  assert.equal(onlyClasses.strippedClasses, true);
  assert.equal(Object.prototype.hasOwnProperty.call(onlyClasses.body, "classes"), false);

  const mixed = stripLegacyClassesStateWrite(
    { classes: [{ id: "c1" }], students: [{ id: "s1" }] },
    ["classes", "students", "teachers"],
  );
  assert.equal(mixed.rejectLegacyClassesWrite, false);
  assert.equal(mixed.strippedClasses, true);
  assert.equal(Object.prototype.hasOwnProperty.call(mixed.body, "classes"), false);
  assert.ok(Array.isArray(mixed.body.students));

  const entityPage = fs.readFileSync(path.join(ROOT, "web/src/pages/EntityPage.tsx"), "utf8");
  assert.match(
    entityPage,
    /props\.entity === "classes"[\s\S]*Navigate to="\/etablissement\/classes"/,
    "EntityPage redirige Classes vers /etablissement/classes (wrapper hors Hooks)",
  );
  assert.match(
    entityPage,
    /function EntityPageContent\(/,
    "EntityPageContent isole les Hooks hors branche Classes",
  );
  assert.doesNotMatch(
    entityPage,
    /module\.key === "classes"/,
    "plus de branche mutation/validation module.key === classes",
  );
  assert.doesNotMatch(entityPage, /removeSchoolClassFromState|validateUniqueClassName/);

  const appTsx = fs.readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");
  assert.doesNotMatch(appTsx, /EntityPage\s+entity=["']classes["']/);
  assert.match(appTsx, /ClassesListPage/);

  console.log("OK unit: guards legacy Classes CRUD");
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

    const classesBefore = await request("/classes", { token });
    assert.equal(classesBefore.status, 200);
    assert.ok(Array.isArray(classesBefore.data), "GET /classes lecture");

    assertBackOfficeStateReadRemoved(await request("/backoffice/state", { token }));

    const forbidden = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        classes: [
          ...(classesBefore.data ?? []),
          {
            id: `CLS-LEGACY-${Date.now()}`,
            name: `Legacy Forbidden ${Date.now()}`,
            schoolCode: "CD-2026-0001",
          },
        ],
      },
    });
    assertBackOfficeStateWriteRemoved(forbidden);

    const stamp = Date.now();
    const created = await request("/classes", {
      method: "POST",
      token,
      body: {
        name: `Classe Cloture ${stamp}`,
        academicYearName: "2025-2026",
        level: "6ème",
        section: "Z",
        status: "active",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.ok(created.data.classCode);

    const stateAfter = await request("/classes", { token });
    assert.equal(stateAfter.status, 200);
    assert.ok(
      (stateAfter.data ?? []).some(
        (row) =>
          String(row.name ?? "") === `Classe Cloture ${stamp}` ||
          String(row.id ?? row.publicId ?? "") === String(created.data.classCode),
      ),
      "classe API visible via GET /classes",
    );

    const listed = await request("/classes", { token });
    assert.equal(listed.status, 200);
    assert.ok(
      (listed.data ?? []).some((row) => row.classCode === created.data.classCode),
      "/api/classes liste la classe créée",
    );

    console.log("OK http: legacy state write bloqué · /api/classes OK");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
    if (stderr && process.env.DEBUG_LEGACY_CLASSES) {
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
