"use strict";

const {
  isPlatformScopePrincipal,
  isSchoolRolePrincipal,
  hasConcreteSchoolCode,
} = require("./platformScopePrincipal");

/**
 * SEC-TENANT-01 — autorité tenant GP-003 : users.id → users.school_id → schools.id.
 *
 * Un claim JWT schoolCode vide ou "*" n'est pas une autorité. Pour un rôle
 * scolaire, le rattachement est relu en base depuis users.school_id ; sans
 * établissement canonique, le principal reste non rattaché et la résolution de
 * portée le refuse. Aucun repli vers user_roles ; dépôt sans lecture → inchangé
 * (donc refusé).
 */
async function hydrateCanonicalSchoolAttachment(principal, repository) {
  if (!principal || typeof principal !== "object") return principal;
  if (isPlatformScopePrincipal(principal) || !isSchoolRolePrincipal(principal)) return principal;
  if (hasConcreteSchoolCode(principal.schoolCode)) return principal;
  if (typeof repository?.findUserCanonicalSchool !== "function") return principal;

  const canonical = await repository.findUserCanonicalSchool(principal.sub);
  if (!canonical || !hasConcreteSchoolCode(canonical.schoolCode)) return principal;
  return {
    ...principal,
    schoolCode: canonical.schoolCode,
    schoolId: canonical.schoolId || principal.schoolId || "",
    schoolAttachmentSource: "users.school_id",
  };
}

module.exports = {
  hydrateCanonicalSchoolAttachment,
};
