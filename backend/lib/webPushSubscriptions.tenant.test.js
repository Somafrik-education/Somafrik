"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("SQL listActiveForUser Web Push filtre user_id + school_id + backend_environment", () => {
  const store = read("backend/db/webPushSubscriptionsStore.js");
  const pgList = store.slice(store.indexOf("async listActiveForUser"));
  const sqlBlock = pgList.slice(0, pgList.indexOf("async getByEndpoint"));
  assert.match(sqlBlock, /user_id\s*=\s*\$/);
  assert.match(sqlBlock, /school_id\s*=\s*\$/);
  assert.match(sqlBlock, /backend_environment\s*=\s*\$/);
  assert.match(sqlBlock, /revoked_at IS NULL/);
});

test("service refuse userId/schoolId client et exige l'école de session", () => {
  const service = read("backend/lib/webPushSubscriptionsService.js");
  assert.match(service, /Identité user\/school interdite depuis le client/);
  const upsert = service.slice(service.indexOf("async function upsertFromSession"));
  assert.match(upsert.slice(0, 900), /sessionSchoolId/);
  assert.match(upsert, /rejectClientIdentity/);
});
