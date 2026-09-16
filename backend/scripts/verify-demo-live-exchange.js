"use strict";

const assert = require("node:assert/strict");

const API_ORIGIN = String(process.env.DEMO_LIVE_API_ORIGIN || "https://api-demo.somafrik.app").replace(/\/$/, "");
const WEB_ORIGIN = String(process.env.DEMO_LIVE_WEB_ORIGIN || "https://demo.somafrik.app").replace(/\/$/, "");

async function jsonRequest(url, init, timeoutMs = 15000) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, elapsedMs: Date.now() - startedAt };
}

function countPayload(body) {
  if (Array.isArray(body)) return body.length;
  if (!body || typeof body !== "object") return null;
  for (const key of [
    "items",
    "rows",
    "users",
    "students",
    "teachers",
    "classes",
    "payments",
    "studentFees",
    "presences",
    "notes",
    "evaluations",
    "exams",
    "bulletins",
    "documents",
    "messages",
    "courseSchedules",
    "assignments",
  ]) {
    if (Array.isArray(body[key])) return body[key].length;
  }
  return null;
}

async function main() {
  const health = await jsonRequest(`${API_ORIGIN}/api/health`, { method: "GET" });
  assert.equal(health.response.status, 200, `health=${health.response.status}`);

  const create = await jsonRequest(`${API_ORIGIN}/api/public/demo-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: "direction",
      discoveryRole: "decider",
      countryIso: "CD",
      organizationName: "CI live exchange probe",
      website: "",
    }),
  });
  assert.equal(create.response.status, 201, `create=${create.response.status} ${JSON.stringify(create.body)}`);
  assert.ok(create.body?.redirectUrl, "redirectUrl absent");

  const redirect = new URL(create.body.redirectUrl);
  const code = redirect.searchParams.get("code");
  assert.ok(code, "code absent");

  const exchange = await jsonRequest(`${API_ORIGIN}/api/demo/exchange`, {
    method: "POST",
    headers: {
      Origin: WEB_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });

  const user = exchange.body?.user || {};
  const school = exchange.body?.school || {};
  const evidence = {
    exchangeStatus: exchange.response.status,
    demo: exchange.body?.demo === true,
    hasAccessToken: Boolean(exchange.body?.accessToken),
    user: {
      schoolId: user.schoolId || null,
      schoolPublicCode: user.schoolPublicCode || null,
      schoolCode: user.schoolCode || null,
    },
    school: {
      id: school.id || null,
      loginCode: school.loginCode || school.publicId || null,
      code: school.code || school.schoolCode || null,
    },
  };

  console.log(`DEMO_LIVE_EXCHANGE ${JSON.stringify(evidence)}`);

  assert.equal(exchange.response.status, 200, `exchange=${exchange.response.status}`);
  assert.equal(exchange.body?.demo, true, "demo=true absent");
  assert.ok(exchange.body?.accessToken, "accessToken absent");
  assert.ok(user.schoolId, "user.schoolId absent du live /api/demo/exchange");
  assert.ok(user.schoolPublicCode, "user.schoolPublicCode absent du live /api/demo/exchange");
  assert.ok(user.schoolCode, "user.schoolCode absent du live /api/demo/exchange");

  const headers = {
    Origin: WEB_ORIGIN,
    Authorization: `Bearer ${exchange.body.accessToken}`,
  };
  const schoolCode = encodeURIComponent(String(user.schoolCode));
  const probes = [
    // Users first: measure its own latency without the known-heavy establishment snapshot in front of it.
    ["users", "/api/backoffice/users", 30000],
    ["students", "/api/students", 8000],
    ["teachers", "/api/teachers", 8000],
    ["classes", "/api/classes", 8000],
    ["payments", "/api/payments", 8000],
    ["studentFees", "/api/finance/student-fees", 8000],
    ["presences", "/api/presences", 8000],
    ["notes", "/api/notes", 8000],
    ["evaluations", "/api/evaluations", 8000],
    ["exams", "/api/exams", 8000],
    ["bulletins", "/api/report-cards", 8000],
    ["documents", "/api/school-documents", 8000],
    ["messages", "/api/backoffice/messages", 8000],
    ["courseSchedules", "/api/course-schedules", 8000],
    ["assignments", "/api/assignments", 8000],
    // School last so its slow legacy snapshot cannot contaminate measurements above.
    ["school", `/api/backoffice/establishments/${schoolCode}`, 30000],
  ];

  const domainEvidence = {};
  for (const [label, pathname, timeoutMs] of probes) {
    try {
      const result = await jsonRequest(`${API_ORIGIN}${pathname}`, { headers }, timeoutMs);
      domainEvidence[label] = {
        status: result.response.status,
        elapsedMs: result.elapsedMs,
        count: countPayload(result.body),
        bodyType: Array.isArray(result.body) ? "array" : typeof result.body,
        keys:
          result.body && typeof result.body === "object" && !Array.isArray(result.body)
            ? Object.keys(result.body).slice(0, 8)
            : [],
      };
    } catch (error) {
      domainEvidence[label] = {
        status: "network-error",
        elapsedMs: null,
        count: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    console.log(`DEMO_LIVE_DOMAIN ${label} ${JSON.stringify(domainEvidence[label])}`);
  }

  for (const label of ["users", "students", "teachers", "classes", "payments", "presences", "notes"]) {
    assert.equal(domainEvidence[label]?.status, 200, `${label} live doit répondre 200`);
    assert.ok((domainEvidence[label]?.count ?? 0) > 0, `${label} live doit contenir des données`);
  }

  console.log("OK verify-demo-live-exchange");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
