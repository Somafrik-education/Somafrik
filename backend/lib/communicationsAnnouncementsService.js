"use strict";

/**
 * COM-C3 — Annonces : audience serveur, snapshot destinataires, read/unread PG.
 */

const {
  CLIENTS_ERROR,
  asTrimmed,
  createClientsError,
  ignoreClientScope,
  isSuperAdminPrincipal,
  formatDateTime,
} = require("./clientsManagement");
const {
  requireSchool,
  actorUserId,
  displayName,
} = require("./communicationsMessagesService");
const {
  mapAttachmentRow,
  persistAttachmentBytes,
  removeStoredAttachment,
  readAttachmentBytes,
  validateUploadBuffer,
} = require("./communicationsAttachments");

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 8000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_ATTACHMENTS_PER_ANNOUNCEMENT = 10;

const RECIPIENT_KINDS = Object.freeze(["parent", "teacher", "student", "staff"]);
const KIND_LABELS = Object.freeze({
  parent: "parents",
  teacher: "enseignants",
  student: "élèves",
  staff: "personnel",
});

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

function isoOf(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return parsed.toISOString();
  }
  return formatDateTime(value);
}

function normalizeKind(raw) {
  const value = asTrimmed(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (["parent", "parents"].includes(value)) return "parent";
  if (["teacher", "teachers", "enseignant", "enseignants"].includes(value)) return "teacher";
  if (["student", "students", "eleve", "eleves", "élève", "élèves"].includes(value)) return "student";
  if (["staff", "personnel", "personnel etablissement", "personnel établissement"].includes(value)) {
    return "staff";
  }
  return "";
}

function uniqueIds(values) {
  return [...new Set((values ?? []).map((value) => asTrimmed(value)).filter(Boolean))];
}

function parseAudience(payload) {
  const classIds = uniqueIds([
    ...(Array.isArray(payload?.classIds) ? payload.classIds : []),
    payload?.targetClassId,
    payload?.classId,
  ]);
  const kinds = uniqueIds([
    ...(Array.isArray(payload?.recipientKinds) ? payload.recipientKinds : []).map(normalizeKind),
    normalizeKind(payload?.recipientKind),
  ]).filter((kind) => RECIPIENT_KINDS.includes(kind));

  const audienceRaw = asTrimmed(payload?.audience || payload?.targetRole);
  const audienceNorm = audienceRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const wholeSchool =
    !audienceRaw ||
    /^(tous|all|school|etablissement|etablissement entier|whole[_-]?school)$/.test(audienceNorm);

  if (audienceRaw) {
    const fromAudience = normalizeKind(audienceRaw);
    if (fromAudience && !kinds.includes(fromAudience)) kinds.push(fromAudience);
  }

  if (!classIds.length && !kinds.length && wholeSchool) {
    return { scope: "school", classIds: [], recipientKinds: [] };
  }
  if (!classIds.length && kinds.length) {
    return { scope: "roles", classIds: [], recipientKinds: kinds };
  }
  if (classIds.length && kinds.length) {
    return { scope: "classes", classIds, recipientKinds: kinds };
  }
  if (classIds.length && !kinds.length) {
    throw createClientsError(400, "Catégories de destinataires obligatoires pour une audience de classe.");
  }
  throw createClientsError(400, "Audience invalide.");
}

function summarizeAudience(audience) {
  if (!audience) return "";
  if (audience.scope === "school") return "Établissement entier";
  const kindLabel = (audience.recipientKinds ?? []).map((kind) => KIND_LABELS[kind] || kind).join(", ");
  if (audience.scope === "roles") return kindLabel ? `Rôles : ${kindLabel}` : "Rôles";
  const classCount = (audience.classIds ?? []).length;
  return classCount
    ? `Classes (${classCount}) · ${kindLabel}`
    : kindLabel;
}

function validateTitleBody(payload) {
  const title = asTrimmed(payload?.title);
  const message = asTrimmed(payload?.message || payload?.body || payload?.content);
  if (!title) throw createClientsError(400, "Titre obligatoire.");
  if (!message) throw createClientsError(400, "Contenu obligatoire.");
  if (title.length > TITLE_MAX_LENGTH) {
    throw createClientsError(400, `Titre trop long (max ${TITLE_MAX_LENGTH} caractères).`);
  }
  if (message.length > BODY_MAX_LENGTH) {
    throw createClientsError(400, `Contenu trop long (max ${BODY_MAX_LENGTH} caractères).`);
  }
  return { title, message };
}

function principalPermissions(principal) {
  return Array.isArray(principal?.permissions) ? principal.permissions.map(String) : [];
}

function canManageAnnouncements(principal) {
  const perms = principalPermissions(principal);
  return perms.some(
    (token) =>
      token === "Announcements:UPDATE" ||
      token === "Gérer annonces" ||
      token === "ALL_PRIVILEGES" ||
      token === "COUNTRY_PRIVILEGES",
  );
}

function notFound(message = "Annonce introuvable.") {
  return createClientsError(404, message, CLIENTS_ERROR.ANNOUNCEMENT_NOT_FOUND || CLIENTS_ERROR.FORBIDDEN);
}

function parseAudiencePayload(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapAnnouncementHistory(row, extras = {}) {
  const audience = extras.audience ?? parseAudiencePayload(row.audience_payload) ?? null;
  const status = asTrimmed(row.status) === "archived" || row.archived_at ? "archived" : "published";
  const attachments = extras.attachments ?? [];
  const recipientCount = extras.recipientCount ?? (Number(row.recipients_count) || 0);
  const readsCount = extras.readsCount ?? (Number(row.reads_count) || 0);
  const unresolved = extras.unresolved ?? (recipientCount === 0 && status !== "archived");
  const projection = {
    type: "announcement",
    id: row.id,
    schoolCode: row.school_code ?? extras.schoolCode ?? "",
    title: row.title ?? "",
    content: row.message ?? "",
    message: row.message ?? "",
    createdByUserId: row.created_by ?? "",
    createdByName: extras.createdByName ?? row.created_by_name ?? "",
    publishedByUserId: row.published_by ?? row.created_by ?? "",
    publishedByName: extras.publishedByName ?? row.published_by_name ?? extras.createdByName ?? row.created_by_name ?? "",
    createdAt: isoOf(row.created_at),
    publishedAt: isoOf(row.published_at || row.created_at),
    updatedAt: isoOf(row.updated_at),
    archivedAt: row.archived_at ? isoOf(row.archived_at) : "",
    status,
    audience,
    audienceLabel: summarizeAudience(audience),
    recipientCount,
    readAt: extras.readAt ?? (row.reader_read_at ? isoOf(row.reader_read_at) : ""),
    attachments,
    audit: extras.audit ?? [],
    unresolved: Boolean(unresolved && extras.management),
  };
  if (extras.management) {
    projection.readsCount = readsCount;
    projection.unreadCount = Math.max(0, recipientCount - readsCount);
  }
  return projection;
}

async function hydrateAttachments(tx, announcementIds) {
  if (!announcementIds.length || typeof tx.listAttachmentsForEntities !== "function") {
    return new Map();
  }
  const rows = await tx.listAttachmentsForEntities("announcement", announcementIds);
  const byId = new Map();
  for (const row of rows) {
    const key = String(row.entity_id);
    const list = byId.get(key) ?? [];
    list.push(mapAttachmentRow(row));
    byId.set(key, list);
  }
  return byId;
}

async function bindAttachments(tx, schoolId, uploaderUserId, announcementId, attachmentIds) {
  const ids = uniqueIds(attachmentIds);
  if (!ids.length) return [];
  if (ids.length > MAX_ATTACHMENTS_PER_ANNOUNCEMENT) {
    throw createClientsError(400, `Trop de pièces jointes (max ${MAX_ATTACHMENTS_PER_ANNOUNCEMENT}).`);
  }
  if (typeof tx.attachToAnnouncement !== "function") {
    throw createClientsError(400, "Pièces jointes indisponibles.");
  }
  const attached = await tx.attachToAnnouncement({
    attachmentIds: ids,
    announcementId,
    schoolId,
    uploadedByUserId: uploaderUserId,
  });
  if (attached.length !== ids.length) {
    throw createClientsError(400, "Pièce jointe invalide ou déjà associée.");
  }
  return attached.map(mapAttachmentRow);
}

async function resolveClassIds(tx, schoolId, classIds) {
  if (!classIds.length) return [];
  if (typeof tx.listSchoolClassesByIds !== "function") {
    throw createClientsError(500, "Résolution des classes indisponible.");
  }
  const rows = await tx.listSchoolClassesByIds(schoolId, classIds);
  const found = new Set(rows.map((row) => String(row.id)));
  for (const classId of classIds) {
    if (!found.has(String(classId))) {
      throw createClientsError(404, "Classe introuvable dans l'établissement.", CLIENTS_ERROR.FORBIDDEN);
    }
  }
  return rows.map((row) => row.id);
}

async function resolveAudienceRecipients(tx, schoolId, audience) {
  const collected = new Map();
  const add = (userId, kind, reason) => {
    const id = asTrimmed(userId);
    if (!id) return;
    if (collected.has(id)) {
      const existing = collected.get(id);
      const kinds = new Set(existing.reason.kinds ?? [existing.kind]);
      kinds.add(kind);
      existing.reason = { ...existing.reason, ...reason, kinds: [...kinds] };
      return;
    }
    collected.set(id, { userId: id, kind, reason: { kinds: [kind], ...reason } });
  };

  if (audience.scope === "school") {
    const rows = typeof tx.listSchoolActiveUserIds === "function" ? await tx.listSchoolActiveUserIds(schoolId) : [];
    for (const row of rows) add(row.user_id || row.id, "school", { scope: "school" });
    return [...collected.values()];
  }

  if (audience.scope === "roles") {
    for (const kind of audience.recipientKinds) {
      const rows =
        typeof tx.listSchoolUserIdsByRecipientKind === "function"
          ? await tx.listSchoolUserIdsByRecipientKind(schoolId, kind)
          : [];
      for (const row of rows) add(row.user_id || row.id, kind, { scope: "roles" });
    }
    return [...collected.values()];
  }

  const classIds = audience.classIds;
  for (const kind of audience.recipientKinds) {
    let rows = [];
    if (kind === "student" && typeof tx.listClassStudentUserIds === "function") {
      rows = await tx.listClassStudentUserIds(schoolId, classIds);
    } else if (kind === "parent" && typeof tx.listClassParentUserIds === "function") {
      rows = await tx.listClassParentUserIds(schoolId, classIds);
    } else if (kind === "teacher" && typeof tx.listClassTeacherUserIds === "function") {
      rows = await tx.listClassTeacherUserIds(schoolId, classIds);
    } else if (kind === "staff" && typeof tx.listSchoolUserIdsByRecipientKind === "function") {
      rows = await tx.listSchoolUserIdsByRecipientKind(schoolId, "staff");
    }
    for (const row of rows) add(row.user_id || row.id, kind, { scope: "classes", classIds });
  }
  return [...collected.values()];
}

async function loadVisibleAnnouncement(tx, announcementId, school, userId, management) {
  const announcement = await tx.getAnnouncementById(announcementId);
  if (!announcement || announcement.school_id !== school.id) throw notFound();
  const isRecipient =
    typeof tx.isAnnouncementRecipient === "function"
      ? await tx.isAnnouncementRecipient(announcement.id, userId)
      : false;
  if (!isRecipient && !management) throw notFound();
  return { announcement, isRecipient };
}

async function publish(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const { title, message } = validateTitleBody(payload);
  const authorUserId = actorUserId(principal);
  if (!authorUserId) {
    throw createClientsError(403, "Auteur non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  }
  const audience = parseAudience(payload);
  const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];

  return store.withTransaction(async (tx) => {
    const { school, schoolCode } = await requireSchool(store, principal, rawPayload);
    const author = await tx.getUserById(authorUserId);
    if (!author || (author.school_id && author.school_id !== school.id && !isSuperAdminPrincipal(principal))) {
      throw createClientsError(403, "Auteur non autorisé.", CLIENTS_ERROR.FORBIDDEN);
    }
    const classIds = await resolveClassIds(tx, school.id, audience.classIds);
    const resolvedAudience = { ...audience, classIds };
    const recipients = await resolveAudienceRecipients(tx, school.id, resolvedAudience);
    const authorName = displayName(author);
    const saved = await tx.insertAnnouncement({
      schoolId: school.id,
      countryId: school.country_id,
      title,
      message,
      targetRole: resolvedAudience.scope === "school" ? "Tous" : (resolvedAudience.recipientKinds ?? []).join(","),
      targetClassId: classIds.length === 1 ? classIds[0] : null,
      createdByUserId: author.id,
      publishedByUserId: author.id,
      status: "published",
      audience: resolvedAudience,
      profile: {
        audience: summarizeAudience(resolvedAudience),
        createdByName: authorName,
        createdByUserId: author.id,
      },
    });
    if (typeof tx.insertAnnouncementRecipients === "function" && recipients.length) {
      await tx.insertAnnouncementRecipients(
        recipients.map((row) => ({
          announcementId: saved.id,
          schoolId: school.id,
          userId: row.userId,
          recipientKind: row.kind,
          audienceReason: row.reason,
        })),
      );
    }
    const attachments = await bindAttachments(tx, school.id, author.id, saved.id, attachmentIds);
    const mapped = mapAnnouncementHistory(
      { ...saved, school_code: schoolCode, created_by_name: authorName, published_by_name: authorName },
      {
        audience: resolvedAudience,
        attachments,
        recipientCount: recipients.length,
        readsCount: 0,
        createdByName: authorName,
        publishedByName: authorName,
        management: canManageAnnouncements(principal),
        unresolved: false,
        audit: [{ action: "publish", actorId: author.id, at: new Date().toISOString() }],
      },
    );
    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_announcement",
      entityType: "announcement",
      entityId: saved.id,
      newValue: {
        id: saved.id,
        audience: resolvedAudience,
        recipientCount: recipients.length,
        attachmentCount: attachments.length,
        createdByUserId: author.id,
      },
    });
    return mapped;
  });
}

async function updateAnnouncement(store, announcementId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  const authorUserId = actorUserId(principal);
  if (!authorUserId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  return store.withTransaction(async (tx) => {
    const { school, schoolCode } = await requireSchool(store, principal, rawPatch);
    const { announcement } = await loadVisibleAnnouncement(tx, announcementId, school, authorUserId, true);
    if (announcement.school_id !== school.id) throw notFound();
    if (!canManageAnnouncements(principal)) throw notFound();
    if (patch.audience !== undefined || patch.classIds !== undefined || patch.recipientKinds !== undefined || patch.targetClassId !== undefined) {
      throw createClientsError(403, "Audience immuable après publication.");
    }
    const title = patch.title !== undefined ? asTrimmed(patch.title) : announcement.title;
    const message =
      patch.message !== undefined || patch.body !== undefined || patch.content !== undefined
        ? asTrimmed(patch.message || patch.body || patch.content)
        : announcement.message;
    if (!title) throw createClientsError(400, "Titre obligatoire.");
    if (!message) throw createClientsError(400, "Contenu obligatoire.");
    if (title.length > TITLE_MAX_LENGTH) throw createClientsError(400, `Titre trop long (max ${TITLE_MAX_LENGTH} caractères).`);
    if (message.length > BODY_MAX_LENGTH) throw createClientsError(400, `Contenu trop long (max ${BODY_MAX_LENGTH} caractères).`);
    const saved = await tx.updateAnnouncement(announcement.id, {
      title,
      message,
      targetRole: announcement.target_role,
      targetClassId: announcement.target_class_id,
      status: announcement.status,
      profile: { updatedByUserId: authorUserId },
    });
    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "update_announcement",
      entityType: "announcement",
      entityId: saved.id,
      oldValue: { title: announcement.title },
      newValue: { title, updatedByUserId: authorUserId },
    });
    return getAnnouncement(store, announcementId, principal, rawPatch);
  });
}

