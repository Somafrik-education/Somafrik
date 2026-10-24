"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UnsafeTestDatabaseError,
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
} = require("./disposableTestDatabaseGuard");

const LOCAL = "postgresql://u:p@localhost:5432/somafrik";

test("SEC-AUTH-03 — garde : instances locales acceptées", () => {
  for (const url of [LOCAL, "postgres://u:p@127.0.0.1:5432/x", "postgresql://u:p@[::1]:5432/x"]) {
    assert.equal(assertDisposableLocalDatabaseUrl(url, {}), true, url);
  }
});

test("SEC-AUTH-03 — garde : bases distantes, partagées ou fournisseurs refusées", () => {
  for (const url of [
    "postgresql://u:p@dpg-abc.frankfurt-postgres.render.com:5432/db",
    "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    "postgresql://u:p@ep-x.neon.tech/db",
    "postgresql://u:p@x.rds.amazonaws.com:5432/db",
    "postgresql://u:p@10.0.0.5:5432/db",
    "postgresql://u:p@postgres.internal:5432/db",
    "mysql://u:p@localhost/db",
    "postgresql://u@/x?host=/var/run/postgresql",
    "postgresql://u:p@localhost:5432/db?host=db.fictif.example.org",
    "postgresql://u:p@localhost:5432/db?hostaddr=10.0.0.9",
    "pas une url",
  ]) {
    assert.throws(() => assertDisposableLocalDatabaseUrl(url, {}), UnsafeTestDatabaseError, url);
  }
});

test("SEC-AUTH-03 — garde : environnements protégés refusés même en local", () => {
  for (const env of [{ NODE_ENV: "production" }, { APP_ENV: "preproduction" }, { APP_ENV: "production" }, { RENDER: "true" }]) {
    assert.throws(() => assertDisposableLocalDatabaseUrl(LOCAL, env), UnsafeTestDatabaseError, JSON.stringify(env));
  }
});

test("SEC-AUTH-03 — garde serveur : base dédiée et serveur local exigés", async () => {
  const pool = (db, addr) => ({ query: async () => ({ rows: [{ db, addr }] }) });
  assert.equal(await assertConnectedToDisposableDatabase(pool("it_db", "127.0.0.1"), "it_db"), true);
  assert.equal(await assertConnectedToDisposableDatabase(pool("it_db", null), "it_db"), true);
  await assert.rejects(() => assertConnectedToDisposableDatabase(pool("somafrik", "127.0.0.1"), "it_db"), UnsafeTestDatabaseError);
  await assert.rejects(() => assertConnectedToDisposableDatabase(pool("it_db", "10.1.2.3"), "it_db"), UnsafeTestDatabaseError);
});
