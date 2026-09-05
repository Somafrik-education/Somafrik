"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertNotProductionUrl,
  redactValue,
  findLegalChunkName,
  legalPageFindings,
  isPresentRouteStatus,
} = require("./preprod503Probe");

test("refuse les URL de production", () => {
  assert.throws(() => assertNotProductionUrl("https://api.somafrik.app/api/health"), (error) => error.code === "PREPROD_PRODUCTION_URL");
  assert.throws(() => assertNotProductionUrl("https://somafrik.app/confidentialite"), (error) => error.code === "PREPROD_PRODUCTION_URL");
  assert.equal(assertNotProductionUrl("https://somafrik-api-preprod.onrender.com/api/health"), "somafrik-api-preprod.onrender.com");
  assert.equal(assertNotProductionUrl("https://preprod.somafrik.app/confidentialite"), "preprod.somafrik.app");
});

test("masque jetons et mots de passe", () => {
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  const redacted = redactValue({ accessToken: token, password: "s3cret!", nested: { refreshToken: token } });
  assert.equal(redacted.password, "s3…t!");
  assert.doesNotMatch(JSON.stringify(redacted), /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
});

test("détecte le chunk légal et refuse les chemins internes", () => {
  const chunkName = findLegalChunkName('import("./LegalPages-D7LM86qb.js")');
  assert.equal(chunkName, "LegalPages-D7LM86qb.js");
  const ok = legalPageFindings("<div></div>", "Oregon Baudouin Okito contact@somafrik.app");
  assert.equal(ok.hasOregon, true);
  assert.equal(ok.hasOperator, true);
  assert.deepEqual(ok.internalPaths, []);
  const leak = legalPageFindings("", "voir backend/db/postgresRepository.js");
  assert.ok(leak.internalPaths.includes("backend/"));
  assert.ok(leak.internalPaths.includes("postgresRepository"));
});

test("route présente = tout sauf 404 / 0", () => {
  assert.equal(isPresentRouteStatus(400), true);
  assert.equal(isPresentRouteStatus(401), true);
  assert.equal(isPresentRouteStatus(201), true);
  assert.equal(isPresentRouteStatus(404), false);
  assert.equal(isPresentRouteStatus(0), false);
});
