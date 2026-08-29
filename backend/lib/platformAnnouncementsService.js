"use strict";

/**
 * ANN-PLATFORM-1 — Annonces Superadmin (domaine plateforme).
 * Domaine distinct du C3 établissement : pas d'école obligatoire, snapshot plateforme.
 * all_active_users : users.status=active ET au moins un user_roles canonique actif.
 */

const {
  CLIENTS_ERROR,
  asTrimmed,
  createClientsError,
  ignoreClientScope,
  formatDateTime,
} = require("./clientsManagement");
const { actorUserId, displayName } = require("./communicationsMessagesService");
const {
  mapAttachmentRow,
  persistPlatformAttachmentBytes,
  removeStoredAttachment,
  readAttachmentBytes,
  validateUploadBuffer,
} = require("./communicationsAttachments");

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 8000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_ATTACHMENTS = 10;
const SYSTEM_SENDER_DISPLAY_NAME = "Somafrik";

const ADMINISTRATIVE_AUDIENCES = Object.freeze(["country_admins", "school_admins", "all_admins"]);
const AUDIENCE_LABELS = Object.freeze({
  country_admins: "Administrateurs pays",
  school_admins: "Administrateurs d'établissement",
  all_admins: "Tous les administrateurs",
  all_active_users: "Tous les utilisateurs Somafrik",
});
const ROLE_KEYS_BY_AUDIENCE = Object.freeze({
  country_admins: ["COUNTRY_ADMIN"],
  school_admins: ["SCHOOL_ADMIN"],
  all_admins: ["COUNTRY_ADMIN", "SCHOOL_ADMIN"],
});
const FORBIDDEN_CLIENT_RECIPIENT_KEYS = Object.freeze([
  "recipientIds",
  "recipientUserIds",
  "userIds",
  "users",
  "recipients",
]);

function openTx(store) {
  return typeof store.bind === "function" ? store.bind({}) : store;
}

function uniqueIds(values) {
  return [...new Set((values ?? []).map((value) => asTrimmed(value)).filter(Boolean))];
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

function notFound(message = "Annonce introuvable.") {
  return createClientsError(404, message, CLIENTS_ERROR.ANNOUNCEMENT_NOT_FOUND || CLIENTS_ERROR.FORBIDDEN);
}

function forbidden(message = "Accès refusé.") {
  return createClientsError(403, message, CLIENTS_ERROR.FORBIDDEN);
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

function parsePlatformAudience(payload) {
  const typeRaw = asTrimmed(payload?.announcementType || payload?.type)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let announcementType = "";
  if (["administrative", "admin", "annonce administrative"].includes(typeRaw)) {
    announcementType = "administrative";
  } else if (["system", "systeme", "somafrik", "annonce systeme somafrik"].includes(typeRaw)) {
    announcementType = "system";
  } else {
    throw createClientsError(400, "Type d'annonce plateforme invalide.");
  }

  let audienceKey = asTrimmed(payload?.audienceKey || payload?.audience)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["country_admins", "administrateurs_pays", "admin_pays"].includes(audienceKey)) {
    audienceKey = "country_admins";
  } else if (
    ["school_admins", "administrateurs_detablissement", "administrateurs_d_etablissement", "admin_school"].includes(
      audienceKey,
    )
  ) {
    audienceKey = "school_admins";
  } else if (["all_admins", "tous_les_administrateurs"].includes(audienceKey)) {
    audienceKey = "all_admins";
  } else if (
    ["all_active_users", "tous_les_utilisateurs_somafrik", "tous_les_utilisateurs"].includes(audienceKey)
  ) {
    audienceKey = "all_active_users";
  } else if (announcementType === "system" && !audienceKey) {
    audienceKey = "all_active_users";
  } else {
    throw createClientsError(400, "Audience plateforme invalide.");
  }

  if (announcementType === "system") {
    if (audienceKey !== "all_active_users") {
      throw createClientsError(400, "Une annonce système cible uniquement tous les utilisateurs Somafrik.");
    }
  } else if (!ADMINISTRATIVE_AUDIENCES.includes(audienceKey)) {
    throw createClientsError(400, "Audience administrative invalide.");
  }

  return { announcementType, audienceKey };
}

function assertNoClientRecipients(payload) {
  for (const key of FORBIDDEN_CLIENT_RECIPIENT_KEYS) {
    if (payload?.[key] !== undefined && payload[key] !== null) {
      const value = payload[key];
      const emptyArray = Array.isArray(value) && value.length === 0;
      if (!emptyArray) {
        throw createClientsError(400, "Les destinataires sont résolus exclusivement côté serveur.");
      }
    }
  }
}

async function writeClientsAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordClientsAudit !== "function") {
    throw createClientsError(500, "Audit clients indisponible dans la transaction.");
  }
  await tx.recordClientsAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode || "",
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

