"use strict";

const clientsService = require("../lib/clientsService");
const {
  asTrimmed,
  parsePayload,
  mapUserRow,
  mapContactRow,
  mapRelationRow,
  mapMessageRow,
  mapAnnouncementRow,
} = require("../lib/clientsManagement");

function createClientsPgStore(repo) {
  function bind(client) {
    const one = (sql, params) => (client.one ? client.one(sql, params) : repo.one(sql, params));
    const all = (sql, params) => (client.all ? client.all(sql, params) : repo.all(sql, params));
    const query = (sql, params) => (client.query ? client.query(sql, params) : repo.query(sql, params));

    return {
      one,
      all,
      query,
      async getSchoolByCode(code) {
        return one(
          `SELECT s.*, c.iso_code AS country_code, c.name AS country_name
           FROM schools s
           JOIN countries c ON c.id = s.country_id
           WHERE s.school_code = $1`,
          [asTrimmed(code).toUpperCase()],
        );
      },
      async getUserById(id) {
        return one(
          `SELECT u.*, s.school_code, c.iso_code AS country_code, c.name AS country_name
           FROM users u
           LEFT JOIN schools s ON s.id = u.school_id
           LEFT JOIN countries c ON c.id = s.country_id
           WHERE u.id::text = $1 OR u.user_code = $1`,
          [id],
        );
      },
      async insertUser(row) {
        return one(
          `INSERT INTO users (
             school_id, user_code, first_name, last_name, email, phone, gender, birth_date,
             password_hash, pin_hash, must_change_password, role, status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,TRUE,$10,$11,$12::jsonb,NOW(),NOW())
           RETURNING *, (SELECT school_code FROM schools WHERE id = $1) AS school_code,
             (SELECT c.iso_code FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = $1) AS country_code,
             (SELECT c.name FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = $1) AS country_name`,
          [
            row.schoolId,
            row.userCode,
            row.firstName,
            row.lastName,
            row.email || null,
            row.phone || null,
            row.gender || null,
            row.birthDate || null,
            row.passwordHash,
            row.role,
            row.status,
            JSON.stringify(row.profile ?? {}),
          ],
        );
      },
      async updateUser(id, row) {
        const existing = await this.getUserById(id);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE users
           SET first_name = $2, last_name = $3, email = $4, phone = $5, gender = $6, birth_date = $7,
               role = $8, status = $9, profile_payload = $10::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT school_code FROM schools WHERE id = users.school_id) AS school_code,
             (SELECT c.iso_code FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = users.school_id) AS country_code,
             (SELECT c.name FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = users.school_id) AS country_name`,
          [
            id,
            row.firstName,
            row.lastName,
            row.email || null,
            row.phone || null,
            row.gender || null,
            row.birthDate || null,
            row.role,
            row.status,
            JSON.stringify(mergedProfile),
          ],
        );
      },
      async getContactById(id) {
        return one(
          `SELECT c.*, s.school_code, s.name AS school_name
           FROM contacts c
           JOIN schools s ON s.id = c.school_id
           WHERE c.id::text = $1`,
          [id],
        );
      },
      async getContactByIdForUpdate(id) {
        return one(
          `SELECT c.*, s.school_code, s.name AS school_name
           FROM contacts c
           JOIN schools s ON s.id = c.school_id
           WHERE c.id::text = $1
           FOR UPDATE OF c`,
          [id],
        );
      },
      async insertContact(row) {
        return one(
          `INSERT INTO contacts (
             school_id, country_id, first_name, last_name, contact_type, phone, email, gender,
             birth_date, address, status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW(),NOW())
           RETURNING *`,
          [
            row.schoolId,
            row.countryId,
            row.firstName,
            row.lastName,
            row.contactType,
            row.phone || null,
            row.email || null,
            row.gender || null,
            row.birthDate || null,
            row.address || null,
            row.status,
            JSON.stringify(row.profile ?? {}),
          ],
        );
      },
      async updateContact(id, row) {
        const existing = await this.getContactById(id);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE contacts
           SET first_name = $2, last_name = $3, contact_type = $4, phone = $5, email = $6,
               gender = $7, birth_date = $8, address = $9, status = $10, profile_payload = $11::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT school_code FROM schools WHERE id = contacts.school_id) AS school_code,
             (SELECT name FROM schools WHERE id = contacts.school_id) AS school_name`,
          [
            id,
            row.firstName,
            row.lastName,
            row.contactType,
            row.phone || null,
            row.email || null,
            row.gender || null,
            row.birthDate || null,
            row.address || null,
            row.status,
            JSON.stringify(mergedProfile),
          ],
        );
      },
      async linkContactUser(contactId, userId, profile) {
        return one(
          `UPDATE contacts
           SET user_id = $2, profile_payload = $3::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT school_code FROM schools WHERE id = contacts.school_id) AS school_code,
             (SELECT name FROM schools WHERE id = contacts.school_id) AS school_name`,
          [contactId, userId, JSON.stringify(profile ?? {})],
        );
      },
      async getStudentById(id) {
        return one(
          `SELECT st.*, s.school_code
           FROM students st
           JOIN schools s ON s.id = st.school_id
           WHERE st.id::text = $1 OR st.student_code = $1`,
          [id],
        );
      },
      async getRelationByContactAndStudent(contactId, studentId) {
        return one(
          `SELECT r.*, s.school_code,
             trim(concat(c.first_name, ' ', c.last_name)) AS contact_name,
             trim(concat(st.first_name, ' ', st.last_name)) AS student_name
           FROM contact_relations r
           JOIN schools s ON s.id = r.school_id
           JOIN contacts c ON c.id = r.contact_id
           JOIN students st ON st.id = r.student_id
           WHERE r.contact_id = $1 AND r.student_id = $2`,
          [contactId, studentId],
        );
      },
      async insertRelation(row) {
        return one(
          `INSERT INTO contact_relations (
             school_id, country_id, relation_type, contact_id, student_id, status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,'parent_student',$3,$4,'active',$5::jsonb,NOW(),NOW())
           ON CONFLICT (school_id, contact_id, student_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`,
          [
            row.schoolId,
            row.countryId,
            row.contactId,
            row.studentId,
            JSON.stringify(row.profile ?? {}),
          ],
        ).then(async (saved) => this.getRelationByContactAndStudent(saved.contact_id, saved.student_id));
      },
      async insertConversation(row) {
        return one(
          `INSERT INTO school_conversations (
             school_id, country_id, subject, created_by_user_id, status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,'active',$5::jsonb,NOW(),NOW())
           RETURNING *`,
          [row.schoolId, row.countryId, row.subject || null, row.createdByUserId, JSON.stringify(row.profile ?? {})],
        );
      },
      async insertParticipant(row) {
        return one(
          `INSERT INTO school_conversation_participants (conversation_id, user_id, school_id, participant_role, joined_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (conversation_id, user_id) DO NOTHING
           RETURNING *`,
          [row.conversationId, row.userId, row.schoolId, row.role || null],
        );
      },
      async insertMessage(row) {
        return one(
          `INSERT INTO school_messages (
             conversation_id, school_id, country_id, sender_user_id, body, direction, theme, priority,
             status, attachment_url, profile_payload, sent_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',$9,$10::jsonb,NOW(),NOW(),NOW())
           RETURNING *`,
          [
            row.conversationId,
            row.schoolId,
            row.countryId,
            row.senderUserId,
            row.body,
            row.direction || null,
            row.theme || null,
            row.priority || null,
            row.attachmentUrl || null,
            JSON.stringify(row.profile ?? {}),
          ],
        );
      },
      async getMessageById(id) {
        return one(
          `SELECT m.*, s.school_code, u.phone AS sender_phone
           FROM school_messages m
           JOIN schools s ON s.id = m.school_id
           JOIN users u ON u.id = m.sender_user_id
           WHERE m.id::text = $1`,
          [id],
        );
      },
      async isConversationParticipant(conversationId, userId) {
        const row = await one(
          `SELECT 1 FROM school_conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, userId],
        );
        return Boolean(row);
      },
      async insertMessageRead(messageId, userId) {
        return one(
          `INSERT INTO school_message_reads (message_id, user_id, read_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = NOW()
           RETURNING *`,
          [messageId, userId],
        );
      },
      async updateMessageStatus(messageId, status) {
        return one(
          `UPDATE school_messages SET status = $2, updated_at = NOW() WHERE id = $1
           RETURNING *, (SELECT school_code FROM schools WHERE id = school_messages.school_id) AS school_code`,
          [messageId, status],
        );
      },
      async getAnnouncementById(id) {
        return one(
          `SELECT a.*, s.school_code, u.first_name || ' ' || u.last_name AS author_name
           FROM announcements a
           JOIN schools s ON s.id = a.school_id
           LEFT JOIN users u ON u.id = a.created_by
           WHERE a.id::text = $1`,
          [id],
        );
      },
      async insertAnnouncement(row) {
        return one(
          `INSERT INTO announcements (
             school_id, country_id, title, message, target_role, target_class_id, created_by,
             published_at, status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9::jsonb,NOW(),NOW())
           RETURNING *`,
          [
            row.schoolId,
            row.countryId,
            row.title,
            row.message,
            row.targetRole || null,
            row.targetClassId || null,
            row.createdByUserId || null,
            row.status,
            JSON.stringify(row.profile ?? {}),
          ],
        );
      },
      async updateAnnouncement(id, row) {
        const existing = await this.getAnnouncementById(id);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE announcements
           SET title = $2, message = $3, target_role = $4, target_class_id = $5, status = $6,
               profile_payload = $7::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT school_code FROM schools WHERE id = announcements.school_id) AS school_code`,
          [
            id,
            row.title,
            row.message,
            row.targetRole || null,
            row.targetClassId || null,
            row.status,
            JSON.stringify(mergedProfile),
          ],
        );
      },
      async recordClientsAudit(entry) {
        const school = entry.schoolCode
          ? await one("SELECT id FROM schools WHERE school_code = $1", [asTrimmed(entry.schoolCode).toUpperCase()])
          : null;
        await query(
          `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,NOW())`,
          [
            school?.id ?? null,
            entry.userId || null,
            entry.action,
            entry.entityType,
            entry.entityId,
            entry.oldValue ? JSON.stringify(entry.oldValue) : null,
            entry.newValue ? JSON.stringify(entry.newValue) : null,
            entry.ipAddress || null,
            entry.userAgent || null,
          ],
        );
      },
    };
  }

  const store = {
    bind,
    getSchoolByCode: (code) => bind({}).getSchoolByCode(code),
    getUserById: (id) => bind({}).getUserById(id),
    withTransaction(fn) {
      return repo.withTransaction((tx) => fn(bind(tx)));
    },
    async listProjection() {
      const users = await repo.all(
        `SELECT u.*, s.school_code, c.iso_code AS country_code, c.name AS country_name
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN countries c ON c.id = s.country_id
         ORDER BY u.created_at`,
      );
      const contacts = await repo.all(
        `SELECT c.*, s.school_code, s.name AS school_name
         FROM contacts c
         JOIN schools s ON s.id = c.school_id
         ORDER BY c.created_at DESC`,
      );
      const relations = await repo.all(
        `SELECT r.*, s.school_code,
           trim(concat(ct.first_name, ' ', ct.last_name)) AS contact_name,
           trim(concat(st.first_name, ' ', st.last_name)) AS student_name
         FROM contact_relations r
         JOIN schools s ON s.id = r.school_id
         JOIN contacts ct ON ct.id = r.contact_id
         JOIN students st ON st.id = r.student_id
         ORDER BY r.created_at DESC`,
      );
      const messages = await repo.all(
        `SELECT m.*, s.school_code, u.phone AS sender_phone,
           (SELECT read_at FROM school_message_reads mr WHERE mr.message_id = m.id ORDER BY read_at DESC LIMIT 1) AS read_at
         FROM school_messages m
         JOIN schools s ON s.id = m.school_id
         JOIN users u ON u.id = m.sender_user_id
         ORDER BY m.sent_at DESC`,
      );
      const announcements = await repo.all(
        `SELECT a.*, s.school_code, u.first_name || ' ' || u.last_name AS author_name
         FROM announcements a
         JOIN schools s ON s.id = a.school_id
         LEFT JOIN users u ON u.id = a.created_by
         ORDER BY a.created_at DESC`,
      );
      return {
        users: users.map(mapUserRow),
        contacts: contacts.map(mapContactRow),
        relations: relations.map(mapRelationRow),
        messages: messages.map(mapMessageRow),
        announcements: announcements.map(mapAnnouncementRow),
      };
    },
    createUser: (...args) => clientsService.createUser(store, ...args),
    updateUser: (...args) => clientsService.updateUser(store, ...args),
    createContact: (...args) => clientsService.createContact(store, ...args),
    updateContact: (...args) => clientsService.updateContact(store, ...args),
    provisionContactAccount: (...args) => clientsService.provisionContactAccount(store, ...args),
    createRelation: (...args) => clientsService.createRelation(store, ...args),
    sendMessage: (...args) => clientsService.sendMessage(store, ...args),
    markMessageRead: (...args) => clientsService.markMessageRead(store, ...args),
    createAnnouncement: (...args) => clientsService.createAnnouncement(store, ...args),
    updateAnnouncement: (...args) => clientsService.updateAnnouncement(store, ...args),
    archiveAnnouncement: (...args) => clientsService.archiveAnnouncement(store, ...args),
  };

  return store;
}

module.exports = {
  createClientsPgStore,
};
