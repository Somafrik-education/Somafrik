"use strict";

/** True when PostgreSQL killed the session via pg_terminate_backend (SQLSTATE 57P01). */
function isAdminTerminateError(error) {
  return /terminating connection due to administrator command/.test(String(error?.message || error || ""));
}

/**
 * The isolated-database helpers call pg_terminate_backend in `finally` so DROP DATABASE
 * can proceed. node-pg raises that FATAL on the client. Without a listener, Node treats
 * it as an uncaught exception and fails the test that is still inside cleanup.
 * Other connection errors still surface.
 */
function guardPgPool(pool) {
  if (!pool || typeof pool.on !== "function") return pool;
  const onError = (error) => {
    if (isAdminTerminateError(error)) return;
    throw error;
  };
  pool.on("error", onError);
  if (typeof pool.on === "function") {
    pool.on("connect", (client) => {
      if (client && typeof client.on === "function") client.on("error", onError);
    });
  }
  return pool;
}

module.exports = { guardPgPool, isAdminTerminateError };