async function archiveAnnouncement(store, announcementId, principal, auditMeta, query = {}) {
  const authorUserId = actorUserId(principal);
  if (!authorUserId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  return store.withTransaction(async (tx) => {
    const { school, schoolCode } = await requireSchool(store, principal, query);
    const { announcement } = await loadVisibleAnnouncement(tx, announcementId, school, authorUserId, true);
    if (!canManageAnnouncements(principal)) throw notFound();
    const saved =
      typeof tx.archiveAnnouncementRow === "function"
        ? await tx.archiveAnnouncementRow(announcement.id, authorUserId)
        : await tx.updateAnnouncement(announcement.id, {
            title: announcement.title,
            message: announcement.message,
            targetRole: announcement.target_role,
            targetClassId: announcement.target_class_id,
            status: "archived",
            profile: { archivedByUserId: authorUserId },
          });
    await writeClientsAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "archive_announcement",
      entityType: "announcement",
      entityId: announcement.id,
      newValue: { archivedByUserId: authorUserId, archivedAt: new Date().toISOString() },
    });
    return mapAnnouncementHistory(
      { ...saved, school_code: schoolCode },
      {
        audience: parseAudiencePayload(saved.audience_payload || announcement.audience_payload),
        management: true,
        createdByName: saved.created_by_name || announcement.author_name,
      },
    );
  });
}

