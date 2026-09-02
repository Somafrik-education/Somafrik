"use strict";

/**
 * Liaison parent ↔ élève canonique PostgreSQL.
 *
 * Élève existant → identité (fail-closed) → réutiliser OU créer
 * → GRANT PARENT → relation active → une transaction.
 */

const { hashSecret } = require("../services/credentialService");
const {
  CLIENTS_ERROR,
  asTrimmed,
  createClientsError,
  ignoreClientScope,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  assertSchoolScope,
  assertSchoolInPrincipalCountry,
  generateTemporaryPassword,
  resolveUserIdentifier,
  mapUserRow,
  mapContactRow,
  mapRelationRow,
  parsePayload,
  toDbStatus,
} = require("./clientsManagement");
const { toDbRole } = require("./clientsRolePolicy");
const { allocateUserCode, hydrateUser, syncPrimaryRole } = require("./userRoleLifecycleService");
const {
  toRoleKey,
  isUserRolesUniqueViolation,
} = require("./userRoleLifecycle");
const { findActiveUserByLoginIdentity, PARENT_IDENTITY_AMBIGUOUS } = require("./usersLoginIdentity");
const { isContactRelationsActiveUniquenessViolation } = require("./parentLinkingConstraints");
const { grantedByUserId } = require("./principalIdentity");

const PARENT_ROLE_LABEL = "Parent";
const PARENT_ROLE_KEY = "PARENT";
const PARENT_CONTACT_TYPE = "Parent";
const CANONICAL_RELATION_TYPE = "parent_student";
const ACCEPTED_RELATION_TYPES = new Set([
  CANONICAL_RELATION_TYPE,
  "parent → élève",
  "parent-enfant",
  "parent_child",
]);

function identityKey(value) {
  return asTrimmed(value).toLowerCase();
}

function normalizeRelationType(value) {
  const raw = asTrimmed(value);
  if (!raw) return CANONICAL_RELATION_TYPE;
  if (ACCEPTED_RELATION_TYPES.has(raw.toLowerCase())) return CANONICAL_RELATION_TYPE;
  return raw;
}

function resolveWritableSchoolCode(principal, rawPayload) {
  let schoolCode = asTrimmed(principal?.schoolCode);
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    schoolCode = asTrimmed(rawPayload.schoolCode || rawPayload.schoolId || schoolCode);
  }
  return schoolCode.toUpperCase();
}

async function writeClientsAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordClientsAudit !== "function") {
    throw createClientsError(500, "Audit clients indisponible dans la transaction.");
  }
  await tx.recordClientsAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode,
    userId: grantedByUserId(principal),
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

function relationProfile(contact, student) {
  return {
    fromContactName: `${contact.first_name ?? contact.firstName ?? ""} ${contact.last_name ?? contact.lastName ?? ""}`.trim(),
    toStudentName: `${student.first_name ?? student.firstName ?? ""} ${student.last_name ?? student.lastName ?? student.name ?? ""}`.trim(),
  };
}

function publicUser(userRow, roleKeys, extras = {}) {
  const hydrated = hydrateUser(userRow, roleKeys);
  return {
    ...hydrated,
    passwordHash: undefined,
    pinHash: undefined,
    ...extras,
  };
}

async function loadRoleKeys(tx, userId) {
  if (typeof tx.listActiveUserRoleKeys !== "function") return [];
  return tx.listActiveUserRoleKeys(userId);
}

async function ensureParentRole(tx, { userId, schoolId, principal }) {
  const keys = await loadRoleKeys(tx, userId);
  if (keys.map((key) => toRoleKey(key)).includes(PARENT_ROLE_KEY)) {
    if (typeof syncPrimaryRole === "function") {
      await syncPrimaryRole(tx, userId, keys);
    }
    return { granted: false, roleKeys: keys };
  }
  try {
    await tx.insertUserRole({
      userId,
      schoolId,
      roleKey: PARENT_ROLE_KEY,
      grantedBy: grantedByUserId(principal),
    });
  } catch (error) {
    if (!isUserRolesUniqueViolation(error)) throw error;
  }
  const after = await loadRoleKeys(tx, userId);
  await syncPrimaryRole(tx, userId, after);
  return { granted: true, roleKeys: after };
}

