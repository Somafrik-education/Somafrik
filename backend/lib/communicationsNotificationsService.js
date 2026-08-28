"use strict";

const crypto = require("node:crypto");
const {
  CLIENTS_ERROR,
  asTrimmed,
  createClientsError,
  formatDateTime,
  ignoreClientScope,
} = require("./clientsManagement");
const {
  requireSchool,
  actorUserId,
  displayName,
} = require("./communicationsMessagesService");
const {
  validateUploadBuffer,
  persistAttachmentBytes,
  removeStoredAttachment,
  readAttachmentBytes,
  mapAttachmentRow,
} = require("./communicationsAttachments");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_ATTACHMENTS = 10;
const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 8000;
const SYSTEM_SENDER_NAME = "Somafrik";
const RECIPIENT_KINDS = new Set(["parent", "teacher", "student", "staff"]);

function openTx(store) {
  return typeof store.bind === "function" ? store.bind({}) : store;
}

function isoOf(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? formatDateTime(value) : parsed.toISOString();
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
  return `${isoOf(at)}|${id}`;
}

function notFound() {
  return createClientsError(404, "Notification introuvable.", CLIENTS_ERROR.FORBIDDEN);
}

function principalPermissions(principal) {
  return new Set(Array.isArray(principal?.permissions) ? principal.permissions.map(String) : []);
}

function canManage(principal) {
  const perms = principalPermissions(principal);
  return perms.has("Notifications:UPDATE") || perms.has("ALL_PRIVILEGES") || perms.has("COUNTRY_PRIVILEGES");
}

function normalizeKind(raw) {
  const value = asTrimmed(raw).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (["parent", "parents"].includes(value)) return "parent";
  if (["teacher", "teachers", "enseignant", "enseignants"].includes(value)) return "teacher";
  if (["student", "students", "eleve", "eleves"].includes(value)) return "student";
  if (["staff", "personnel"].includes(value)) return "staff";
  return "";
}

function parseAudience(payload) {
  const classIds = [...new Set((Array.isArray(payload?.classIds) ? payload.classIds : [])
    .map(asTrimmed).filter(Boolean))];
  const kinds = [...new Set((Array.isArray(payload?.recipientKinds) ? payload.recipientKinds : [])
    .map(normalizeKind).filter((kind) => RECIPIENT_KINDS.has(kind)))];
  if (!classIds.length && !kinds.length) return { scope: "school", classIds: [], recipientKinds: [] };
  if (!classIds.length) return { scope: "roles", classIds: [], recipientKinds: kinds };
  if (!kinds.length) throw createClientsError(400, "Catégories de destinataires obligatoires pour les classes.");
  return { scope: "classes", classIds, recipientKinds: kinds };
}

async function resolveManualRecipients(tx, schoolId, audience) {
  const ids = new Map();
  const add = (userId, kind, context = {}) => {
    const id = asTrimmed(userId);
    if (id) ids.set(id, { userId: id, kind, context });
  };
  if (audience.scope === "school") {
    const rows = await tx.listSchoolActiveUserIds(schoolId);
    for (const row of rows) add(row.user_id || row.id, "school", { scope: "school" });
    return [...ids.values()];
  }
  if (audience.scope === "roles") {
    for (const kind of audience.recipientKinds) {
      for (const row of await tx.listSchoolUserIdsByRecipientKind(schoolId, kind)) {
        add(row.user_id || row.id, kind, { scope: "roles" });
      }
    }
    return [...ids.values()];
  }
  const classes = await tx.listSchoolClassesByIds(schoolId, audience.classIds);
  if (classes.length !== audience.classIds.length) throw notFound();
  for (const kind of audience.recipientKinds) {
    let rows = [];
    if (kind === "parent") rows = await tx.listClassParentUserIds(schoolId, audience.classIds);
    if (kind === "teacher") rows = await tx.listClassTeacherUserIds(schoolId, audience.classIds);
    if (kind === "student") rows = await tx.listClassStudentUserIds(schoolId, audience.classIds);
    if (kind === "staff") rows = await tx.listSchoolUserIdsByRecipientKind(schoolId, "staff");
    for (const row of rows) add(row.user_id || row.id, kind, { scope: "classes", classIds: audience.classIds });
  }
  return [...ids.values()];
}

