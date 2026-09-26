"use strict";

const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { guardPgPool } = require("./pgPoolGuard");

test("guardPgPool absorbe la coupure pg_terminate_backend sur le pool et le client", () => {
  const pool = new EventEmitter();
  const client = new EventEmitter();
  guardPgPool(pool);
  pool.emit("connect", client);
  const error = new Error("terminating connection due to administrator command");
  assert.doesNotThrow(() => {
    client.emit("error", error);
    pool.emit("error", error);
  });
});

test("guardPgPool propage une erreur de connexion autre", () => {
  const pool = new EventEmitter();
  guardPgPool(pool);
  assert.throws(
    () => pool.emit("error", new Error("password authentication failed")),
    /password authentication failed/,
  );
});
