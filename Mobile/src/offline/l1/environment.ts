/**
 * PERF-PR5 — séparation des caches L1 par environnement.
 *
 * Préproduction et production partagent le même identifiant d'application
 * (`com.somafrik.app`) : sans séparation, un appareil passé d'une version à l'autre
 * rouvrirait le même fichier SQLite et la même clé SQLCipher. Chaque environnement
 * (profil de build + URL de l'API) reçoit ici son propre fichier et sa propre clé.
 * L'ancien fichier commun, d'origine inconnue, n'est plus jamais ouvert (fail-closed).
 */
import { L1_DB_FILENAME, L1_DB_KEY_SECURESTORE } from "./types";

export type L1EnvironmentStorage = {
  /** Identifiant non secret de l'environnement, ex. `production-3f2a9c1d`. */
  environmentId: string;
  fileName: string;
  keyName: string;
};

/** FNV-1a 32 bits : identifiant stable et non secret d'une URL d'API. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizeApiRoot(apiRoot: string): string {
  return String(apiRoot ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export function resolveL1EnvironmentStorage(input: { releaseProfile: string; apiRoot: string }): L1EnvironmentStorage {
  const profile = String(input.releaseProfile ?? "").trim().toLowerCase();
  const api = normalizeApiRoot(input.apiRoot);
  if (!/^[a-z]+$/.test(profile) || !api) {
    throw new Error("Environnement L1 indéterminé : aucun cache local ouvert.");
  }
  const environmentId = `${profile}-${fnv1a(api)}`;
  return {
    environmentId,
    fileName: L1_DB_FILENAME.replace(/\.db$/, `-${environmentId}.db`),
    keyName: `${L1_DB_KEY_SECURESTORE}.${environmentId}`,
  };
}
