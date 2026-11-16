"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { hasExited, stopChildProcess, waitForNoDatabaseSessions } = require("./pgTestLifecycle");

function spawnNode(source) {
  return spawn(process.execPath, ["-e", source], { stdio: "ignore" });
}

test("stopChildProcess : arrête un enfant par SIGTERM et attend sa sortie", async () => {
  const child = spawnNode("setInterval(() => {}, 1000)");
  await stopChildProcess(child);
  assert.ok(hasExited(child));
  assert.equal(child.signalCode, "SIGTERM");
});

test("stopChildProcess : enfant qui ignore SIGTERM ⇒ SIGKILL, puis sortie attendue", async () => {
  const child = spawnNode("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await stopChildProcess(child, { graceMs: 200 });
  assert.ok(hasExited(child));
  assert.equal(child.signalCode, "SIGKILL");
});

test("stopChildProcess : un enfant déjà tué par signal est considéré comme arrêté (pas d'attente)", async () => {
  const child = spawnNode("setInterval(() => {}, 1000)");
  await stopChildProcess(child);
  const started = Date.now();
  await stopChildProcess(child);
  assert.ok(Date.now() - started < 500, "aucune attente de 5 s sur un processus déjà arrêté");
  await stopChildProcess(null);
});

test("waitForNoDatabaseSessions : attend la fermeture des sessions, puis renvoie 0", async () => {
  const counts = [2, 1, 0];
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push(params);
      return { rows: [{ n: counts.shift() }] };
    },
  };
  assert.equal(await waitForNoDatabaseSessions(pool, "db_test", { intervalMs: 1, ignoreApplicationName: "probe" }), 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ["db_test", "probe"]);
});

test("waitForNoDatabaseSessions : délai dépassé ⇒ renvoie le nombre de sessions restantes", async () => {
  const pool = { query: async () => ({ rows: [{ n: 3 }] }) };
  assert.equal(await waitForNoDatabaseSessions(pool, "db_test", { timeoutMs: 20, intervalMs: 5 }), 3);
});