async function requireLiveSuperAdmin(tx, principal) {
  const userId = actorUserId(principal);
  if (!userId || userId === "anonymous") throw forbidden("Auteur non authentifié.");
  const author = typeof tx.getUserById === "function" ? await tx.getUserById(userId) : null;
  if (!author || String(author.status ?? "active").toLowerCase() !== "active") {
    throw forbidden("Réservé au Super Administrateur Somafrik.");
  }
  const keys =
    typeof tx.listActiveRoleKeys === "function" ? await tx.listActiveRoleKeys(author.id) : [];
  const liveSuper = (keys ?? []).map((key) => String(key).toUpperCase()).includes("SUPER_ADMIN");
  if (!liveSuper) throw forbidden("Réservé au Super Administrateur Somafrik.");
  return author;
}

async function isLiveSuperAdmin(tx, principal) {
  try {
    await requireLiveSuperAdmin(tx, principal);
    return true;
  } catch {
    return false;
  }
}

function mapPlatformAttachment(row) {
  if (!row) return null;
  const mapped = mapAttachmentRow({
    ...row,
    school_id: null,
    entity_type: "platform_announcement",
    entity_id: row.announcement_id,
  });
  if (!mapped) return null;
  return {
    id: mapped.id,
    fileName: mapped.fileName,
    mimeType: mapped.mimeType,
    fileSize: mapped.fileSize,
  };
}

function mapPlatformAnnouncement(row, extras = {}) {
  const status = asTrimmed(row.status) === "archived" || row.archived_at ? "archived" : "published";
  const announcementType = asTrimmed(row.announcement_type);
  const audienceKey = asTrimmed(row.audience_key);
  const senderDisplayName =
    announcementType === "system"
      ? SYSTEM_SENDER_DISPLAY_NAME
      : extras.senderDisplayName || row.sender_display_name || extras.createdByName || "";
  return {
    type: "platform-announcement",
    source: "platform",
    domain: "platform",
    id: row.id,
    announcementType,
    audienceKey,
    title: row.title ?? "",
    content: row.message ?? "",
    message: row.message ?? "",
    createdByUserId: row.created_by ?? "",
    publishedByUserId: row.published_by ?? row.created_by ?? "",
    createdByName: extras.createdByName || "",
    publishedByName: extras.publishedByName || extras.createdByName || "",
    senderDisplayName,
    createdAt: isoOf(row.created_at),
    publishedAt: isoOf(row.published_at || row.created_at),
    updatedAt: isoOf(row.updated_at),
    archivedAt: row.archived_at ? isoOf(row.archived_at) : "",
    status,
    audience: { scope: "platform", audienceKey },
    audienceLabel: AUDIENCE_LABELS[audienceKey] || audienceKey,
    originLabel: announcementType === "system" ? "Annonce Somafrik" : "Annonce administrative Somafrik",
    badge: announcementType === "system" ? "Somafrik" : "",
    systemBroadcast: announcementType === "system",
    recipientCount: extras.recipientCount ?? (Number(row.recipients_count) || 0),
    readAt: extras.readAt ?? (row.reader_read_at ? isoOf(row.reader_read_at) : ""),
    attachments: extras.attachments ?? [],
    unresolved: false,
  };
}

async function snapshotAudienceRecipients(tx, announcementId, audienceKey) {
  if (typeof tx.snapshotPlatformAnnouncementRecipients !== "function") {
    throw createClientsError(500, "Snapshot destinataires plateforme indisponible.");
  }
  const roleKeys = ROLE_KEYS_BY_AUDIENCE[audienceKey] || [];
  const count = await tx.snapshotPlatformAnnouncementRecipients({
    announcementId,
    audienceKey,
    roleKeys,
  });
  return Number(count) || 0;
}

async function bindAttachments(tx, uploaderUserId, announcementId, attachmentIds) {
  const ids = uniqueIds(attachmentIds);
  if (!ids.length) return [];
  if (ids.length > MAX_ATTACHMENTS) {
    throw createClientsError(400, `Trop de pièces jointes (max ${MAX_ATTACHMENTS}).`);
  }
  if (typeof tx.attachToPlatformAnnouncement !== "function") {
    throw createClientsError(400, "Pièces jointes indisponibles.");
  }
  const attached = await tx.attachToPlatformAnnouncement({
    attachmentIds: ids,
    announcementId,
    uploadedByUserId: uploaderUserId,
  });
  if (attached.length !== ids.length) {
    throw createClientsError(400, "Pièce jointe invalide ou déjà associée.");
  }
  return attached.map(mapPlatformAttachment).filter(Boolean);
}

