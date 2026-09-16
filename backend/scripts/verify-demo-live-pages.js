"use strict";

const assert = require("node:assert/strict");

const API_ORIGIN = String(process.env.DEMO_LIVE_API_ORIGIN || "https://api-demo.somafrik.app").replace(/\/$/, "");
const WEB_ORIGIN = String(process.env.DEMO_LIVE_WEB_ORIGIN || "https://demo.somafrik.app").replace(/\/$/, "");

async function request(path, init = {}, timeoutMs = 45000) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
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
    return { status: response.status, elapsedMs: Date.now() - startedAt, body };
  } catch (error) {
    return {
      status: "network-error",
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      body: null,
    };
  }
}

function count(body) {
  if (Array.isArray(body)) return body.length;
  if (!body || typeof body !== "object") return null;
  for (const key of ["items", "rows", "users", "relations", "classes", "teachers", "courseSchedules", "bulletins"] ) {
    if (Array.isArray(body[key])) return body[key].length;
  }
  return null;
}

async function exchangeDemo() {
  const create = await request("/api/public/demo-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: "direction",
      discoveryRole: "decider",
      countryIso: "CD",
      organizationName: "CI page latency probe",
      website: "",
    }),
  }, 15000);
  assert.equal(create.status, 201, `create session=${create.status}`);
  const redirect = new URL(create.body.redirectUrl);
  const code = redirect.searchParams.get("code");
  assert.ok(code, "demo code absent");

  const exchange = await request("/api/demo/exchange", {
    method: "POST",
    headers: { Origin: WEB_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  }, 15000);
  assert.equal(exchange.status, 200, `exchange=${exchange.status}`);
  assert.ok(exchange.body?.accessToken, "accessToken absent");
  return exchange.body;
}

async function main() {
  const session = await exchangeDemo();
  const token = session.accessToken;
  const schoolCode = encodeURIComponent(String(session.user?.schoolCode || ""));
  const headers = { Origin: WEB_ORIGIN, Authorization: `Bearer ${token}` };

  const probes = {
    users: "/api/backoffice/users",
    relations: "/api/backoffice/relations",
    teachers: "/api/teachers",
    classes: "/api/classes",
    academicYears: "/api/v2/academic-years",
    educationCatalog: "/api/education-reference/catalog",
    assignments: "/api/assignments",
    courseSchedules: "/api/course-schedules",
    school: `/api/backoffice/establishments/${schoolCode}`,
  };

  const entries = await Promise.all(
    Object.entries(probes).map(async ([label, path]) => {
      const result = await request(path, { headers }, 45000);
      return [label, {
        status: result.status,
        elapsedMs: result.elapsedMs,
        count: count(result.body),
        keys: result.body && typeof result.body === "object" && !Array.isArray(result.body)
          ? Object.keys(result.body).slice(0, 10)
          : [],
        error: result.error || null,
      }];
    }),
  );

  const evidence = Object.fromEntries(entries);
  for (const [label, row] of Object.entries(evidence)) {
    console.log(`DEMO_PAGE_PROBE ${label} ${JSON.stringify(row)}`);
  }

  assert.equal(evidence.classes.status, 200, "classes doit répondre 200");
  assert.equal(evidence.teachers.status, 200, "teachers doit répondre 200");
  console.log("OK verify-demo-live-pages");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
