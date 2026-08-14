"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19699;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
} = require("../lib/backofficeStateRemoval");

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
    body: body === undefined ? undefined : JSON.stringify(body),
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
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

function runStaticGuards() {
  const patterns = [
    "backend/server.js",
    "web/src/context/DataContext.tsx",
    "Mobile/src/services/api.ts",
    "BackOffice/app.js",
    "backend/db/postgresRepository.js",
    "backend/db/fallbackRepository.js",
  ].map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));

  const [server, dataContext, mobileApi, backOffice, postgres, fallback] = patterns;

  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /overlayResidualProjection/);
  assert.match(server, /exams: residual\.exams \?\? \[\]/);
  assert.match(server, /requirePermission\("PUT \/api\/backoffice\/planning-exams"\)/);
  assert.doesNotMatch(dataContext, /api\.put\([\s\S]*\/backoffice\/state/);
  assert.doesNotMatch(mobileApi, /\/backoffice\/state[\s\S]{0,120}method:\s*"PUT"/);
  assert.doesNotMatch(mobileApi, /method:\s*"PUT"[\s\S]{0,120}\/backoffice\/state/);
  assert.doesNotMatch(backOffice, /method:\s*"PUT"[\s\S]{0,120}\/backoffice\/state/);
  assert.match(postgres, /async getBackOfficeState\(\)[\s\S]*return null/);
  assert.match(fallback, /createBackOfficeStateWriteRemovedError/);

  for (const label of ["saveBackOfficeState", "persistSyncedState", "syncBackOfficeState"]) {
    const hits = [];
    for (const rel of ["web/src", "Mobile/src", "BackOffice"]) {
      const dir = path.join(ROOT, rel);
      if (!fs.existsSync(dir)) continue;
      for (const file of walk(dir)) {
        if (!/\.(ts|tsx|js)$/.test(file)) continue;
        const content = fs.readFileSync(file, "utf8");
        if (content.includes(label) && !file.includes("verify-") && !file.includes(".test.")) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    if (label === "saveBackOfficeState") {
      const allowed = new Set(["Mobile/src/services/api.ts"]);
      assert.ok(
        hits.every((hit) => allowed.has(hit)),
        `writers résiduels ${label}: ${hits.join(", ")}`,
      );
    }
  }

  console.log("OK static: aucun writer PUT state actif côté clients");
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

async function countAuditRows(token, { action, schoolCode } = {}) {
  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (schoolCode) params.set("schoolCode", schoolCode);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const audit = await request(`/audit${suffix}`, { token });
  assert.equal(audit.status, 200, JSON.stringify(audit.data));
  const rows = Array.isArray(audit.data?.items) ? audit.data.items : audit.data ?? [];
  return rows.length;
}

async function runResidualGuards(superToken) {
  const adminCd = await login("admin", "1234", "CD-2026-0001");
  const adminBi = await login("admin", "1234", "BI-2026-0002");
  const teacherToken = await login("ENS-0001", "1234", "CD-2026-0001");
  const parentToken = await login("+243 820 000 001", "1234", "CD-2026-0001");
  const studentToken = await login("ELE-0001", "1234", "CD-2026-0001");

  const forbiddenTokens = [
    ["Enseignant", teacherToken],
    ["Parent", parentToken],
    ["Élève", studentToken],
  ];

  const residualRoutes = [
    ["/backoffice/planning-exams", { exams: [{ id: "EXAM-RBAC-1", schoolCode: "CD-2026-0001", title: "Test" }] }],
    ["/backoffice/report-cards", { bulletins: [{ id: "BUL-RBAC-1", schoolCode: "CD-2026-0001", title: "Test" }] }],
    [
      "/backoffice/establishment-documents",
      { documents: [{ id: "DOC-RBAC-1", schoolCode: "CD-2026-0001", title: "Test" }] },
    ],
  ];

  for (const [roleLabel, token] of forbiddenTokens) {
    for (const [route, body] of residualRoutes) {
      const auditBefore = await countAuditRows(superToken, { action: `replace_residual_${route.includes("planning") ? "exam" : route.includes("report") ? "bulletin" : "document"}` });
      const denied = await request(route, { method: "PUT", token, body });
      assert.equal(denied.status, 403, `${roleLabel} ${route}`);
      const auditAfter = await countAuditRows(superToken, { action: `replace_residual_${route.includes("planning") ? "exam" : route.includes("report") ? "bulletin" : "document"}` });
      assert.equal(auditAfter, auditBefore, `${roleLabel} ${route} ne doit pas auditer`);
    }
  }

  const baselineBi = await request("/academic-config", { token: adminBi });
  assert.equal(baselineBi.status, 200);
  await request("/academic-config", {
    method: "PUT",
    token: adminBi,
    body: {
      schoolCode: "CD-2026-0001",
      periodMode: "bi-baseline",
      periods: [{ name: "Trimestre 1", type: "Trimestre", startDate: "01-09-2025", endDate: "20-12-2025", active: true }],
      evaluationTypes: ["Devoir"],
      defaultScale: 20,
    },
  });

  await request("/academic-config", {
    method: "PUT",
    token: adminCd,
    body: {
      schoolCode: "BI-2026-0002",
      periodMode: "cd-scoped-write",
      periods: [{ name: "Trimestre 1", type: "Trimestre", startDate: "01-09-2025", endDate: "20-12-2025", active: true }],
      evaluationTypes: ["Devoir"],
      defaultScale: 20,
    },
  });

  const cdConfig = await request("/academic-config", { token: adminCd });
  assert.equal(cdConfig.status, 200);
  assert.equal(cdConfig.data?.periodMode, "cd-scoped-write");
  assert.equal(cdConfig.data?.schoolCode, "CD-2026-0001");

  const biConfig = await request("/academic-config", { token: adminBi });
  assert.equal(biConfig.status, 200);
  assert.equal(biConfig.data?.periodMode, "bi-baseline");
  assert.equal(biConfig.data?.schoolCode, "BI-2026-0002");

  const beforeState = await request("/backoffice/state", { token: adminCd });
  assert.equal(beforeState.status, 200);
  const runtimeExamCount = (beforeState.data?.exams ?? []).length;

  const seeded = await request("/backoffice/planning-exams", {
    method: "PUT",
    token: adminCd,
    body: {
      exams: [{ id: "EXAM-EMPTY-1", schoolCode: "CD-2026-0001", title: "Provisoire" }],
    },
  });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.data));

  const cleared = await request("/backoffice/planning-exams", {
    method: "PUT",
    token: adminCd,
    body: { exams: [] },
  });
  assert.equal(cleared.status, 200);

  const afterState = await request("/backoffice/state", { token: adminCd });
  assert.equal(afterState.status, 200);
  assert.deepEqual(afterState.data?.exams ?? [], [], "projection vide canonique après remplacement []");
  if (runtimeExamCount > 0) {
    assert.notDeepEqual(
      afterState.data?.exams ?? [],
      beforeState.data?.exams ?? [],
      "le fallback runtime ne doit pas réapparaître après vidage PG",
    );
  }

  const auditBeforeReplace = await countAuditRows(superToken, { action: "replace_residual_exam", schoolCode: "CD-2026-0001" });
  const allowed = await request("/backoffice/planning-exams", {
    method: "PUT",
    token: adminCd,
    body: {
      exams: [{ id: "EXAM-AUDIT-1", schoolCode: "CD-2026-0001", title: "Audit OK" }],
    },
  });
  assert.equal(allowed.status, 200);
  const auditAfterReplace = await countAuditRows(superToken, { action: "replace_residual_exam", schoolCode: "CD-2026-0001" });
  assert.ok(auditAfterReplace > auditBeforeReplace, "audit transactionnel attendu sur remplacement autorisé");

  console.log("OK http: RBAC résiduel, isolation CD/BI, projection vide, audit");
}

async function runHttpGuards() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(child);

    const superLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "superadmin@somafrik.app", password: "1234" },
    });
    const superToken = superLogin.data.accessToken || superLogin.data.token;

    const payloads = [{}, null, { academicConfigs: {} }, { exams: [] }, { unknownKey: 1 }, { exams: [], bulletins: [] }];
    for (const body of payloads) {
      const denied = await request("/backoffice/state", {
        method: "PUT",
        token: superToken,
        body,
      });
      assert.equal(denied.status, BACKOFFICE_STATE_WRITE_REMOVED_STATUS, JSON.stringify(body));
      assert.equal(denied.data?.code, BACKOFFICE_STATE_WRITE_REMOVED_CODE);
      assert.equal(denied.data?.message, BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE);
    }

    const getState = await request("/backoffice/state", { token: superToken });
    assert.equal(getState.status, 200);
    assert.ok(Array.isArray(getState.data?.schools));
    assert.ok(!String(JSON.stringify(getState.data)).includes("passwordHash"));

    await runResidualGuards(superToken);

    console.log("OK http: PUT 410 + GET projection read-only");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

async function main() {
  runStaticGuards();
  await runHttpGuards();
  console.log("verify-backoffice-state-removal: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