async function hydrateAttachments(tx, notificationIds) {
  if (!notificationIds.length || typeof tx.listAttachmentsForEntities !== "function") return new Map();
  const rows = await tx.listAttachmentsForEntities("notification", notificationIds);
  const result = new Map();
  for (const row of rows) {
    const key = String(row.entity_id);
    const list = result.get(key) ?? [];
    list.push(mapAttachmentRow(row));
    result.set(key, list);
  }
  return result;
}

function mapNotification(row, extras = {}) {
  return {
    type: "notification",
    id: row.id,
    schoolCode: row.school_code ?? extras.schoolCode ?? "",
    eventType: row.event_type,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    senderType: row.sender_type,
    senderUserId: row.sender_user_id ?? null,
    senderName: row.sender_name || (row.sender_type === "system" ? SYSTEM_SENDER_NAME : ""),
    title: row.title,
    body: row.body,
    message: row.body,
    createdAt: isoOf(row.created_at),
    publishedAt: isoOf(row.published_at || row.created_at),
    readAt: row.read_at ? isoOf(row.read_at) : "",
    archivedAt: row.recipient_archived_at ? isoOf(row.recipient_archived_at) : "",
    status: row.read_at ? "Lu" : "Non lu",
    attachments: extras.attachments ?? [],
    navigationTarget: typeof row.navigation_target === "string" ? JSON.parse(row.navigation_target || "{}") : (row.navigation_target ?? {}),
    metadataSafe: typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : (row.metadata ?? {}),
  };
}

async function loadVisible(tx, notificationId, schoolId, userId, management = false) {
  const row = await tx.one(
    `SELECT n.*, s.school_code, r.read_at, r.archived_at AS recipient_archived_at
     FROM communication_notifications n
     JOIN schools s ON s.id = n.school_id
     LEFT JOIN notification_recipients r ON r.notification_id = n.id AND r.user_id = $2
     WHERE n.id::text = $1 AND n.school_id = $3`,
    [notificationId, userId, schoolId],
  );
  if (!row || (!row.read_at && !row.recipient_archived_at && !management)) {
    const recipient = row
      ? await tx.one(`SELECT 1 FROM notification_recipients WHERE notification_id = $1 AND user_id = $2`, [row.id, userId])
      : null;
    if (!recipient && !management) throw notFound();
  }
  if (!row) throw notFound();
  return row;
}

