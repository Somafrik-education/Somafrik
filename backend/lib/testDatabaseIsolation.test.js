"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseLocalTestDatabaseUrl,
  withDatabaseName,
  quoteIdentifier,
  buildIsolatedDatabaseName,
} = require("../scripts/run-isolated-test-suite");

test("accepte uniquement une DATABASE_URL PostgreSQL locale", () => {
  const parsed = parseLocalTestDatabaseUrl(
    "postgresql://somafrik@localhost:5432/somafrik",
  );
  assert.equal(parsed.hostname, "localhost");
  assert.throws(
    () =>
      parseLocalTestDatabaseUrl(
        "postgresql://somafrik@preprod-db.example.com:5432/somafrik",
      ),
    /non locale refusée/,
  );
  assert.throws(
    () => parseLocalTestDatabaseUrl("https://localhost/somafrik"),
    /uniquement PostgreSQL/,
  );
});

test("refuse une URL sans base explicite", () => {
  assert.throws(
    () => parseLocalTestDatabaseUrl("postgresql://somafrik@localhost:5432/"),
    /base locale explicite/,
  );
});

test("construit une URL isolée sans changer l'hôte ni les credentials", () => {
  const url = withDatabaseName(
    "postgresql://somafrik@127.0.0.1:5432/somafrik?sslmode=disable",
    "somafrik_ci_123",
  );
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.username, "somafrik");
  assert.equal(parsed.pathname, "/somafrik_ci_123");
  assert.equal(parsed.searchParams.get("sslmode"), "disable");
});

test("génère un nom PostgreSQL éphémère sûr et borné", () => {
  const name = buildIsolatedDatabaseName({
    GITHUB_RUN_ID: "33335931444",
    GITHUB_JOB: "Risk-targeted avec espaces et / caractères",
  });
  assert.match(name, /^somafrik_ci_[a-z0-9_]+$/);
  assert.ok(name.length <= 63);
});

test("quote les identifiants SQL défensivement", () => {
  assert.equal(quoteIdentifier('db"name'), '"db""name"');
});
