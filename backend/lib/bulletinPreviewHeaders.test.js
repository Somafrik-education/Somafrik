"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  BULLETIN_PREVIEW_HEADERS,
  BULLETIN_PREVIEW_RESPONSE_CSP,
  applyBulletinPreviewHeaders,
} = require("./bulletinPreviewHeaders");

test("SEC-XSS-01 — CSP de la réponse d'aperçu : sandbox, aucun script ni réseau", () => {
  const directives = BULLETIN_PREVIEW_RESPONSE_CSP.split(";").map((part) => part.trim());
  assert.equal(directives[0], "sandbox", "sandbox sans permission");
  for (const expected of [
    "default-src 'none'",
    "img-src data:",
    "font-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(directives.includes(expected), expected);
  }
  assert.doesNotMatch(BULLETIN_PREVIEW_RESPONSE_CSP, /allow-|script-src|unsafe-eval|https?:|\*/);
});

test("SEC-XSS-01 — en-têtes appliqués à la réponse", () => {
  const headers = {};
  applyBulletinPreviewHeaders({ setHeader: (name, value) => { headers[name] = value; } });
  assert.deepEqual(headers, { ...BULLETIN_PREVIEW_HEADERS });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Content-Type"], "text/html; charset=utf-8");
});

test("SEC-XSS-01 — la route d'aperçu utilise ces en-têtes, superadmin uniquement", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf('app.post("/api/backoffice/bulletin-design/preview"');
  assert.ok(start > 0);
  const route = src.slice(start, src.indexOf("}));", start));
  assert.match(route, /isSuperAdminPrincipal\(req\.principal\)/);
  assert.match(route, /applyBulletinPreviewHeaders\(res\)/);
  assert.doesNotMatch(route, /res\.setHeader\("Content-Type", "text\/html/);
});
