"use strict";

const { BusinessError } = require("../services/authService");
const {
  isPlatformScopePrincipal,
  isSchoolRolePrincipal,
  hasConcreteSchoolCode,
} = require("./platformScopePrincipal");

const ACTIVE_ACCOUNT_STATUS = "active";

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function hasAccountProjection(activeSession) {
  return Boolean(activeSession) && Object.prototype.hasOwnProperty.call(activeSession, "user_status");
}

/**
 * Le schoolCode (ou schoolId) porté par le jeton doit désigner l'établissement
 * canonique actuel du compte (users.school_id, GP-003).
 */
function tokenMatchesCanonicalSchool(principal, canonical) {
  const tokenCode = normalizeCode(principal?.schoolCode);
  const tokenSchoolId = String(principal?.schoolId ?? "").trim().toLowerCase();
  const canonicalId = String(canonical?.schoolId ?? "").trim().toLowerCase();
  if (tokenSchoolId && canonicalId && tokenSchoolId === canonicalId) return true;
  return [canonical?.schoolCode, canonical?.loginCode].map(normalizeCode).filter(Boolean).includes(tokenCode);
}

async function rejectSession(repository, sessionId, reason, message) {
  if (sessionId && typeof repository?.revokeSession === "function") {
    await repository.revokeSession(sessionId, reason);
  }
  const error = new BusinessError(401, message);
  error.code = reason === "account_inactive" ? "SESSION_ACCOUNT_INACTIVE" : "SESSION_SCHOOL_ATTACHMENT_MISSING";
  throw error;
}

/**
 * SEC-TENANT-01 — une session existante reste soumise à l'état courant du compte.
 *
 * - Compte non actif (désactivé, archivé, suspendu, en attente, supprimé) :
 *   session révoquée, 401. S'applique à tous les rôles.
 * - Rôle scolaire : le schoolCode concret du jeton doit être l'établissement
 *   canonique actuel (users.school_id). Changement d'établissement ou retrait :
 *   session révoquée, 401. Un jeton à schoolCode vide est traité par
 *   l'hydratation canonique (canonicalSchoolAttachment).
 *
 * PostgreSQL : l'état du compte vient de la même requête que la session.
 * Dépôt sans projection de compte : rattachement relu via findUserCanonicalSchool.
 */
async function assertAccessSessionAccount({ principal, activeSession, repository, sessionId }) {
  const projected = hasAccountProjection(activeSession);
  if (projected && activeSession.user_status !== ACTIVE_ACCOUNT_STATUS) {
    await rejectSession(repository, sessionId, "account_inactive", "Compte inactif. Session révoquée.");
  }

  if (isPlatformScopePrincipal(principal) || !isSchoolRolePrincipal(principal)) return;
  if (!hasConcreteSchoolCode(principal?.schoolCode)) return;

  let canonical = null;
  if (projected) {
    canonical = activeSession.user_school_id
      ? {
          schoolId: String(activeSession.user_school_id),
          schoolCode: activeSession.user_school_code,
          loginCode: activeSession.user_school_login_code,
        }
      : null;
  } else if (typeof repository?.findUserCanonicalSchool === "function") {
    canonical = await repository.findUserCanonicalSchool(principal.sub);
  }

  if (!canonical || !tokenMatchesCanonicalSchool(principal, canonical)) {
    await rejectSession(
      repository,
      sessionId,
      "school_attachment_changed",
      "Rattachement établissement modifié. Session révoquée.",
    );
  }
}

module.exports = {
  assertAccessSessionAccount,
};