async function listAnnouncements(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode, tx } = await requireSchool(store, principal, query);
  const management = canManageAnnouncements(principal);
  const limit = parseLimit(query);
  const cursor = parseCursor(query.cursor);
  if (typeof tx.listAnnouncementsForUser !== "function") {
    return { items: [], nextCursor: null };
  }
  const rows = await tx.listAnnouncementsForUser({
    userId,
    schoolId: school.id,
    limit: limit + 1,
    cursor,
    management,
  });
  const page = rows.slice(0, limit);
  const attachments = await hydrateAttachments(tx, page.map((row) => row.id));
  const items = page.map((row) =>
    mapAnnouncementHistory(row, {
      schoolCode: row.school_code || schoolCode,
      attachments: attachments.get(String(row.id)) ?? [],
      createdByName: row.created_by_name,
      publishedByName: row.published_by_name,
      management,
      readAt: row.reader_read_at ? isoOf(row.reader_read_at) : "",
      unresolved: Number(row.recipients_count || 0) === 0,
    }),
  );
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > limit ? makeCursor(last?.published_at || last?.created_at, last?.id) : null,
  };
}

async function getAnnouncement(store, announcementId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode, tx } = await requireSchool(store, principal, query);
  const management = canManageAnnouncements(principal);
  const { announcement, isRecipient } = await loadVisibleAnnouncement(
    tx,
    announcementId,
    school,
    userId,
    management,
  );
  const read =
    typeof tx.getAnnouncementRead === "function" ? await tx.getAnnouncementRead(announcement.id, userId) : null;
  const attachments = (await hydrateAttachments(tx, [announcement.id])).get(String(announcement.id)) ?? [];
  const recipientCount =
    typeof tx.countAnnouncementRecipients === "function"
      ? await tx.countAnnouncementRecipients(announcement.id)
      : 0;
  const readsCount =
    management && typeof tx.countAnnouncementReads === "function"
      ? await tx.countAnnouncementReads(announcement.id)
      : 0;
  const creator = announcement.created_by ? await tx.getUserById(announcement.created_by) : null;
  const publisher = announcement.published_by ? await tx.getUserById(announcement.published_by) : creator;
  return mapAnnouncementHistory(
    { ...announcement, school_code: announcement.school_code || schoolCode },
    {
      attachments,
      recipientCount,
      readsCount,
      management,
      readAt: isRecipient && read?.read_at ? isoOf(read.read_at) : "",
      createdByName: displayName(creator) || announcement.author_name || "",
      publishedByName: displayName(publisher) || displayName(creator) || "",
      unresolved: Number(recipientCount) === 0,
      audience: parseAudiencePayload(announcement.audience_payload),
    },
  );
}

