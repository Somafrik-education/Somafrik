"use strict";

const {
  asTrimmed,
  toIsoDate,
  ignoreClientScope,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  requestedCountryCodeFromPayload,
  assertRequestedCountryMatchesSchool,
  mapUserRow,
  toDbStatus,
  parsePayload,
} = require("./clientsManagement");
const {
  attachUsersStorePrincipal,
  assertUsersTargetAccess,
  targetFromUserRow,
} = require("./usersSchoolScope");
const { toDbRole } = require("./clientsRolePolicy");
const {
  USER_ROLE_ERROR,
  FORBIDDEN_CREATE_KEYS,
  FORBIDDEN_IDENTITY_PATCH_KEYS,
  SCHOOL_PLATFORM_ROLE_KEYS,
  createUserRoleError,
  toRoleKey,
  toRoleLabel,
  displayRoles,
  primaryRoleKey,
  isPlatformRoleKey,
  isForbiddenAssignRoleKey,
  isKnownRoleKey,
  assertNoClientPrivilegeKeys,
  assertSingleRoleOperation,
  nextUserCodeFromExisting,
  isUserRolesUniqueViolation,
  isUserCodeUniqueViolation,
} = require("./userRoleLifecycle");
const {
  buildBusinessProfile,
  emptyBusinessProfile,
  isBusinessProfileConflictError,
  studentToTeacherConflict,
  teacherToStudentConflict,
} = require("./businessProfileIntegrity");

const SCHOOL_ADMIN_KEY = "SCHOOL_ADMIN";
const TEACHER_KEY = "TEACHER";
const STUDENT_KEY = "STUDENT";
const PENDING_VALIDATION_STATUS = "En attente de validation";

function actorUserId(principal) {
  return asTrimmed(principal?.sub || principal?.id || principal?.userId);
}

function hydrateUser(row, roleKeys = [], businessProfile = null) {
  const mapped = mapUserRow(row);
  const display = displayRoles(roleKeys);
  const profile = businessProfile || emptyBusinessProfile(roleKeys);
  return {
    ...mapped,
    role: display.role,
    roles: display.roles,
    roleKeys: display.roleKeys,
    secondaryRoles: display.roles.slice(1),
    assignmentStatus: display.assignmentStatus,
    accountKind: profile.accountKind,
    linkedStudent: profile.linkedStudent,
    linkedTeacher: profile.linkedTeacher,
    businessProfileConflict: Boolean(profile.businessProfileConflict),
  };
}

function throwBusinessProfileConflict(conflict) {
  throw createUserRoleError(conflict.status, conflict.message, conflict.code, conflict.details);
}

function mapGrantPgError(error) {
  if (isBusinessProfileConflictError(error)) {
    const message = String(error.message ?? "");
    const conflict =
      message.includes("cannot receive STUDENT") || (message.includes("teacher") && message.includes("STUDENT"))
        ? teacherToStudentConflict()
        : studentToTeacherConflict();
    throw createUserRoleError(conflict.status, conflict.message, USER_ROLE_ERROR.BUSINESS_PROFILE_CONFLICT, conflict.details);
  }
  throw error;
}

async function loadBusinessProfile(tx, user, roleKeys = []) {
  if (!user) return emptyBusinessProfile(roleKeys);
  const schoolId = user.school_id ?? user.schoolId ?? null;
  let studentRow = null;
  let teacherRow = null;
  if (schoolId && typeof tx.getActiveStudentProfileByUser === "function") {
    studentRow = await tx.getActiveStudentProfileByUser(user.id, schoolId);
  }
  if (schoolId && typeof tx.getActiveTeacherProfileByUser === "function") {
    teacherRow = await tx.getActiveTeacherProfileByUser(user.id, schoolId);
  }
  return buildBusinessProfile({ studentRow, teacherRow, roleKeys });
}

