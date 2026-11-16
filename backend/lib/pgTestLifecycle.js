"use strict";

/**
 * MONO-T0 — cycle de vie des tests PostgreSQL qui lancent `backend/server.js`.
 *
 * Code de test uniquement (aucun module de production ne l'importe).
 *
 * - stopChildProcess : arrête réellement le serveur enfant. Un processus tué par
 *   signal a `exitCode === null` et `signalCode` renseigné : il est bien
 *   considéré comme arrêté. Après SIGKILL, on attend encore l'événement `exit`.
 * - waitForNoDatabaseSessions : attend qu'aucune session (autre que la
 *   requête de contrôle) ne reste ouverte sur une base. `pool.end()` rend la
 *   main avant que PostgreSQL ait fermé les sessions côté serveur ; enchaîner
 *   une DDL ou un `DROP DATABASE … WITH (FORCE)` peut alors interbloquer ou
 *   terminer ces sessions (40P01 / 57P01).
 */

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopChildProcess(child, { graceMs = 5000, killMs = 5000 } = {}) {
  if (!child || hasExited(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs).unref()),
  ]);
  if (graceful || hasExited(child)) return;
  child.kill("SIGKILL");
  const killed = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), killMs).unref()),
  ]);
  if (!killed && !hasExited(child)) {
    throw new Error(`processus enfant ${child.pid} toujours actif après SIGKILL`);
  }
}

/**
 * @param {{ query: Function }} adminPool pool connecté à une AUTRE base (ex. postgres)
 *   ou à la base cible ; la session de contrôle elle-même est exclue.
 * @param {string} databaseName
 * @param {{ timeoutMs?: number, intervalMs?: number, ignoreApplicationName?: string }} options
 * @returns {Promise<number>} nombre de sessions restantes (0 si la base est libre).
 */
async function waitForNoDatabaseSessions(
  adminPool,
  databaseName,
  { timeoutMs = 10_000, intervalMs = 100, ignoreApplicationName = null } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await adminPool.query(
      `SELECT COUNT(*)::int AS n
         FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
          AND ($2::text IS NULL OR application_name IS DISTINCT FROM $2::text)`,
      [databaseName, ignoreApplicationName],
    );
    const remaining = result.rows[0].n;
    if (remaining === 0 || Date.now() >= deadline) return remaining;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = { hasExited, stopChildProcess, waitForNoDatabaseSessions };
