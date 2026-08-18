"use strict";

/**
 * Contrat d'identité JWT / audit / GRANT.
 *
 * Production PostgreSQL : `users.id` est un UUID. `buildPrincipal` pose
 * `principal.sub = user.id`. Les colonnes UUID (`user_roles.granted_by`,
 * `audit_logs.user_id`) n'acceptent que cet identifiant, sinon NULL.
 *
 * Mémoire / legacy : `user.id` peut être un slug (`USER-T1`). `sub` reste le
 * slug pour le JWT, mais **aucune** écriture UUID ne doit recevoir cette valeur.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_RE.test(String(value ?? "").trim());
}

function uuidOrNull(value) {
  const raw = String(value ?? "").trim();
  return isUuid(raw) ? raw : null;
}

/**
 * Sujet de session : `users.id` s'il existe (UUID en PG).
 * @param {{ id?: string, publicId?: string, matricule?: string }} user
 */
function resolvePrincipalSub(user = {}) {
  const id = String(user.id ?? "").trim();
  if (id) return id;
  const fallback = String(user.publicId ?? user.matricule ?? "").trim();
  return fallback || "anonymous";
}

/**
 * Auteur persistable en colonne UUID REFERENCES users(id).
 * @param {{ sub?: string, id?: string, userId?: string } | null} principal
 */
function grantedByUserId(principal) {
  return uuidOrNull(principal?.sub || principal?.id || principal?.userId);
}

module.exports = {
  UUID_RE,
  isUuid,
  uuidOrNull,
  resolvePrincipalSub,
  grantedByUserId,
};
