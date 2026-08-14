"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertBackOfficeStateReadRemoved,
  assertBackOfficeStateWriteRemoved,
} = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19699;
const BASE = `http://127.0.0.1:${PORT}/api`;

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

function runStaticGuards() {
  const patterns = [
    "backend/server.js",
    "web/src/context/DataContext.tsx",
    "web/src/lib/domainLoaders.ts",
    "Mobile/src/services/api.ts",
    "Mobile/src/context/AdminDataContext.tsx",
    "BackOffice/app.js",
    "backend/db/postgresRepository.js",
    "backend/db/fallbackRepository.js",
  ].map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));

  const [server, dataContext, domainLoaders, mobileApi, mobileContext, backOffice, postgres, fallback] = patterns;

  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /sendBackOfficeStateReadRemoved/);
  assert.match(server, /sendBackOfficeStateReadRemoved/);
  assert.match(server, /overlayResidualProjection/);
  assert.match(server, /exams: canonical\.exams \?\? \[\]/);
  assert.match(server, /requirePermission\("GET \/api\/backoffice\/planning-exams"\)/);
  assert.match(server, /requirePermission\("PUT \/api\/backoffice\/planning-exams"\)/);
  assert.match(server, /LEGACY_EXAMS_WRITE_FORBIDDEN/);
  assert.match(domainLoaders, /loadDomains/);
  assert.doesNotMatch(dataContext, /fetchDomainBackOfficeState/);
  assert.doesNotMatch(dataContext, /api\.put\([\s\S]*\/backoffice\/state/);
  assert.doesNotMatch(dataContext, /void refresh\(\)/);
  assert.doesNotMatch(dataContext, /setInterval/);
  assert.doesNotMatch(mobileApi, /\/backoffice\/state[\s\S]{0,120}method:\s*"PUT"/);
  assert.doesNotMatch(mobileApi, /method:\s*"PUT"[\s\S]{0,120}\/backoffice\/state/);
  assert.doesNotMatch(mobileApi, /\/backoffice\/state[\s\S]{0,120}method:\s*"GET"/);
  assert.match(mobileApi, /BACKOFFICE_STATE_READ_REMOVED/);
  assert.doesNotMatch(mobileContext, /getBackOfficeState\(/);
  assert.doesNotMatch(mobileContext, /setInterval/);
  assert.doesNotMatch(backOffice, /request\(["']\/backoffice\/state["']\)/);
  assert.doesNotMatch(backOffice, /fetch\([^)]*\/backoffice\/state/);
  assert.doesNotMatch(backOffice, /startRealtimeSync/);
  assert.doesNotMatch(backOffice, /refreshBackOfficeStateFromBackend/);
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

  console.log("OK static: aucun writer/reader global actif côté clients");
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
      const auditBefore = await countAuditRows(superToken, {
        action: `replace_residual_${route.includes("planning") ? "exam" : route.includes("report") ? "bulletin" : "document"}`,
      });
      const denied = await request(route, { method: "PUT", token, body });
      assert.equal(denied.status, 403, `${roleLabel} ${route}`);
      const auditAfter = await countAuditRows(superToken, {
        action: `replace_residual_${route.includes("planning") ? "exam" : route.includes("report") ? "bulletin" : "document"}`,
      });
      assert.equal(auditAfter, auditBefore, `${roleLabel} ${route} ne doit pas auditer`);
    }
  }

  const readOnlyCases = [
    ["/backoffice/planning-exams", { exams: [] }],
    ["/backoffice/report-cards", { bulletins: [] }],
    ["/backoffice/establishment-documents", { documents: [] }],
  ];
  for (const [route, body] of readOnlyCases) {
    const read = await request(route, { token: teacherToken });
    assert.equal(read.status, 200, `Enseignant lecture autorisée sur ${route}`);
    const write = await request(route, { method: "PUT", token: teacherToken, body });
    assert.equal(write.status, 403, `Enseignant écriture refusée sur ${route}`);
  }

  const baselineBi = await request("/academic-config", { token: adminBi });
  assert.equal(baselineBi.status, 200);
  const biSettings = await request("/school-settings", {
    method: "PATCH",
    token: adminBi,
    body: { schoolCode: "CD-2026-0001", periodMode: "semestre" },
  });
  assert.equal(biSettings.status, 200, JSON.stringify(biSettings.data));
  assert.equal(biSettings.data?.periodMode, "semestre");

  const cdSettings = await request("/school-settings", {
    method: "PATCH",
    token: adminCd,
    body: { schoolCode: "BI-2026-0002", periodMode: "periode" },
  });
  assert.equal(cdSettings.status, 200, JSON.stringify(cdSettings.data));
  assert.equal(cdSettings.data?.periodMode, "periode");

  const cdConfig = await request("/academic-config", { token: adminCd });
  assert.equal(cdConfig.status, 200);
  assert.equal(cdConfig.data?.periodMode, "periode");
  assert.equal(cdConfig.data?.schoolCode, "CD-2026-0001");

  const biConfig = await request("/academic-config", { token: adminBi });
  assert.equal(biConfig.status, 200);
  assert.equal(biConfig.data?.periodMode, "semestre");
  assert.equal(biConfig.data?.schoolCode, "BI-2026-0002");

  const beforeExams = await request("/backoffice/planning-exams", { token: adminCd });
  assert.equal(beforeExams.status, 200);
  assert.ok(Array.isArray(beforeExams.data?.exams));

  const seeded = await request("/backoffice/planning-exams", {
    method: "PUT",
    token: adminCd,
    body: {
      exams: [{ id: "EXAM-EMPTY-1", schoolCode: "CD-2026-0001", title: "Provisoire" }],
    },
  });
  assert.equal(seeded.status, 400, JSON.stringify(seeded.data));
  assert.equal(seeded.data?.code, "LEGACY_EXAMS_WRITE_FORBIDDEN");

  const afterForbidden = await request("/backoffice/planning-exams", { token: adminCd });
  assert.equal(afterForbidden.status, 200);
  assert.ok(
    !(afterForbidden.data?.exams ?? []).some((exam) => exam.id === "EXAM-EMPTY-1"),
    "aucun examen JSON n'est créé par PUT legacy",
  );

  const invalidPayloadCases = [
    ["/backoffice/planning-exams", {}],
    ["/backoffice/planning-exams", { exams: null }],
    ["/backoffice/planning-exams", { exams: [{}] }],
    ["/backoffice/report-cards", { bulletins: "invalid" }],
    ["/backoffice/establishment-documents", { documents: [null] }],
  ];

  for (const [route, body] of invalidPayloadCases) {
    const rejected = await request(route, { method: "PUT", token: adminCd, body });
    assert.equal(rejected.status, 400, `${route} doit rejeter l'écriture legacy: ${JSON.stringify(body)}`);
    assert.ok(
      String(rejected.data?.code ?? "").includes("LEGACY_"),
      `${route} code LEGACY_* attendu: ${JSON.stringify(rejected.data)}`,
    );
  }

  const foreignCases = [
    ["/backoffice/planning-exams", "exams", { id: "EXAM-FOREIGN", schoolCode: "BI-2026-0002", title: "Inject" }],
    ["/backoffice/report-cards", "bulletins", { id: "BUL-FOREIGN", schoolCode: "BI-2026-0002", title: "Inject" }],
    [
      "/backoffice/establishment-documents",
      "documents",
      { id: "DOC-FOREIGN", schoolCode: "BI-2026-0002", title: "Inject" },
    ],
  ];

  for (const [route, key, item] of foreignCases) {
    const rejected = await request(route, {
      method: "PUT",
      token: adminCd,
      body: { [key]: [item] },
    });
    assert.equal(rejected.status, 400, `${route} doit rejeter schoolCode imbriqué BI`);
  }

  const preservedExams = await request("/backoffice/planning-exams", { token: adminCd });
  assert.equal(preservedExams.status, 200);
  assert.ok(
    !(preservedExams.data?.exams ?? []).some((exam) => exam.id === "EXAM-FOREIGN"),
    "aucun examen BI injecté ne doit apparaître en projection CD",
  );

  console.log("OK http: RBAC résiduel, isolation CD/BI, PUT legacy forbidden, projection canonique");
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
      assertBackOfficeStateWriteRemoved(denied, JSON.stringify(body));
    }

    const getState = await request("/backoffice/state", { token: superToken });
    assertBackOfficeStateReadRemoved(getState);

    await runResidualGuards(superToken);

    console.log("OK http: PUT/GET 410 + APIs résiduelles");
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
