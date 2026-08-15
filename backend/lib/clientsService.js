"use strict";

const { hashSecret } = require("../services/credentialService");
const {
  CLIENTS_ERROR,
  ROLE_TO_DB,
  asTrimmed,
  createClientsError,
  ignoreClientScope,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  assertSchoolScope,
  assertSchoolInPrincipalCountry,
  generateTemporaryPassword,
  generateUserCode,
  resolveUserIdentifier,
  toIsoDate,
  toDbStatus,
  mapUserRow,
  mapContactRow,
  mapRelationRow,
  mapMessageRow,
  mapAnnouncementRow,
  parsePayload,
} = require("./clientsManagement");
const {
  assertProvisionContactRole,
  toDbRole,
  assertSafeUserPatch,
  mergeUserProfileForUpdate,
  PROVISION_CONTACT_ROLE,
} = require("./clientsRolePolicy");
const {
  allocateUserCode,
  hydrateUser,
  FORBIDDEN_CREATE_KEYS,
  FORBIDDEN_IDENTITY_PATCH_KEYS,
} = require("./userRoleLifecycleService");
const {
  USER_ROLE_ERROR,
  assertNoClientPrivilegeKeys,
  displayRoles,
  toRoleKey,
} = require("./userRoleLifecycle");
const {
  findActiveUserByLoginIdentity,
  assertUniqueUserLoginIdentity,
  isUsersLoginIdentityUniquenessViolation,
} = require("./usersLoginIdentity");

const SCHOOL_ADMIN_ROLE = "Admin School";
const PENDING_VALIDATION_STATUS = "En attente de validation";

async function assertStudentInContactSchool(tx, contact, studentId) {
  const student = await tx.getStudentById(studentId);
  if (!student || student.school_id !== contact.school_id) {
    throw createClientsError(404, "Élève introuvable dans cet établissement.", CLIENTS_ERROR.STUDENT_NOT_FOUND);
  }
  return student;
}

async function assertParticipantsInSchool(tx, school, participantUserIds) {
  for (const userId of participantUserIds) {
    const user = await tx.getUserById(userId);
    if (!user) {
      throw createClientsError(404, "Participant introuvable.", CLIENTS_ERROR.USER_NOT_FOUND);
    }
    if (user.school_id && user.school_id !== school.id) {
      throw createClientsError(403, "Participant hors établissement.", CLIENTS_ERROR.FORBIDDEN);
    }
  }
}

async function writeClientsAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordClientsAudit !== "function") {
    throw createClientsError(500, "Audit clients indisponible dans la transaction.");
  }
  await tx.recordClientsAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode,
    userId: principal?.sub || principal?.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

function resolveWritableSchoolCode(principal, rawPayload) {
  let schoolCode = asTrimmed(principal?.schoolCode);
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    schoolCode = asTrimmed(rawPayload.schoolCode || rawPayload.schoolId || schoolCode);
  }
  return schoolCode.toUpperCase();
}

function rethrowLoginIdentityConflict(error) {
  if (
    error?.code === "USER_LOGIN_IDENTITY_DUPLICATE" ||
    isUsersLoginIdentityUniquenessViolation(error)
  ) {
    throw createClientsError(
      409,
      error.message || "Un compte avec cet email ou ce téléphone existe déjà.",
      CLIENTS_ERROR.DUPLICATE,
    );
  }
  throw error;
}