async function findActiveContactByIdentity(tx, schoolId, { userId, email, phone }) {
  const matches = [];
  const pushUnique = (row) => {
    if (!row?.id) return;
    if (matches.some((item) => String(item.id) === String(row.id))) return;
    matches.push(row);
  };

  if (userId && typeof tx.getActiveContactByUserId === "function") {
    const byUser = await tx.getActiveContactByUserId(schoolId, userId);
    pushUnique(byUser);
  }
  if (email && typeof tx.findActiveContactByEmail === "function") {
    const byEmail = await tx.findActiveContactByEmail(schoolId, email);
    pushUnique(byEmail);
  }
  if (phone && typeof tx.findActiveContactByPhone === "function") {
    const byPhone = await tx.findActiveContactByPhone(schoolId, phone);
    pushUnique(byPhone);
  }

  if (matches.length > 1) {
    throw createClientsError(
      409,
      "Plusieurs contacts actifs correspondent à cette identité dans l'établissement.",
      CLIENTS_ERROR.PARENT_CONTACT_AMBIGUOUS,
      { contactIds: matches.map((row) => row.id) },
    );
  }
  return matches[0] || null;
}

async function ensureCanonicalContact(tx, input) {
  const {
    school,
    user,
    firstName,
    lastName,
    phone,
    email,
    contactType = PARENT_CONTACT_TYPE,
  } = input;
  const userId = user?.id ?? null;
  const existing = await findActiveContactByIdentity(tx, school.id, {
    userId,
    email,
    phone,
  });

  if (existing) {
    if (existing.user_id && userId && String(existing.user_id) !== String(userId)) {
      throw createClientsError(
        409,
        "Ce contact est déjà lié à un autre compte utilisateur.",
        CLIENTS_ERROR.PARENT_CONTACT_AMBIGUOUS,
      );
    }
    const nextFirst = asTrimmed(firstName) || existing.first_name;
    const nextLast = asTrimmed(lastName) || existing.last_name;
    const nextPhone = asTrimmed(phone) || existing.phone;
    const nextEmail = asTrimmed(email) || existing.email;
    let saved = existing;
    if (
      nextFirst !== existing.first_name ||
      nextLast !== existing.last_name ||
      nextPhone !== (existing.phone || "") ||
      nextEmail !== (existing.email || "")
    ) {
      saved = await tx.updateContact(existing.id, {
        firstName: nextFirst,
        lastName: nextLast,
        contactType: existing.contact_type || contactType,
        phone: nextPhone,
        email: nextEmail,
        gender: existing.gender,
        birthDate: existing.birth_date,
        address: existing.address,
        status: existing.status || "active",
        profile: parsePayload(existing.profile_payload),
      });
    }
    if (userId && !saved.user_id) {
      saved = await tx.linkContactUser(saved.id, userId, {
        ...parsePayload(saved.profile_payload),
        role: PARENT_ROLE_LABEL,
        hasAccess: "Oui",
      });
    }
    return { contact: saved, created: false };
  }

  const created = await tx.insertContact({
    schoolId: school.id,
    countryId: school.country_id,
    firstName: asTrimmed(firstName),
    lastName: asTrimmed(lastName),
    contactType,
    phone: asTrimmed(phone),
    email: asTrimmed(email),
    gender: "",
    birthDate: null,
    address: "",
    status: "active",
    profile: { role: PARENT_ROLE_LABEL, hasAccess: userId ? "Oui" : "Non" },
  });
  let saved = created;
  if (userId) {
    saved = await tx.linkContactUser(created.id, userId, {
      ...parsePayload(created.profile_payload),
      role: PARENT_ROLE_LABEL,
      hasAccess: "Oui",
    });
  }
  return { contact: saved, created: true };
}

async function ensureActiveParentRelation(tx, { school, contact, student }) {
  if (typeof tx.getActiveRelationByContactAndStudent === "function") {
    const active = await tx.getActiveRelationByContactAndStudent(contact.id, student.id);
    if (active) return { relation: active, created: false };
  } else {
    const existing = await tx.getRelationByContactAndStudent(contact.id, student.id);
    if (existing && toDbStatus(existing.status) === "active") {
      return { relation: existing, created: false };
    }
  }

  try {
    const saved = await tx.insertRelation({
      schoolId: school.id,
      countryId: school.country_id ?? contact.country_id,
      contactId: contact.id,
      studentId: student.id,
      profile: relationProfile(contact, student),
    });
    return { relation: saved, created: true };
  } catch (error) {
    if (!isContactRelationsActiveUniquenessViolation(error) && error?.code !== "23505") {
      throw error;
    }
    const existing =
      typeof tx.getActiveRelationByContactAndStudent === "function"
        ? await tx.getActiveRelationByContactAndStudent(contact.id, student.id)
        : await tx.getRelationByContactAndStudent(contact.id, student.id);
    if (existing) return { relation: existing, created: false };
    throw error;
  }
}

