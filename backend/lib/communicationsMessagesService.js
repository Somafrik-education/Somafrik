"use strict";

const {
  CLIENTS_ERROR,
  asTrimmed,
  createClientsError,
  ignoreClientScope,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  assertSchoolScope,
  assertSchoolInPrincipalCountry,
  mapMessageRow,
  formatDateTime,
} = require("./clientsManagement");
const {
  validateUploadBuffer,
  persistAttachmentBytes,
  removeStoredAttachment,
  readAttachmentBytes,
  mapAttachmentRow,
} = require("./communicationsAttachments");
const { RbacService } = require("../services/rbacService");

const MESSAGE_MAX_LENGTH = 8000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const attachmentRbac = new RbacService();
const ENTITY_DOWNLOAD_ROUTE = Object.freeze({
  message: "GET /api/backoffice/messages/attachments/:attachmentId",
  announcement: "GET /api/backoffice/announcements/attachments/:attachmentId",
});

const PARENT_KEYS = new Set(["PARENT"]);
const TEACHER_KEYS = new Set(["TEACHER"]);
const STUDENT_KEYS = new Set(["STUDENT"]);

function actorUserId(principal) {
  return asTrimmed(principal?.sub || principal?.id || principal?.userId);
}

function displayName(user) {
  return asTrimmed(`${user?.first_name ?? ""} ${user?.last_name ?? ""}`) || asTrimmed(user?.email) || "";
}

function classifyActor(roleLabel, roleKeys = []) {
  const keys = new Set((roleKeys ?? []).map((key) => String(key ?? "").trim().toUpperCase()));
  const label = asTrimmed(roleLabel);
  if (keys.has("PARENT") || label === "Parent") return "parent";
  if (keys.has("TEACHER") || label === "Enseignant") return "teacher";
  if (keys.has("STUDENT") || label === "Élève / Étudiant") return "student";
  if (isSuperAdminPrincipal({ role: label }) || keys.has("SUPER_ADMIN")) return "superadmin";
  if (keys.has("COUNTRY_ADMIN") || label === "Admin Pays") return "country_admin";
  return "school_staff";
}

function parseLimit(query) {
  const n = Number(query?.limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function parseCursor(raw) {
  const value = asTrimmed(raw);
  if (!value) return null;
  const idx = value.lastIndexOf("|");
  if (idx < 0) return null;
  return { at: value.slice(0, idx), id: value.slice(idx + 1) };
}

function makeCursor(at, id) {
  if (!at || !id) return null;
  const iso = at instanceof Date ? at.toISOString() : String(at);
  return `${iso}|${id}`;
}

function validateBody(raw) {
  const body = asTrimmed(raw);
  if (!body) {
    throw createClientsError(400, "Message obligatoire.");
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw createClientsError(400, `Message trop long (max ${MESSAGE_MAX_LENGTH} caractères).`);
  }
  return body;
}

function openTx(store) {
  return typeof store.bind === "function" ? store.bind({}) : store;
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
  const requested = asTrimmed(
    rawPayload?.effectiveSchoolCode || rawPayload?.schoolCode || rawPayload?.school_code,
  ).toUpperCase();
  const principalCode = asTrimmed(principal?.schoolCode).toUpperCase();
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    const schoolCode = requested && requested !== "*" ? requested : principalCode;
    if (!schoolCode || schoolCode === "*") {
      throw createClientsError(
        400,
        "Établissement requis (effectiveSchoolCode).",
        CLIENTS_ERROR.TENANT_MISMATCH,
      );
    }
    return schoolCode;
  }
  return principalCode;
}

async function requireSchool(store, principal, rawPayload = {}) {
  const schoolCode = resolveWritableSchoolCode(principal, rawPayload);
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);
  const tx = openTx(store);
  const school = await tx.getSchoolByCode(schoolCode);
  if (!school) {
    throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
  }
  return { school, schoolCode, tx };
}

async function loadKind(tx, user) {
  const keys = typeof tx.listActiveRoleKeys === "function" ? await tx.listActiveRoleKeys(user.id) : [];
  return classifyActor(user.role, keys);
}

function notFound(message = "Conversation introuvable.") {
  return createClientsError(404, message, CLIENTS_ERROR.FORBIDDEN);
}

async function requireActiveParticipant(tx, conversationId, userId) {
  const ok =
    typeof tx.isConversationParticipant === "function"
      ? await tx.isConversationParticipant(conversationId, userId, { activeOnly: true })
      : false;
  if (!ok) throw notFound();
}

