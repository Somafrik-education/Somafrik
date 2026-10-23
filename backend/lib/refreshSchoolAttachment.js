"use strict";

const { BusinessError } = require("../services/authService");
const {
  isPlatformScopePrincipal,
  isSchoolRolePrincipal,
  hasConcreteSchoolCode,
} = require("./platformScopePrincipal");

/**
 * SEC-TENANT-01 — le refresh ne change jamais silencieusement la portée tenant.
 *
 * - Rôle plateforme : portée de la session, ou "*".
 * - Rôle scolaire : la session doit porter un établissement concret auquel
 *   l'utilisateur est toujours rattaché ; sinon la session est révoquée et le
 *   refresh refusé (401).
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

  let attached = Boolean(schoolCode);
  if (attached && typeof repository?.isUserAttachedToSchool === "function") {
    attached = await repository.isUserAttachedToSchool(session.user_id, session.school_id);
  }
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
