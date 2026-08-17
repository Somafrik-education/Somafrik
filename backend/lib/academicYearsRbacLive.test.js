"use strict";

/**
 * Socle academic_years — routes v2 autorisées uniquement par le module live
 * Années Académiques (CREATE/READ/UPDATE), plus Gérer classes ni COUNTRY_PRIVILEGES.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RbacService, routePermissions } = require("../services/rbacService");

const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const rbac = new RbacService({ rolePermissions: {} });

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `bloc introuvable: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end >= 0 ? end : start + 2500);
}

test("contrat source : GET/POST/PATCH academic-years passent par requirePermission", () => {
  const getBlock = sliceFrom(serverSrc, 'app.get("/api/v2/academic-years"', 'app.post("/api/v2/academic-years"');
  assert.match(getBlock, /requirePermission\("GET \/api\/v2\/academic-years"\)/);
  const postBlock = sliceFrom(serverSrc, 'app.post("/api/v2/academic-years"', 'app.patch("/api/v2/academic-years/:id"');
  assert.match(postBlock, /requirePermission\("POST \/api\/v2\/academic-years"\)/);
  const patchBlock = sliceFrom(serverSrc, 'app.patch("/api/v2/academic-years/:id"', 'app.get("/api/v2/exams"');
  assert.match(patchBlock, /requirePermission\("PATCH \/api\/v2\/academic-years\/:id"\)/);
});

test("routePermissions academic-years : module live, sans Gérer classes", () => {
  assert.deepEqual(routePermissions["GET /api/v2/academic-years"], [
    "Années Académiques:READ",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["POST /api/v2/academic-years"], [
    "Années Académiques:CREATE",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["PATCH /api/v2/academic-years/:id"], [
    "Années Académiques:UPDATE",
    "ALL_PRIVILEGES",
  ]);
  for (const key of [
    "GET /api/v2/academic-years",
    "POST /api/v2/academic-years",
    "PATCH /api/v2/academic-years/:id",
  ]) {
    assert.equal(routePermissions[key].includes("Gérer classes"), false, key);
    assert.equal(routePermissions[key].includes("COUNTRY_PRIVILEGES"), false, key);
    assert.equal(routePermissions[key].includes("Valider années académiques"), false, key);
    assert.equal(routePermissions[key].includes("Gérer planning académique"), false, key);
  }
});

test("Gérer classes / COUNTRY_PRIVILEGES n'autorisent plus academic-years", () => {
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Gérer classes"] }, "POST /api/v2/academic-years"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Classes:CREATE"] }, "POST /api/v2/academic-years"),
    false,
  );
  assert.ok(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Années Académiques:CREATE"] },
      "POST /api/v2/academic-years",
    ),
  );
  assert.equal(
    rbac.canAccess({ role: "Admin Pays", permissions: ["COUNTRY_PRIVILEGES"] }, "GET /api/v2/academic-years"),
    false,
  );
  assert.ok(
    rbac.canAccess(
      { role: "Préfet des études", permissions: ["Années Académiques:READ"] },
      "GET /api/v2/academic-years",
    ),
  );
  assert.equal(
    rbac.canAccess(
      { role: "Préfet des études", permissions: ["Années Académiques:READ"] },
      "POST /api/v2/academic-years",
    ),
    false,
  );
  assert.ok(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Années Académiques:UPDATE"] },
      "PATCH /api/v2/academic-years/:id",
    ),
  );
});
