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
  STUDENTS_SYNC_PERMISSIONS,
  ASSIGNMENTS_SYNC_PERMISSIONS,
  MOBILE_SYNC_RESOURCE_CLASSES,
  MOBILE_SYNC_RESOURCE_STUDENTS,
  MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
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
 * Lecture Classes autorisée uniquement si le snapshot live du tenant
 * détient réellement une permission de lecture (pas le JWT, pas un rôle
 * d'un autre établissement).
 * @param {{ permissionKeys?: string[] }} [input]
 */
function liveSnapshotHasClassesRead(input = {}) {
  const held = new Set(input.permissionKeys ?? []);
  return CLASSES_SYNC_PERMISSIONS.some((permission) => held.has(permission));
}

/**
 * Périmètre réel Classes : school-wide (rôles établissement), assigned (enseignant)
 * ou none (aucun rôle live, ou rôle live hors allowlist).
 * Aligné sur `scopeSchoolClassesForPrincipal` — jamais « Teacher = school entier ».
 * Un principal sans rôle live n'hérite pas du JWT : aucun scope.
 * School-wide = allowlist explicite uniquement. `Classes:READ` seul n'élargit
 * jamais un rôle inconnu.
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
  return emptyScope();
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

function emptyStudentScope() {
  return { scopeKind: "none", classIds: [], classCodes: [], studentIds: [] };
}

function studentsPermissionKeys(principal = {}) {
  const held = new Set(principal.permissions ?? []);
  return STUDENTS_SYNC_PERMISSIONS.filter((permission) => held.has(permission));
}

/**
 * Lecture Élèves autorisée uniquement si le snapshot live du tenant
 * détient réellement une permission de lecture (GET /api/students).
 * @param {{ permissionKeys?: string[] }} [input]
 */
function liveSnapshotHasStudentsRead(input = {}) {
  const held = new Set(input.permissionKeys ?? []);
  return STUDENTS_SYNC_PERMISSIONS.some((permission) => held.has(permission));
}

function authorizedStudentIdsFromPrincipal(principal = {}) {
  return sortedUnique(principal.authorizedStudentIds ?? []);
}

/**
 * Périmètre réel Students : school-wide | assigned | linked | self | none.
 * Aligné sur `scopeSchoolStudentsForPrincipal` + RBAC GET /api/students.
 * Jamais `principal.studentIds` JWT : le snapshot live pose `authorizedStudentIds`.
 * School-wide = allowlist explicite uniquement. Tout rôle live non reconnu → none
 * (fail-closed) : `Élèves:READ` seul n'élargit jamais l'annuaire.
 *
 * @param {object} principal
 * @returns {{
 *   scopeKind: "school-wide" | "assigned" | "linked" | "self" | "none",
 *   classIds: string[],
 *   classCodes: string[],
 *   studentIds: string[],
 * }}
 */
function resolveStudentsSyncScope(principal) {
  if (!principal) {
    return emptyStudentScope();
  }
  const liveRoles = principalRoleList(principal);
  if (!liveRoles.length) {
    return emptyStudentScope();
  }
  if (SUPER_ADMIN_ROLES.has(principal.role) || principalHasAnyRole(principal, SUPER_ADMIN_ROLES)) {
    return { scopeKind: "school-wide", classIds: [], classCodes: [], studentIds: [] };
  }
  if (principalHasAnyRole(principal, SCHOOL_WIDE_STUDENT_READ_ROLES)) {
    return { scopeKind: "school-wide", classIds: [], classCodes: [], studentIds: [] };
  }
  if (principalHasRole(principal, "Enseignant")) {
    const { classCodes, classIds } = collectTeacherAssignmentRefs(principal);
    return {
      scopeKind: "assigned",
      classIds: sortedUnique([...classIds]),
      classCodes: sortedUnique([...classCodes]),
      studentIds: authorizedStudentIdsFromPrincipal(principal),
    };
  }
  if (principalHasRole(principal, "Parent")) {
    return {
      scopeKind: "linked",
      classIds: [],
      classCodes: [],
      studentIds: authorizedStudentIdsFromPrincipal(principal),
    };
  }
  if (principalHasRole(principal, "Élève / Étudiant")) {
    return {
      scopeKind: "self",
      classIds: [],
      classCodes: [],
      studentIds: authorizedStudentIdsFromPrincipal(principal),
    };
  }
  return emptyStudentScope();
}

function rosterStudentIdsForHash(scope) {
  if (scope.scopeKind === "assigned" || scope.scopeKind === "linked" || scope.scopeKind === "self") {
    return scope.studentIds;
  }
  return [];
}

/**
 * Entrées déterministes du scopeHash Students.
 * School-wide : pas la liste des IDs élèves (création / transfert restent des deltas).
 * Assigned / linked / self : roster des IDs actuellement autorisés (P0 visibilité).
 *
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
function studentsScopeHashInput(principal, schoolRef = {}) {
  const scope = resolveStudentsSyncScope(principal);
  const schoolCode = asRef(schoolRef.schoolCode ?? principal?.schoolCode).toUpperCase();
  return {
    resource: MOBILE_SYNC_RESOURCE_STUDENTS,
    schoolCode,
    schoolId: asRef(schoolRef.schoolId ?? principal?.effectiveSchoolId),
    principalId: asRef(principal?.sub ?? principal?.userId ?? principal?.publicId ?? principal?.identifier),
    roleKeys: sortedUnique(principalRoleList(principal)),
    permissionKeys: studentsPermissionKeys(principal),
    scopeKind: scope.scopeKind,
    classIds: scope.scopeKind === "assigned" ? scope.classIds : [],
    classCodes: scope.scopeKind === "assigned" ? scope.classCodes : [],
    studentIds: rosterStudentIdsForHash(scope),
  };
}

function computeStudentsScopeHash(principal, schoolRef = {}) {
  const scope = resolveStudentsSyncScope(principal);
  const input = studentsScopeHashInput(principal, schoolRef);
  return {
    scopeHash: hashScopeInput(input),
    scope,
    input,
  };
}

async function loadLiveAssignedStudentIds(repository, schoolId, classIds, classCodes) {
  const sid = asRef(schoolId);
  if (!sid || typeof repository?.listLiveAssignedStudentIdsForSync !== "function") {
    return [];
  }
  if (!classIds.length && !classCodes.length) {
    return [];
  }
  let rows;
  try {
    rows = await repository.listLiveAssignedStudentIdsForSync(sid, { classIds, classCodes });
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre le roster élèves live.");
  }
  return sortedUnique(
    (Array.isArray(rows) ? rows : []).map((row) => asRef(row?.studentId ?? row?.student_id ?? row)),
  );
}

async function loadLiveParentLinkedStudentIds(repository, userId, schoolId) {
  const uid = asRef(userId);
  const sid = asRef(schoolId);
  if (!uid || !sid || typeof repository?.listLiveParentLinkedStudentIdsForSync !== "function") {
    return [];
  }
  let rows;
  try {
    rows = await repository.listLiveParentLinkedStudentIdsForSync(uid, sid);
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre les liens parent live.");
  }
  return sortedUnique(
    (Array.isArray(rows) ? rows : []).map((row) => asRef(row?.studentId ?? row?.student_id ?? row)),
  );
}

async function loadLiveSelfStudentIds(repository, userId, schoolId) {
  const uid = asRef(userId);
  const sid = asRef(schoolId);
  if (!uid || !sid || typeof repository?.listLiveSelfStudentIdForSync !== "function") {
    return [];
  }
  let loaded;
  try {
    loaded = await repository.listLiveSelfStudentIdForSync(uid, sid);
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre l'identité élève live.");
  }
  if (loaded == null) {
    return [];
  }
  if (Array.isArray(loaded)) {
    return sortedUnique(loaded.map((row) => asRef(row?.studentId ?? row?.student_id ?? row)));
  }
  const id = asRef(loaded.studentId ?? loaded.student_id ?? loaded.id ?? loaded);
  return id ? [id] : [];
}

/**
 * Snapshot canonique live Students : userId + schoolId → rôles du tenant →
 * permissions du tenant → affectations / liens parent / identité élève live.
 * scopeHash et filtre SQL partagent ce snapshot.
 * Assigned / linked / self : les IDs élèves actuellement autorisés entrent
 * dans le hash (un transfert hors classe enseignant → scope_changed).
 *
 * @param {object} repository
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
async function resolveLiveStudentsSyncSnapshot(repository, principal, schoolRef = {}) {
  const roleKeys = await loadLiveRoleKeys(repository, principal, schoolRef);
  const permissions = await loadLivePermissions(repository, roleKeys, schoolRef);
  const labels = roleKeys.map((key) => toRoleLabel(key)).filter(Boolean);
  const userId = asRef(principal?.sub ?? principal?.userId ?? principal?.id);
  const schoolId = asRef(schoolRef.schoolId);
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
    authorizedStudentIds: [],
  };

  const preliminary = resolveStudentsSyncScope(livePrincipal);
  if (preliminary.scopeKind === "assigned") {
    livePrincipal.assignments = await loadLiveTeacherAssignments(repository, userId, schoolId);
    const assigned = resolveStudentsSyncScope(livePrincipal);
    livePrincipal.authorizedStudentIds = await loadLiveAssignedStudentIds(
      repository,
      schoolId,
      assigned.classIds,
      assigned.classCodes,
    );
  } else if (preliminary.scopeKind === "linked") {
    livePrincipal.authorizedStudentIds = await loadLiveParentLinkedStudentIds(
      repository,
      userId,
      schoolId,
    );
  } else if (preliminary.scopeKind === "self") {
    livePrincipal.authorizedStudentIds = await loadLiveSelfStudentIds(repository, userId, schoolId);
  }

  return computeStudentsScopeHash(livePrincipal, schoolRef);
}

function emptyAssignmentScope() {
  return { scopeKind: "none", teacherId: "", assignmentIds: [] };
}

function assignmentsPermissionKeys(principal = {}) {
  const held = new Set(principal.permissions ?? []);
  return ASSIGNMENTS_SYNC_PERMISSIONS.filter((permission) => held.has(permission));
}

/**
 * Lecture Affectations autorisée uniquement si le snapshot live du tenant
 * détient réellement une permission de GET /api/assignments.
 * @param {{ permissionKeys?: string[] }} [input]
 */
function liveSnapshotHasAssignmentsRead(input = {}) {
  const held = new Set(input.permissionKeys ?? []);
  return ASSIGNMENTS_SYNC_PERMISSIONS.some((permission) => held.has(permission));
}

function liveTeacherIdFromPrincipal(principal = {}) {
  return asRef(principal.liveTeacherId ?? principal.authorizedTeacherId);
}

function authorizedAssignmentIdsFromPrincipal(principal = {}) {
  return sortedUnique(principal.authorizedAssignmentIds ?? []);
}

/**
 * Périmètre réel Assignments : school-wide | assigned | none.
 * School-wide = allowlist explicite uniquement. Un `CUSTOM_ROLE` même avec
 * `Affectations:READ` → none. Jamais `principal.role` / `teacherCode` /
 * `teacherId` / `assignments` JWT.
 *
 * @param {object} principal
 * @returns {{
 *   scopeKind: "school-wide" | "assigned" | "none",
 *   teacherId: string,
 *   assignmentIds: string[],
 * }}
 */
function resolveAssignmentsSyncScope(principal) {
  if (!principal) {
    return emptyAssignmentScope();
  }
  const liveRoles = principalRoleList(principal);
  if (!liveRoles.length) {
    return emptyAssignmentScope();
  }
  if (SUPER_ADMIN_ROLES.has(principal.role) || principalHasAnyRole(principal, SUPER_ADMIN_ROLES)) {
    return { scopeKind: "school-wide", teacherId: "", assignmentIds: [] };
  }
  if (principalHasAnyRole(principal, SCHOOL_WIDE_STUDENT_READ_ROLES)) {
    return { scopeKind: "school-wide", teacherId: "", assignmentIds: [] };
  }
  if (principalHasRole(principal, "Enseignant")) {
    return {
      scopeKind: "assigned",
      teacherId: liveTeacherIdFromPrincipal(principal),
      assignmentIds: authorizedAssignmentIdsFromPrincipal(principal),
    };
  }
  return emptyAssignmentScope();
}

function rosterAssignmentIdsForHash(scope) {
  if (scope.scopeKind === "assigned") {
    return scope.assignmentIds;
  }
  return [];
}

/**
 * Entrées déterministes du scopeHash Assignments.
 * School-wide : pas le roster d'IDs (création / update / delete = deltas).
 * Assigned : IDs des affectations actives actuellement visibles.
 *
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
function assignmentsScopeHashInput(principal, schoolRef = {}) {
  const scope = resolveAssignmentsSyncScope(principal);
  const schoolCode = asRef(schoolRef.schoolCode ?? principal?.schoolCode).toUpperCase();
  return {
    resource: MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
    schoolCode,
    schoolId: asRef(schoolRef.schoolId ?? principal?.effectiveSchoolId),
    principalId: asRef(principal?.sub ?? principal?.userId ?? principal?.publicId ?? principal?.identifier),
    roleKeys: sortedUnique(principalRoleList(principal)),
    permissionKeys: assignmentsPermissionKeys(principal),
    scopeKind: scope.scopeKind,
    teacherId: scope.scopeKind === "assigned" ? scope.teacherId : "",
    assignmentIds: rosterAssignmentIdsForHash(scope),
  };
}

function computeAssignmentsScopeHash(principal, schoolRef = {}) {
  const scope = resolveAssignmentsSyncScope(principal);
  const input = assignmentsScopeHashInput(principal, schoolRef);
  return {
    scopeHash: hashScopeInput(input),
    scope,
    input,
  };
}

/**
 * Identité enseignant live : users.id = principal → teachers.user_id + teachers.school_id.
 * Jamais `principal.teacherCode` JWT.
 *
 * @param {object} repository
 * @param {string} userId
 * @param {string} schoolId
 * @returns {Promise<{ teacherId: string, teacherCode: string, teacherUserId: string } | null>}
 */
async function loadLiveTeacherIdentityForSchool(repository, userId, schoolId) {
  const uid = asRef(userId);
  const sid = asRef(schoolId);
  if (!uid || !sid || typeof repository?.getLiveTeacherIdentityForSchool !== "function") {
    return null;
  }
  let loaded;
  try {
    loaded = await repository.getLiveTeacherIdentityForSchool(uid, sid);
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre l'identité enseignant live.");
  }
  if (!loaded || typeof loaded !== "object") {
    return null;
  }
  const teacherId = asRef(loaded.teacherId ?? loaded.teacher_id ?? loaded.id);
  if (!teacherId) {
    return null;
  }
  return {
    teacherId,
    teacherCode: asRef(loaded.teacherCode ?? loaded.teacher_code),
    teacherUserId: asRef(loaded.teacherUserId ?? loaded.teacher_user_id ?? loaded.user_id ?? uid),
  };
}

async function loadLiveTeacherAssignmentIdsForSync(repository, schoolId, teacherId) {
  const sid = asRef(schoolId);
  const tid = asRef(teacherId);
  if (!sid || !tid || typeof repository?.listLiveTeacherAssignmentIdsForSync !== "function") {
    return [];
  }
  let rows;
  try {
    rows = await repository.listLiveTeacherAssignmentIdsForSync(sid, tid);
  } catch (error) {
    rethrowLiveScope(error, "Impossible de résoudre les affectations live.");
  }
  return sortedUnique(
    (Array.isArray(rows) ? rows : []).map((row) => asRef(row?.assignmentId ?? row?.assignment_id ?? row?.id ?? row)),
  );
}

/**
 * Snapshot canonique live Assignments : userId + schoolId → rôles du tenant →
 * permissions du tenant → identité Teacher PostgreSQL si Enseignant →
 * affectations actives autorisées. scopeHash et filtre SQL partagent ce snapshot.
 * Aucun fallback JWT (role / roleKeys / permissions / teacherCode / teacherId / assignments).
 *
 * @param {object} repository
 * @param {object} principal
 * @param {{ schoolCode?: string, schoolId?: string }} schoolRef
 */
async function resolveLiveAssignmentsSyncSnapshot(repository, principal, schoolRef = {}) {
  const roleKeys = await loadLiveRoleKeys(repository, principal, schoolRef);
  const permissions = await loadLivePermissions(repository, roleKeys, schoolRef);
  const labels = roleKeys.map((key) => toRoleLabel(key)).filter(Boolean);
  const userId = asRef(principal?.sub ?? principal?.userId ?? principal?.id);
  const schoolId = asRef(schoolRef.schoolId);
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
    liveTeacherId: "",
    authorizedAssignmentIds: [],
  };

  const preliminary = resolveAssignmentsSyncScope(livePrincipal);
  if (preliminary.scopeKind === "assigned") {
    const identity = await loadLiveTeacherIdentityForSchool(repository, userId, schoolId);
    livePrincipal.liveTeacherId = identity?.teacherId ?? "";
    livePrincipal.authorizedAssignmentIds = await loadLiveTeacherAssignmentIdsForSync(
      repository,
      schoolId,
      livePrincipal.liveTeacherId,
    );
  }

  return computeAssignmentsScopeHash(livePrincipal, schoolRef);
}

module.exports = {
  resolveClassesSyncScope,
  classesScopeHashInput,
  computeClassesScopeHash,
  hashScopeInput,
  classesPermissionKeys,
  liveSnapshotHasClassesRead,
  resolveLiveClassesSyncSnapshot,
  loadLiveTeacherAssignments,
  resolveStudentsSyncScope,
  studentsScopeHashInput,
  computeStudentsScopeHash,
  studentsPermissionKeys,
  liveSnapshotHasStudentsRead,
  resolveLiveStudentsSyncSnapshot,
  loadLiveAssignedStudentIds,
  loadLiveParentLinkedStudentIds,
  loadLiveSelfStudentIds,
  resolveAssignmentsSyncScope,
  assignmentsScopeHashInput,
  computeAssignmentsScopeHash,
  assignmentsPermissionKeys,
  liveSnapshotHasAssignmentsRead,
  resolveLiveAssignmentsSyncSnapshot,
  loadLiveTeacherIdentityForSchool,
  loadLiveTeacherAssignmentIdsForSync,
};