async function markRead(store, announcementId, principal, auditMeta, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school } = await requireSchool(store, principal, query);
  return store.withTransaction(async (tx) => {
    const announcement = await tx.getAnnouncementById(announcementId);
    if (!announcement || announcement.school_id !== school.id) throw notFound();
    const isRecipient =
      typeof tx.isAnnouncementRecipient === "function"
        ? await tx.isAnnouncementRecipient(announcement.id, userId)
        : false;
    if (!isRecipient) throw notFound();
    const read = await tx.insertAnnouncementRead(announcement.id, userId);
    if (auditMeta) {
      await writeClientsAudit(tx, principal, auditMeta, {
        schoolCode: announcement.school_code,
        action: "mark_announcement_read",
        entityType: "announcement",
        entityId: announcement.id,
        newValue: { userId, readAt: isoOf(read?.read_at) },
      });
    }
    return getAnnouncement(store, announcementId, principal, query);
  });
}

async function unreadCount(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  if (typeof tx.countAnnouncementUnreadForUser !== "function") return { count: 0 };
  const count = await tx.countAnnouncementUnreadForUser(userId, school.id);
  return { count: Number(count) || 0 };
}

async function audienceOptions(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const classes =
    typeof tx.listSchoolAudienceClasses === "function" ? await tx.listSchoolAudienceClasses(school.id) : [];
  return {
    classes: classes.map((row) => ({
      id: row.id,
      code: row.class_code ?? row.code ?? "",
      name: row.name ?? "",
    })),
    recipientKinds: RECIPIENT_KINDS.map((kind) => ({ id: kind, label: KIND_LABELS[kind] })),
  };
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
          entityType: "announcement",
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
          newValue: { ...mapAttachmentRow(saved), entityType: "announcement" },
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

async function assertCanDownloadAnnouncementAttachment(tx, school, userId, attachment, principal) {
  if (attachment.school_id !== school.id) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
  if (asTrimmed(attachment.status) === "uploaded" && !attachment.entity_id) {
    if (String(attachment.uploaded_by_user_id) !== String(userId) && !canManageAnnouncements(principal)) {
      throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
    }
    return;
  }
  if (asTrimmed(attachment.entity_type) !== "announcement" || !attachment.entity_id) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
  const announcement = await tx.getAnnouncementById(attachment.entity_id);
  if (!announcement || announcement.school_id !== school.id) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
  const isRecipient =
    typeof tx.isAnnouncementRecipient === "function"
      ? await tx.isAnnouncementRecipient(announcement.id, userId)
      : false;
  if (!isRecipient && !canManageAnnouncements(principal)) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
}

async function downloadAnnouncementBytes(store, attachment, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  await assertCanDownloadAnnouncementAttachment(tx, school, userId, attachment, principal);
  const bytes = await readAttachmentBytes(attachment.storage_key);
  return {
    bytes,
    fileName: attachment.file_name,
    mimeType: attachment.mime_type,
  };
}

module.exports = {
  TITLE_MAX_LENGTH,
  BODY_MAX_LENGTH,
  RECIPIENT_KINDS,
  publish,
  createAnnouncement: publish,
  updateAnnouncement,
  archiveAnnouncement,
  listAnnouncements,
  getAnnouncement,
  markRead,
  unreadCount,
  audienceOptions,
  uploadAttachment,
  assertCanDownloadAnnouncementAttachment,
  downloadAnnouncementBytes,
  parseAudience,
  canManageAnnouncements,
  mapAnnouncementHistory,
};
