"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UnsafeTestDatabaseError,
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
} = require("./disposableTestDatabaseGuard");

const LOCAL = "postgresql://u@localhost:5432/somafrik";

test("SEC-AUTH-03 — garde : instances locales acceptées", () => {
  for (const url of [LOCAL, "postgres://u@127.0.0.1:5432/x", "postgresql://u@[::1]:5432/x"]) {
    assert.equal(assertDisposableLocalDatabaseUrl(url, {}), true, url);
  }
});

test("SEC-AUTH-03 — garde : bases distantes, partagées ou fournisseurs refusées", () => {
  for (const url of [
    "postgresql://u@dpg-abc.frankfurt-postgres.render.com:5432/db",
    "postgresql://u@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://u@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    "postgresql://u@ep-x.neon.tech/db",
    "postgresql://u@x.rds.amazonaws.com:5432/db",
    "postgresql://u@10.0.0.5:5432/db",
    "postgresql://u@postgres.internal:5432/db",
    "mysql://u@localhost/db",
    "postgresql://u@/x?host=/var/run/postgresql",
    "postgresql://u@localhost:5432/db?host=db.fictif.example.org",
    "postgresql://u@localhost:5432/db?hostaddr=10.0.0.9",
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
  // Service Docker publié sur localhost (CI) : adresse de pont privée acceptée.
  assert.equal(await assertConnectedToDisposableDatabase(pool("it_db", "172.18.0.2"), "it_db"), true);
  for (const publicAddr of ["8.8.8.8", "34.120.1.2", "172.32.0.1", "2001:db8::1"]) {
    await assert.rejects(() => assertConnectedToDisposableDatabase(pool("it_db", publicAddr), "it_db"), UnsafeTestDatabaseError, publicAddr);
  }
});
