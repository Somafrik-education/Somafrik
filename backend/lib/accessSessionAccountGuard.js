"use strict";

const { BusinessError } = require("../services/authService");
const { isPlatformScopePrincipal, hasConcreteSchoolCode } = require("./platformScopePrincipal");

const ACTIVE_ACCOUNT_STATUS = "active";

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function hasAccountProjection(activeSession) {
  return Boolean(activeSession) && Object.prototype.hasOwnProperty.call(activeSession, "user_status");
}

/**
 * SEC-TENANT-02 (F6) — l'identité établissement portée par le jeton doit
 * désigner l'établissement canonique actuel du compte (users.school_id, GP-003).
 * Chaque identifiant présent est vérifié : un schoolId concordant ne couvre plus
 * un schoolCode d'un autre établissement, et inversement.
 * Dépôt sans identifiant canonique (mémoire) : le schoolId n'est accepté que si
 * le schoolCode, lui, est vérifié.
 */
function tokenMatchesCanonicalSchool(principal, canonical) {
  const tokenCode = normalizeCode(principal?.schoolCode);
  const tokenSchoolId = String(principal?.schoolId ?? "").trim().toLowerCase();
  const canonicalId = String(canonical?.schoolId ?? "").trim().toLowerCase();
  const codeGiven = hasConcreteSchoolCode(tokenCode);
  const codeOk =
    !codeGiven || [canonical?.schoolCode, canonical?.loginCode].map(normalizeCode).filter(Boolean).includes(tokenCode);
  let idOk = true;
  if (tokenSchoolId) idOk = canonicalId ? tokenSchoolId === canonicalId : codeGiven && codeOk;
  return (codeGiven || Boolean(tokenSchoolId)) && codeOk && idOk;
}

async function rejectSession(repository, sessionId, reason, message) {
  if (sessionId && typeof repository?.revokeSession === "function") {
    await repository.revokeSession(sessionId, reason);
  }
  const error = new BusinessError(401, message);
  error.code =
    reason === "account_inactive"
      ? "SESSION_ACCOUNT_INACTIVE"
      : reason === "school_identity_mismatch"
        ? "SESSION_SCHOOL_IDENTITY_MISMATCH"
        : "SESSION_SCHOOL_ATTACHMENT_MISSING";
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
 *
 * SEC-TENANT-02 : schoolCode et schoolId sont tous deux vérifiés ; renvoie
 * l'établissement canonique vérifié (ou null), sans requête supplémentaire en
 * PostgreSQL (projection de la requête de session).
 */
async function assertAccessSessionAccount({ principal, activeSession, repository, sessionId }) {
  const projected = hasAccountProjection(activeSession);
  if (projected && activeSession.user_status !== ACTIVE_ACCOUNT_STATUS) {
    await rejectSession(repository, sessionId, "account_inactive", "Compte inactif. Session révoquée.");
  }

  // SEC-TENANT-02 : un compte plateforme sans rattachement concret ne porte aucun
  // identifiant d'établissement (aucun accès scolaire implicite).
  if (isPlatformScopePrincipal(principal)) {
    if (String(principal?.schoolId ?? "").trim() && !hasConcreteSchoolCode(principal?.schoolCode)) {
      await rejectSession(
        repository,
        sessionId,
        "school_identity_mismatch",
        "Identité établissement incohérente. Session révoquée.",
      );
    }
    return null;
  }
  // Aucun identifiant d'établissement : rôle scolaire → hydratation canonique
  // (canonicalSchoolAttachment), compte sans affectation → aucune école.
  const claimsSchool = hasConcreteSchoolCode(principal?.schoolCode) || Boolean(String(principal?.schoolId ?? "").trim());
  if (!claimsSchool) return null;

  // Tout compte non plateforme portant un établissement (rôle scolaire ou compte
  // sans affectation) doit désigner son établissement canonique.
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
  return canonical;
}

module.exports = {
  assertAccessSessionAccount,
};
