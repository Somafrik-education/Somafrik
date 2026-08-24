"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PostgresRepository } = require("../db/postgresRepository");
const { initializeRepository } = require("../db/repositoryFactory");

function extractAsyncMethod(source, methodName) {
  const start = source.indexOf(`async ${methodName}(`);
  assert.ok(start >= 0, methodName);
  const next = source.slice(start + 1).search(/\n  async [A-Za-z0-9_]+\(/);
  return next >= 0 ? source.slice(start, start + 1 + next) : source.slice(start);
}

describe("J2A — plus d'import backoffice_state au boot", () => {
  const source = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");

  it("init et ensureNotesCanonicalPersistence n'appellent plus les migrations JSON", () => {
    const initSource = extractAsyncMethod(source, "init");
    const ensureSource = extractAsyncMethod(source, "ensureNotesCanonicalPersistence");
    assert.doesNotMatch(initSource, /migrateEvaluationsFromBackOffice/);
    assert.doesNotMatch(initSource, /migrateNotesFromBackOffice/);
    assert.doesNotMatch(ensureSource, /migrateEvaluationsFromBackOffice/);
    assert.doesNotMatch(ensureSource, /migrateNotesFromBackOffice/);
  });

  it("les méthodes legacy sont des tombstones fail-closed, sans SELECT snapshot", () => {
    for (const methodName of ["migrateEvaluationsFromBackOffice", "migrateNotesFromBackOffice"]) {
      const body = extractAsyncMethod(source, methodName);
      assert.doesNotMatch(body, /SELECT\s+state_payload/i);
      assert.doesNotMatch(body, /upsertEvaluationFromLegacy/);
      assert.doesNotMatch(body, /upsertGrade\(/);
      assert.match(body, /LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED/);
    }
  });

  it("un appel direct lève LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED", async () => {
    const repo = Object.create(PostgresRepository.prototype);
    await assert.rejects(
      () => repo.migrateEvaluationsFromBackOffice(),
      (error) => error.code === "LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED",
    );
    await assert.rejects(
      () => repo.migrateNotesFromBackOffice(),
      (error) => error.code === "LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED",
    );
  });

  it("initializeRepository conserve le tombstone fail-closed", async () => {
    const factory = fs.readFileSync(path.join(__dirname, "../db/repositoryFactory.js"), "utf8");
    assert.doesNotMatch(factory, /async\s*\(\)\s*=>\s*undefined/);

    const repository = Object.create(PostgresRepository.prototype);
    repository.engine = "postgresql";
    repository.init = async () => undefined;
    repository.query = async () => ({ rows: [], rowCount: 0 });

    const { repository: active } = await initializeRepository({
      repository,
      required: true,
      logger: { warn() {}, error() {} },
      env: {
        NODE_ENV: "production",
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        DB_HOST: "db.example.com",
        DB_PORT: "5432",
        DB_NAME: "somafrik",
        DB_USER: "somafrik_app",
        DB_PASSWORD: "unit-test-password-value",
        DB_SSL: "require",
      },
    });

    await assert.rejects(
      () => active.migrateEvaluationsFromBackOffice(),
      (error) => error.code === "LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED",
    );
    await assert.rejects(
      () => active.migrateNotesFromBackOffice(),
      (error) => error.code === "LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED",
    );
  });
});
