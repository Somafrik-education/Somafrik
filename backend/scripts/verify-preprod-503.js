"use strict";

/**
 * Preuves préprod #503 — non destructif par défaut.
 *
 *   node backend/scripts/verify-preprod-503.js
 *   node backend/scripts/verify-preprod-503.js --local
 *   node backend/scripts/verify-preprod-503.js --apply-reuse --apply-erasure
 *
 * Credentials : variables d'environnement uniquement. Aucun secret en dur hors --local.
 * Production (api.somafrik.app / somafrik.app) refusée.
 */

const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertNotProductionUrl,
  redactValue,
  findLegalChunkName,
  legalPageFindings,
  isPresentRouteStatus,
} = require("../lib/preprod503Probe");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_API = "https://somafrik-api-preprod.onrender.com";
const DEFAULT_WEB = "https://preprod.somafrik.app";
const LOCAL_PORT = 19773;

function argvFlag(name) {
  return process.argv.includes(name);
}

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  }
}

function probe(id, ok, extra = {}) {
  return redactValue({ id, ok, ...extra });
}

async function httpRequest(base, pathname, { method = "GET", token, body, headers = {} } = {}) {
  const url = `${String(base).replace(/\/$/, "")}${pathname}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: parseJsonSafe(text), text };
}

async function waitForHealth(child, apiBase) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child?.exitCode != null) throw new Error(`Backend exited ${child.exitCode}`);
    try {
      const result = await httpRequest(apiBase, "/api/health");
      if (result.status === 200) return result;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("health timeout");
}

function credsFromEnv(prefix) {
  return {
    identifier: env(`${prefix}_ID`),
    password: env(`${prefix}_PASSWORD`),
    schoolCode: env(`${prefix}_SCHOOL_CODE`),
  };
}

async function login(apiBase, creds) {
  if (!creds.identifier || !creds.password) return null;
  const body = {
    identifier: creds.identifier,
    password: creds.password,
    ...(creds.schoolCode ? { schoolCode: creds.schoolCode } : {}),
  };
  const result = await httpRequest(apiBase, "/api/backoffice/login", { method: "POST", body });
  if (result.status !== 200) return { error: result };
  return {
    accessToken: result.data?.accessToken,
    refreshToken: result.data?.refreshToken,
    role: result.data?.user?.role ?? result.data?.role,
  };
}

async function probeLegalPages(webBase) {
  const page = await httpRequest(webBase, "/confidentialite");
  const deletion = await httpRequest(webBase, "/suppression-compte");
  const indexJsMatch = String(page.text || "").match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  let chunkJs = "";
  let chunkName = "";
  if (indexJsMatch) {
    const indexJs = await httpRequest(webBase, indexJsMatch[0]);
    chunkName = findLegalChunkName(indexJs.text);
    if (chunkName) {
      const chunk = await httpRequest(webBase, `/assets/${chunkName}`);
      chunkJs = String(chunk.text || "");
    }
  }
  const findings = legalPageFindings(page.text, chunkJs);
  return { page, deletion, chunkName, findings };
}

async function runProbes({ apiBase, webBase, local, applyReuse, applyErasure, creds }) {
  const probes = [];
  const residual = [];

  const health = await httpRequest(apiBase, "/api/health");
  const healthOk =
    health.status === 200 &&
    (health.data?.database === "postgresql" || (local && health.data?.database === "memory"));
  probes.push(
    probe("health", healthOk, {
      status: health.status,
      database: health.data?.database,
      healthStatus: health.data?.status,
      shaExposed: Boolean(health.data?.gitSha || health.data?.commit || health.data?.sha),
    }),
  );

  const erasureRoute = await httpRequest(apiBase, "/api/privacy/erasure-requests", {
    method: "POST",
    body: {},
  });
  probes.push(
    probe("erasure_route", isPresentRouteStatus(erasureRoute.status), {
      status: erasureRoute.status,
      code: erasureRoute.data?.code,
    }),
  );

  const revokeRoute = await httpRequest(apiBase, "/api/auth/revoke-all", { method: "POST", body: {} });
  probes.push(
    probe("revoke_all_route", isPresentRouteStatus(revokeRoute.status), {
      status: revokeRoute.status,
    }),
  );

  const studentsUnauth = await httpRequest(apiBase, "/api/students");
  const auditUnauth = await httpRequest(apiBase, "/api/audit");
  probes.push(probe("students_unauth", studentsUnauth.status === 401, { status: studentsUnauth.status }));
  probes.push(probe("audit_unauth", auditUnauth.status === 401, { status: auditUnauth.status }));

  if (webBase) {
    const legal = await probeLegalPages(webBase);
    probes.push(probe("legal_confidentialite", legal.page.status === 200, { status: legal.page.status }));
    probes.push(probe("legal_suppression", legal.deletion.status === 200, { status: legal.deletion.status }));
    probes.push(
      probe("legal_copy", legal.findings.hasOregon && legal.findings.hasOperator && legal.findings.hasContact, {
        chunk: legal.chunkName,
        hasOregon: legal.findings.hasOregon,
        hasOperator: legal.findings.hasOperator,
      }),
    );
    probes.push(
      probe("legal_no_internal_paths", legal.findings.internalPaths.length === 0, {
        internalPaths: legal.findings.internalPaths,
      }),
    );
  } else {
    probes.push(probe("legal_confidentialite", true, { skipped: "web_url_absent" }));
    residual.push("pages légales HTTP non sondées (pas d’URL web)");
  }

  async function assertPlatformDeny(label, session) {
    if (!session?.accessToken) {
      probes.push(probe(`${label}_students_403`, true, { skipped: "credentials_absent" }));
      probes.push(probe(`${label}_audit_403`, true, { skipped: "credentials_absent" }));
      residual.push(`${label}: credentials absents — 403 non prouvé en live`);
      return;
    }
    const schoolCode = creds.school?.schoolCode || "CD-2026-0001";
    const students = await httpRequest(apiBase, `/api/students?schoolCode=${encodeURIComponent(schoolCode)}`, {
      token: session.accessToken,
    });
    const audit = await httpRequest(apiBase, `/api/audit?schoolCode=${encodeURIComponent(schoolCode)}`, {
      token: session.accessToken,
    });
    probes.push(probe(`${label}_students_403`, students.status === 403, { status: students.status }));
    probes.push(probe(`${label}_audit_403`, audit.status === 403, { status: audit.status }));
  }

  const superSession = creds.superadmin.identifier ? await login(apiBase, creds.superadmin) : null;
  if (superSession?.error) {
    probes.push(probe("superadmin_login", false, { status: superSession.error.status }));
  } else {
    await assertPlatformDeny("superadmin", superSession);
  }

  const countrySession = creds.country.identifier ? await login(apiBase, creds.country) : null;
  if (countrySession?.error) {
    probes.push(probe("country_admin_login", false, { status: countrySession.error.status }));
  } else {
    await assertPlatformDeny("country_admin", countrySession);
  }

  let schoolSession = creds.school.identifier ? await login(apiBase, creds.school) : null;
  if (schoolSession?.error) {
    probes.push(probe("school_admin_login", false, { status: schoolSession.error.status }));
    schoolSession = null;
  } else if (!schoolSession?.accessToken) {
    probes.push(probe("school_admin_students", true, { skipped: "credentials_absent" }));
    residual.push("Admin School: credentials absents — parcours nominal non prouvé en live");
  } else {
    const students = await httpRequest(apiBase, "/api/students", { token: schoolSession.accessToken });
    probes.push(
      probe("school_admin_students", students.status !== 403 && students.status < 500, {
        status: students.status,
      }),
    );
  }

  if (schoolSession?.refreshToken) {
    const rotated = await httpRequest(apiBase, "/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: schoolSession.refreshToken },
    });
    const rotatedOk =
      rotated.status === 200 &&
      rotated.data?.refreshToken &&
      rotated.data.refreshToken !== schoolSession.refreshToken;
    probes.push(probe("refresh_rotation", rotatedOk, { status: rotated.status }));

    const raced = await httpRequest(apiBase, "/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: schoolSession.refreshToken },
    });
    const graceOk =
      raced.status === 200 && rotated.data?.refreshToken && raced.data?.refreshToken === rotated.data.refreshToken;
    probes.push(probe("refresh_grace", graceOk, { status: raced.status }));

    if (applyReuse) {
      await wait(16_000);
      const replay = await httpRequest(apiBase, "/api/auth/refresh", {
        method: "POST",
        body: { refreshToken: schoolSession.refreshToken },
      });
      probes.push(
        probe("refresh_reuse", replay.status === 401 && replay.data?.code === "REFRESH_REUSE_DETECTED", {
          status: replay.status,
          code: replay.data?.code,
        }),
      );
    } else {
      probes.push(probe("refresh_reuse", true, { skipped: "non_destructive_default" }));
      residual.push("refresh hors grâce non exécuté (ajouter --apply-reuse)");
    }
  } else {
    probes.push(probe("refresh_rotation", true, { skipped: "credentials_absent" }));
    probes.push(probe("refresh_grace", true, { skipped: "credentials_absent" }));
    probes.push(probe("refresh_reuse", true, { skipped: "credentials_absent" }));
  }

  if (applyErasure) {
    const identifier = env("SOMAFRIK_PREPROD_ERASURE_IDENTIFIER") || (local ? "secretaire" : "");
    const schoolCode = env("SOMAFRIK_PREPROD_ERASURE_SCHOOL_CODE") || creds.school.schoolCode;
    const blocked = ["superadmin", "admin-rdc", creds.school.identifier, creds.superadmin.identifier]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    if (!identifier || blocked.includes(identifier.toLowerCase())) {
      probes.push(probe("erasure_execute", false, { reason: "identifiant recette manquant ou protégé" }));
    } else if (!schoolSession?.accessToken) {
      probes.push(probe("erasure_execute", false, { reason: "admin établissement requis" }));
    } else {
      const created = await httpRequest(apiBase, "/api/privacy/erasure-requests", {
        method: "POST",
        body: { schoolCode, identifier, reason: "preuve préprod #503" },
      });
      const requestId = created.data?.requestCode || created.data?.id;
      const executed = requestId
        ? await httpRequest(apiBase, `/api/privacy/erasure-requests/${encodeURIComponent(requestId)}/execute`, {
            method: "POST",
            token: schoolSession.accessToken,
          })
        : { status: 0, data: null };
      const reconnect = await httpRequest(apiBase, "/api/backoffice/login", {
        method: "POST",
        body: {
          identifier,
          password: env("SOMAFRIK_PREPROD_ERASURE_PASSWORD") || (local ? "1234" : ""),
          schoolCode,
        },
      });
      probes.push(
        probe("erasure_execute", executed.status === 200 && reconnect.status !== 200, {
          createStatus: created.status,
          executeStatus: executed.status,
          reconnectStatus: reconnect.status,
          identifier: identifier.slice(0, 3) + "…",
        }),
      );
    }
  } else {
    probes.push(probe("erasure_execute", true, { skipped: "non_destructive_default" }));
    residual.push("effacement recette non exécuté (ajouter --apply-erasure + identifiant recette)");
  }

  return { probes, residual };
}

async function main() {
  const local = argvFlag("--local");
  const applyReuse = argvFlag("--apply-reuse") || env("SOMAFRIK_PREPROD_APPLY_REUSE") === "1";
  const applyErasure = argvFlag("--apply-erasure") || env("SOMAFRIK_PREPROD_APPLY_ERASURE") === "1";
  const outPath = env("SOMAFRIK_PREPROD_REPORT") || (argvFlag("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "");

  let apiBase = env("SOMAFRIK_PREPROD_API_URL", local ? `http://127.0.0.1:${LOCAL_PORT}` : DEFAULT_API);
  let webBase = env("SOMAFRIK_PREPROD_WEB_URL", local ? "" : DEFAULT_WEB);
  if (apiBase.endsWith("/api")) apiBase = apiBase.slice(0, -4);
  webBase = webBase.replace(/\/$/, "");

  assertNotProductionUrl(apiBase, "API");
  if (webBase) assertNotProductionUrl(webBase, "Web");

  const creds = local
    ? {
        superadmin: { identifier: "superadmin", password: "1234" },
        country: { identifier: "admin-rdc", password: "1234" },
        school: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
      }
    : {
        superadmin: credsFromEnv("SOMAFRIK_PREPROD_SUPERADMIN"),
        country: credsFromEnv("SOMAFRIK_PREPROD_COUNTRY"),
        school: {
          ...credsFromEnv("SOMAFRIK_PREPROD_SCHOOL"),
          schoolCode: env("SOMAFRIK_PREPROD_SCHOOL_CODE") || env("SOMAFRIK_PREPROD_SCHOOL_SCHOOL_CODE"),
        },
      };

  let child = null;
  if (local) {
    child = spawn("node", ["backend/scripts/dev-memory.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(LOCAL_PORT),
        NODE_ENV: "development",
        SOMAFRIK_DB_REQUIRED: "false",
        DATABASE_URL: "",
        SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
        JWT_ACCESS_TTL_SECONDS: "900",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const candidateSha = env("SOMAFRIK_PREPROD_CANDIDATE_SHA") || gitHead();
  const renderApiSha = env("RENDER_API_DEPLOYED_SHA");
  const renderWebSha = env("RENDER_WEB_DEPLOYED_SHA");

  try {
    if (local) await waitForHealth(child, apiBase);
    const { probes, residual } = await runProbes({
      apiBase,
      webBase,
      local,
      applyReuse,
      applyErasure,
      creds,
    });
    const failed = probes.filter((row) => row.ok === false);
    const report = redactValue({
      ok: failed.length === 0,
      mode: local ? "local" : "remote",
      destructive: { reuse: applyReuse, erasure: applyErasure },
      candidateSha,
      render: {
        apiSha: renderApiSha || null,
        webSha: renderWebSha || null,
        match:
          renderApiSha && renderWebSha && candidateSha && renderApiSha === renderWebSha && renderApiSha === candidateSha
            ? "match"
            : "unknown",
        note: "Le /api/health public n’expose pas le SHA Render. Coller les SHA dashboard ops.",
      },
      probes,
      residual,
      generatedAt: new Date().toISOString(),
    });

    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);
    if (outPath) {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.writeFileSync(path.resolve(outPath), json);
    }
    if (!report.ok) process.exit(1);
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await wait(300);
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || null }));
  process.exit(1);
});