async function list(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode, tx } = await requireSchool(store, principal, query);
  const limit = parseLimit(query);
  const cursor = parseCursor(query.cursor);
  const params = [school.id, userId];
  let cursorSql = "";
  if (cursor?.at && cursor?.id) {
    params.push(cursor.at, cursor.id);
    cursorSql = `AND (n.created_at, n.id) < ($3::timestamptz, $4::uuid)`;
  }
  params.push(limit + 1);
  const rows = await tx.all(
    `SELECT n.*, $1::text AS scoped_school_id, s.school_code,
            r.read_at, r.archived_at AS recipient_archived_at
     FROM notification_recipients r
     JOIN communication_notifications n ON n.id = r.notification_id AND n.school_id = r.school_id
     JOIN schools s ON s.id = n.school_id
     WHERE r.school_id = $1 AND r.user_id = $2 AND r.archived_at IS NULL
       ${cursorSql}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit);
  const attachments = await hydrateAttachments(tx, page.map((row) => row.id));
  return {
    items: page.map((row) => mapNotification(row, { schoolCode, attachments: attachments.get(String(row.id)) ?? [] })),
    nextCursor: rows.length > limit ? makeCursor(page.at(-1)?.created_at, page.at(-1)?.id) : null,
  };
}

async function get(store, notificationId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode, tx } = await requireSchool(store, principal, query);
  const row = await loadVisible(tx, notificationId, school.id, userId, canManage(principal));
  const attachments = (await hydrateAttachments(tx, [row.id])).get(String(row.id)) ?? [];
  return mapNotification(row, { schoolCode, attachments });
}

async function unreadCount(store, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const row = await tx.one(
    `SELECT count(*)::int AS c
     FROM notification_recipients r
     JOIN communication_notifications n ON n.id = r.notification_id AND n.school_id = r.school_id
     WHERE r.school_id = $1 AND r.user_id = $2 AND r.read_at IS NULL AND r.archived_at IS NULL`,
    [school.id, userId],
  );
  return { count: Number(row?.c || 0) };
}

async function markRead(store, notificationId, principal, auditMeta, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode } = await requireSchool(store, principal, query);
  return store.withTransaction(async (tx) => {
    const recipient = await tx.one(
      `UPDATE notification_recipients
       SET read_at = COALESCE(read_at, NOW())
       WHERE notification_id = $1 AND user_id = $2 AND school_id = $3 AND archived_at IS NULL
       RETURNING *`,
      [notificationId, userId, school.id],
    );
    if (!recipient) throw notFound();
    if (typeof tx.recordClientsAudit === "function" && auditMeta) {
      await tx.recordClientsAudit({
        schoolCode,
        userId,
        action: "mark_notification_read",
        entityType: "notification",
        entityId: notificationId,
        newValue: { readAt: isoOf(recipient.read_at) },
        ipAddress: auditMeta.ipAddress,
        userAgent: auditMeta.userAgent,
      });
    }
    const row = await loadVisible(tx, notificationId, school.id, userId, false);
    const attachments = (await hydrateAttachments(tx, [row.id])).get(String(row.id)) ?? [];
    return mapNotification(row, { schoolCode, attachments });
  });
}

async function archive(store, notificationId, principal, auditMeta, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, schoolCode } = await requireSchool(store, principal, query);
  return store.withTransaction(async (tx) => {
    const recipient = await tx.one(
      `UPDATE notification_recipients
       SET archived_at = COALESCE(archived_at, NOW())
       WHERE notification_id = $1 AND user_id = $2 AND school_id = $3
       RETURNING *`,
      [notificationId, userId, school.id],
    );
    if (!recipient) throw notFound();
    if (typeof tx.recordClientsAudit === "function" && auditMeta) {
      await tx.recordClientsAudit({
        schoolCode,
        userId,
        action: "archive_notification",
        entityType: "notification",
        entityId: notificationId,
        newValue: { archivedAt: isoOf(recipient.archived_at) },
        ipAddress: auditMeta.ipAddress,
        userAgent: auditMeta.userAgent,
      });
    }
    return { id: notificationId, archivedAt: isoOf(recipient.archived_at) };
  });
}

async function uploadAttachment(store, principal, { buffer, fileName, mimeType }, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school } = await requireSchool(store, principal, query);
  const safe = validateUploadBuffer({ buffer, fileName, mimeType });
  let storageKey = null;
  try {
    const persisted = await persistAttachmentBytes({ ...safe, schoolId: school.id });
    storageKey = persisted.storageKey;
    const tx = openTx(store);
    const row = await tx.insertAttachment({
      schoolId: school.id,
      entityType: "notification",
      entityId: null,
      fileName: safe.fileName,
      mimeType: safe.mimeType,
      fileSize: safe.fileSize,
      storageKey,
      uploadedByUserId: userId,
      status: "uploaded",
    });
    return mapAttachmentRow(row);
  } catch (error) {
    if (storageKey) await removeStoredAttachment(storageKey);
    throw error;
  }
}

async function bindAttachments(tx, { schoolId, notificationId, uploadedByUserId, attachmentIds }) {
  const ids = [...new Set((attachmentIds ?? []).map(asTrimmed).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_ATTACHMENTS) throw createClientsError(400, `Trop de pièces jointes (max ${MAX_ATTACHMENTS}).`);
  const rows = await tx.all(
    `UPDATE communication_attachments
     SET entity_id = $2, status = 'attached'
     WHERE id = ANY($1::uuid[]) AND school_id = $3 AND uploaded_by_user_id = $4
       AND entity_type = 'notification' AND entity_id IS NULL AND status = 'uploaded'
     RETURNING *`,
    [ids, notificationId, schoolId, uploadedByUserId],
  );
  if (rows.length !== ids.length) throw createClientsError(400, "Pièce jointe invalide ou déjà associée.");
  return rows.map(mapAttachmentRow);
}

async function createManual(store, rawPayload, principal, auditMeta, idempotencyKey) {
  const payload = ignoreClientScope(rawPayload);
  const userId = actorUserId(principal);
  const key = asTrimmed(idempotencyKey);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  if (!key) throw createClientsError(400, "Idempotency-Key obligatoire.");
  const title = asTrimmed(payload.title);
  const body = asTrimmed(payload.body || payload.message);
  if (!title || !body) throw createClientsError(400, "Titre et message obligatoires.");
  if (title.length > TITLE_MAX_LENGTH || body.length > BODY_MAX_LENGTH) throw createClientsError(400, "Notification trop longue.");
  const audience = parseAudience(payload);
  const { school, schoolCode } = await requireSchool(store, principal, rawPayload);
  return store.withTransaction(async (tx) => {
    const author = await tx.getUserById(userId);
    if (!author || (author.school_id && String(author.school_id) !== String(school.id))) {
      throw createClientsError(403, "Auteur non autorisé.", CLIENTS_ERROR.FORBIDDEN);
    }
    const eventKey = `notification.manual:${school.id}:${key}`;
    let row = await tx.one(`SELECT * FROM communication_notifications WHERE event_key = $1`, [eventKey]);
    if (!row) {
      row = await tx.one(
        `INSERT INTO communication_notifications (
           school_id, event_key, event_type, source_entity_type, source_entity_id,
           title, body, sender_type, sender_user_id, sender_name,
           navigation_target, metadata, status, created_at, published_at
         ) VALUES ($1,$2,'notification.manual','notification',$3,$4,$5,'user',$6,$7,$8::jsonb,$9::jsonb,'published',NOW(),NOW())
         RETURNING *`,
        [school.id, eventKey, crypto.randomUUID(), title, body, userId, displayName(author), JSON.stringify(payload.navigationTarget ?? {}), JSON.stringify({ audience })],
      );
      const recipients = await resolveManualRecipients(tx, school.id, audience);
      for (const recipient of recipients) {
        await tx.query(
          `INSERT INTO notification_recipients (
             notification_id, school_id, user_id, recipient_kind, recipient_context, created_at
           ) VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
           ON CONFLICT (notification_id, user_id) DO NOTHING`,
          [row.id, school.id, recipient.userId, recipient.kind, JSON.stringify(recipient.context ?? {})],
        );
      }
      await bindAttachments(tx, {
        schoolId: school.id,
        notificationId: row.id,
        uploadedByUserId: userId,
        attachmentIds: payload.attachmentIds,
      });
      if (typeof tx.recordClientsAudit === "function") {
        await tx.recordClientsAudit({
          schoolCode,
          userId,
          action: "create_internal_notification",
          entityType: "notification",
          entityId: row.id,
          newValue: { eventKey, recipientCount: recipients.length },
          ipAddress: auditMeta?.ipAddress,
          userAgent: auditMeta?.userAgent,
        });
      }
    }
    const recipientRow = await tx.one(
      `SELECT n.*, s.school_code, r.read_at, r.archived_at AS recipient_archived_at
       FROM communication_notifications n JOIN schools s ON s.id = n.school_id
       LEFT JOIN notification_recipients r ON r.notification_id = n.id AND r.user_id = $2
       WHERE n.id = $1`,
      [row.id, userId],
    );
    const attachments = (await hydrateAttachments(tx, [row.id])).get(String(row.id)) ?? [];
    return mapNotification(recipientRow || { ...row, school_code: schoolCode }, { schoolCode, attachments });
  });
}

async function downloadAttachment(store, attachmentId, principal, query = {}) {
  const userId = actorUserId(principal);
  if (!userId) throw createClientsError(403, "Non authentifié.", CLIENTS_ERROR.FORBIDDEN);
  const { school, tx } = await requireSchool(store, principal, query);
  const attachment = await tx.getAttachmentById(attachmentId);
  if (!attachment || attachment.school_id !== school.id || attachment.entity_type !== "notification") throw notFound();
  if (attachment.status === "uploaded" && !attachment.entity_id) {
    if (String(attachment.uploaded_by_user_id) !== String(userId)) throw notFound();
  } else {
    const recipient = await tx.one(
      `SELECT 1 FROM notification_recipients WHERE notification_id = $1 AND user_id = $2 AND school_id = $3`,
      [attachment.entity_id, userId, school.id],
    );
    if (!recipient && !canManage(principal)) throw notFound();
  }
  const bytes = await readAttachmentBytes(attachment.storage_key);
  return { bytes, fileName: attachment.file_name, mimeType: attachment.mime_type };
}

async function eventSpec(tx, event) {
  const sourceId = event.source_entity_id;
  const schoolId = event.school_id;
  const eventType = event.event_type;
  const recipients = new Map();
  const add = (id, kind = "user", context = {}) => {
    if (id && String(id) !== String(event.actor_user_id || "")) recipients.set(String(id), { userId: id, kind, context });
  };
  // Une annonce reprend exactement le snapshot C3, y compris son auteur s'il est destinataire.
  const addExact = (id, kind = "user", context = {}) => {
    if (id) recipients.set(String(id), { userId: id, kind, context });
  };
  let title = "Nouvelle notification";
  let body = "Une nouvelle information est disponible dans Somafrik.";
  let navigationTarget = {};
  let metadata = {};

  if (eventType === "communication.message.created") {
    const message = await tx.one(
      `SELECT m.*, c.id AS conversation_id FROM school_messages m
       JOIN school_conversations c ON c.id = m.conversation_id
       WHERE m.id = $1 AND m.school_id = $2`, [sourceId, schoolId]);
    if (!message) throw new Error("Message source introuvable");
    const rows = await tx.all(
      `SELECT user_id FROM school_conversation_participants
       WHERE conversation_id = $1 AND school_id = $2 AND COALESCE(status,'active')='active'`,
      [message.conversation_id, schoolId],
    );
    for (const row of rows) add(row.user_id, "participant", { conversationId: message.conversation_id });
    title = "Nouveau message";
    body = "Vous avez reçu un nouveau message.";
    navigationTarget = { type: "conversation", conversationId: message.conversation_id };
  } else if (eventType === "communication.announcement.published") {
    const announcement = await tx.one(`SELECT id, title FROM announcements WHERE id = $1 AND school_id = $2`, [sourceId, schoolId]);
    if (!announcement) throw new Error("Annonce source introuvable");
    const rows = await tx.all(`SELECT user_id, recipient_kind FROM announcement_recipients WHERE announcement_id = $1 AND school_id = $2`, [sourceId, schoolId]);
    for (const row of rows) addExact(row.user_id, row.recipient_kind, { announcementId: sourceId });
    title = "Nouvelle annonce";
    body = announcement.title ? `Une nouvelle annonce est disponible : ${announcement.title}` : "Une nouvelle annonce est disponible.";
    navigationTarget = { type: "announcement", announcementId: sourceId };
  } else if (eventType === "attendance.student.absent") {
    const attendance = await tx.one(
      `SELECT a.*, trim(concat(st.first_name,' ',st.last_name)) AS student_name
       FROM attendance a JOIN students st ON st.id = a.student_id
       WHERE a.id = $1 AND a.school_id = $2`, [sourceId, schoolId]);
    if (!attendance) throw new Error("Présence source introuvable");
    const parentIds = await tx.listParentUserIdsForStudent(schoolId, attendance.student_id);
    for (const id of parentIds) add(id, "parent", { studentId: attendance.student_id });
    title = "Absence enregistrée";
    body = `${attendance.student_name || "Un élève"} a été signalé(e) absent(e).`;
    navigationTarget = { type: "attendance", studentId: attendance.student_id, attendanceId: sourceId };
    metadata = { attendanceDate: attendance.attendance_date };
  } else if (eventType === "pedagogy.grade.published") {
    const grade = await tx.one(
      `SELECT g.*, st.student_code, trim(concat(st.first_name,' ',st.last_name)) AS student_name
       FROM grades g JOIN students st ON st.id = g.student_id
       WHERE g.id = $1 AND g.school_id = $2`, [sourceId, schoolId]);
    if (!grade) throw new Error("Note source introuvable");
    const parentIds = await tx.listParentUserIdsForStudent(schoolId, grade.student_id);
    for (const id of parentIds) add(id, "parent", { studentId: grade.student_id });
    const studentUser = await tx.one(
      `SELECT id FROM users WHERE school_id = $1 AND user_code = $2 AND COALESCE(status,'active')='active' LIMIT 1`,
      [schoolId, grade.student_code],
    );
    if (studentUser) add(studentUser.id, "student", { studentId: grade.student_id });
    title = "Nouvelle note disponible";
    body = "Une nouvelle note est disponible dans Somafrik.";
    navigationTarget = { type: "grade", studentId: grade.student_id, gradeId: sourceId };
  } else if (eventType === "finance.payment.recorded") {
    const payment = await tx.one(
      `SELECT p.*, trim(concat(st.first_name,' ',st.last_name)) AS student_name
       FROM payments p JOIN students st ON st.id = p.student_id
       WHERE p.id = $1 AND p.school_id = $2`, [sourceId, schoolId]);
    if (!payment) throw new Error("Paiement source introuvable");
    const parentIds = await tx.listParentUserIdsForStudent(schoolId, payment.student_id);
    for (const id of parentIds) add(id, "parent", { studentId: payment.student_id });
    title = "Paiement enregistré";
    body = `Un paiement a été enregistré pour ${payment.student_name || "l'élève"}.`;
    navigationTarget = { type: "payment", studentId: payment.student_id, paymentId: sourceId };
    metadata = { paymentCode: payment.payment_code, paymentDate: payment.payment_date };
  } else {
    throw new Error(`Type d'événement C4 non supporté: ${eventType}`);
  }

  return { title, body, navigationTarget, metadata, recipients: [...recipients.values()] };
}