async function createUser(store, rawPayload, principal, auditMeta) {
  assertNoClientPrivilegeKeys(rawPayload, FORBIDDEN_CREATE_KEYS, USER_ROLE_ERROR.ROLE_NOT_ALLOWED_ON_CREATE);
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  const firstName = asTrimmed(payload.firstName);
  const lastName = asTrimmed(payload.lastName);
  if (!firstName || !lastName) {
    throw createClientsError(400, "Prénom et nom obligatoires.");
  }

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }

    const temporaryPassword = asTrimmed(payload.temporaryPassword) || generateTemporaryPassword();
    const userCode = await allocateUserCode(tx);
    const identifier = resolveUserIdentifier({
      role: "",
      phone: payload.phone,
      email: payload.email,
      userCode,
    });

    const email = asTrimmed(payload.email);
    const phone = asTrimmed(payload.phone);
    await assertUniqueUserLoginIdentity(tx, {
      schoolId: school.id,
      email,
      phone,
    }).catch(rethrowLoginIdentityConflict);

    const profile = {
      contactId: payload.contactId,
      identifier,
      accessChannel: payload.accessChannel ?? "Application",
      createdBy: principal?.identifier || principal?.email || "system",
      ...(payload.validationStatus ? { validationStatus: payload.validationStatus } : {}),
      ...(payload.validationRequestedBy ? { validationRequestedBy: payload.validationRequestedBy } : {}),
      ...(payload.validatedBy ? { validatedBy: payload.validatedBy } : {}),
      ...(payload.validatedAt ? { validatedAt: payload.validatedAt } : {}),
      ...(Array.isArray(payload.history) ? { history: payload.history } : {}),
    };

    const initialStatus = payload.status || "Actif";

    let saved;
    try {
      saved = await tx.insertUser({
        schoolId: school.id,
        userCode,
        firstName,
        lastName,
        email,
        phone,
        gender: asTrimmed(payload.gender),
        birthDate: toIsoDate(payload.birthDate),
        role: null,
        status: toDbStatus(initialStatus),
        passwordHash: hashSecret(temporaryPassword),
        mustChangePassword: true,
        profile,
      });
    } catch (error) {
      rethrowLoginIdentityConflict(error);
    }

    const hydrated = hydrateUser(saved, []);
    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_user",
      entityType: "user",
      entityId: saved.id,
      newValue: hydrated,
    });

    return {
      ...hydrated,
      temporaryPassword,
      hasTemporaryPassword: true,
    };
  });
}

async function updateUser(store, userId, rawPatch, principal, auditMeta) {
  assertNoClientPrivilegeKeys(rawPatch, FORBIDDEN_IDENTITY_PATCH_KEYS, USER_ROLE_ERROR.ROLE_NOT_ALLOWED_ON_PATCH);
  const patch = ignoreClientScope(rawPatch);

  const existing = await store.getUserById(userId);
  if (!existing) {
    throw createClientsError(404, "Utilisateur introuvable.", CLIENTS_ERROR.USER_NOT_FOUND);
  }
  const schoolCode = existing.school_code;
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);
  assertSafeUserPatch(principal, existing, patch);

  return store.withTransaction(async (tx) => {
    const locked = await tx.getUserById(userId);
    if (!locked) {
      throw createClientsError(404, "Utilisateur introuvable.", CLIENTS_ERROR.USER_NOT_FOUND);
    }

    const profile = mergeUserProfileForUpdate(parsePayload(locked.profile_payload), patch);
    const nextEmail = patch.email !== undefined ? asTrimmed(patch.email) : locked.email;
    const nextPhone = patch.phone !== undefined ? asTrimmed(patch.phone) : locked.phone;

    await assertUniqueUserLoginIdentity(tx, {
      schoolId: locked.school_id,
      email: nextEmail,
      phone: nextPhone,
      excludeUserId: locked.id,
    }).catch(rethrowLoginIdentityConflict);

    let saved;
    try {
      saved = await tx.updateUser(locked.id, {
        firstName: patch.firstName ?? locked.first_name,
        lastName: patch.lastName ?? locked.last_name,
        email: nextEmail,
        phone: nextPhone,
        gender: patch.gender ?? locked.gender,
        birthDate: patch.birthDate !== undefined ? toIsoDate(patch.birthDate) : locked.birth_date,
        role: locked.role,
        status: patch.status ? toDbStatus(patch.status) : locked.status,
        profile,
      });
    } catch (error) {
      rethrowLoginIdentityConflict(error);
    }

    const roleKeys =
      typeof tx.listActiveUserRoleKeys === "function" ? await tx.listActiveUserRoleKeys(saved.id) : [];
    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "update_user",
      entityType: "user",
      entityId: saved.id,
      oldValue: hydrateUser(locked, roleKeys),
      newValue: hydrateUser(saved, roleKeys),
    });
    return hydrateUser(saved, roleKeys);
  });
}