async function loadConversation(tx, conversationId) {
  if (typeof tx.getConversationById !== "function") {
    throw createClientsError(500, "Store conversation indisponible.");
  }
  const conversation = await tx.getConversationById(conversationId);
  if (!conversation) throw notFound();
  return conversation;
}

async function assertCanMessageRecipient(tx, { school, sender, senderKind, recipientUserId, studentRef }) {
  if (String(recipientUserId) === String(sender.id)) return;
  const recipient = await tx.getUserById(recipientUserId);
  if (!recipient) {
    throw createClientsError(404, "Participant introuvable.", CLIENTS_ERROR.USER_NOT_FOUND);
  }
  if (recipient.school_id && recipient.school_id !== school.id) {
    throw createClientsError(403, "Participant hors établissement.", CLIENTS_ERROR.FORBIDDEN);
  }
  const recipientKind = await loadKind(tx, recipient);

  if (senderKind === "superadmin" || senderKind === "school_staff" || senderKind === "country_admin") {
    return;
  }

  if (senderKind === "parent") {
    const linked =
      typeof tx.listParentLinkedStudentIds === "function"
        ? await tx.listParentLinkedStudentIds(sender.id, school.id)
        : [];
    if (!linked.length) {
      throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
    }
    let contextIds = linked;
    if (studentRef) {
      const student = await tx.resolveSchoolStudent(school.id, studentRef);
      if (!student || !linked.map(String).includes(String(student.id))) {
        throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
      }
      contextIds = [student.id];
    }
    if (recipientKind === "teacher") {
      const ok = await tx.teacherAssignedToStudents(recipient.id, school.id, contextIds);
      if (!ok) throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
      return;
    }
    if (recipientKind === "school_staff" || recipientKind === "country_admin") return;
    throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  }

  if (senderKind === "teacher") {
    const classIds =
      typeof tx.listTeacherActiveClassIds === "function"
        ? await tx.listTeacherActiveClassIds(sender.id, school.id)
        : [];
    if (!classIds.length) {
      throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
    }
    if (recipientKind === "parent") {
      const ok = await tx.parentLinkedToTeacherClasses(recipient.id, school.id, classIds, studentRef);
      if (!ok) throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
      return;
    }
    if (recipientKind === "school_staff" || recipientKind === "teacher") return;
    throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  }

  throw createClientsError(403, "Destinataire non autorisé.", CLIENTS_ERROR.FORBIDDEN);
}

async function resolveHintRecipients(tx, school, payload, sender, senderKind) {
  const ids = new Set();
  const studentRef = asTrimmed(payload.studentId);
  if (asTrimmed(payload.teacherId) && typeof tx.resolveTeacherUserId === "function") {
    const teacherUserId = await tx.resolveTeacherUserId(school.id, payload.teacherId);
    if (teacherUserId) ids.add(String(teacherUserId));
  }
  if (studentRef && senderKind === "teacher" && typeof tx.listParentUserIdsForStudent === "function") {
    for (const id of await tx.listParentUserIdsForStudent(school.id, studentRef)) ids.add(String(id));
  }
  if (asTrimmed(payload.parentPhone) && typeof tx.resolveParentUserIdByPhone === "function") {
    const parentId = await tx.resolveParentUserIdByPhone(school.id, payload.parentPhone);
    if (parentId) ids.add(String(parentId));
  }
  if (senderKind === "parent" && !ids.size && typeof tx.listSchoolAdminUserIds === "function") {
    for (const id of await tx.listSchoolAdminUserIds(school.id)) ids.add(String(id));
  }
  return ids;
}

async function collectRecipients(tx, school, payload, sender, senderKind) {
  const ids = new Set(
    (Array.isArray(payload.participantUserIds) ? payload.participantUserIds : [])
      .map((value) => asTrimmed(value))
      .filter(Boolean),
  );
  for (const id of await resolveHintRecipients(tx, school, payload, sender, senderKind)) {
    ids.add(id);
  }
  ids.delete(String(sender.id));
  if (!ids.size) {
    throw createClientsError(400, "Destinataire obligatoire.");
  }
  const studentRef = asTrimmed(payload.studentId) || null;
  for (const recipientUserId of ids) {
    await assertCanMessageRecipient(tx, { school, sender, senderKind, recipientUserId, studentRef });
  }
  return ids;
}

