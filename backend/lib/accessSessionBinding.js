"use strict";

/**
 * SEC-AUTH-04 — liaison obligatoire JWT ↔ session ↔ utilisateur.
 *
 * Un access token n'authentifie que si :
 * - il porte un `sessionId` au format émis par le serveur (UUID) ;     C-03
 * - la session existe, n'est ni révoquée ni expirée ;
 * - la session appartient au sujet du jeton (`session.user_id`).        F3
 *
 * Aucun mode de compatibilité : un jeton sans session est refusé, quel que
 * soit le rôle (Superadmin et Admin Pays compris).
 */

const { BusinessError } = require("../services/authService");

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = SESSION_ID_RE;

function sessionError(code, message) {
  const error = new BusinessError(401, message);
  error.code = code;
  return error;
}

/** `sessionId` du jeton, ou null s'il est absent, vide ou mal formé. */
function normalizeAccessSessionId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SESSION_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Le propriétaire de la session est-il le sujet du jeton ?
 *
 * - `session.user_id` est l'identifiant enregistré à la création de la session :
 *   `users.id` (UUID) en PostgreSQL, `principal.sub` en mémoire.
 * - PostgreSQL : `createSession` résout `sub` par `users.id` ou `users.user_code`
 *   (`resolveDbUserId`). La même résolution est appliquée ici via `user_code`,
 *   projeté par la même requête que la session. Aucun autre identifiant
 *   (publicId, identifiant de connexion, e-mail) n'est accepté.
 */
function sessionBelongsToSubject(principal, activeSession) {
  const sub = String(principal?.sub ?? "").trim();
  const owner = String(activeSession?.user_id ?? "").trim();
  if (!sub || !owner) return false;
  if (UUID_RE.test(sub) && UUID_RE.test(owner)) return sub.toLowerCase() === owner.toLowerCase();
  if (sub === owner) return true;
  const ownerCode = String(activeSession?.user_code ?? "").trim();
  return Boolean(ownerCode) && sub === ownerCode;
}

/**
 * Résout la session active liée au jeton déjà vérifié (signature, type, exp).
 * Lève une erreur 401 si la liaison est absente ou invalide.
 */
async function resolveBoundAccessSession({ principal, repository }) {
  const sessionId = normalizeAccessSessionId(principal?.sessionId);
  if (!sessionId) {
    throw sessionError("SESSION_REQUIRED", "Session requise.");
  }
  if (typeof repository?.findActiveAccessSession !== "function") {
    throw sessionError("SESSION_STORE_UNAVAILABLE", "Session requise.");
  }
  const activeSession = await repository.findActiveAccessSession(sessionId);
  if (!activeSession) {
    throw sessionError("SESSION_REVOKED", "Session révoquée.");
  }
  if (!sessionBelongsToSubject(principal, activeSession)) {
    // Pas de révocation : la session appartient à un autre utilisateur.
    throw sessionError("SESSION_SUBJECT_MISMATCH", "Session invalide.");
  }
  return { sessionId, activeSession };
}

module.exports = {
  normalizeAccessSessionId,
  resolveBoundAccessSession,
  sessionBelongsToSubject,
};