async function createContact(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  const firstName = asTrimmed(payload.firstName);
  const lastName = asTrimmed(payload.lastName);
  const contactType = asTrimmed(payload.contactType);
  if (!firstName || !lastName || !contactType) {
    throw createClientsError(400, "Nom, prénom et type de contact obligatoires.");
  }

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }

    const profile = {
      accountName: payload.accountName,
      role: payload.role,
      secondaryRole: payload.secondaryRole,
      hasAccess: payload.hasAccess,
      address: payload.address,
    };

    const saved = await tx.insertContact({
      schoolId: school.id,
      countryId: school.country_id,
      firstName,
      lastName,
      contactType,
      phone: asTrimmed(payload.phone),
      email: asTrimmed(payload.email),
      gender: asTrimmed(payload.gender),
      birthDate: toIsoDate(payload.birthDate),
      address: asTrimmed(payload.address),
      status: toDbStatus(payload.status || "Actif"),
      profile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_contact",
      entityType: "contact",
      entityId: saved.id,
      newValue: mapContactRow({ ...saved, school_code: schoolCode, school_name: school.name }),
    });
    return mapContactRow({ ...saved, school_code: schoolCode, school_name: school.name });
  });
}

async function updateContact(store, contactId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getContactById(contactId);
    if (!existing) {
      throw createClientsError(404, "Contact introuvable.", CLIENTS_ERROR.CONTACT_NOT_FOUND);
    }
    assertSchoolScope(principal, existing.school_code);
    await assertSchoolInPrincipalCountry(store, principal, existing.school_code);

    const profile = { ...parsePayload(existing.profile_payload) };
    for (const key of ["accountName", "role", "secondaryRole", "hasAccess", "address"]) {
      if (patch[key] !== undefined) profile[key] = patch[key];
    }

    const saved = await tx.updateContact(existing.id, {
      firstName: patch.firstName ?? existing.first_name,
      lastName: patch.lastName ?? existing.last_name,
      contactType: patch.contactType ?? existing.contact_type,
      phone: patch.phone ?? existing.phone,
      email: patch.email ?? existing.email,
      gender: patch.gender ?? existing.gender,
      birthDate: patch.birthDate !== undefined ? toIsoDate(patch.birthDate) : existing.birth_date,
      address: patch.address ?? existing.address,
      status: patch.status ? toDbStatus(patch.status) : existing.status,
      profile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode: existing.school_code,
      action: "update_contact",
      entityType: "contact",
      entityId: saved.id,
      oldValue: mapContactRow(existing),
      newValue: mapContactRow(saved),
    });
    return mapContactRow(saved);
  });
}

/**
 * Provisionnement atomique contact → compte Parent (+ relation optionnelle).
 * Idempotent si le contact possède déjà un user_id.
 */