async function loadRecipientContext(tx, school, sender, senderKind, recipient, recipientKind) {
  const context = {};
  if (senderKind === "parent" && recipientKind === "teacher") {
    const linked =
      typeof tx.listParentLinkedStudentIds === "function"
        ? await tx.listParentLinkedStudentIds(sender.id, school.id)
        : [];
    for (const studentId of linked) {
      const ok =
        typeof tx.teacherAssignedToStudents === "function"
          ? await tx.teacherAssignedToStudents(recipient.id, school.id, [studentId])
          : false;
      if (!ok) continue;
      const student = await tx.resolveSchoolStudent(school.id, studentId);
      if (student) {
        context.studentId = student.id;
        context.studentName =
          asTrimmed(`${student.first_name ?? ""} ${student.last_name ?? ""}`) || student.student_code || "";
      }
      break;
    }
  }
  return context;
}

async function listAuthorizedRecipients(store, principal, query = {}) {
  const senderUserId = actorUserId(principal);
  if (!senderUserId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const sender = await tx.getUserById(senderUserId);
  if (!sender) throw createClientsError(403, "Expéditeur non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  const senderKind = await loadKind(tx, sender);
  const users = typeof tx.listSchoolUsers === "function" ? await tx.listSchoolUsers(school.id) : [];
  const items = [];
  for (const recipient of users) {
    if (!recipient?.id || String(recipient.id) === String(sender.id)) continue;
    try {
      await assertCanMessageRecipient(tx, {
        school,
        sender,
        senderKind,
        recipientUserId: recipient.id,
      });
    } catch (error) {
      if (Number(error?.statusCode) === 403 || Number(error?.statusCode) === 404) continue;
      throw error;
    }
    const kind = await loadKind(tx, recipient);
    const context = await loadRecipientContext(tx, school, sender, senderKind, recipient, kind);
    items.push({
      userId: recipient.id,
      displayName: displayName(recipient),
      roleLabel: recipient.role || "",
      kind,
      ...context,
    });
  }
  return { items };
}

function mapHistoryMessage(row, extras = {}) {
  const mapped = mapMessageRow(row);
  const readerReadAt = row.reader_read_at ?? row.read_at;
  return {
    ...mapped,
    type: "message",
    content: mapped.body ?? mapped.message,
    senderName: row.sender_name ?? extras.senderName ?? mapped.senderName ?? "",
    senderRoleLabel: row.sender_role_label ?? extras.senderRoleLabel ?? "",
    createdAt: formatDateTime(row.created_at) || mapped.sentAt,
    sentAt: mapped.sentAt,
    readAt: readerReadAt ? formatDateTime(readerReadAt) : "",
    status: readerReadAt ? "Lu" : mapped.status === "Lu" ? "Envoyé" : mapped.status,
    attachments: extras.attachments ?? row.attachments ?? mapped.attachments ?? [],
    participants: extras.participants ?? mapped.participants ?? [],
    audit: mapped.audit ?? [],
  };
}

async function hydrateAttachments(tx, messageIds) {
  if (!messageIds.length || typeof tx.listAttachmentsForEntities !== "function") {
    return new Map();
  }
  const rows = await tx.listAttachmentsForEntities("message", messageIds);
  const byMessage = new Map();
  for (const row of rows) {
    const key = String(row.entity_id);
    const list = byMessage.get(key) ?? [];
    list.push(mapAttachmentRow(row));
    byMessage.set(key, list);
  }
  return byMessage;
}

async function loadParticipants(tx, conversationId) {
  if (typeof tx.listConversationParticipants !== "function") return [];
  const rows = await tx.listConversationParticipants(conversationId);
  return rows.map((row) => ({
    userId: row.user_id,
    name: displayName(row),
    roleLabel: row.role_label ?? row.participant_role ?? "",
    status: row.status ?? "active",
  }));
}

async function bindAttachments(tx, schoolId, senderUserId, messageId, attachmentIds) {
  const ids = [...new Set((attachmentIds ?? []).map((value) => asTrimmed(value)).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw createClientsError(400, `Trop de pièces jointes (max ${MAX_ATTACHMENTS_PER_MESSAGE}).`);
  }
  if (typeof tx.attachToMessage !== "function") {
    throw createClientsError(400, "Pièces jointes indisponibles.");
  }
  const attached = await tx.attachToMessage({
    attachmentIds: ids,
    messageId,
    schoolId,
    uploadedByUserId: senderUserId,
  });
  if (attached.length !== ids.length) {
    throw createClientsError(400, "Pièce jointe invalide ou déjà associée.");
  }
  return attached.map(mapAttachmentRow);
}

async function persistMessage(tx, { conversation, school, schoolCode, sender, body, payload, attachmentIds, principal, auditMeta }) {
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
        actorId: sender.id,
        date: new Date().toISOString(),
      },
    ],
  };
  const saved = await tx.insertMessage({
    conversationId: conversation.id,
    schoolId: school.id,
    countryId: school.country_id,
    senderUserId: sender.id,
    body,
    direction: payload.direction,
    theme: payload.theme,
    priority: payload.priority,
    attachmentUrl: null,
    profile: messageProfile,
  });
  if (typeof tx.touchConversation === "function") {
    await tx.touchConversation(conversation.id);
  }
  const attachments = await bindAttachments(tx, school.id, sender.id, saved.id, attachmentIds);
  const mapped = mapHistoryMessage(
    {
      ...saved,
      school_code: schoolCode,
      sender_phone: sender.phone,
      sender_name: displayName(sender),
      sender_role_label: sender.role ?? "",
    },
    { attachments, senderName: displayName(sender), senderRoleLabel: sender.role ?? "" },
  );
  await writeClientsAudit(tx, principal, auditMeta, {
    schoolCode,
    action: "send_message",
    entityType: "message",
    entityId: saved.id,
    newValue: mapped,
  });
  return mapped;
}

