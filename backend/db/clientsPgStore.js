"use strict";

const clientsService = require("../lib/clientsService");
const userRoleLifecycleService = require("../lib/userRoleLifecycleService");
const {
  asTrimmed,
  parsePayload,
  mapUserRow,
  mapContactRow,
  mapRelationRow,
  mapMessageRow,
  mapAnnouncementRow,
} = require("../lib/clientsManagement");
const { uuidOrNull } = require("../lib/principalIdentity");

const USER_SCHOOL_SELECT = `s.school_code, s.login_code AS school_login_code, s.name AS school_name`;

function userSchoolReturningSql(schoolIdSql) {
  return `(SELECT school_code FROM schools WHERE id = ${schoolIdSql}) AS school_code,
          (SELECT login_code FROM schools WHERE id = ${schoolIdSql}) AS school_login_code,
          (SELECT name FROM schools WHERE id = ${schoolIdSql}) AS school_name`;
}

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
        const normalized = asTrimmed(code).toUpperCase();
        if (!normalized) return null;
        return one(
          `SELECT s.*, c.iso_code AS country_code, c.name AS country_name
           FROM schools s
           JOIN countries c ON c.id = s.country_id
           WHERE s.school_code = $1
              OR UPPER(COALESCE(s.login_code, '')) = $1
           LIMIT 1`,
          [normalized],
        );
      },
      async getCountryByCode(code) {
        const normalized = asTrimmed(code).toUpperCase();
        if (!normalized) return null;
        return one("SELECT * FROM countries WHERE iso_code = $1", [normalized]);
      },
      async getUserById(id) {
        return one(
          `SELECT u.*, ${USER_SCHOOL_SELECT}, c.iso_code AS country_code, c.name AS country_name
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
           RETURNING *, ${userSchoolReturningSql("$1")},
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
            row.role || null,
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
           RETURNING *, ${userSchoolReturningSql("users.school_id")},
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
            row.role || null,
            row.status,
            JSON.stringify(mergedProfile),
          ],
        );
      },
      async updateUserSchoolId(id, schoolId) {
        return one(
          `UPDATE users
           SET school_id = $2,
               profile_payload = COALESCE(profile_payload, '{}'::jsonb)
                 - 'countryCode' - 'countryScope' - 'schoolCode' - 'schoolId' - 'country',
               updated_at = NOW()
           WHERE id = $1
           RETURNING *, ${userSchoolReturningSql("$2")},
             (SELECT c.iso_code FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = $2) AS country_code,
             (SELECT c.name FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = $2) AS country_name`,
          [id, schoolId],
        );
      },
      async reassignActiveUserRolesSchool(userId, _fromSchoolId, toSchoolId) {
        await query(
          `UPDATE user_roles
           SET school_id = $2, updated_at = NOW()
           WHERE user_id = $1
             AND status = 'active'
             AND revoked_at IS NULL`,
          [userId, toSchoolId],
        );
      },
      async revokeUserSessions(userId, reason) {
        const result = await query(
          `UPDATE sessions
           SET revoked_at = NOW(), revoke_reason = $2
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId, reason],
        );
        return result?.rowCount ?? 0;
      },
      async lockUserById(id) {
        return one(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [id]);
      },
      async listActiveUserRoleKeys(userId) {
        const rows = await all(
          `SELECT role_key
           FROM user_roles
           WHERE user_id = $1 AND status = 'active' AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [userId],
        );
        return rows.map((row) => row.role_key);
      },
      async listActiveUserRoleKeysForSchool(userId, schoolId) {
        const uid = String(userId ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!uid || !sid) return [];
        const rows = await all(
          `SELECT role_key
           FROM user_roles
           WHERE user_id::text = $1
             AND school_id::text = $2
             AND status = 'active'
             AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [uid, sid],
        );
        return rows.map((row) => row.role_key);
      },
      async listActiveUserRolesByUserIds(userIds = []) {
        if (!userIds.length) return [];
        return all(
          `SELECT user_id, role_key
           FROM user_roles
           WHERE user_id = ANY($1::uuid[]) AND status = 'active' AND revoked_at IS NULL`,
          [userIds],
        );
      },
      async listUserCodes() {
        const rows = await all(`SELECT user_code FROM users`);
        return rows.map((row) => row.user_code);
      },
      async allocateUserCode(year) {
        await query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`user-code:${year}`]);
        const current = await one(
          `SELECT GREATEST(
             COALESCE((SELECT last_value FROM user_code_counters WHERE year = $1), 0),
             COALESCE((
               SELECT MAX(CAST(substring(user_code from 'USR-' || $1::text || '-(.*)$') AS INTEGER))
               FROM users
               WHERE user_code ~ ('^USR-' || $1::text || '-[0-9]+$')
             ), 0)
           ) AS current`,
          [year],
        );
        const nextValue = Number(current?.current ?? 0) + 1;
        await query(
          `INSERT INTO user_code_counters (year, last_value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (year) DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = NOW()`,
          [year, nextValue],
        );
        const { formatUserCode } = require("../lib/userRoleLifecycle");
        return formatUserCode(year, nextValue);
      },
      async insertUserRole(row) {
        return one(
          `INSERT INTO user_roles (user_id, school_id, role_key, granted_by, granted_at, status)
           VALUES ($1, $2, $3, $4, NOW(), 'active')
           RETURNING *`,
          [row.userId, row.schoolId || null, row.roleKey, uuidOrNull(row.grantedBy)],
        );
      },
      async revokeUserRole(row) {
        return one(
          `UPDATE user_roles
           SET status = 'revoked', revoked_at = NOW(), revoked_by = $4, updated_at = NOW()
           WHERE user_id = $1
             AND role_key = $2
             AND status = 'active'
             AND revoked_at IS NULL
             AND (
               ($3::uuid IS NULL AND school_id IS NULL)
               OR school_id IS NOT DISTINCT FROM $3::uuid
             )
           RETURNING *`,
          [row.userId, row.roleKey, row.schoolId || null, uuidOrNull(row.revokedBy)],
        );
      },
      async syncUserPrimaryRole(userId, roleKey) {
        return one(
          `UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1 RETURNING id, role`,
          [userId, roleKey || null],
        );
      },
      async getTeacherBySchoolUser(schoolId, userId) {
        return one(
          `SELECT * FROM teachers WHERE school_id = $1 AND user_id = $2 LIMIT 1`,
          [schoolId, userId],
        );
      },
      async findAmbiguousTeacherIdentity(schoolId, identity) {
        const { isExactTeacherCivilIdentity } = require("../lib/teachersManagement");
        const { formatIsoDate } = require("./teachersRepository");
        const rows = await all(
          `SELECT t.id, t.user_id, u.first_name, u.last_name, u.birth_date, u.gender
           FROM teachers t
           JOIN users u ON u.id = t.user_id
           WHERE t.school_id = $1
             AND t.user_id IS NOT NULL
             AND t.user_id <> $2
             AND COALESCE(t.status, 'active') NOT IN ('deleted')`,
          [schoolId, identity.excludeUserId],
        );
        return rows.find((row) =>
          isExactTeacherCivilIdentity(identity, {
            firstName: row.first_name,
            lastName: row.last_name,
            birthDate: formatIsoDate(row.birth_date),
            gender: row.gender,
          }),
        ) ?? null;
      },
      async insertTeacherForUser(row) {
        const {
          allocateTeacherCodesLocked,
          acquireTeacherSchoolCreationLock,
        } = require("../lib/teacherCodeAllocation");
        const { isTeachersSchoolUserUniquenessViolation } = require("../lib/teachersUniqueness");
        await acquireTeacherSchoolCreationLock({ query }, row.schoolId);
        const existing = await this.getTeacherBySchoolUser(row.schoolId, row.userId);
        if (existing) return existing;
        const codes = await allocateTeacherCodesLocked(
          { query, all },
          row.schoolId,
          row.schoolCode,
          { alreadyLocked: true },
        );
        try {
          return await one(
            `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, hire_date, status)
             VALUES ($1, $2, $3, $4, $5, 'active')
             RETURNING *`,
            [row.schoolId, row.userId, codes.teacherCode, row.speciality, row.hireDate],
          );
        } catch (error) {
          if (isTeachersSchoolUserUniquenessViolation(error)) {
            const reused = await this.getTeacherBySchoolUser(row.schoolId, row.userId);
            if (reused) return reused;
          }
          throw error;
        }
      },
      async countActiveTeacherAssignments(teacherId) {
        const row = await one(
          `SELECT COUNT(*)::int AS count
           FROM teacher_assignments
           WHERE teacher_id = $1 AND COALESCE(status, 'active') = 'active'`,
          [teacherId],
        );
        return Number(row?.count ?? 0);
      },
      async deactivateTeacherProfile(teacherId) {
        return one(
          `UPDATE teachers SET status = 'inactive', updated_at = NOW() WHERE id = $1 RETURNING *`,
          [teacherId],
        );
      },
      async reactivateTeacherProfile(teacherId) {
        return one(
          `UPDATE teachers SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *`,
          [teacherId],
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
      async getActiveContactByUserId(schoolId, userId) {
        return one(
          `SELECT c.*, s.school_code, s.name AS school_name
           FROM contacts c
           JOIN schools s ON s.id = c.school_id
           WHERE c.school_id = $1 AND c.user_id = $2 AND c.status = 'active'
           ORDER BY c.updated_at DESC
           LIMIT 1`,
          [schoolId, userId],
        );
      },
      async findActiveContactByEmail(schoolId, email) {
        const key = asTrimmed(email).toLowerCase();
        if (!key) return null;
        return one(
          `SELECT c.*, s.school_code, s.name AS school_name
           FROM contacts c
           JOIN schools s ON s.id = c.school_id
           WHERE c.school_id = $1 AND c.status = 'active'
             AND c.email IS NOT NULL AND lower(trim(c.email)) = $2
           ORDER BY c.updated_at DESC
           LIMIT 1`,
          [schoolId, key],
        );
      },
      async findActiveContactByPhone(schoolId, phone) {
        const key = asTrimmed(phone).toLowerCase();
        if (!key) return null;
        return one(
          `SELECT c.*, s.school_code, s.name AS school_name
           FROM contacts c
           JOIN schools s ON s.id = c.school_id
           WHERE c.school_id = $1 AND c.status = 'active'
             AND c.phone IS NOT NULL AND lower(trim(c.phone)) = $2
           ORDER BY c.updated_at DESC
           LIMIT 1`,
          [schoolId, key],
        );
      },
      async advisoryXactLock(key) {
        await query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [String(key)]);
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
      async getRelationById(id) {
        return one(
          `SELECT r.*, s.school_code,
             trim(concat(c.first_name, ' ', c.last_name)) AS contact_name,
             trim(concat(st.first_name, ' ', st.last_name)) AS student_name
           FROM contact_relations r
           JOIN schools s ON s.id = r.school_id
           JOIN contacts c ON c.id = r.contact_id
           JOIN students st ON st.id = r.student_id
           WHERE r.id::text = $1`,
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
           WHERE r.contact_id = $1 AND r.student_id = $2
           ORDER BY CASE WHEN r.status = 'active' THEN 0 ELSE 1 END, r.updated_at DESC
           LIMIT 1`,
          [contactId, studentId],
        );
      },
      async getActiveRelationByContactAndStudent(contactId, studentId) {
        return one(
          `SELECT r.*, s.school_code,
             trim(concat(c.first_name, ' ', c.last_name)) AS contact_name,
             trim(concat(st.first_name, ' ', st.last_name)) AS student_name
           FROM contact_relations r
           JOIN schools s ON s.id = r.school_id
           JOIN contacts c ON c.id = r.contact_id
           JOIN students st ON st.id = r.student_id
           WHERE r.contact_id = $1 AND r.student_id = $2 AND r.status = 'active'
           LIMIT 1`,
          [contactId, studentId],
        );
      },
      async insertRelation(row) {
        const saved = await one(
          `INSERT INTO contact_relations (
             school_id, country_id, relation_type, contact_id, student_id, status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,'parent_student',$3,$4,'active',$5::jsonb,NOW(),NOW())
           ON CONFLICT (school_id, contact_id, student_id) WHERE status = 'active'
           DO NOTHING
           RETURNING *`,
          [
            row.schoolId,
            row.countryId,
            row.contactId,
            row.studentId,
            JSON.stringify(row.profile ?? {}),
          ],
        );
        if (saved) return this.getRelationById(saved.id);
        return this.getActiveRelationByContactAndStudent(row.contactId, row.studentId);
      },
      async archiveRelation(id) {
        return one(
          `UPDATE contact_relations
           SET status = 'archived', updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id],
        ).then(async (saved) => (saved ? this.getRelationById(saved.id) : null));
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
            uuidOrNull(entry.userId),
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
    getCountryByCode: (code) => bind({}).getCountryByCode(code),
    getUserById: (id) => bind({}).getUserById(id),
    withTransaction(fn) {
      return repo.withTransaction((tx) => fn(bind(tx)));
    },
    async listProjection() {
      const users = await repo.all(
        `SELECT u.*, ${USER_SCHOOL_SELECT}, c.iso_code AS country_code, c.name AS country_name
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN countries c ON c.id = s.country_id
         ORDER BY u.created_at`,
      );
      const roleRows = users.length
        ? await repo.all(
            `SELECT user_id, role_key FROM user_roles
             WHERE status = 'active' AND revoked_at IS NULL AND user_id = ANY($1::uuid[])`,
            [users.map((row) => row.id)],
          )
        : [];
      const rolesByUser = new Map();
      for (const row of roleRows) {
        const list = rolesByUser.get(String(row.user_id)) ?? [];
        list.push(row.role_key);
        rolesByUser.set(String(row.user_id), list);
      }
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
        users: users.map((row) =>
          userRoleLifecycleService.hydrateUser(row, rolesByUser.get(String(row.id)) ?? []),
        ),
        contacts: contacts.map(mapContactRow),
        relations: relations.map(mapRelationRow),
        messages: messages.map(mapMessageRow),
        announcements: announcements.map(mapAnnouncementRow),
      };
    },
    createUser: (...args) => clientsService.createUser(store, ...args),
    provisionUser: (...args) => clientsService.provisionUser(store, ...args),
    updateUser: (...args) => clientsService.updateUser(store, ...args),
    reassignUserSchool: (...args) => clientsService.reassignUserSchool(store, ...args),
    grantUserRole: (...args) => userRoleLifecycleService.grantRole(store, ...args),
    revokeUserRole: (...args) => userRoleLifecycleService.revokeRole(store, ...args),
    listAssignableUserRoles: (...args) =>
      userRoleLifecycleService.listAssignableRolesForPrincipal(store, ...args),
    createContact: (...args) => clientsService.createContact(store, ...args),
    updateContact: (...args) => clientsService.updateContact(store, ...args),
    provisionContactAccount: (...args) => clientsService.provisionContactAccount(store, ...args),
    createRelation: (...args) => clientsService.createRelation(store, ...args),
    linkParent: (...args) => {
      const { linkParent } = require("../lib/parentLinking");
      return linkParent(store, ...args);
    },
    lookupParentIdentity: (...args) => {
      const { lookupParentIdentity } = require("../lib/parentLinking");
      return lookupParentIdentity(store, ...args);
    },
    archiveParentRelation: (...args) => {
      const { archiveParentRelation } = require("../lib/parentLinking");
      return archiveParentRelation(store, ...args);
    },
    sendMessage: (...args) => clientsService.sendMessage(store, ...args),
    markMessageRead: (...args) => clientsService.markMessageRead(store, ...args),
    createAnnouncement: (...args) => clientsService.createAnnouncement(store, ...args),
    updateAnnouncement: (...args) => clientsService.updateAnnouncement(store, ...args),
    archiveAnnouncement: (...args) => clientsService.archiveAnnouncement(store, ...args),
    ensureStudentRecord() {
      return null;
    },
    assertEstablishmentRoleAssignable: (role, principal) =>
      typeof repo.assertEstablishmentRoleAssignable === "function"
        ? repo.assertEstablishmentRoleAssignable(role, principal)
        : Promise.resolve(role),
    listEstablishmentAssignableRoles: (principal) =>
      typeof repo.listEstablishmentRoles === "function"
        ? repo.listEstablishmentRoles({ schoolAssignableOnly: true, principal })
        : Promise.resolve([]),
  };

  return store;
}

module.exports = {
  createClientsPgStore,
};