async function provisionContactAccount(store, contactId, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const role = assertProvisionContactRole(payload.role);
  const studentId = asTrimmed(payload.studentId || payload.toStudentId);

  return store.withTransaction(async (tx) => {
    const contact = await tx.getContactByIdForUpdate(contactId);
    if (!contact) {
      throw createClientsError(404, "Contact introuvable.", CLIENTS_ERROR.CONTACT_NOT_FOUND);
    }
    assertSchoolScope(principal, contact.school_code);
    await assertSchoolInPrincipalCountry(store, principal, contact.school_code);

    if (contact.user_id) {
      const existingUser = await tx.getUserById(contact.user_id);
      let relation = null;
      if (studentId) {
        const student = await assertStudentInContactSchool(tx, contact, studentId);
        relation = await tx.getRelationByContactAndStudent(contact.id, student.id);
        if (!relation) {
          relation = await tx.insertRelation({
            schoolId: contact.school_id,
            countryId: contact.country_id,
            contactId: contact.id,
            studentId: student.id,
            profile: {
              fromContactName: `${contact.first_name} ${contact.last_name}`.trim(),
              toStudentName: `${student.first_name ?? ""} ${student.last_name ?? student.name ?? ""}`.trim(),
            },
          });
          await writeClientsAudit(tx, principal, auditMeta, {
            schoolCode: contact.school_code,
            action: "create_relation",
            entityType: "relation",
            entityId: relation.id,
            newValue: mapRelationRow(relation),
          });
        }
      }
      return {
        contact: mapContactRow(contact),
        user: mapUserRow(existingUser),
        relation: relation ? mapRelationRow(relation) : null,
        created: false,
      };
    }

    const existingIdentity = await findActiveUserByLoginIdentity(tx, {
      schoolId: contact.school_id,
      email: contact.email,
      phone: contact.phone,
    });
    if (existingIdentity?.id) {
      const reused = await tx.getUserById(existingIdentity.id);
      if (!reused) {
        throw createClientsError(404, "Utilisateur introuvable.", CLIENTS_ERROR.USER_NOT_FOUND);
      }
      const updatedContact = await tx.linkContactUser(contact.id, reused.id, {
        ...parsePayload(contact.profile_payload),
        role: PROVISION_CONTACT_ROLE,
        secondaryRole: payload.secondaryRole,
        hasAccess: "Oui",
        reusedUserId: reused.id,
      });
      if (typeof tx.insertUserRole === "function") {
        const keys =
          typeof tx.listActiveUserRoleKeys === "function" ? await tx.listActiveUserRoleKeys(reused.id) : [];
        if (!keys.includes(toRoleKey(PROVISION_CONTACT_ROLE))) {
          try {
            await tx.insertUserRole({
              userId: reused.id,
              schoolId: contact.school_id,
              roleKey: toRoleKey(PROVISION_CONTACT_ROLE),
              grantedBy: principal?.sub || principal?.id || null,
            });
          } catch (error) {
            if (!String(error?.constraint ?? "").includes("user_roles")) throw error;
          }
        }
      }
      let relation = null;
      if (studentId) {
        const student = await assertStudentInContactSchool(tx, contact, studentId);
        relation = await tx.getRelationByContactAndStudent(contact.id, student.id);
        if (!relation) {
          relation = await tx.insertRelation({
            schoolId: contact.school_id,
            countryId: contact.country_id,
            contactId: contact.id,
            studentId: student.id,
            profile: {
              fromContactName: `${contact.first_name} ${contact.last_name}`.trim(),
              toStudentName: `${student.first_name ?? ""} ${student.last_name ?? student.name ?? ""}`.trim(),
            },
          });
        }
      }
      await writeClientsAudit(tx, principal, auditMeta, {
        schoolCode: contact.school_code,
        action: "provision_contact_account",
        entityType: "contact",
        entityId: contact.id,
        newValue: { userId: reused.id, reused: true, relationId: relation?.id ?? null },
      });
      return {
        contact: mapContactRow(updatedContact),
        user: mapUserRow(reused),
        relation: relation ? mapRelationRow(relation) : null,
        created: false,
        reused: true,
      };
    }

    const temporaryPassword = generateTemporaryPassword();
    const userCode = await allocateUserCode(tx);
    const identifier = resolveUserIdentifier({
      role,
      phone: contact.phone,
      email: contact.email,
      userCode,
    });

    const profile = {
      contactId: contact.id,
      identifier,
      accessChannel: "Application",
      createdBy: principal?.identifier || "system",
      role: PROVISION_CONTACT_ROLE,
      secondaryRole: payload.secondaryRole,
    };

    await assertUniqueUserLoginIdentity(tx, {
      schoolId: contact.school_id,
      email: contact.email,
      phone: contact.phone,
    }).catch(rethrowLoginIdentityConflict);

    let user;
    try {
      user = await tx.insertUser({
        schoolId: contact.school_id,
        userCode,
        firstName: contact.first_name,
        lastName: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        gender: contact.gender,
        birthDate: contact.birth_date,
        role: toDbRole(PROVISION_CONTACT_ROLE),
        status: "active",
        passwordHash: hashSecret(temporaryPassword),
        mustChangePassword: true,
        profile,
      });
    } catch (error) {
      rethrowLoginIdentityConflict(error);
    }

    if (typeof tx.insertUserRole === "function") {
      await tx.insertUserRole({
        userId: user.id,
        schoolId: contact.school_id,
        roleKey: toRoleKey(PROVISION_CONTACT_ROLE),
        grantedBy: principal?.sub || principal?.id || null,
      });
    }

    const updatedContact = await tx.linkContactUser(contact.id, user.id, {
      ...parsePayload(contact.profile_payload),
      role: PROVISION_CONTACT_ROLE,
      secondaryRole: payload.secondaryRole,
      hasAccess: "Oui",
    });

    let relation = null;
    if (studentId) {
      const student = await assertStudentInContactSchool(tx, contact, studentId);
      relation = await tx.insertRelation({
        schoolId: contact.school_id,
        countryId: contact.country_id,
        contactId: contact.id,
        studentId: student.id,
        profile: {
          fromContactName: `${contact.first_name} ${contact.last_name}`.trim(),
          toStudentName: `${student.first_name ?? ""} ${student.last_name ?? student.name ?? ""}`.trim(),
        },
      });
    }

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode: contact.school_code,
      action: "provision_contact_account",
      entityType: "contact",
      entityId: contact.id,
      newValue: { userId: user.id, relationId: relation?.id ?? null },
    });

    return {
      contact: mapContactRow(updatedContact),
      user: {
        ...mapUserRow(user),
        temporaryPassword,
        hasTemporaryPassword: true,
      },
      relation: relation ? mapRelationRow(relation) : null,
      created: true,
      temporaryPassword,
    };
  });
}

