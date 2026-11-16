"use strict";

/**
 * SEC-AUTH-03 — garde des bancs d'intégration destructifs (DROP SCHEMA).
 *
 * Un banc ne réinitialise une base que si toutes les conditions sont réunies :
 * - hôte loopback (`localhost`, `127.0.0.1`, `::1`) ; toute URL non analysable
 *   (y compris la forme socket Unix sans hôte) est refusée ;
 * - aucun hôte de fournisseur (Render, Supabase, Neon, AWS, pooler…) ;
 * - environnement ni production, ni préproduction, ni service Render ;
 * - côté serveur, juste avant le DROP : base courante = base dédiée au banc,
 *   adresse du serveur loopback ou privée (conteneur local, ex. service
 *   Docker publié sur localhost en CI), ou connexion socket sans adresse.
 *   Toute adresse publique est refusée.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PROVIDER_HOST_PATTERN = /render|supabase|neon|amazonaws|rds\.|azure|gcp|pooler|cloud/i;
const IPV4_PRIVATE_OR_LOOPBACK = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

/** Adresse serveur acceptable : loopback ou plage privée (RFC 1918 / ULA IPv6). */
function isLoopbackOrPrivateAddress(addr) {
  const value = normalize(addr).replace(/^::ffff:/, "");
  if (value === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;
  return IPV4_PRIVATE_OR_LOOPBACK.some((re) => re.test(value));
}

const FORBIDDEN_APP_ENVS = new Set(["production", "preproduction", "preprod", "staging", "demo"]);

class UnsafeTestDatabaseError extends Error {
  constructor(reason) {
    super(`Banc destructif refusé : ${reason}. Utiliser une instance PostgreSQL locale jetable.`);
    this.name = "UnsafeTestDatabaseError";
    this.reason = reason;
  }
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Vérification avant toute connexion. Ne renvoie jamais l'URL (secrets). */
function assertDisposableLocalDatabaseUrl(databaseUrl, env = process.env) {
  let parsed;
  try {
    parsed = new URL(String(databaseUrl ?? ""));
  } catch {
    throw new UnsafeTestDatabaseError("DATABASE_URL illisible");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new UnsafeTestDatabaseError("protocole non PostgreSQL");
  const host = normalize(parsed.hostname);
  const socketHost = normalize(parsed.searchParams.get("host"));
  if (PROVIDER_HOST_PATTERN.test(host) || PROVIDER_HOST_PATTERN.test(socketHost)) {
    throw new UnsafeTestDatabaseError("hôte de fournisseur distant");
  }
  if (!LOOPBACK_HOSTS.has(host)) throw new UnsafeTestDatabaseError("hôte non local");
  // Le pilote pg honore ?host= / ?hostaddr= : ils remplaceraient l'hôte de l'URL.
  for (const key of ["host", "hostaddr"]) {
    const override = normalize(parsed.searchParams.get(key));
    if (override && !LOOPBACK_HOSTS.has(override)) throw new UnsafeTestDatabaseError(`paramètre ${key} non local`);
  }
  if (normalize(env.NODE_ENV) === "production") throw new UnsafeTestDatabaseError("NODE_ENV=production");
  if (FORBIDDEN_APP_ENVS.has(normalize(env.APP_ENV))) throw new UnsafeTestDatabaseError(`APP_ENV=${normalize(env.APP_ENV)}`);
  if (normalize(env.RENDER) !== "") throw new UnsafeTestDatabaseError("service Render");
  return true;
}

/** Vérification côté serveur, sur la connexion qui exécutera le DROP. */
async function assertConnectedToDisposableDatabase(pool, expectedDatabase) {
  const { rows } = await pool.query("SELECT current_database() AS db, host(inet_server_addr()) AS addr");
  const db = String(rows[0]?.db ?? "");
  const addr = rows[0]?.addr == null ? null : String(rows[0].addr);
  if (db !== expectedDatabase) throw new UnsafeTestDatabaseError("base courante différente de la base dédiée au banc");
  if (addr !== null && !isLoopbackOrPrivateAddress(addr)) {
    throw new UnsafeTestDatabaseError("serveur PostgreSQL non local");
  }
  return true;
}

module.exports = {
  UnsafeTestDatabaseError,
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
  isLoopbackOrPrivateAddress,
};
