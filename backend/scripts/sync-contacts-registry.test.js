"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  REMOVAL_MESSAGE,
  assertSyncContactsRegistryRemoved,
} = require("./sync-contacts-registry");

test("le script CLI refuse d'exécuter toute synchronisation", () => {
  const script = path.join(__dirname, "sync-contacts-registry.js");
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /INTERDIT/);
  assert.match(`${result.stderr}${result.stdout}`, /backoffice_state/);
  assert.doesNotMatch(`${result.stderr}${result.stdout}`, /Synchronisation Contacts terminée/);
});

test("assertSyncContactsRegistryRemoved lève SYNC_CONTACTS_REMOVED", () => {
  assert.throws(() => assertSyncContactsRegistryRemoved(), (error) => {
    assert.equal(error.code, "SYNC_CONTACTS_REMOVED");
    assert.equal(error.message, REMOVAL_MESSAGE);
    return true;
  });
});

test("package.json n'expose plus db:sync-contacts", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
  assert.equal(pkg.scripts["db:sync-contacts"], undefined);
});

test("le tombstone ne contient plus de DELETE métier ni d'UPSERT snapshot", () => {
  const source = fs.readFileSync(path.join(__dirname, "sync-contacts-registry.js"), "utf8");
  assert.doesNotMatch(source, /DELETE FROM attendance/i);
  assert.doesNotMatch(source, /DELETE FROM students/i);
  assert.doesNotMatch(source, /INSERT INTO backoffice_state/i);
  assert.doesNotMatch(source, /purgePostgresOrphans/);
});
