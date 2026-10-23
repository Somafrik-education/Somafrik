"use strict";

const { BusinessError } = require("../services/authService");
const {
  isPlatformScopePrincipal,
  isSchoolRolePrincipal,
  hasConcreteSchoolCode,
} = require("./platformScopePrincipal");

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Le claim schoolCode du refresh token doit désigner l'établissement de la
 * session (code interne ou login_code V2). Un claim vide ne prouve rien.
 */
function payloadMatchesSessionSchool(payload = {}, session = {}) {
  const claimed = normalizeCode(payload.schoolCode);
  if (!hasConcreteSchoolCode(claimed)) return true;
  return [session.school_code, session.school_login_code]
    .map(normalizeCode)
    .filter(Boolean)
    .includes(claimed);
}

/**
 * SEC-TENANT-01 — le refresh ne change jamais silencieusement la portée tenant.
 *
 * - Rôle plateforme : portée de la session, ou "*".
 * - Rôle scolaire : la session doit porter un établissement concret, cohérent
 *   avec le claim du refresh token, et égal à l'établissement canonique de
 *   l'utilisateur (users.school_id, contrat GP-003). Un rôle secondaire dans
 *   user_roles ne maintient pas la session. Dépôt sans vérification → refus.
 *   En cas d'échec, la session est révoquée et le refresh refusé (401).
 * - Compte sans affectation : aucun établissement, jamais "*".
 *
 * @returns {Promise<string>} schoolCode à embarquer dans le nouvel access token
 */
async function resolveRefreshSchoolCode({ repository, session = {}, payload = {}, roleKeys = [] }) {
  const scopeShape = { role: session.role, roleKeys };
  if (isPlatformScopePrincipal(scopeShape)) {
    return session.school_code ?? "*";
  }

  const schoolCode = hasConcreteSchoolCode(session.school_code) ? session.school_code : "";
  if (!isSchoolRolePrincipal(scopeShape)) {
    return schoolCode;
  }

  const attached =
    Boolean(schoolCode) &&
    payloadMatchesSessionSchool(payload, session) &&
    typeof repository?.isUserAttachedToSessionSchool === "function" &&
    (await repository.isUserAttachedToSessionSchool(session)) === true;
  if (attached) {
    return schoolCode;
  }

  const sessionId = String(payload.sessionId ?? session.session_code ?? "").trim();
  if (sessionId && typeof repository?.revokeSession === "function") {
    await repository.revokeSession(sessionId, "school_attachment_missing");
  }
  const error = new BusinessError(401, "Session expirée ou révoquée");
  error.code = "SESSION_SCHOOL_ATTACHMENT_MISSING";
  throw error;
}

module.exports = {
  resolveRefreshSchoolCode,
};
