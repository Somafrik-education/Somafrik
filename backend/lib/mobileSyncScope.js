"use strict";

const crypto = require("crypto");
const {
  SUPER_ADMIN_ROLES,
  SCHOOL_WIDE_STUDENT_READ_ROLES,
  collectTeacherAssignmentRefs,
} = require("./classStudentsAuthz");
const {
  principalHasRole,
  principalHasAnyRole,
  principalRoleList,
  toRoleKey,
  toRoleLabel,
} = require("./userRoleLifecycle");
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

async function loadLiveRoleKeys(repository, principal) {
  const userId = asRef(principal?.sub ?? principal?.userId ?? principal?.id);
  if (userId && typeof repository?.listActiveUserRoleKeys === "function") {
    try {
      const loaded = await repository.listActiveUserRoleKeys(userId);
      if (Array.isArray(loaded) && loaded.length) {
        return sortedUnique(loaded.map((value) => toRoleKey(value)).filter(Boolean));
      }
    } catch {
      // fail-closed vers les rôles JWT ci-dessous
    }
  }
  return sortedUnique(principalRoleList(principal).map((value) => toRoleKey(value)).filter(Boolean));
}

async function loadLivePermissions(repository, principal, roleKeys) {
  if (typeof repository?.resolveEffectivePermissions === "function") {
    try {
      const live = await repository.resolveEffectivePermissions({
        ...principal,
        roleKeys,
        roles: roleKeys.map((key) => toRoleLabel(key)).filter(Boolean),
      });
      if (Array.isArray(live?.permissions)) {
        return live.permissions;
      }
    } catch {
      // conserve les permissions déjà overlayées par requirePermission
    }
  }
  return Array.isArray(principal?.permissions) ? principal.permissions : [];
}

/**
 * Affectations enseignant : PostgreSQL uniquement.
 * Jamais `principal.assignments` JWT — un revoke serveur doit changer le hash
 * avec le même access token.
 *
 * @param {object} repository
 * @param {string} userId
 * @param {string} schoolId
 * @returns {Promise<object[]>}
 */
async function loadLiveTeacherAssignments(repository, userId, schoolId) {
  if (!userId || !schoolId || typeof repository?.listLiveTeacherClassAssignmentsForSync !== "function") {
    return [];
  }
  const rows = await repository.listLiveTeacherClassAssignmentsForSync(userId, schoolId);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    classId: asRef(row.classId ?? row.class_id),
    classCode: asRef(row.classCode ?? row.class_code),
    status: asRef(row.status) || "active",
  }));
}

/**
 * Snapshot canonique live : rôles user_roles + permissions effectives +
 * teacher_assignments PostgreSQL. scopeHash et filtre SQL partagent ce snapshot.
 *
 * @param {object} repository
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
async function resolveLiveClassesSyncSnapshot(repository, principal, schoolRef = {}) {
  const roleKeys = await loadLiveRoleKeys(repository, principal);
  const permissions = await loadLivePermissions(repository, principal, roleKeys);
  const labels = roleKeys.map((key) => toRoleLabel(key)).filter(Boolean);
  const livePrincipal = {
    ...principal,
    role: labels[0] || principal?.role,
    roles: labels.length ? labels : principal?.roles,
    roleKeys: roleKeys.length ? roleKeys : principal?.roleKeys,
    permissions,
    assignments: [],
  };

  const preliminary = resolveClassesSyncScope(livePrincipal);
  if (preliminary.scopeKind === "assigned") {
    livePrincipal.assignments = await loadLiveTeacherAssignments(
      repository,
      asRef(principal?.sub ?? principal?.userId ?? principal?.id),
      asRef(schoolRef.schoolId),
    );
  }

  return computeClassesScopeHash(livePrincipal, schoolRef);
}

module.exports = {
  resolveClassesSyncScope,
  classesScopeHashInput,
  computeClassesScopeHash,
  hashScopeInput,
  classesPermissionKeys,
  resolveLiveClassesSyncSnapshot,
  loadLiveTeacherAssignments,
};