async function lockParentLink(tx, schoolId, email, phone) {
  if (typeof tx.advisoryXactLock !== "function") return;
  await tx.advisoryXactLock(`parent-link:${schoolId}:${identityKey(email)}:${identityKey(phone)}`);
}

function parseLinkPayload(rawPayload = {}) {
  const scoped = ignoreClientScope(rawPayload);
  const studentId = asTrimmed(rawPayload.studentId || rawPayload.toStudentId || scoped.studentId);
  const firstName = asTrimmed(rawPayload.firstName || scoped.firstName);
  const lastName = asTrimmed(rawPayload.lastName || scoped.lastName);
  const phone = asTrimmed(rawPayload.phone || scoped.phone);
  const email = asTrimmed(rawPayload.email || scoped.email);
  const relationType = normalizeRelationType(rawPayload.relationType || scoped.relationType);
  return { studentId, firstName, lastName, phone, email, relationType };
}

async function lookupParentIdentity(store, query, principal) {
  const phone = asTrimmed(query?.phone);
  const email = asTrimmed(query?.email);
  if (!phone && !email) {
    throw createClientsError(400, "Téléphone ou email obligatoire.", CLIENTS_ERROR.PARENT_IDENTITY_REQUIRED);
  }
  const schoolCode = resolveWritableSchoolCode(principal, query ?? {});
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }
    await lockParentLink(tx, school.id, email, phone);
    let identity;
    try {
      identity = await findActiveUserByLoginIdentity(tx, {
        schoolId: school.id,
        email,
        phone,
      });
    } catch (error) {
      if (error?.code === PARENT_IDENTITY_AMBIGUOUS) {
        throw createClientsError(409, error.message, CLIENTS_ERROR.PARENT_IDENTITY_AMBIGUOUS, error.details);
      }
      throw error;
    }
    if (!identity?.id) {
      return { found: false, reuse: false, user: null, contact: null };
    }
    const user = await tx.getUserById(identity.id);
    if (user?.school_id && String(user.school_id) !== String(school.id)) {
      throw createClientsError(403, "Identité hors établissement.", CLIENTS_ERROR.TENANT_MISMATCH);
    }
    const contact = await findActiveContactByIdentity(tx, school.id, {
      userId: identity.id,
      email: user?.email || email,
      phone: user?.phone || phone,
    });
    const roleKeys = await loadRoleKeys(tx, identity.id);
    return {
      found: true,
      reuse: true,
      message: "Ce compte sera réutilisé",
      user: publicUser(user, roleKeys),
      contact: contact ? mapContactRow(contact) : null,
    };
  });
}