async function hydrateAttachments(tx, announcementIds) {
  if (!announcementIds.length || typeof tx.listPlatformAnnouncementAttachments !== "function") {
    return new Map();
  }
  const rows = await tx.listPlatformAnnouncementAttachments(announcementIds);
  const byId = new Map();
  for (const row of rows) {
    const key = String(row.announcement_id);
    const list = byId.get(key) ?? [];
    list.push(mapPlatformAttachment(row));
    byId.set(key, list);
  }
  return byId;
}

async function hydrateOne(tx, announcement, userId, management) {
  const isRecipient =
    typeof tx.isPlatformAnnouncementRecipient === "function"
      ? await tx.isPlatformAnnouncementRecipient(announcement.id, userId)
      : false;
  if (!isRecipient && !management) throw notFound();
  const read =
    typeof tx.getPlatformAnnouncementRead === "function"
      ? await tx.getPlatformAnnouncementRead(announcement.id, userId)
      : null;
  const attachments = (await hydrateAttachments(tx, [announcement.id])).get(String(announcement.id)) ?? [];
  const recipientCount =
    typeof tx.countPlatformAnnouncementRecipients === "function"
      ? await tx.countPlatformAnnouncementRecipients(announcement.id)
      : 0;
  const creator = announcement.created_by ? await tx.getUserById(announcement.created_by) : null;
  const publisher = announcement.published_by ? await tx.getUserById(announcement.published_by) : creator;
  return mapPlatformAnnouncement(announcement, {
    attachments,
    recipientCount,
    readAt: isRecipient && read?.read_at ? isoOf(read.read_at) : "",
    createdByName: displayName(creator),
    publishedByName: displayName(publisher) || displayName(creator),
    senderDisplayName: announcement.sender_display_name,
  });
}

async function publish(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  assertNoClientRecipients(rawPayload);
  assertNoClientRecipients(payload);
  const { title, message } = validateTitleBody(payload);
  const { announcementType, audienceKey } = parsePlatformAudience(payload);
  const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];

  return store.withTransaction(async (tx) => {
    const author = await requireLiveSuperAdmin(tx, principal);
    const senderDisplayName =
      announcementType === "system" ? SYSTEM_SENDER_DISPLAY_NAME : displayName(author);
    const saved = await tx.insertPlatformAnnouncement({
      announcementType,
      audienceKey,
      title,
      message,
      createdByUserId: author.id,
      publishedByUserId: author.id,
      senderDisplayName,
      status: "published",
    });
    const recipientCount = await snapshotAudienceRecipients(tx, saved.id, audienceKey);
    const attachments = await bindAttachments(tx, author.id, saved.id, attachmentIds);
    const mapped = mapPlatformAnnouncement(
      { ...saved, sender_display_name: senderDisplayName },
      {
        attachments,
        recipientCount,
        createdByName: displayName(author),
        publishedByName: displayName(author),
        senderDisplayName,
      },
    );
    await writeClientsAudit(tx, principal, auditMeta, {
      action: "create_platform_announcement",
      entityType: "platform_announcement",
      entityId: saved.id,
      newValue: {
        id: saved.id,
        announcementType,
        audienceKey,
        recipientCount,
        attachmentCount: attachments.length,
        createdByUserId: author.id,
        senderDisplayName,
      },
    });
    return mapped;
  });
}

async function listAnnouncements(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw forbidden("Non authentifié.");
  const tx = openTx(store);
  const management = await isLiveSuperAdmin(tx, principal);
  const limit = parseLimit(query);
  const cursor = parseCursor(query.cursor);
  if (typeof tx.listPlatformAnnouncementsForUser !== "function") {
    return { items: [], nextCursor: null };
  }
  const rows = await tx.listPlatformAnnouncementsForUser({
    userId,
    limit: limit + 1,
    cursor,
    management,
  });
  const page = rows.slice(0, limit);
  const attachments = await hydrateAttachments(
    tx,
    page.map((row) => row.id),
  );
  const items = page.map((row) =>
    mapPlatformAnnouncement(row, {
      attachments: attachments.get(String(row.id)) ?? [],
      createdByName: row.created_by_name,
      publishedByName: row.published_by_name,
      senderDisplayName: row.sender_display_name,
      readAt: row.reader_read_at ? isoOf(row.reader_read_at) : "",
      recipientCount: Number(row.recipients_count) || 0,
    }),
  );
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > limit ? makeCursor(last?.published_at || last?.created_at, last?.id) : null,
  };
}

