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

async function createUser(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);

  const role = asTrimmed(payload.role);
  const firstName = asTrimmed(payload.firstName);
  const lastName = asTrimmed(payload.lastName);
  if (!role || !firstName || !lastName) {
    throw createClientsError(400, "Rôle, prénom et nom obligatoires.");
  }

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }

    const temporaryPassword = asTrimmed(payload.temporaryPassword) || generateTemporaryPassword();
    const userCode = generateUserCode();
    const identifier = resolveUserIdentifier({
      role,
      phone: payload.phone,
      email: payload.email,
      userCode,
    });

    const profile = {
      contactId: payload.contactId,
      secondaryRoles: payload.secondaryRoles ?? [],
      identifier,
      accessChannel: payload.accessChannel ?? "Application",
      createdBy: principal?.identifier || principal?.email || "system",
    };

    const saved = await tx.insertUser({
      schoolId: school.id,
      userCode,
      firstName,
      lastName,
      email: asTrimmed(payload.email),
      phone: asTrimmed(payload.phone),
      gender: asTrimmed(payload.gender),
      birthDate: toIsoDate(payload.birthDate),
      role: ROLE_TO_DB[role] ?? role,
      status: toDbStatus(payload.status || "Actif"),
      passwordHash: hashSecret(temporaryPassword),
      mustChangePassword: true,
      profile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_user",
      entityType: "user",
      entityId: saved.id,
      newValue: mapUserRow(saved),
    });

    return {
      ...mapUserRow(saved),
      temporaryPassword,
      hasTemporaryPassword: true,
    };
  });
}

async function updateUser(store, userId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getUserById(userId);
    if (!existing) {
      throw createClientsError(404, "Utilisateur introuvable.", CLIENTS_ERROR.USER_NOT_FOUND);
    }
    const schoolCode = existing.school_code;
    assertSchoolScope(principal, schoolCode);
    await assertSchoolInPrincipalCountry(store, principal, schoolCode);

    const profile = { ...parsePayload(existing.profile_payload), ...(patch.profile ?? {}) };
    if (patch.contactId !== undefined) profile.contactId = patch.contactId;
    if (patch.secondaryRoles !== undefined) profile.secondaryRoles = patch.secondaryRoles;

    const saved = await tx.updateUser(existing.id, {
      firstName: patch.firstName ?? existing.first_name,
      lastName: patch.lastName ?? existing.last_name,
      email: patch.email ?? existing.email,
      phone: patch.phone ?? existing.phone,
      gender: patch.gender ?? existing.gender,
      birthDate: patch.birthDate !== undefined ? toIsoDate(patch.birthDate) : existing.birth_date,
      role: patch.role ? ROLE_TO_DB[patch.role] ?? patch.role : existing.role,
      status: patch.status ? toDbStatus(patch.status) : existing.status,
      profile,
    });

    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "update_user",
      entityType: "user",
      entityId: saved.id,
      oldValue: mapUserRow(existing),
      newValue: mapUserRow(saved),
    });
    return mapUserRow(saved);
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
  const role = asTrimmed(payload.role || "Parent");
  const studentId = asTrimmed(payload.studentId || payload.toStudentId);

  return store.withTransaction(async (tx) => {
    const contact = await tx.getContactById(contactId);
    if (!contact) {
      throw createClientsError(404, "Contact introuvable.", CLIENTS_ERROR.CONTACT_NOT_FOUND);
    }
    assertSchoolScope(principal, contact.school_code);
    await assertSchoolInPrincipalCountry(store, principal, contact.school_code);

    if (contact.user_id) {
      const existingUser = await tx.getUserById(contact.user_id);
      let relation = null;
      if (studentId) {
        relation = await tx.getRelationByContactAndStudent(contact.id, studentId);
        if (!relation) {
          relation = await tx.insertRelation({
            schoolId: contact.school_id,
            countryId: contact.country_id,
            contactId: contact.id,
            studentId,
            profile: {
              fromContactName: `${contact.first_name} ${contact.last_name}`.trim(),
            },
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

    const temporaryPassword = generateTemporaryPassword();
    const userCode = generateUserCode();
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
      role,
      secondaryRole: payload.secondaryRole,
    };

    const user = await tx.insertUser({
      schoolId: contact.school_id,
      userCode,
      firstName: contact.first_name,
      lastName: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      gender: contact.gender,
      birthDate: contact.birth_date,
      role: ROLE_TO_DB[role] ?? role,
      status: "active",
      passwordHash: hashSecret(temporaryPassword),
      mustChangePassword: true,
      profile,
    });

    const updatedContact = await tx.linkContactUser(contact.id, user.id, {
      ...parsePayload(contact.profile_payload),
      role,
      secondaryRole: payload.secondaryRole,
      hasAccess: "Oui",
    });

    let relation = null;
    if (studentId) {
      const student = await tx.getStudentById(studentId);
      if (!student || student.school_id !== contact.school_id) {
        throw createClientsError(404, "Élève introuvable dans cet établissement.", CLIENTS_ERROR.STUDENT_NOT_FOUND);
      }
      relation = await tx.insertRelation({
        schoolId: contact.school_id,
        countryId: contact.country_id,
        contactId: contact.id,
        studentId,
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