async function createRelation(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  const contactId = asTrimmed(payload.fromContactId || payload.contactId);
  const studentId = asTrimmed(payload.toStudentId || payload.studentId);
  if (!contactId || !studentId) {
    throw createClientsError(400, "Contact parent et élève obligatoires.");
  }

  return store.withTransaction(async (tx) => {
    const contact = await tx.getContactById(contactId);
    if (!contact || asTrimmed(contact.school_code).toUpperCase() !== schoolCode) {
      throw createClientsError(404, "Contact introuvable.", CLIENTS_ERROR.CONTACT_NOT_FOUND);
    }
    const student = await tx.getStudentById(studentId);
    if (!student || student.school_id !== contact.school_id) {
      throw createClientsError(404, "Élève introuvable.", CLIENTS_ERROR.STUDENT_NOT_FOUND);
    }

    const existing = await tx.getRelationByContactAndStudent(contact.id, student.id);
    if (existing) {
      return mapRelationRow(existing);
    }

    const saved = await tx.insertRelation({
      schoolId: contact.school_id,
      countryId: contact.country_id,
      contactId: contact.id,
      studentId: student.id,
      profile: {
        fromContactName: `${contact.first_name} ${contact.last_name}`.trim(),
        toStudentName: `${student.first_name ?? ""} ${student.last_name ?? student.name ?? ""}`.trim(),
      },
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_relation",
      entityType: "relation",
      entityId: saved.id,
      newValue: mapRelationRow(saved),
    });
    return mapRelationRow(saved);
  });
}

async function sendMessage(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  const body = asTrimmed(payload.message || payload.body);
  if (!body) {
    throw createClientsError(400, "Message obligatoire.");
  }

  const senderUserId = asTrimmed(principal?.sub || principal?.id);
  if (!senderUserId) {
    throw createClientsError(403, "Expéditeur non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  }

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }

    const sender = await tx.getUserById(senderUserId);
    if (!sender || (sender.school_id && sender.school_id !== school.id && !isSuperAdminPrincipal(principal))) {
      throw createClientsError(403, "Expéditeur non autorisé.", CLIENTS_ERROR.FORBIDDEN);
    }

    const participantUserIds = new Set(
      (Array.isArray(payload.participantUserIds) ? payload.participantUserIds : [])
        .map((value) => asTrimmed(value))
        .filter(Boolean),
    );
    participantUserIds.add(senderUserId);
    await assertParticipantsInSchool(tx, school, participantUserIds);

    const conversation = await tx.insertConversation({
      schoolId: school.id,
      countryId: school.country_id,
      subject: asTrimmed(payload.theme || payload.subject),
      createdByUserId: senderUserId,
      profile: {},
    });

    for (const userId of participantUserIds) {
      await tx.insertParticipant({
        conversationId: conversation.id,
        userId,
        schoolId: school.id,
        role: userId === senderUserId ? "sender" : "recipient",
      });
    }

    const messageProfile = {
      studentId: payload.studentId,
      teacherId: payload.teacherId,
      parentPhone: payload.parentPhone,
      direction: payload.direction,
      theme: payload.theme,
      priority: payload.priority,
      audit: [
        {
          action: "Création",
          actorId: senderUserId,
          date: new Date().toISOString(),
        },
      ],
    };

    const saved = await tx.insertMessage({
      conversationId: conversation.id,
      schoolId: school.id,
      countryId: school.country_id,
      senderUserId,
      body,
      direction: payload.direction,
      theme: payload.theme,
      priority: payload.priority,
      attachmentUrl: payload.attachmentUrl,
      profile: messageProfile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "send_message",
      entityType: "message",
      entityId: saved.id,
      newValue: mapMessageRow({ ...saved, school_code: schoolCode, sender_phone: sender.phone }),
    });

    return mapMessageRow({ ...saved, school_code: schoolCode, sender_phone: sender.phone });
  });
}