async function processOneEvent(store) {
  let currentEvent = null;
  try {
    return await store.withTransaction(async (tx) => {
      currentEvent = await tx.one(
        `SELECT * FROM communication_event_outbox
         WHERE status IN ('pending','failed') AND available_at <= NOW()
         ORDER BY occurred_at, id
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!currentEvent) return null;
      await tx.query(
        `UPDATE communication_event_outbox SET status='processing', claimed_at=NOW(), attempts=attempts+1, updated_at=NOW()
         WHERE id=$1`, [currentEvent.id]);
      let notification = await tx.one(`SELECT * FROM communication_notifications WHERE event_key=$1`, [currentEvent.event_key]);
      if (!notification) {
        const spec = await eventSpec(tx, currentEvent);
        if (spec.recipients.length) {
          notification = await tx.one(
            `INSERT INTO communication_notifications (
               school_id,event_id,event_key,event_type,source_entity_type,source_entity_id,
               title,body,sender_type,sender_user_id,sender_name,navigation_target,metadata,status,created_at,published_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system',NULL,$9,$10::jsonb,$11::jsonb,'published',NOW(),NOW())
             ON CONFLICT (event_key) DO UPDATE SET event_key=EXCLUDED.event_key
             RETURNING *`,
            [currentEvent.school_id,currentEvent.id,currentEvent.event_key,currentEvent.event_type,currentEvent.source_entity_type,currentEvent.source_entity_id,
             spec.title,spec.body,SYSTEM_SENDER_NAME,JSON.stringify(spec.navigationTarget),JSON.stringify(spec.metadata)],
          );
          for (const recipient of spec.recipients) {
            await tx.query(
              `INSERT INTO notification_recipients (notification_id,school_id,user_id,recipient_kind,recipient_context,created_at)
               VALUES ($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT (notification_id,user_id) DO NOTHING`,
              [notification.id,currentEvent.school_id,recipient.userId,recipient.kind,JSON.stringify(recipient.context ?? {})],
            );
          }
        }
      }
      await tx.query(
        `UPDATE communication_event_outbox SET status='processed', processed_at=NOW(), last_error=NULL, updated_at=NOW() WHERE id=$1`,
        [currentEvent.id],
      );
      return notification;
    });
  } catch (error) {
    if (currentEvent?.id) {
      await store.withTransaction(async (tx) => {
        await tx.query(
          `UPDATE communication_event_outbox
           SET status='failed', last_error=$2, available_at=NOW() + INTERVAL '5 seconds', updated_at=NOW()
           WHERE id=$1`,
          [currentEvent.id, String(error?.message || error).slice(0, 500)],
        );
      });
    }
    throw error;
  }
}

async function drainOutbox(store, { limit = 50 } = {}) {
  const processed = [];
  for (let i = 0; i < Math.max(1, Math.min(500, Number(limit) || 50)); i += 1) {
    const row = await processOneEvent(store);
    if (row === null) break;
    processed.push(row);
  }
  return processed;
}

module.exports = {
  SYSTEM_SENDER_NAME,
  list,
  get,
  unreadCount,
  markRead,
  archive,
  createManual,
  uploadAttachment,
  downloadAttachment,
  drainOutbox,
  processOneEvent,
  mapNotification,
};
