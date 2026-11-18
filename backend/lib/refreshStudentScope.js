"use strict";

/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 1 — périmètre Élève conservé au rafraîchissement du jeton.
 *
 * Cause racine des « écrans blancs » Élève (Android, reproduite sur émulateur) : le jeton émis
 * par POST /api/auth/refresh ne portait plus `studentIds`. Après expiration du premier jeton
 * (application rouverte, session restaurée), l'élève sortait de son propre périmètre :
 * GET /students/<son id> → 404, /presences, /payments, /classes, /students → listes vides.
 *
 * Correctif : recalculer `studentIds` au refresh avec exactement la résolution de la connexion
 * (AuthService.buildManagedMobileUser → linkedStudent → getPrincipalStudentIds), à partir de
 * l'état autoritatif courant. Aucun élargissement : sans fiche liée, périmètre vide (fail-closed),
 * comme à la connexion. Les autres rôles ne sont pas concernés.
 */
const { getPrincipalStudentIds } = require("./principalStudentIds");
const { principalHasRole } = require("./userRoleLifecycle");

const STUDENT_ROLE_LABEL = "Élève / Étudiant";

/**
 * @param {{
 *   authService: { userAccounts?: object[], buildManagedMobileUser: Function } | null,
 *   userId: string,
 *   sessionRole: string,
 *   roleKeys: string[],
 * }} input
 * @returns {{ studentIds?: string[] }} champs à fusionner dans le jeton (vide si rôle non Élève)
 */
function resolveRefreshStudentScope({ authService, userId, sessionRole, roleKeys }) {
  if (!principalHasRole({ role: sessionRole, roleKeys }, STUDENT_ROLE_LABEL)) return {};
  const uid = String(userId ?? "").trim();
  const accounts = Array.isArray(authService?.userAccounts) ? authService.userAccounts : [];
  const user = uid ? accounts.find((account) => String(account?.id ?? "").trim() === uid) : null;
  if (!user || typeof authService?.buildManagedMobileUser !== "function") return { studentIds: [] };
  const mobileUser = authService.buildManagedMobileUser(user, "student");
  return { studentIds: getPrincipalStudentIds({ role: "student", user: mobileUser }) };
}

module.exports = { resolveRefreshStudentScope, STUDENT_ROLE_LABEL };
