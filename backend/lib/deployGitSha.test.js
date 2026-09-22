"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { readDeployGitSha, withDeployGitSha } = require("./deployGitSha");

const SHA = "a853c3776d5b61a0b565929e6023396e202fad55";

test("gitSha est null hors Render ou si la valeur n'est pas un SHA complet", () => {
  assert.equal(readDeployGitSha({}), null);
  assert.equal(readDeployGitSha({ RENDER_GIT_COMMIT: "" }), null);
  assert.equal(readDeployGitSha({ RENDER_GIT_COMMIT: "   " }), null);
  assert.equal(readDeployGitSha({ RENDER_GIT_COMMIT: SHA.slice(0, 7) }), null);
  assert.equal(readDeployGitSha({ RENDER_GIT_COMMIT: "not-a-full-git-sha" }), null);
  assert.equal(readDeployGitSha({ DATABASE_URL: "db-marker-not-a-commit" }), null);
  assert.equal(readDeployGitSha({ RENDER_GIT_COMMIT: SHA.toUpperCase() }), SHA);
});

test("withDeployGitSha ajoute uniquement gitSha", () => {
  const payload = withDeployGitSha(
    {
      status: "ok",
      database: "postgresql",
      version: "1.0.0",
      attachments: { ready: true, writable: true },
      reportCardSource: { ready: false, writable: false },
    },
    { RENDER_GIT_COMMIT: SHA, DATABASE_URL: "db-marker-not-exposed", HOSTNAME: "host-marker-not-exposed" },
  );
  assert.equal(payload.gitSha, SHA);
  assert.equal(payload.status, "ok");
  assert.equal(payload.attachments.ready, true);
  assert.equal(payload.reportCardSource.writable, false);
  assert.equal(Object.hasOwn(payload, "hostname"), false);
  assert.doesNotMatch(JSON.stringify(payload), /db-marker-not-exposed|host-marker-not-exposed|DATABASE_URL|HOSTNAME/);
});

test("HTTP /api/health expose gitSha null sans RENDER_GIT_COMMIT", async () => {
  const body = await fetchHealth(withDeployGitSha({
    status: "not_ready",
    database: "postgresql",
    version: "1.0.0",
    timestamp: "2026-09-22T00:00:00.000Z",
    attachments: { ready: false, writable: false },
    reportCardSource: { ready: true, writable: true },
  }, {}));
  assert.equal(body.status, "not_ready");
  assert.equal(body.gitSha, null);
  assert.equal(body.attachments.ready, false);
  assert.equal(body.reportCardSource.ready, true);
});

test("HTTP /api/health expose le SHA Render et rien d'autre", async () => {
  const body = await fetchHealth(withDeployGitSha({
    status: "ok",
    database: "postgresql",
    version: "1.0.0",
    timestamp: "2026-09-22T00:00:00.000Z",
    attachments: { ready: true, writable: true },
    reportCardSource: { ready: true, writable: true },
  }, {
    RENDER_GIT_COMMIT: SHA,
    DATABASE_URL: "db-marker-not-exposed",
    HOSTNAME: "host-marker-not-exposed",
  }));
  assert.equal(body.gitSha, SHA);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.attachments, { ready: true, writable: true });
  assert.deepEqual(body.reportCardSource, { ready: true, writable: true });
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /db-marker-not-exposed|host-marker-not-exposed|DATABASE_URL|HOSTNAME/);
});

test("GET /api/health réel délègue gitSha sans élargir le contrat", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf('app.get("/api/health"');
  const end = source.indexOf("app.post(", start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /withDeployGitSha\(/);
  assert.match(handler, /status: ready \? "ok" : "not_ready"/);
  assert.match(handler, /attachments,/);
  assert.match(handler, /reportCardSource,/);
  assert.match(handler, /res\.status\(503\)\.json\(payload\)/);
  assert.match(handler, /res\.json\(payload\)/);
  assert.doesNotMatch(handler, /RENDER_GIT_COMMIT|DATABASE_URL|hostname|process\.env\.(?!npm_package_version)/);
  assert.match(source, /require\("\.\/lib\/deployGitSha"\)/);
});

function fetchHealth(payload) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url !== "/api/health") {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = payload.status === "ok" ? 200 : 503;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    });
    server.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        assert.equal(response.status, payload.status === "ok" ? 200 : 503);
        resolve(await response.json());
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}