async function loadBusinessProfilesByUserIds(tx, userIds = [], roleKeysByUser = new Map()) {
  const map = new Map();
  const ids = [...new Set((userIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  const studentRows =
    typeof tx.listActiveStudentProfilesByUserIds === "function"
      ? await tx.listActiveStudentProfilesByUserIds(ids)
      : [];
  const teacherRows =
    typeof tx.listActiveTeacherProfilesByUserIds === "function"
      ? await tx.listActiveTeacherProfilesByUserIds(ids)
      : [];

  const studentsByUser = new Map();
  for (const row of studentRows ?? []) {
    studentsByUser.set(String(row.user_id), {
      id: row.student_id ?? row.id,
      student_code: row.student_code,
      status: row.status,
    });
  }
  const teachersByUser = new Map();
  for (const row of teacherRows ?? []) {
    teachersByUser.set(String(row.user_id), {
      id: row.teacher_id ?? row.id,
      teacher_code: row.teacher_code,
      status: row.status,
    });
  }

  for (const id of ids) {
    map.set(
      id,
      buildBusinessProfile({
        studentRow: studentsByUser.get(id) ?? null,
        teacherRow: teachersByUser.get(id) ?? null,
        roleKeys: roleKeysByUser.get(id) ?? [],
      }),
    );
  }
  return map;
}

async function assertBusinessProfileGrantAllowed(tx, user, school, roleKey) {
  const schoolId = school?.id ?? user.school_id ?? null;
  if (!schoolId) return;

  if (roleKey === TEACHER_KEY && typeof tx.getActiveStudentProfileByUser === "function") {
    const studentProfile = await tx.getActiveStudentProfileByUser(user.id, schoolId);
    if (studentProfile) {
      throwBusinessProfileConflict(studentToTeacherConflict(studentProfile));
    }
  }

  if (roleKey === STUDENT_KEY && typeof tx.getActiveTeacherProfileByUser === "function") {
    const teacherProfile = await tx.getActiveTeacherProfileByUser(user.id, schoolId);
    if (teacherProfile) {
      throwBusinessProfileConflict(teacherToStudentConflict(teacherProfile));
    }
  }
}

async function loadRoleKeys(tx, userId) {
  if (typeof tx.listActiveUserRoleKeys !== "function") {
    const fallback = toRoleKey(tx.role || "");
    return fallback ? [fallback] : [];
  }
  return tx.listActiveUserRoleKeys(userId);
}

async function hydrateUserRow(tx, row) {
  if (!row) return null;
  const roleKeys = await loadRoleKeys(tx, row.id);
  const businessProfile = await loadBusinessProfile(tx, row, roleKeys);
  return hydrateUser(row, roleKeys, businessProfile);
}

async function allocateUserCode(tx) {
  const year = new Date().getUTCFullYear();
  if (typeof tx.allocateUserCode === "function") {
    return tx.allocateUserCode(year);
  }
  const existing = typeof tx.listUserCodes === "function" ? await tx.listUserCodes() : [];
  return nextUserCodeFromExisting(existing, year);
}

async function syncPrimaryRole(tx, userId, roleKeys) {
  const primary = primaryRoleKey(roleKeys);
  if (typeof tx.syncUserPrimaryRole === "function") {
    await tx.syncUserPrimaryRole(userId, primary || null);
  }
}

function assertNotSelfTarget(principal, targetUserId) {
  const actor = actorUserId(principal);
  if (actor && String(actor) === String(targetUserId)) {
    throw createUserRoleError(
      403,
      "Auto-attribution ou auto-révocation interdite.",
      USER_ROLE_ERROR.AUTO_GRANT_FORBIDDEN,
    );
  }
}

async function assertGrantableRole(store, principal, roleInput) {
  let roleKey = toRoleKey(roleInput);
  let label = toRoleLabel(roleKey) || asTrimmed(roleInput);
  if (!isKnownRoleKey(roleKey)) {
    if (typeof store.assertEstablishmentRoleAssignable !== "function") {
      throw createUserRoleError(400, "Rôle inconnu.", USER_ROLE_ERROR.ROLE_UNKNOWN);
    }
    try {
      label = await store.assertEstablishmentRoleAssignable(roleInput, principal);
      roleKey = toRoleKey(label || roleInput);
    } catch (error) {
      if (error?.statusCode === 404) {
        throw createUserRoleError(400, "Rôle inconnu.", USER_ROLE_ERROR.ROLE_UNKNOWN);
      }
      throw error;
    }
  }

  if (isForbiddenAssignRoleKey(roleKey)) {
    const code =
      roleKey === "PARENT" ? USER_ROLE_ERROR.PARENT_ROLE_FORBIDDEN : USER_ROLE_ERROR.STUDENT_ROLE_FORBIDDEN;
    throw createUserRoleError(
      403,
      roleKey === "PARENT"
        ? "Le rôle Parent n'est pas attribuable depuis Comptes utilisateurs."
        : "Le rôle Élève n'est pas attribuable depuis Comptes utilisateurs.",
      code,
    );
  }

  if (roleKey === "SUPER_ADMIN") {
    throw createUserRoleError(
      403,
      "Le rôle Superadmin n'est pas attribuable.",
      USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN,
    );
  }

  if (isPlatformRoleKey(roleKey) && !isSuperAdminPrincipal(principal)) {
    throw createUserRoleError(
      403,
      "Rôle plateforme interdit pour ce principal.",
      USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN,
    );
  }

  if (SCHOOL_PLATFORM_ROLE_KEYS.includes(roleKey) && !isSuperAdminPrincipal(principal) && !isCountryAdminPrincipal(principal)) {
    throw createUserRoleError(
      403,
      "Rôle plateforme interdit pour ce principal.",
      USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN,
    );
  }

  if (typeof store.assertEstablishmentRoleAssignable === "function" && !isPlatformRoleKey(roleKey) && !SCHOOL_PLATFORM_ROLE_KEYS.includes(roleKey)) {
    label = (await store.assertEstablishmentRoleAssignable(label || roleInput, principal)) || label;
  }

  return { roleKey, label };
}

async function activateTeacherProfile(tx, user, school, principal) {
  if (typeof tx.getTeacherBySchoolUser !== "function") {
    return { reused: false, created: false };
  }

  const existing = await tx.getTeacherBySchoolUser(school.id, user.id);
  if (existing) {
    if (asTrimmed(existing.status).toLowerCase() === "inactive") {
      if (typeof tx.reactivateTeacherProfile === "function") {
        await tx.reactivateTeacherProfile(existing.id);
      }
    }
    return { reused: true, created: false, teacherId: existing.id, teacherCode: existing.teacher_code };
  }

  if (typeof tx.findAmbiguousTeacherIdentity === "function") {
    const ambiguous = await tx.findAmbiguousTeacherIdentity(school.id, {
      firstName: user.first_name,
      lastName: user.last_name,
      birthDate: toIsoDate(user.birth_date) || "",
      gender: user.gender,
      excludeUserId: user.id,
    });
    if (ambiguous) {
      throw createUserRoleError(
        409,
        "Identité enseignant ambiguë : un profil distinct existe déjà pour cette identité civile.",
        USER_ROLE_ERROR.TEACHER_PROFILE_AMBIGUOUS,
      );
    }
  }

  if (typeof tx.insertTeacherForUser !== "function") {
    throw createUserRoleError(500, "Activation du profil enseignant indisponible.");
  }

  const teacher = await tx.insertTeacherForUser({
    schoolId: school.id,
    schoolCode: school.school_code,
    userId: user.id,
    speciality: null,
    hireDate: null,
    actorId: actorUserId(principal),
  });
  return { reused: false, created: true, teacherId: teacher.id, teacherCode: teacher.teacher_code };
}

async function assertTeacherRevokeAllowed(tx, user, school) {
  if (typeof tx.getTeacherBySchoolUser !== "function") return null;
  const teacher = await tx.getTeacherBySchoolUser(school.id, user.id);
  if (!teacher) return null;
  const activeCount =
    typeof tx.countActiveTeacherAssignments === "function"
      ? await tx.countActiveTeacherAssignments(teacher.id)
      : 0;
  if (activeCount > 0) {
    throw createUserRoleError(
      409,
      "Révocation enseignant refusée : des affectations actives existent. Désactivez-les d'abord.",
      USER_ROLE_ERROR.TEACHER_REVOKE_BLOCKED_ACTIVE_ASSIGNMENTS,
      { activeAssignments: activeCount },
    );
  }
  return teacher;
}

async function deactivateTeacherProfile(tx, teacher) {
  if (!teacher || typeof tx.deactivateTeacherProfile !== "function") return;
  await tx.deactivateTeacherProfile(teacher.id);
}

async function grantRole(store, userId, rawPayload, principal, auditMeta) {
  assertSingleRoleOperation(rawPayload);
  const payload = ignoreClientScope(rawPayload);
  const { roleKey, label } = await assertGrantableRole(store, principal, payload.role ?? payload.roleKey);

  const existing = await store.getUserById(userId);
  if (!existing) {
    throw createUserRoleError(404, "Utilisateur introuvable.", USER_ROLE_ERROR.USER_NOT_FOUND);
  }

  const attached = await attachUsersStorePrincipal(principal, store);
  assertUsersTargetAccess(attached, targetFromUserRow(existing));
  assertNotSelfTarget(attached, existing.id);
  const schoolCode = asTrimmed(existing.school_login_code || existing.school_code);

  return store.withTransaction(async (tx) => {
    if (typeof tx.lockUserById === "function") {
      await tx.lockUserById(existing.id);
    }
    const locked = await tx.getUserById(existing.id);
    if (!locked) {
      throw createUserRoleError(404, "Utilisateur introuvable.", USER_ROLE_ERROR.USER_NOT_FOUND);
    }

    const beforeKeys = await loadRoleKeys(tx, locked.id);
    const already = beforeKeys.includes(roleKey);
    if (already) {
      throw createUserRoleError(409, "Ce rôle est déjà attribué.", USER_ROLE_ERROR.ROLE_ALREADY_GRANTED);
    }

    let school = null;
    if (locked.school_id && typeof tx.getSchoolById === "function") {
      school = await tx.getSchoolById(locked.school_id);
    }
    if (!school && schoolCode && schoolCode !== "*") {
      school = await tx.getSchoolByCode(schoolCode);
    }
    if (schoolCode && schoolCode !== "*" && !school) {
      throw createUserRoleError(404, "Établissement introuvable.", USER_ROLE_ERROR.SCHOOL_NOT_FOUND);
    }
    const requestedCountry = requestedCountryCodeFromPayload(rawPayload);
    assertRequestedCountryMatchesSchool(school, requestedCountry);
    if (roleKey === SCHOOL_ADMIN_KEY && !school && !locked.school_id) {
      throw createUserRoleError(
        400,
        "Établissement obligatoire pour le rôle Admin School.",
        USER_ROLE_ERROR.INVALID_TENANT_SCOPE,
      );
    }

    await assertBusinessProfileGrantAllowed(tx, locked, school, roleKey);

    let teacherEffect = null;
    try {
      await tx.insertUserRole({
        userId: locked.id,
        schoolId: school?.id ?? locked.school_id ?? null,
        roleKey,
        grantedBy: actorUserId(principal) || null,
      });
    } catch (error) {
      if (isUserRolesUniqueViolation(error)) {
        throw createUserRoleError(409, "Ce rôle est déjà attribué.", USER_ROLE_ERROR.ROLE_ALREADY_GRANTED);
      }
      mapGrantPgError(error);
    }

    if (roleKey === TEACHER_KEY) {
      if (!school) {
        throw createUserRoleError(400, "Établissement requis pour le profil enseignant.");
      }
      try {
        teacherEffect = await activateTeacherProfile(tx, locked, school, principal);
      } catch (error) {
        mapGrantPgError(error);
      }
    }

    const afterKeys = await loadRoleKeys(tx, locked.id);
    await syncPrimaryRole(tx, locked.id, afterKeys);

    const requiresSuperAdminValidation =
      isCountryAdminPrincipal(principal) && roleKey === SCHOOL_ADMIN_KEY;
    if (requiresSuperAdminValidation && typeof tx.updateUser === "function") {
      const profile = parsePayload(locked.profile_payload);
      profile.validationStatus = PENDING_VALIDATION_STATUS;
      profile.validationRequestedBy = principal?.identifier || principal?.email || "Admin Pays";
      profile.validationRequestedAt = new Date().toISOString();
      await tx.updateUser(locked.id, {
        firstName: locked.first_name,
        lastName: locked.last_name,
        email: locked.email,
        phone: locked.phone,
        gender: locked.gender,
        birthDate: locked.birth_date,
        role: toDbRole(toRoleLabel(primaryRoleKey(afterKeys))) || null,
        status: toDbStatus(PENDING_VALIDATION_STATUS),
        profile,
      });
    }

    const saved = await tx.getUserById(locked.id);
    const businessProfile = await loadBusinessProfile(tx, saved, afterKeys);
    const hydrated = hydrateUser(saved, afterKeys, businessProfile);

    await tx.recordClientsAudit({
      schoolCode,
      userId: actorUserId(principal),
      action: "grant_role",
      entityType: "user_role",
      entityId: locked.id,
      oldValue: { userId: locked.id, roleKeys: beforeKeys, role: displayRoles(beforeKeys).assignmentStatus },
      newValue: {
        userId: locked.id,
        roleKey,
        role: label,
        roleKeys: afterKeys,
        operation: "GRANT",
        teacher: teacherEffect,
        actor: actorUserId(principal),
        grantedAt: new Date().toISOString(),
      },
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    });

    return hydrated;
  });
}

async function revokeRole(store, userId, rawPayload, principal, auditMeta) {
  assertSingleRoleOperation(rawPayload);
  const payload = ignoreClientScope(rawPayload);
  const roleKey = toRoleKey(payload.role ?? payload.roleKey);
  if (!roleKey) {
    throw createUserRoleError(400, "Rôle inconnu.", USER_ROLE_ERROR.ROLE_UNKNOWN);
  }
  if (isForbiddenAssignRoleKey(roleKey)) {
    const code =
      roleKey === "PARENT" ? USER_ROLE_ERROR.PARENT_ROLE_FORBIDDEN : USER_ROLE_ERROR.STUDENT_ROLE_FORBIDDEN;
    throw createUserRoleError(403, "Ce rôle ne peut pas être retiré depuis Attribuer.", code);
  }

  const existing = await store.getUserById(userId);
  if (!existing) {
    throw createUserRoleError(404, "Utilisateur introuvable.", USER_ROLE_ERROR.USER_NOT_FOUND);
  }

  const attached = await attachUsersStorePrincipal(principal, store);
  assertUsersTargetAccess(attached, targetFromUserRow(existing));
  assertNotSelfTarget(attached, existing.id);
  const schoolCode = asTrimmed(existing.school_login_code || existing.school_code);

  if (isPlatformRoleKey(roleKey) && !isSuperAdminPrincipal(principal)) {
    throw createUserRoleError(403, "Rôle plateforme interdit pour ce principal.", USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN);
  }

  return store.withTransaction(async (tx) => {
    if (typeof tx.lockUserById === "function") {
      await tx.lockUserById(existing.id);
    }
    const locked = await tx.getUserById(existing.id);
    if (!locked) {
      throw createUserRoleError(404, "Utilisateur introuvable.", USER_ROLE_ERROR.USER_NOT_FOUND);
    }

    const beforeKeys = await loadRoleKeys(tx, locked.id);
    if (!beforeKeys.includes(roleKey)) {
      throw createUserRoleError(404, "Ce rôle n'est pas attribué.", USER_ROLE_ERROR.ROLE_NOT_GRANTED);
    }

    let school = null;
    if (locked.school_id && typeof tx.getSchoolById === "function") {
      school = await tx.getSchoolById(locked.school_id);
    }
    if (!school && schoolCode && schoolCode !== "*") {
      school = await tx.getSchoolByCode(schoolCode);
    }
    let teacher = null;
    if (roleKey === TEACHER_KEY && school) {
      teacher = await assertTeacherRevokeAllowed(tx, locked, school);
    }

    const revoked = await tx.revokeUserRole({
      userId: locked.id,
      schoolId: school?.id ?? locked.school_id ?? null,
      roleKey,
      revokedBy: actorUserId(principal) || null,
    });
    if (!revoked) {
      throw createUserRoleError(404, "Ce rôle n'est pas attribué.", USER_ROLE_ERROR.ROLE_NOT_GRANTED);
    }

    if (roleKey === TEACHER_KEY) {
      await deactivateTeacherProfile(tx, teacher);
    }

    const afterKeys = await loadRoleKeys(tx, locked.id);
    await syncPrimaryRole(tx, locked.id, afterKeys);
    const saved = await tx.getUserById(locked.id);
    const businessProfile = await loadBusinessProfile(tx, saved, afterKeys);
    const hydrated = hydrateUser(saved, afterKeys, businessProfile);

    await tx.recordClientsAudit({
      schoolCode,
      userId: actorUserId(principal),
      action: "revoke_role",
      entityType: "user_role",
      entityId: locked.id,
      oldValue: { userId: locked.id, roleKeys: beforeKeys, roleKey, operation: "REVOKE" },
      newValue: {
        userId: locked.id,
        roleKey,
        roleKeys: afterKeys,
        assignmentStatus: hydrated.assignmentStatus,
        operation: "REVOKE",
        teacherDeactivated: Boolean(teacher),
        actor: actorUserId(principal),
        revokedAt: new Date().toISOString(),
      },
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    });

    return hydrated;
  });
}

async function listAssignableRolesForPrincipal(store, principal) {
  if (typeof store.listEstablishmentAssignableRoles === "function") {
    const catalogue = await store.listEstablishmentAssignableRoles(principal);
    return catalogue
      .map((row) => ({
        roleKey: toRoleKey(row.roleCode || row.roleName),
        roleName: row.roleName,
      }))
      .filter(
        (row) =>
          row.roleKey &&
          row.roleName &&
          !isForbiddenAssignRoleKey(row.roleKey) &&
          !isForbiddenAssignRoleKey(row.roleName) &&
          !isPlatformRoleKey(row.roleKey),
      );
  }
  const defaults = ["SCHOOL_ADMIN", "PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "ACCOUNTANT", "SECRETARY", "SUPERVISOR", "TEACHER"];
  const allowed = isSuperAdminPrincipal(principal)
    ? ["COUNTRY_ADMIN", "SCHOOL_ADMIN", ...defaults]
    : isCountryAdminPrincipal(principal)
      ? ["SCHOOL_ADMIN", ...defaults.filter((key) => key !== "SCHOOL_ADMIN")]
      : defaults.filter((key) => key !== "SCHOOL_ADMIN");
  return allowed
    .filter((key) => !isForbiddenAssignRoleKey(key))
    .map((roleKey) => ({ roleKey, roleName: toRoleLabel(roleKey) }));
}

module.exports = {
  hydrateUser,
  hydrateUserRow,
  loadBusinessProfilesByUserIds,
  allocateUserCode,
  syncPrimaryRole,
  grantRole,
  revokeRole,
  listAssignableRolesForPrincipal,
  assertGrantableRole,
  assertNoClientPrivilegeKeys,
  FORBIDDEN_CREATE_KEYS,
  FORBIDDEN_IDENTITY_PATCH_KEYS,
};
