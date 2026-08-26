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
const {
  CLASSES_SYNC_PERMISSIONS,
  MOBILE_SYNC_RESOURCE_CLASSES,
  MOBILE_SYNC_ERROR,
  liveScopeError,
} = require("./mobileSyncErrors");

function asRef(value) {
  return String(value ?? "").trim();
}

function sortedUnique(values) {
  return [...new Set((values ?? []).map(asRef).filter(Boolean))].sort();
}

function emptyScope() {
  return { scopeKind: "none", classIds: [], classCodes: [] };
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
 * Périmètre réel Classes : school-wide (rôles établissement), assigned (enseignant)
 * ou none (aucun rôle live).
 * Aligné sur `scopeSchoolClassesForPrincipal` — jamais « Teacher = school entier ».
 * Un principal sans rôle live n'hérite pas du JWT : aucun scope.
 *
 * @param {object} principal
 * @returns {{
 *   scopeKind: "school-wide" | "assigned" | "none",
 *   classIds: string[],
 *   classCodes: string[],
 * }}
 */
function resolveClassesSyncScope(principal) {
  if (!principal) {
    return emptyScope();
  }
  const liveRoles = principalRoleList(principal);
  if (!liveRoles.length) {
    return emptyScope();
  }
  if (SUPER_ADMIN_ROLES.has(principal.role) || principalHasAnyRole(principal, SUPER_ADMIN_ROLES)) {
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

function rethrowLiveScope(error, message) {
  if (error?.code === MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE) {
    throw error;
  }
  throw liveScopeError(message);
}

async function loadLiveRoleKeys(repository, principal, schoolRef = {}) {
  const userId = asRef(principal?.sub ?? principal?.userId ?? principal?.id);
  const schoolId = asRef(schoolRef.schoolId);
  if (!userId || !schoolId) {
    return [];
  }
  if (typeof repository?.listActiveUserRoleKeysForSchool !== "function") {
    return [];
  }
  let loaded;
  try {
    loaded = await repository.listActiveUserRoleKeysForSchool(userId, schoolId);
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre les rôles live.");
  }
  if (!Array.isArray(loaded)) {
    return [];
  }
  return sortedUnique(loaded.map((value) => toRoleKey(value)).filter(Boolean));
}

async function loadLivePermissions(repository, roleKeys, schoolRef = {}) {
  if (!roleKeys.length) {
    return [];
  }
  if (typeof repository?.resolveEffectivePermissions !== "function") {
    return [];
  }
  const labels = roleKeys.map((key) => toRoleLabel(key)).filter(Boolean);
  let live;
  try {
    live = await repository.resolveEffectivePermissions({
      roleKeys,
      roles: labels,
      role: labels[0] || "",
      schoolCode: asRef(schoolRef.schoolCode),
      effectiveSchoolId: asRef(schoolRef.schoolId),
    });
    // sub/userId volontairement omis : collectPrincipalRoleKeys rechargerait
    // sinon user_roles sans school_id (contamination inter-établissements).
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre les permissions live.");
  }
  return Array.isArray(live?.permissions) ? live.permissions : [];
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
  let rows;
  try {
    rows = await repository.listLiveTeacherClassAssignmentsForSync(userId, schoolId);
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre les affectations live.");
  }
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    classId: asRef(row.classId ?? row.class_id),
    classCode: asRef(row.classCode ?? row.class_code),
    status: asRef(row.status) || "active",
  }));
}

/**
 * Snapshot canonique live : userId + schoolId → rôles du tenant →
 * permissions du tenant (schoolCode) → affectations du tenant.
 * scopeHash et filtre SQL partagent ce snapshot.
 * Aucun fallback JWT : live [] = aucun scope ; erreur PG = fail-closed.
 * listActiveUserRoleKeys (global, tous établissements) n'est jamais utilisé.
 *
 * @param {object} repository
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
async function resolveLiveClassesSyncSnapshot(repository, principal, schoolRef = {}) {
  const roleKeys = await loadLiveRoleKeys(repository, principal, schoolRef);
  const permissions = await loadLivePermissions(repository, roleKeys, schoolRef);
  const labels = roleKeys.map((key) => toRoleLabel(key)).filter(Boolean);
  const livePrincipal = {
    sub: principal?.sub,
    userId: principal?.userId,
    publicId: principal?.publicId,
    identifier: principal?.identifier,
    schoolCode: schoolRef.schoolCode ?? principal?.schoolCode,
    effectiveSchoolId: schoolRef.schoolId ?? principal?.effectiveSchoolId,
    role: labels[0] || "",
    roles: labels,
    roleKeys,
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