async function getAnnouncement(store, announcementId, principal) {
  const userId = actorUserId(principal);
  if (!userId) throw forbidden("Non authentifié.");
  const tx = openTx(store);
  const announcement =
    typeof tx.getPlatformAnnouncementById === "function"
      ? await tx.getPlatformAnnouncementById(announcementId)
      : null;
  if (!announcement) throw notFound();
  const management = await isLiveSuperAdmin(tx, principal);
  return hydrateOne(tx, announcement, userId, management);
}

async function markRead(store, announcementId, principal, auditMeta) {
  const userId = actorUserId(principal);
  if (!userId) throw forbidden("Non authentifié.");
  return store.withTransaction(async (tx) => {
    const announcement = await tx.getPlatformAnnouncementById(announcementId);
    if (!announcement) throw notFound();
    const isRecipient = await tx.isPlatformAnnouncementRecipient(announcement.id, userId);
    if (!isRecipient) throw notFound();
    const read = await tx.insertPlatformAnnouncementRead(announcement.id, userId);
    if (auditMeta) {
      await writeClientsAudit(tx, principal, auditMeta, {
        action: "mark_platform_announcement_read",
        entityType: "platform_announcement",
        entityId: announcement.id,
        newValue: { userId, readAt: isoOf(read?.read_at) },
      });
    }
    const management = await isLiveSuperAdmin(tx, principal);
    return hydrateOne(tx, announcement, userId, management);
  });
}

async function archiveAnnouncement(store, announcementId, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const author = await requireLiveSuperAdmin(tx, principal);
    const announcement = await tx.getPlatformAnnouncementById(announcementId);
    if (!announcement) throw notFound();
    const saved = await tx.archivePlatformAnnouncement(announcement.id, author.id);
    await writeClientsAudit(tx, principal, auditMeta, {
      action: "archive_platform_announcement",
      entityType: "platform_announcement",
      entityId: announcement.id,
      newValue: { archivedByUserId: author.id, archivedAt: new Date().toISOString() },
    });
    return hydrateOne(tx, saved, author.id, true);
  });
}

async function unreadCount(store, principal) {
  const userId = actorUserId(principal);
  if (!userId) throw forbidden("Non authentifié.");
  const tx = openTx(store);
  if (typeof tx.countPlatformAnnouncementUnreadForUser !== "function") return { count: 0 };
  const count = await tx.countPlatformAnnouncementUnreadForUser(userId);
  return { count: Number(count) || 0 };
}

async function uploadAttachment(store, principal, { buffer, fileName, mimeType }) {
  const userId = actorUserId(principal);
  if (!userId) throw forbidden("Non authentifié.");
  const validated = validateUploadBuffer(buffer, mimeType, fileName);
  let storageKey = "";
  try {
    return await store.withTransaction(async (tx) => {
      const author = await requireLiveSuperAdmin(tx, principal);
      storageKey = await persistPlatformAttachmentBytes(buffer);
      try {
        const saved = await tx.insertPlatformAnnouncementAttachment({
          announcementId: null,
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          fileSize: validated.fileSize,
          storageKey,
          uploadedByUserId: author.id,
          status: "uploaded",
        });
        await writeClientsAudit(tx, principal, {}, {
          action: "upload_platform_announcement_attachment",
          entityType: "platform_attachment",
          entityId: saved.id,
          newValue: mapPlatformAttachment(saved),
        });
        return mapPlatformAttachment(saved);
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

async function downloadAttachment(store, attachmentId, principal) {
  const userId = actorUserId(principal);
  if (!userId) throw forbidden("Non authentifié.");
  const tx = openTx(store);
  const attachment =
    typeof tx.getPlatformAnnouncementAttachmentById === "function"
      ? await tx.getPlatformAnnouncementAttachmentById(attachmentId)
      : null;
  if (!attachment) throw notFound("Pièce jointe introuvable.");
  const management = await isLiveSuperAdmin(tx, principal);
  if (asTrimmed(attachment.status) === "uploaded" && !attachment.announcement_id) {
    if (String(attachment.uploaded_by_user_id) !== String(userId) && !management) {
      throw notFound("Pièce jointe introuvable.");
    }
  } else {
    if (!attachment.announcement_id) throw notFound("Pièce jointe introuvable.");
    const isRecipient = await tx.isPlatformAnnouncementRecipient(attachment.announcement_id, userId);
    if (!isRecipient && !management) throw notFound("Pièce jointe introuvable.");
  }
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
  SYSTEM_SENDER_DISPLAY_NAME,
  AUDIENCE_LABELS,
  parsePlatformAudience,
  publish,
  createAnnouncement: publish,
  listAnnouncements,
  getAnnouncement,
  markRead,
  archiveAnnouncement,
  unreadCount,
  uploadAttachment,
  downloadAttachment,
};