async function linkParent(store, rawPayload, principal, auditMeta) {
  const payload = parseLinkPayload(rawPayload);
  if (!payload.studentId) {
    throw createClientsError(400, "Élève obligatoire.", CLIENTS_ERROR.STUDENT_NOT_FOUND);
  }
  if (!payload.phone && !payload.email) {
    throw createClientsError(400, "Téléphone ou email obligatoire.", CLIENTS_ERROR.PARENT_IDENTITY_REQUIRED);
  }
  if (payload.relationType !== CANONICAL_RELATION_TYPE) {
    throw createClientsError(
      400,
      "Type de relation invalide. Utilisez parent_student.",
      CLIENTS_ERROR.PARENT_RELATION_TYPE_INVALID,
    );
  }

  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }
    await lockParentLink(tx, school.id, payload.email, payload.phone);

    const student = await tx.getStudentById(payload.studentId);
    if (!student || String(student.school_id) !== String(school.id)) {
      throw createClientsError(404, "Élève introuvable dans cet établissement.", CLIENTS_ERROR.STUDENT_NOT_FOUND);
    }

    let identity;
    try {
      identity = await findActiveUserByLoginIdentity(tx, {
        schoolId: school.id,
        email: payload.email,
        phone: payload.phone,
      });
    } catch (error) {
      if (error?.code === PARENT_IDENTITY_AMBIGUOUS) {
        throw createClientsError(409, error.message, CLIENTS_ERROR.PARENT_IDENTITY_AMBIGUOUS, error.details);
      }
      throw error;
    }

    let user = identity?.id ? await tx.getUserById(identity.id) : null;
    let createdUser = false;
    let temporaryPassword = null;

    if (user) {
      if (user.school_id && String(user.school_id) !== String(school.id)) {
        throw createClientsError(403, "Identité hors établissement.", CLIENTS_ERROR.TENANT_MISMATCH);
      }
    } else {
      const firstName = payload.firstName;
      const lastName = payload.lastName;
      if (!firstName || !lastName) {
        throw createClientsError(400, "Nom et prénom obligatoires pour créer le parent.", CLIENTS_ERROR.PARENT_NAME_REQUIRED);
      }
      temporaryPassword = generateTemporaryPassword();
      const userCode = await allocateUserCode(tx);
      const identifier = resolveUserIdentifier({
        role: PARENT_ROLE_LABEL,
        phone: payload.phone,
        email: payload.email,
        userCode,
      });
      user = await tx.insertUser({
        schoolId: school.id,
        userCode,
        firstName,
        lastName,
        email: payload.email,
        phone: payload.phone,
        gender: "",
        birthDate: null,
        role: toDbRole(PARENT_ROLE_LABEL),
        status: "active",
        passwordHash: hashSecret(temporaryPassword),
        mustChangePassword: true,
        profile: {
          identifier,
          accessChannel: "Application",
          createdBy: principal?.identifier || "system",
          role: PARENT_ROLE_LABEL,
        },
      });
      createdUser = true;
    }

    const firstName = payload.firstName || user.first_name || user.firstName;
    const lastName = payload.lastName || user.last_name || user.lastName;
    const { contact } = await ensureCanonicalContact(tx, {
      school,
      user,
      firstName,
      lastName,
      phone: payload.phone || user.phone,
      email: payload.email || user.email,
    });

    const roleGrant = await ensureParentRole(tx, {
      userId: user.id,
      schoolId: school.id,
      principal,
    });

    const { relation, created } = await ensureActiveParentRelation(tx, { school, contact, student });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "link_parent",
      entityType: "relation",
      entityId: relation.id,
      newValue: {
        userId: user.id,
        contactId: contact.id,
        studentId: student.id,
        createdUser,
        createdRelation: created,
        grantedParent: roleGrant.granted,
      },
    });

    const extras = createdUser
      ? { temporaryPassword, hasTemporaryPassword: true }
      : {};
    return {
      created,
      reusedUser: !createdUser,
      createdUser,
      grantedParent: roleGrant.granted,
      message: created ? "Parent lié à l'élève" : "Relation déjà existante",
      user: publicUser(user, roleGrant.roleKeys, extras),
      contact: mapContactRow(contact),
      relation: mapRelationRow(relation),
      ...(createdUser ? { temporaryPassword } : {}),
    };
  });
}

async function archiveParentRelation(store, relationId, rawPatch, principal, auditMeta) {
  const status = toDbStatus(rawPatch?.status || "archived");
  if (status !== "archived") {
    throw createClientsError(400, "Seule l'archivage de la relation est autorisé.");
  }
  const id = asTrimmed(relationId);
  if (!id) {
    throw createClientsError(404, "Relation introuvable.", CLIENTS_ERROR.RELATION_NOT_FOUND);
  }

  return store.withTransaction(async (tx) => {
    const existing =
      typeof tx.getRelationById === "function"
        ? await tx.getRelationById(id)
        : null;
    if (!existing) {
      throw createClientsError(404, "Relation introuvable.", CLIENTS_ERROR.RELATION_NOT_FOUND);
    }
    assertSchoolScope(principal, existing.school_code);
    await assertSchoolInPrincipalCountry(store, principal, existing.school_code);

    if (toDbStatus(existing.status) === "archived") {
      return { relation: mapRelationRow(existing), archived: false };
    }

    const saved = await tx.archiveRelation(existing.id);
    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode: existing.school_code,
      action: "archive_relation",
      entityType: "relation",
      entityId: existing.id,
      oldValue: mapRelationRow(existing),
      newValue: mapRelationRow(saved),
    });
    return { relation: mapRelationRow(saved), archived: true };
  });
}

module.exports = {
  PARENT_ROLE_KEY,
  CANONICAL_RELATION_TYPE,
  lookupParentIdentity,
  linkParent,
  archiveParentRelation,
  ensureCanonicalContact,
  ensureActiveParentRelation,
  parseLinkPayload,
};