async function sendOrCreate(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const body = validateBody(payload.message || payload.body);
  const senderUserId = actorUserId(principal);
  if (!senderUserId) {
    throw createClientsError(403, "Expéditeur non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  }
  const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];

  return store.withTransaction(async (tx) => {
    const { school, schoolCode } = await requireSchool(store, principal, rawPayload);
    const sender = await tx.getUserById(senderUserId);
    if (!sender || (sender.school_id && sender.school_id !== school.id && !isSuperAdminPrincipal(principal))) {
      throw createClientsError(403, "Expéditeur non autorisé.", CLIENTS_ERROR.FORBIDDEN);
    }
    const senderKind = await loadKind(tx, sender);
    const conversationId = asTrimmed(payload.conversationId);

    if (conversationId) {
      const conversation = await loadConversation(tx, conversationId);
      if (conversation.school_id !== school.id) throw notFound();
      if (asTrimmed(conversation.status) !== "active") {
        throw createClientsError(403, "Conversation non disponible.", CLIENTS_ERROR.FORBIDDEN);
      }
      await requireActiveParticipant(tx, conversation.id, sender.id);
      return persistMessage(tx, {
        conversation,
        school,
        schoolCode,
        sender,
        body,
        payload,
        attachmentIds,
        principal,
        auditMeta,
      });
    }

    const recipientIds = await collectRecipients(tx, school, payload, sender, senderKind);
    const conversation = await tx.insertConversation({
      schoolId: school.id,
      countryId: school.country_id,
      subject: asTrimmed(payload.theme || payload.subject),
      createdByUserId: sender.id,
      profile: {},
    });
    await tx.insertParticipant({
      conversationId: conversation.id,
      userId: sender.id,
      schoolId: school.id,
      role: "sender",
    });
    for (const userId of recipientIds) {
      await tx.insertParticipant({
        conversationId: conversation.id,
        userId,
        schoolId: school.id,
        role: "recipient",
      });
    }
    return persistMessage(tx, {
      conversation,
      school,
      schoolCode,
      sender,
      body,
      payload,
      attachmentIds,
      principal,
      auditMeta,
    });
  });
}

async function createConversation(store, rawPayload, principal, auditMeta) {
  return sendOrCreate(store, rawPayload, principal, auditMeta);
}

async function replyToConversation(store, conversationId, rawPayload, principal, auditMeta) {
  return sendOrCreate(
    store,
    { ...(rawPayload ?? {}), conversationId },
    principal,
    auditMeta,
  );
}

async function markMessageRead(store, messageId, principal, auditMeta, query = {}) {
  const readerUserId = actorUserId(principal);
  if (!readerUserId) {
    throw createClientsError(403, "Lecteur non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  }
  const { school } = await requireSchool(store, principal, query);
  return store.withTransaction(async (tx) => {
    const message = await tx.getMessageById(messageId);
    if (!message || message.school_id !== school.id) {
      throw createClientsError(404, "Message introuvable.", CLIENTS_ERROR.MESSAGE_NOT_FOUND);
    }
    await requireActiveParticipant(tx, message.conversation_id, readerUserId);
    const read = await tx.insertMessageRead(message.id, readerUserId);
    const attachments = (await hydrateAttachments(tx, [message.id])).get(String(message.id)) ?? [];
    const sender = await tx.getUserById(message.sender_user_id);
    return mapHistoryMessage(
      {
        ...message,
        reader_read_at: read?.read_at ?? new Date(),
        sender_name: displayName(sender),
        sender_role_label: sender?.role ?? "",
      },
      { attachments, senderName: displayName(sender) },
    );
  });
}

function canBypassParticipation() {
  return false;
}

async function listConversations(store, principal, query = {}) {
  const senderUserId = actorUserId(principal);
  if (!senderUserId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode, tx } = await requireSchool(store, principal, query);
  const limit = parseLimit(query);
  const cursor = parseCursor(query.cursor);
  if (typeof tx.listConversationsForUser !== "function") {
    return { items: [], nextCursor: null };
  }
  const rows = await tx.listConversationsForUser({
    userId: senderUserId,
    schoolId: school.id,
    limit: limit + 1,
    cursor,
    bypass: canBypassParticipation(principal),
  });
  const page = rows.slice(0, limit);
  const items = [];
  for (const row of page) {
    const participants = await loadParticipants(tx, row.id);
    items.push({
      id: row.id,
      type: "conversation",
      schoolCode: row.school_code || schoolCode,
      subject: row.subject ?? "",
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdAt: formatDateTime(row.created_at),
      updatedAt: formatDateTime(row.updated_at),
      participants,
      lastMessage: row.last_message_id
        ? {
            id: row.last_message_id,
            body: row.last_message_body,
            sentAt: formatDateTime(row.last_message_at),
            senderUserId: row.last_sender_user_id,
            senderName: row.last_sender_name ?? "",
          }
        : null,
      unreadCount: Number(row.unread_count) || 0,
    });
  }
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > limit ? makeCursor(last?.last_message_at || last?.updated_at, last?.id) : null,
  };
}

async function getConversation(store, conversationId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode, tx } = await requireSchool(store, principal, query);
  const conversation = await loadConversation(tx, conversationId);
  if (conversation.school_id !== school.id && !canBypassParticipation(principal)) throw notFound();
  if (!canBypassParticipation(principal)) {
    await requireActiveParticipant(tx, conversation.id, userId);
  }
  const participants = await loadParticipants(tx, conversation.id);
  return {
    id: conversation.id,
    type: "conversation",
    schoolCode: conversation.school_code || schoolCode,
    subject: conversation.subject ?? "",
    status: conversation.status,
    createdByUserId: conversation.created_by_user_id,
    createdAt: formatDateTime(conversation.created_at),
    updatedAt: formatDateTime(conversation.updated_at),
    participants,
  };
}

async function listConversationMessages(store, conversationId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const conversation = await loadConversation(tx, conversationId);
  if (conversation.school_id !== school.id && !canBypassParticipation(principal)) throw notFound();
  if (!canBypassParticipation(principal)) {
    await requireActiveParticipant(tx, conversation.id, userId);
  }
  const limit = parseLimit(query);
  const cursor = parseCursor(query.cursor);
  const rows = await tx.listConversationMessagesPage({
    conversationId: conversation.id,
    readerUserId: userId,
    limit: limit + 1,
    cursor,
  });
  const chronological = [...rows].reverse();
  const page = chronological.slice(Math.max(0, chronological.length - limit));
  const attachments = await hydrateAttachments(tx, page.map((row) => row.id));
  const participants = await loadParticipants(tx, conversation.id);
  const items = page.map((row) =>
    mapHistoryMessage(row, {
      attachments: attachments.get(String(row.id)) ?? [],
      participants,
      senderName: row.sender_name,
      senderRoleLabel: row.sender_role_label,
    }),
  );
  const oldest = items[0];
  return {
    items,
    nextCursor:
      rows.length > limit && oldest ? makeCursor(oldest.sentAt, oldest.id) : null,
  };
}

async function listMessages(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  if (typeof tx.listMessagesForUser !== "function") return [];
  const rows = await tx.listMessagesForUser({
    userId,
    schoolId: school.id,
    bypass: canBypassParticipation(principal),
  });
  const attachments = await hydrateAttachments(tx, rows.map((row) => row.id));
  return rows.map((row) =>
    mapHistoryMessage(row, {
      attachments: attachments.get(String(row.id)) ?? [],
      senderName: row.sender_name,
      senderRoleLabel: row.sender_role_label,
    }),
  );
}

async function getMessage(store, messageId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const message = await tx.getMessageById(messageId);
  if (!message || (message.school_id !== school.id && !canBypassParticipation(principal))) {
    throw createClientsError(404, "Message introuvable.", CLIENTS_ERROR.MESSAGE_NOT_FOUND);
  }
  if (!canBypassParticipation(principal)) {
    await requireActiveParticipant(tx, message.conversation_id, userId);
  }
  const read =
    typeof tx.getMessageRead === "function" ? await tx.getMessageRead(message.id, userId) : null;
  const attachments = (await hydrateAttachments(tx, [message.id])).get(String(message.id)) ?? [];
  const participants = await loadParticipants(tx, message.conversation_id);
  const sender = await tx.getUserById(message.sender_user_id);
  return mapHistoryMessage(
    {
      ...message,
      reader_read_at: read?.read_at,
      sender_name: displayName(sender),
      sender_role_label: sender?.role ?? "",
    },
    { attachments, participants, senderName: displayName(sender) },
  );
}

async function unreadCount(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  if (typeof tx.countUnreadForUser !== "function") return { count: 0 };
  const count = await tx.countUnreadForUser(userId, school.id);
  return { count: Number(count) || 0 };
}

async function uploadAttachment(store, principal, { buffer, fileName, mimeType }, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const validated = validateUploadBuffer(buffer, mimeType, fileName);
  let storageKey = "";
  try {
    return await store.withTransaction(async (tx) => {
      const { school, schoolCode } = await requireSchool(store, principal, query);
      const sender = await tx.getUserById(userId);
      if (!sender || (sender.school_id && sender.school_id !== school.id && !isSuperAdminPrincipal(principal))) {
        throw createClientsError(403, "Expéditeur non autorisé.", CLIENTS_ERROR.FORBIDDEN);
      }
      storageKey = await persistAttachmentBytes(school.id, buffer);
      try {
        const saved = await tx.insertAttachment({
          schoolId: school.id,
          entityType: "message",
          entityId: null,
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          fileSize: validated.fileSize,
          storageKey,
          uploadedByUserId: userId,
          status: "uploaded",
        });
        await writeClientsAudit(tx, principal, {}, {
          schoolCode,
          action: "upload_communication_attachment",
          entityType: "attachment",
          entityId: saved.id,
          newValue: mapAttachmentRow(saved),
        });
        return mapAttachmentRow(saved);
      } catch (error) {
        await removeStoredAttachment(storageKey);
        storageKey = "";
        throw error;
      }
    });
  } catch (error) {
    if (storageKey) await removeStoredAttachment(storageKey);
    throw error;
  }
}

function assertEntityTypeDownloadAccess(principal, entityType) {
  const routeKey = ENTITY_DOWNLOAD_ROUTE[asTrimmed(entityType)];
  if (!routeKey || !attachmentRbac.canAccess(principal, routeKey)) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
}

async function downloadAttachment(store, attachmentId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const attachment = await tx.getAttachmentById(attachmentId);
  if (!attachment || attachment.school_id !== school.id) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
  const entityType = asTrimmed(attachment.entity_type);
  assertEntityTypeDownloadAccess(principal, entityType);
  if (asTrimmed(attachment.status) === "uploaded" && !attachment.entity_id) {
    if (String(attachment.uploaded_by_user_id) !== String(userId) && !canBypassParticipation(principal)) {
      throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
    }
  } else if (entityType === "message" && attachment.entity_id) {
    const message = await tx.getMessageById(attachment.entity_id);
    if (!message || message.school_id !== school.id) {
      throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
    }
    if (!canBypassParticipation(principal)) {
      await requireActiveParticipant(tx, message.conversation_id, userId);
    }
  } else if (entityType === "announcement") {
    const announcements = require("./communicationsAnnouncementsService");
    await announcements.assertCanDownloadAnnouncementAttachment(tx, school, userId, attachment, principal);
  } else {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
  const bytes = await readAttachmentBytes(attachment.storage_key);
  return {
    bytes,
    fileName: attachment.file_name,
    mimeType: attachment.mime_type,
  };
}

module.exports = {
  MESSAGE_MAX_LENGTH,
  sendOrCreate,
  createConversation,
  replyToConversation,
  markMessageRead,
  listConversations,
  getConversation,
  listConversationMessages,
  listMessages,
  listAuthorizedRecipients,
  getMessage,
  unreadCount,
  uploadAttachment,
  downloadAttachment,
  assertEntityTypeDownloadAccess,
  classifyActor,
  validateBody,
  requireSchool,
  resolveWritableSchoolCode,
  actorUserId,
  displayName,
};
