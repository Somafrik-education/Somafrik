"use strict";

const crypto = require("crypto");
const {
  SUPER_ADMIN_ROLES,
  SCHOOL_WIDE_STUDENT_READ_ROLES,
  collectTeacherAssignmentRefs,
} = require("./classStudentsAuthz");
const { principalHasRole, principalHasAnyRole, principalRoleList } = require("./userRoleLifecycle");
const { CLASSES_SYNC_PERMISSIONS, MOBILE_SYNC_RESOURCE_CLASSES } = require("./mobileSyncErrors");

function asRef(value) {
  return String(value ?? "").trim();
}

function sortedUnique(values) {
  return [...new Set((values ?? []).map(asRef).filter(Boolean))].sort();
}

/**
 * Permissions Classes effectivement présentes sur le principal (pas le label de rôle seul).
 * @param {object} principal
 * @returns {string[]}
 */
function classesPermissionKeys(principal = {}) {
  const held = new Set(principal.permissions ?? []);
  return CLASSES_SYNC_PERMISSIONS.filter((permission) => held.has(permission));
}

/**
 * Périmètre réel Classes : school-wide (rôles établissement) ou assigned (enseignant).
 * Aligné sur `scopeSchoolClassesForPrincipal` — jamais « Teacher = school entier ».
 *
 * @param {object} principal
 * @returns {{
 *   scopeKind: "school-wide" | "assigned",
 *   classIds: string[],
 *   classCodes: string[],
 * }}
 */
function resolveClassesSyncScope(principal) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return { scopeKind: "school-wide", classIds: [], classCodes: [] };
  }
  if (principalHasAnyRole(principal, SCHOOL_WIDE_STUDENT_READ_ROLES)) {
    return { scopeKind: "school-wide", classIds: [], classCodes: [] };
  }
  if (principalHasRole(principal, "Enseignant")) {
    const { classCodes, classIds } = collectTeacherAssignmentRefs(principal);
    return {
      scopeKind: "assigned",
      classIds: sortedUnique([...classIds]),
      classCodes: sortedUnique([...classCodes]),
    };
  }
  return { scopeKind: "school-wide", classIds: [], classCodes: [] };
}

/**
 * Entrées déterministes du scopeHash Classes.
 * School-wide : pas la liste des IDs (une classe créée reste un delta warm).
 * Assigned : IDs/codes des affectations actives (grant/revoke → hash change).
 *
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
function classesScopeHashInput(principal, schoolRef = {}) {
  const scope = resolveClassesSyncScope(principal);
  const schoolCode = asRef(schoolRef.schoolCode ?? principal?.schoolCode).toUpperCase();
  return {
    resource: MOBILE_SYNC_RESOURCE_CLASSES,
    schoolCode,
    schoolId: asRef(schoolRef.schoolId ?? principal?.effectiveSchoolId),
    principalId: asRef(principal?.sub ?? principal?.userId ?? principal?.publicId ?? principal?.identifier),
    roleKeys: sortedUnique(principalRoleList(principal)),
    permissionKeys: classesPermissionKeys(principal),
    scopeKind: scope.scopeKind,
    classIds: scope.scopeKind === "assigned" ? scope.classIds : [],
    classCodes: scope.scopeKind === "assigned" ? scope.classCodes : [],
  };
}

/**
 * @param {object} input
 * @returns {string} hex sha256
 */
function hashScopeInput(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 * @returns {{ scopeHash: string, scope: ReturnType<typeof resolveClassesSyncScope>, input: object }}
 */
function computeClassesScopeHash(principal, schoolRef = {}) {
  const scope = resolveClassesSyncScope(principal);
  const input = classesScopeHashInput(principal, schoolRef);
  return {
    scopeHash: hashScopeInput(input),
    scope,
    input,
  };
}

module.exports = {
  resolveClassesSyncScope,
  classesScopeHashInput,
  computeClassesScopeHash,
  hashScopeInput,
  classesPermissionKeys,
};