async function markMessageRead(store, messageId, principal, auditMeta) {
  const readerUserId = asTrimmed(principal?.sub || principal?.id);
  if (!readerUserId) {
    throw createClientsError(403, "Lecteur non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  }

  return store.withTransaction(async (tx) => {
    const message = await tx.getMessageById(messageId);
    if (!message) {
      throw createClientsError(404, "Message introuvable.", CLIENTS_ERROR.MESSAGE_NOT_FOUND);
    }
    assertSchoolScope(principal, message.school_code);
    await assertSchoolInPrincipalCountry(store, principal, message.school_code);

    const isParticipant = await tx.isConversationParticipant(message.conversation_id, readerUserId);
    if (!isParticipant && !isSuperAdminPrincipal(principal)) {
      throw createClientsError(403, "Lecture réservée aux participants.", CLIENTS_ERROR.FORBIDDEN);
    }

    await tx.insertMessageRead(message.id, readerUserId);
    const updated = await tx.updateMessageStatus(message.id, "read");
    return mapMessageRow(updated);
  });
}

async function createAnnouncement(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  const title = asTrimmed(payload.title);
  const message = asTrimmed(payload.message);
  if (!title || !message) {
    throw createClientsError(400, "Titre et message obligatoires.");
  }

  const authorUserId = asTrimmed(principal?.sub || principal?.id);

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }

    const profile = {
      audience: payload.audience,
      targetClassId: payload.targetClassId,
      createdByName: principal?.identifier || principal?.email || "",
    };

    const saved = await tx.insertAnnouncement({
      schoolId: school.id,
      countryId: school.country_id,
      title,
      message,
      targetRole: asTrimmed(payload.targetRole || payload.audience),
      targetClassId: payload.targetClassId || null,
      createdByUserId: authorUserId || null,
      status: "published",
      profile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_announcement",
      entityType: "announcement",
      entityId: saved.id,
      newValue: mapAnnouncementRow({ ...saved, school_code: schoolCode }),
    });
    return mapAnnouncementRow({ ...saved, school_code: schoolCode });
  });
}

async function updateAnnouncement(store, announcementId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getAnnouncementById(announcementId);
    if (!existing) {
      throw createClientsError(404, "Annonce introuvable.", CLIENTS_ERROR.ANNOUNCEMENT_NOT_FOUND);
    }
    assertSchoolScope(principal, existing.school_code);
    await assertSchoolInPrincipalCountry(store, principal, existing.school_code);

    const profile = { ...parsePayload(existing.profile_payload) };
    if (patch.audience !== undefined) profile.audience = patch.audience;
    if (patch.targetClassId !== undefined) profile.targetClassId = patch.targetClassId;

    const saved = await tx.updateAnnouncement(existing.id, {
      title: patch.title ?? existing.title,
      message: patch.message ?? existing.message,
      targetRole: patch.targetRole ?? patch.audience ?? existing.target_role,
      targetClassId: patch.targetClassId ?? existing.target_class_id,
      status: patch.status ? toDbStatus(patch.status) : existing.status,
      profile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode: existing.school_code,
      action: "update_announcement",
      entityType: "announcement",
      entityId: saved.id,
      oldValue: mapAnnouncementRow(existing),
      newValue: mapAnnouncementRow(saved),
    });
    return mapAnnouncementRow(saved);
  });
}

async function archiveAnnouncement(store, announcementId, principal, auditMeta) {
  return updateAnnouncement(store, announcementId, { status: "Archivé" }, principal, auditMeta);
}

module.exports = {
  createUser,
  updateUser,
  createContact,
  updateContact,
  provisionContactAccount,
  createRelation,
  sendMessage,
  markMessageRead,
  createAnnouncement,
  updateAnnouncement,
  archiveAnnouncement,
};
