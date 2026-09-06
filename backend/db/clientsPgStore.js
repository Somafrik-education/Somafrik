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
const { sqlUsersScope } = require("../lib/usersSchoolScope");

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
      async getSchoolById(id) {
        const schoolId = asTrimmed(id);
        if (!schoolId) return null;
        return one(
          `SELECT s.*, c.iso_code AS country_code, c.name AS country_name
           FROM schools s
           JOIN countries c ON c.id = s.country_id
           WHERE s.id::text = $1
           LIMIT 1`,
          [schoolId],
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
      async listSchoolUsers(schoolId) {
        return all(
          `SELECT u.*, ${USER_SCHOOL_SELECT}, c.iso_code AS country_code, c.name AS country_name
           FROM users u
           LEFT JOIN schools s ON s.id = u.school_id
           LEFT JOIN countries c ON c.id = s.country_id
           WHERE u.school_id = $1 AND COALESCE(u.status, 'active') = 'active'`,
          [schoolId],
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
        const { assertCanonicalStudentRolesLocked } = require("../lib/studentRoleLock");
        await assertCanonicalStudentRolesLocked(this, userId, { operation: "reassign" });
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
        const { assertCanonicalStudentRolesLocked } = require("../lib/studentRoleLock");
        await assertCanonicalStudentRolesLocked(this, row.userId, {
          operation: "grant",
          roleKey: row.roleKey,
        });
        return one(
          `INSERT INTO user_roles (user_id, school_id, role_key, granted_by, granted_at, status)
           VALUES ($1, $2, $3, $4, NOW(), 'active')
           RETURNING *`,
          [row.userId, row.schoolId || null, row.roleKey, uuidOrNull(row.grantedBy)],
        );
      },
      async revokeUserRole(row) {
        const { assertCanonicalStudentRolesLocked } = require("../lib/studentRoleLock");
        await assertCanonicalStudentRolesLocked(this, row.userId, {
          operation: "revoke",
          roleKey: row.roleKey,
        });
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
      async getCanonicalLinkedStudentByUserId(userId) {
        const { SELECT_CANONICAL_LINKED_STUDENT_SQL } = require("../lib/studentRoleLock");
        return one(SELECT_CANONICAL_LINKED_STUDENT_SQL, [userId]);
      },
      async getActiveStudentProfileByUser(userId, schoolId) {
        const {
          SELECT_ACTIVE_STUDENT_FOR_USER_SQL,
        } = require("../lib/businessProfileIntegrity");
        return one(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, [userId, schoolId]);
      },
      async getActiveTeacherProfileByUser(userId, schoolId) {
        const {
          SELECT_ACTIVE_TEACHER_FOR_USER_SQL,
        } = require("../lib/businessProfileIntegrity");
        return one(SELECT_ACTIVE_TEACHER_FOR_USER_SQL, [userId, schoolId]);
      },
      async listActiveStudentProfilesByUserIds(userIds = []) {
        if (!userIds.length) return [];
        const {
          SELECT_STUDENT_PROFILES_FOR_USERS_SQL,
        } = require("../lib/businessProfileIntegrity");
        return all(SELECT_STUDENT_PROFILES_FOR_USERS_SQL, [userIds]);
      },
      async listActiveTeacherProfilesByUserIds(userIds = []) {
        if (!userIds.length) return [];
        const {
          SELECT_TEACHER_PROFILES_FOR_USERS_SQL,
        } = require("../lib/businessProfileIntegrity");
        return all(SELECT_TEACHER_PROFILES_FOR_USERS_SQL, [userIds]);
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
          `INSERT INTO school_conversation_participants (conversation_id, user_id, school_id, participant_role, status, joined_at)
           VALUES ($1,$2,$3,$4,'active',NOW())
           ON CONFLICT (conversation_id, user_id) DO UPDATE
             SET status = 'active', left_at = NULL,
                 participant_role = COALESCE(EXCLUDED.participant_role, school_conversation_participants.participant_role)
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
          `SELECT m.*, s.school_code, u.phone AS sender_phone,
             trim(concat(u.first_name, ' ', u.last_name)) AS sender_name,
             u.role AS sender_role_label
           FROM school_messages m
           JOIN schools s ON s.id = m.school_id
           JOIN users u ON u.id = m.sender_user_id
           WHERE m.id::text = $1`,
          [id],
        );
      },
      async getConversationById(id) {
        return one(
          `SELECT c.*, s.school_code
           FROM school_conversations c
           JOIN schools s ON s.id = c.school_id
           WHERE c.id::text = $1`,
          [id],
        );
      },
      async touchConversation(id) {
        return one(
          `UPDATE school_conversations SET updated_at = NOW() WHERE id = $1 RETURNING *`,
          [id],
        );
      },
      async isConversationParticipant(conversationId, userId, options = {}) {
        const activeOnly = options.activeOnly !== false;
        const row = await one(
          activeOnly
            ? `SELECT 1 FROM school_conversation_participants
               WHERE conversation_id = $1 AND user_id = $2 AND COALESCE(status, 'active') = 'active'`
            : `SELECT 1 FROM school_conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
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
      async getMessageRead(messageId, userId) {
        return one(
          `SELECT * FROM school_message_reads WHERE message_id = $1 AND user_id = $2`,
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
      async listActiveRoleKeys(userId) {
        const rows = await all(
          `SELECT role_key FROM user_roles
           WHERE user_id = $1 AND status = 'active' AND revoked_at IS NULL`,
          [userId],
        );
        return rows.map((row) => row.role_key);
      },
      async listParentLinkedStudentIds(userId, schoolId) {
        const rows = await all(
          `SELECT st.id
           FROM contacts c
           JOIN contact_relations r ON r.contact_id = c.id AND r.status = 'active'
           JOIN students st ON st.id = r.student_id
           WHERE c.user_id = $1 AND c.school_id = $2 AND c.status = 'active'`,
          [userId, schoolId],
        );
        return rows.map((row) => row.id);
      },
      async resolveSchoolStudent(schoolId, ref) {
        return one(
          `SELECT * FROM students WHERE school_id = $1 AND (id::text = $2 OR student_code = $2) LIMIT 1`,
          [schoolId, asTrimmed(ref)],
        );
      },
      async listTeacherActiveClassIds(userId, schoolId) {
        const rows = await all(
          `SELECT DISTINCT ta.class_id
           FROM teachers t
           JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.status = 'active'
           WHERE t.user_id = $1 AND t.school_id = $2 AND ta.school_id = $2`,
          [userId, schoolId],
        );
        return rows.map((row) => row.class_id);
      },
      async teacherAssignedToStudents(teacherUserId, schoolId, studentIds) {
        if (!studentIds?.length) return false;
        const row = await one(
          `SELECT 1
           FROM teachers t
           JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.status = 'active'
           JOIN enrollments e ON e.class_id = ta.class_id AND e.status = 'active' AND e.student_id = ANY($3::uuid[])
           WHERE t.user_id = $1 AND t.school_id = $2
           LIMIT 1`,
          [teacherUserId, schoolId, studentIds],
        );
        return Boolean(row);
      },
      async parentLinkedToTeacherClasses(parentUserId, schoolId, classIds, studentRef) {
        if (!classIds?.length) return false;
        const params = [parentUserId, schoolId, classIds];
        let studentSql = "";
        if (asTrimmed(studentRef)) {
          params.push(asTrimmed(studentRef));
          studentSql = `AND (st.id::text = $4 OR st.student_code = $4)`;
        }
        const row = await one(
          `SELECT 1
           FROM contacts c
           JOIN contact_relations r ON r.contact_id = c.id AND r.status = 'active'
           JOIN students st ON st.id = r.student_id
           JOIN enrollments e ON e.student_id = st.id AND e.status = 'active' AND e.class_id = ANY($3::uuid[])
           WHERE c.user_id = $1 AND c.school_id = $2 ${studentSql}
           LIMIT 1`,
          params,
        );
        return Boolean(row);
      },
      async resolveTeacherUserId(schoolId, teacherRef) {
        const row = await one(
          `SELECT t.user_id
           FROM teachers t
           WHERE t.school_id = $1
             AND (t.id::text = $2 OR t.teacher_code = $2 OR t.user_id::text = $2)
           LIMIT 1`,
          [schoolId, asTrimmed(teacherRef)],
        );
        return row?.user_id ?? null;
      },
      async listParentUserIdsForStudent(schoolId, studentRef) {
        const rows = await all(
          `SELECT DISTINCT c.user_id
           FROM students st
           JOIN contact_relations r ON r.student_id = st.id AND r.status = 'active'
           JOIN contacts c ON c.id = r.contact_id AND c.status = 'active' AND c.user_id IS NOT NULL
           WHERE st.school_id = $1 AND (st.id::text = $2 OR st.student_code = $2)`,
          [schoolId, asTrimmed(studentRef)],
        );
        return rows.map((row) => row.user_id).filter(Boolean);
      },
      async resolveParentUserIdByPhone(schoolId, phone) {
        const row = await one(
          `SELECT user_id FROM contacts
           WHERE school_id = $1 AND status = 'active' AND user_id IS NOT NULL
             AND regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g')
               = regexp_replace($2, '[^0-9+]', '', 'g')
           LIMIT 1`,
          [schoolId, asTrimmed(phone)],
        );
        return row?.user_id ?? null;
      },
      async listSchoolAdminUserIds(schoolId) {
        const rows = await all(
          `SELECT DISTINCT u.id
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
           WHERE u.school_id = $1 AND upper(ur.role_key) IN ('SCHOOL_ADMIN', 'PROVISEUR', 'PRINCIPAL', 'PREFET_ETUDES')`,
          [schoolId],
        );
        return rows.map((row) => row.id);
      },
      async listConversationParticipants(conversationId) {
        return all(
          `SELECT p.*, u.first_name, u.last_name, u.role AS role_label, u.email
           FROM school_conversation_participants p
           JOIN users u ON u.id = p.user_id
           WHERE p.conversation_id = $1
           ORDER BY p.joined_at`,
          [conversationId],
        );
      },
      async listAttachmentsForEntities(entityType, entityIds) {
        if (!entityIds?.length) return [];
        return all(
          `SELECT * FROM communication_attachments
           WHERE entity_type = $1 AND entity_id = ANY($2::uuid[]) AND status = 'attached'
           ORDER BY created_at`,
          [entityType, entityIds],
        );
      },
      async insertAttachment(row) {
        return one(
          `INSERT INTO communication_attachments (
             school_id, entity_type, entity_id, file_name, mime_type, file_size,
             storage_key, uploaded_by_user_id, created_at, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)
           RETURNING *`,
          [
            row.schoolId,
            row.entityType,
            row.entityId || null,
            row.fileName,
            row.mimeType,
            row.fileSize,
            row.storageKey,
            row.uploadedByUserId,
            row.status || "uploaded",
          ],
        );
      },
      async getAttachmentById(id) {
        return one(`SELECT * FROM communication_attachments WHERE id::text = $1`, [id]);
      },
      async attachToMessage({ attachmentIds, messageId, schoolId, uploadedByUserId }) {
        const rows = await all(
          `UPDATE communication_attachments
           SET entity_type = 'message', entity_id = $2, status = 'attached'
           WHERE id = ANY($1::uuid[])
             AND school_id = $3
             AND uploaded_by_user_id = $4
             AND status = 'uploaded'
             AND entity_id IS NULL
             AND entity_type = 'message'
           RETURNING *`,
          [attachmentIds, messageId, schoolId, uploadedByUserId],
        );
        return rows;
      },
      async countUnreadForUser(userId, schoolId) {
        const row = await one(
          `SELECT count(*)::int AS c
           FROM school_messages m
           JOIN school_conversation_participants p
             ON p.conversation_id = m.conversation_id
            AND p.user_id = $1
            AND COALESCE(p.status, 'active') = 'active'
           JOIN school_conversations c ON c.id = m.conversation_id AND COALESCE(c.status, 'active') = 'active'
           LEFT JOIN school_message_reads r ON r.message_id = m.id AND r.user_id = $1
           WHERE m.school_id = $2
             AND m.sender_user_id <> $1
             AND r.message_id IS NULL`,
          [userId, schoolId],
        );
        return row?.c ?? 0;
      },
      async listMessagesForUser({ userId, schoolId, bypass }) {
        if (bypass) {
          return all(
            `SELECT m.*, s.school_code, u.phone AS sender_phone,
               trim(concat(u.first_name, ' ', u.last_name)) AS sender_name,
               u.role AS sender_role_label,
               (SELECT read_at FROM school_message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $1) AS reader_read_at
             FROM school_messages m
             JOIN schools s ON s.id = m.school_id
             JOIN users u ON u.id = m.sender_user_id
             ORDER BY m.sent_at DESC, m.id DESC`,
            [userId],
          );
        }
        return all(
          `SELECT m.*, s.school_code, u.phone AS sender_phone,
             trim(concat(u.first_name, ' ', u.last_name)) AS sender_name,
             u.role AS sender_role_label,
             r.read_at AS reader_read_at
           FROM school_messages m
           JOIN schools s ON s.id = m.school_id
           JOIN users u ON u.id = m.sender_user_id
           JOIN school_conversation_participants p
             ON p.conversation_id = m.conversation_id AND p.user_id = $1 AND COALESCE(p.status, 'active') = 'active'
           LEFT JOIN school_message_reads r ON r.message_id = m.id AND r.user_id = $1
           WHERE m.school_id = $2
           ORDER BY m.sent_at DESC, m.id DESC`,
          [userId, schoolId],
        );
      },
      async listConversationMessagesPage({ conversationId, readerUserId, limit, cursor }) {
        const params = [conversationId, readerUserId, limit];
        let cursorSql = "";
        if (cursor?.at && cursor?.id) {
          params.push(cursor.at, cursor.id);
          cursorSql = `AND (m.sent_at, m.id) < ($4::timestamptz, $5::uuid)`;
        }
        return all(
          `SELECT m.*, s.school_code, u.phone AS sender_phone,
             trim(concat(u.first_name, ' ', u.last_name)) AS sender_name,
             u.role AS sender_role_label,
             r.read_at AS reader_read_at
           FROM school_messages m
           JOIN schools s ON s.id = m.school_id
           JOIN users u ON u.id = m.sender_user_id
           LEFT JOIN school_message_reads r ON r.message_id = m.id AND r.user_id = $2
           WHERE m.conversation_id = $1 ${cursorSql}
           ORDER BY m.sent_at DESC, m.id DESC
           LIMIT $3`,
          params,
        );
      },
      async listConversationsForUser({ userId, schoolId, limit, cursor, bypass }) {
        const params = bypass ? [userId, limit] : [userId, schoolId, limit];
        const schoolFilter = bypass ? "" : "AND c.school_id = $2";
        const limitIdx = bypass ? 2 : 3;
        let cursorSql = "";
        if (cursor?.at && cursor?.id) {
          params.push(cursor.at, cursor.id);
          const atIdx = params.length - 1;
          const idIdx = params.length;
          cursorSql = `AND (COALESCE(lm.sent_at, c.updated_at), c.id) < ($${atIdx}::timestamptz, $${idIdx}::uuid)`;
        }
        const participantJoin = bypass
          ? ""
          : `JOIN school_conversation_participants p
               ON p.conversation_id = c.id AND p.user_id = $1 AND COALESCE(p.status, 'active') = 'active'`;
        return all(
          `SELECT c.*, s.school_code,
             lm.id AS last_message_id,
             lm.body AS last_message_body,
             lm.sent_at AS last_message_at,
             lm.sender_user_id AS last_sender_user_id,
             trim(concat(su.first_name, ' ', su.last_name)) AS last_sender_name,
             (
               SELECT count(*)::int
               FROM school_messages m
               LEFT JOIN school_message_reads r ON r.message_id = m.id AND r.user_id = $1
               WHERE m.conversation_id = c.id
                 AND m.sender_user_id <> $1
                 AND r.message_id IS NULL
             ) AS unread_count
           FROM school_conversations c
           JOIN schools s ON s.id = c.school_id
           ${participantJoin}
           LEFT JOIN LATERAL (
             SELECT m.* FROM school_messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.sent_at DESC, m.id DESC
             LIMIT 1
           ) lm ON TRUE
           LEFT JOIN users su ON su.id = lm.sender_user_id
           WHERE 1=1 ${schoolFilter} ${cursorSql}
           ORDER BY COALESCE(lm.sent_at, c.updated_at) DESC, c.id DESC
           LIMIT $${limitIdx}`,
          params,
        );
      },
      async getAnnouncementById(id) {
        return one(
          `SELECT a.*, s.school_code,
             trim(concat(cu.first_name, ' ', cu.last_name)) AS author_name,
             trim(concat(cu.first_name, ' ', cu.last_name)) AS created_by_name,
             trim(concat(pu.first_name, ' ', pu.last_name)) AS published_by_name
           FROM announcements a
           JOIN schools s ON s.id = a.school_id
           LEFT JOIN users cu ON cu.id = a.created_by
           LEFT JOIN users pu ON pu.id = a.published_by
           WHERE a.id::text = $1`,
          [id],
        );
      },
      async insertAnnouncement(row) {
        return one(
          `INSERT INTO announcements (
             school_id, country_id, title, message, target_role, target_class_id, created_by,
             published_by, published_at, status, profile_payload, audience_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10::jsonb,$11::jsonb,NOW(),NOW())
           RETURNING *`,
          [
            row.schoolId,
            row.countryId,
            row.title,
            row.message,
            row.targetRole || null,
            row.targetClassId || null,
            row.createdByUserId || null,
            row.publishedByUserId || row.createdByUserId || null,
            row.status,
            JSON.stringify(row.profile ?? {}),
            JSON.stringify(row.audience ?? {}),
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
      async archiveAnnouncementRow(id, actorUserId) {
        return one(
          `UPDATE announcements
           SET status = 'archived', archived_at = COALESCE(archived_at, NOW()), archived_by = COALESCE(archived_by, $2),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT school_code FROM schools WHERE id = announcements.school_id) AS school_code`,
          [id, actorUserId],
        );
      },
      async insertAnnouncementRecipients(rows) {
        if (!rows?.length) return [];
        const inserted = [];
        for (const row of rows) {
          const saved = await one(
            `INSERT INTO announcement_recipients (
               announcement_id, school_id, user_id, recipient_kind, audience_reason, created_at
             ) VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
             ON CONFLICT (announcement_id, user_id) DO NOTHING
             RETURNING *`,
            [
              row.announcementId,
              row.schoolId,
              row.userId,
              row.recipientKind,
              JSON.stringify(row.audienceReason ?? {}),
            ],
          );
          if (saved) inserted.push(saved);
        }
        return inserted;
      },
      async isAnnouncementRecipient(announcementId, userId) {
        const row = await one(
          `SELECT 1 FROM announcement_recipients WHERE announcement_id = $1 AND user_id = $2`,
          [announcementId, userId],
        );
        return Boolean(row);
      },
      async countAnnouncementRecipients(announcementId) {
        const row = await one(
          `SELECT count(*)::int AS c FROM announcement_recipients WHERE announcement_id = $1`,
          [announcementId],
        );
        return row?.c ?? 0;
      },
      async countAnnouncementReads(announcementId) {
        const row = await one(
          `SELECT count(*)::int AS c FROM announcement_reads WHERE announcement_id = $1`,
          [announcementId],
        );
        return row?.c ?? 0;
      },
      async insertAnnouncementRead(announcementId, userId) {
        return one(
          `INSERT INTO announcement_reads (announcement_id, user_id, read_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = announcement_reads.read_at
           RETURNING *`,
          [announcementId, userId],
        );
      },
      async getAnnouncementRead(announcementId, userId) {
        return one(
          `SELECT * FROM announcement_reads WHERE announcement_id = $1 AND user_id = $2`,
          [announcementId, userId],
        );
      },
      /**
       * Snapshot plateforme set-based (INSERT … SELECT).
       * all_active_users : users.status=active ET au moins un user_roles actif (revoked_at IS NULL).
       * Retourne uniquement le nombre inséré — pas la population en JS.
       */
      async snapshotPlatformAnnouncementRecipients({ announcementId, audienceKey, roleKeys = [] }) {
        if (audienceKey === "all_active_users") {
          const row = await one(
            `WITH inserted AS (
               INSERT INTO platform_announcement_recipients (
                 announcement_id, user_id, recipient_kind, country_id, school_id, audience_reason, created_at
               )
               SELECT
                 $1::uuid,
                 u.id,
                 'user',
                 s.country_id,
                 u.school_id,
                 jsonb_build_object('audienceKey', 'all_active_users'),
                 NOW()
               FROM users u
               LEFT JOIN schools s ON s.id = u.school_id
               WHERE lower(COALESCE(u.status, 'active')) = 'active'
                 AND EXISTS (
                   SELECT 1
                   FROM user_roles ur
                   WHERE ur.user_id = u.id
                     AND ur.status = 'active'
                     AND ur.revoked_at IS NULL
                 )
               ON CONFLICT (announcement_id, user_id) DO NOTHING
               RETURNING user_id
             )
             SELECT count(*)::int AS c FROM inserted`,
            [announcementId],
          );
          return row?.c ?? 0;
        }
        const keys = Array.isArray(roleKeys) ? roleKeys.filter(Boolean) : [];
        if (!keys.length) return 0;
        const row = await one(
          `WITH inserted AS (
             INSERT INTO platform_announcement_recipients (
               announcement_id, user_id, recipient_kind, country_id, school_id, audience_reason, created_at
             )
             SELECT DISTINCT ON (u.id)
               $1::uuid,
               u.id,
               CASE
                 WHEN ur.role_key = 'COUNTRY_ADMIN' THEN 'country_admin'
                 WHEN ur.role_key = 'SCHOOL_ADMIN' THEN 'school_admin'
                 ELSE lower(ur.role_key)
               END,
               s.country_id,
               COALESCE(u.school_id, ur.school_id),
               jsonb_build_object('audienceKey', $3::text, 'roleKey', ur.role_key),
               NOW()
             FROM users u
             JOIN user_roles ur
               ON ur.user_id = u.id
              AND ur.status = 'active'
              AND ur.revoked_at IS NULL
              AND ur.role_key = ANY($2::text[])
             LEFT JOIN schools s ON s.id = COALESCE(u.school_id, ur.school_id)
             WHERE lower(COALESCE(u.status, 'active')) = 'active'
             ORDER BY u.id, ur.role_key
             ON CONFLICT (announcement_id, user_id) DO NOTHING
             RETURNING user_id
           )
           SELECT count(*)::int AS c FROM inserted`,
          [announcementId, keys, audienceKey],
        );
        return row?.c ?? 0;
      },
      async insertPlatformAnnouncement(row) {
        return one(
          `INSERT INTO platform_announcements (
             announcement_type, audience_key, title, message,
             created_by, published_by, sender_display_name, status, published_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),NOW())
           RETURNING *`,
          [
            row.announcementType,
            row.audienceKey,
            row.title,
            row.message,
            row.createdByUserId,
            row.publishedByUserId,
            row.senderDisplayName,
            row.status || "published",
          ],
        );
      },
      async insertPlatformAnnouncementRecipients() {
        throw new Error("insertPlatformAnnouncementRecipients unitaire interdit — utiliser snapshotPlatformAnnouncementRecipients (INSERT … SELECT).");
      },
      async isPlatformAnnouncementRecipient(announcementId, userId) {
        const row = await one(
          `SELECT 1 FROM platform_announcement_recipients WHERE announcement_id = $1 AND user_id = $2`,
          [announcementId, userId],
        );
        return Boolean(row);
      },
      async countPlatformAnnouncementRecipients(announcementId) {
        const row = await one(
          `SELECT count(*)::int AS c FROM platform_announcement_recipients WHERE announcement_id = $1`,
          [announcementId],
        );
        return row?.c ?? 0;
      },
      async insertPlatformAnnouncementRead(announcementId, userId) {
        return one(
          `INSERT INTO platform_announcement_reads (announcement_id, user_id, read_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = platform_announcement_reads.read_at
           RETURNING *`,
          [announcementId, userId],
        );
      },
      async getPlatformAnnouncementRead(announcementId, userId) {
        return one(
          `SELECT * FROM platform_announcement_reads WHERE announcement_id = $1 AND user_id = $2`,
          [announcementId, userId],
        );
      },
      async getPlatformAnnouncementById(id) {
        return one(
          `SELECT a.*,
             trim(concat(cu.first_name, ' ', cu.last_name)) AS created_by_name,
             trim(concat(pu.first_name, ' ', pu.last_name)) AS published_by_name
           FROM platform_announcements a
           LEFT JOIN users cu ON cu.id = a.created_by
           LEFT JOIN users pu ON pu.id = a.published_by
           WHERE a.id::text = $1`,
          [id],
        );
      },
      async archivePlatformAnnouncement(id, actorUserId) {
        return one(
          `UPDATE platform_announcements
           SET status = 'archived',
               archived_at = COALESCE(archived_at, NOW()),
               archived_by = COALESCE(archived_by, $2),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, actorUserId],
        );
      },
      async listPlatformAnnouncementsForUser({ userId, limit, cursor, management }) {
        const params = [userId];
        let cursorSql = "";
        if (cursor?.at && cursor?.id) {
          params.push(cursor.at, cursor.id);
          cursorSql = `AND (a.published_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
        params.push(limit);
        const visibility = management
          ? "TRUE"
          : `EXISTS (
               SELECT 1 FROM platform_announcement_recipients rec
               WHERE rec.announcement_id = a.id AND rec.user_id = $1
             )`;
        return all(
          `SELECT a.*,
             trim(concat(cu.first_name, ' ', cu.last_name)) AS created_by_name,
             trim(concat(pu.first_name, ' ', pu.last_name)) AS published_by_name,
             (SELECT count(*)::int FROM platform_announcement_recipients rec WHERE rec.announcement_id = a.id) AS recipients_count,
             (SELECT r.read_at FROM platform_announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = $1) AS reader_read_at
           FROM platform_announcements a
           LEFT JOIN users cu ON cu.id = a.created_by
           LEFT JOIN users pu ON pu.id = a.published_by
           WHERE ${visibility}
             ${cursorSql}
           ORDER BY a.published_at DESC, a.id DESC
           LIMIT $${params.length}`,
          params,
        );
      },
      async countPlatformAnnouncementUnreadForUser(userId) {
        const row = await one(
          `SELECT count(*)::int AS c
           FROM platform_announcement_recipients rec
           JOIN platform_announcements a ON a.id = rec.announcement_id
           LEFT JOIN platform_announcement_reads r
             ON r.announcement_id = rec.announcement_id AND r.user_id = rec.user_id
           WHERE rec.user_id = $1
             AND a.status = 'published'
             AND r.read_at IS NULL`,
          [userId],
        );
        return row?.c ?? 0;
      },
      async insertPlatformAnnouncementAttachment(row) {
        return one(
          `INSERT INTO platform_announcement_attachments (
             announcement_id, file_name, mime_type, file_size, storage_key,
             uploaded_by_user_id, created_at, status
           ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
           RETURNING *`,
          [
            row.announcementId || null,
            row.fileName,
            row.mimeType,
            row.fileSize,
            row.storageKey,
            row.uploadedByUserId,
            row.status || "uploaded",
          ],
        );
      },
      async getPlatformAnnouncementAttachmentById(id) {
        return one(`SELECT * FROM platform_announcement_attachments WHERE id::text = $1`, [id]);
      },
      async listPlatformAnnouncementAttachments(announcementIds) {
        if (!announcementIds?.length) return [];
        return all(
          `SELECT * FROM platform_announcement_attachments
           WHERE announcement_id = ANY($1::uuid[]) AND status = 'attached'
           ORDER BY created_at`,
          [announcementIds],
        );
      },
      async attachToPlatformAnnouncement({ attachmentIds, announcementId, uploadedByUserId }) {
        if (!attachmentIds?.length) return [];
        const rows = await all(
          `UPDATE platform_announcement_attachments
           SET announcement_id = $1, status = 'attached'
           WHERE id = ANY($2::uuid[])
             AND uploaded_by_user_id = $3
             AND announcement_id IS NULL
             AND status = 'uploaded'
           RETURNING *`,
          [announcementId, attachmentIds, uploadedByUserId],
        );
        return rows;
      },
      async countAnnouncementUnreadForUser(userId, schoolId) {
        const row = await one(
          `SELECT count(*)::int AS c
           FROM announcement_recipients rec
           JOIN announcements a ON a.id = rec.announcement_id
           LEFT JOIN announcement_reads r ON r.announcement_id = rec.announcement_id AND r.user_id = rec.user_id
           WHERE rec.user_id = $1
             AND rec.school_id = $2
             AND a.school_id = $2
             AND COALESCE(a.status, 'published') = 'published'
             AND a.archived_at IS NULL
             AND r.announcement_id IS NULL`,
          [userId, schoolId],
        );
        return row?.c ?? 0;
      },
      async listAnnouncementsForUser({ userId, schoolId, limit, cursor, management }) {
        const params = [schoolId, userId];
        let cursorSql = "";
        if (cursor?.at && cursor?.id) {
          params.push(cursor.at, cursor.id);
          cursorSql = ` AND (COALESCE(a.published_at, a.created_at), a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
        params.push(limit);
        const visibility = management
          ? ""
          : ` AND EXISTS (
                SELECT 1 FROM announcement_recipients rec
                WHERE rec.announcement_id = a.id AND rec.user_id = $2
              )
              AND COALESCE(a.status, 'published') = 'published'
              AND a.archived_at IS NULL`;
        return all(
          `SELECT a.*, s.school_code,
             trim(concat(cu.first_name, ' ', cu.last_name)) AS created_by_name,
             trim(concat(pu.first_name, ' ', pu.last_name)) AS published_by_name,
             (SELECT r.read_at FROM announcement_reads r
               WHERE r.announcement_id = a.id AND r.user_id = $2) AS reader_read_at,
             (SELECT count(*)::int FROM announcement_recipients rec WHERE rec.announcement_id = a.id) AS recipients_count,
             (SELECT count(*)::int FROM announcement_reads rd WHERE rd.announcement_id = a.id) AS reads_count
           FROM announcements a
           JOIN schools s ON s.id = a.school_id
           LEFT JOIN users cu ON cu.id = a.created_by
           LEFT JOIN users pu ON pu.id = a.published_by
           WHERE a.school_id = $1 ${visibility} ${cursorSql}
           ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
           LIMIT $${params.length}`,
          params,
        );
      },
      async listSchoolClassesByIds(schoolId, classIds) {
        if (!classIds?.length) return [];
        return all(
          `SELECT id, class_code, name, school_id FROM classes
           WHERE school_id = $1 AND id = ANY($2::uuid[]) AND COALESCE(status, 'active') = 'active'`,
          [schoolId, classIds],
        );
      },
      async listSchoolAudienceClasses(schoolId) {
        return all(
          `SELECT id, class_code, name FROM classes
           WHERE school_id = $1 AND COALESCE(status, 'active') = 'active'
           ORDER BY name, class_code`,
          [schoolId],
        );
      },
      async listSchoolActiveUserIds(schoolId) {
        return all(
          `SELECT id AS user_id FROM users WHERE school_id = $1 AND COALESCE(status, 'active') = 'active'`,
          [schoolId],
        );
      },
      async listSchoolUserIdsByRecipientKind(schoolId, kind) {
        if (kind === "parent") {
          return all(
            `SELECT DISTINCT u.id AS user_id
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
             WHERE u.school_id = $1 AND COALESCE(u.status, 'active') = 'active'
               AND upper(ur.role_key) = 'PARENT'`,
            [schoolId],
          );
        }
        if (kind === "teacher") {
          return all(
            `SELECT DISTINCT u.id AS user_id
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
             WHERE u.school_id = $1 AND COALESCE(u.status, 'active') = 'active'
               AND upper(ur.role_key) = 'TEACHER'`,
            [schoolId],
          );
        }
        if (kind === "student") {
          return all(
            `SELECT DISTINCT u.id AS user_id
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
             WHERE u.school_id = $1 AND COALESCE(u.status, 'active') = 'active'
               AND upper(ur.role_key) = 'STUDENT'`,
            [schoolId],
          );
        }
        if (kind === "staff") {
          return all(
            `SELECT DISTINCT u.id AS user_id
             FROM users u
             WHERE u.school_id = $1 AND COALESCE(u.status, 'active') = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM user_roles ur
                 WHERE ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
                   AND upper(ur.role_key) IN ('PARENT', 'TEACHER', 'STUDENT')
               )
               AND COALESCE(u.role, '') NOT IN ('Parent', 'Enseignant', 'Élève / Étudiant')`,
            [schoolId],
          );
        }
        return [];
      },
      async listClassStudentUserIds(schoolId, classIds) {
        if (!classIds?.length) return [];
        return all(
          `SELECT DISTINCT u.id AS user_id
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.school_id = e.school_id
           JOIN users u ON u.school_id = st.school_id
            AND (
              st.user_id = u.id
              OR (
                st.user_id IS NULL
                AND u.user_code = st.student_code
              )
            )
           WHERE e.school_id = $1
             AND e.class_id = ANY($2::uuid[])
             AND e.status = 'active'
             AND COALESCE(st.status, 'active') = 'active'
             AND COALESCE(u.status, 'active') = 'active'
           ORDER BY u.id`,
          [schoolId, classIds],
        );
      },
      async listClassParentUserIds(schoolId, classIds) {
        if (!classIds?.length) return [];
        return all(
          `SELECT DISTINCT c.user_id
           FROM enrollments e
           JOIN contact_relations r ON r.student_id = e.student_id AND r.status = 'active' AND r.school_id = e.school_id
           JOIN contacts c ON c.id = r.contact_id AND c.status = 'active' AND c.user_id IS NOT NULL
           WHERE e.school_id = $1
             AND e.class_id = ANY($2::uuid[])
             AND e.status = 'active'`,
          [schoolId, classIds],
        );
      },
      async listClassTeacherUserIds(schoolId, classIds) {
        if (!classIds?.length) return [];
        return all(
          `SELECT DISTINCT t.user_id
           FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id AND t.school_id = ta.school_id AND t.user_id IS NOT NULL
           WHERE ta.school_id = $1
             AND ta.class_id = ANY($2::uuid[])
             AND ta.status = 'active'
             AND COALESCE(t.status, 'active') = 'active'`,
          [schoolId, classIds],
        );
      },
      async attachToAnnouncement({ attachmentIds, announcementId, schoolId, uploadedByUserId }) {
        const rows = await all(
          `UPDATE communication_attachments
           SET entity_id = $2, status = 'attached'
           WHERE id = ANY($1::uuid[])
             AND school_id = $3
             AND uploaded_by_user_id = $4
             AND status = 'uploaded'
             AND entity_id IS NULL
             AND entity_type = 'announcement'
           RETURNING *`,
          [attachmentIds, announcementId, schoolId, uploadedByUserId],
        );
        return rows;
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
    getSchoolById: (id) => bind({}).getSchoolById(id),
    getCountryByCode: (code) => bind({}).getCountryByCode(code),
    getUserById: (id) => bind({}).getUserById(id),
    getCanonicalLinkedStudentByUserId: (id) => bind({}).getCanonicalLinkedStudentByUserId(id),
    withTransaction(fn) {
      return repo.withTransaction((tx) => fn(bind(tx)));
    },
    async listUsers(scope) {
      const params = [];
      const pred = sqlUsersScope(scope, params);
      const users = await repo.all(
        `SELECT u.*, ${USER_SCHOOL_SELECT}, c.iso_code AS country_code, c.name AS country_name
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN countries c ON c.id = s.country_id
         WHERE ${pred}
         ORDER BY u.created_at`,
        params,
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
      const profiles = await userRoleLifecycleService.loadBusinessProfilesByUserIds(
        bind({}),
        users.map((row) => row.id),
        rolesByUser,
      );
      return users.map((row) =>
        userRoleLifecycleService.hydrateUser(
          row,
          rolesByUser.get(String(row.id)) ?? [],
          profiles.get(String(row.id)),
        ),
      );
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
      const profiles = await userRoleLifecycleService.loadBusinessProfilesByUserIds(
        bind({}),
        users.map((row) => row.id),
        rolesByUser,
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
        users: users.map((row) =>
          userRoleLifecycleService.hydrateUser(
            row,
            rolesByUser.get(String(row.id)) ?? [],
            profiles.get(String(row.id)),
          ),
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
    listMessagesForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.listMessages(store, ...args);
    },
    listConversationsForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.listConversations(store, ...args);
    },
    getConversationForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.getConversation(store, ...args);
    },
    listConversationMessagesForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.listConversationMessages(store, ...args);
    },
    getMessageForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.getMessage(store, ...args);
    },
    createConversationForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.createConversation(store, ...args);
    },
    replyToConversationForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.replyToConversation(store, ...args);
    },
    unreadCountForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.unreadCount(store, ...args);
    },
    listMessageRecipientsForPrincipal: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.listAuthorizedRecipients(store, ...args);
    },
    uploadCommunicationAttachment: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.uploadAttachment(store, ...args);
    },
    downloadCommunicationAttachment: (...args) => {
      const service = require("../lib/communicationsMessagesService");
      return service.downloadAttachment(store, ...args);
    },
    createAnnouncement: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.publish(store, ...args);
    },
    updateAnnouncement: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.updateAnnouncement(store, ...args);
    },
    archiveAnnouncement: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.archiveAnnouncement(store, ...args);
    },
    listAnnouncementsForPrincipal: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.listAnnouncements(store, ...args);
    },
    getAnnouncementForPrincipal: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.getAnnouncement(store, ...args);
    },
    markAnnouncementRead: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.markRead(store, ...args);
    },
    unreadAnnouncementCountForPrincipal: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.unreadCount(store, ...args);
    },
    announcementAudienceOptionsForPrincipal: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.audienceOptions(store, ...args);
    },
    uploadAnnouncementAttachment: (...args) => {
      const service = require("../lib/communicationsAnnouncementsService");
      return service.uploadAttachment(store, ...args);
    },
    createPlatformAnnouncement: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.publish(store, ...args);
    },
    listPlatformAnnouncementsForPrincipal: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.listAnnouncements(store, ...args);
    },
    getPlatformAnnouncementForPrincipal: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.getAnnouncement(store, ...args);
    },
    markPlatformAnnouncementRead: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.markRead(store, ...args);
    },
    archivePlatformAnnouncementForPrincipal: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.archiveAnnouncement(store, ...args);
    },
    unreadPlatformAnnouncementCountForPrincipal: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.unreadCount(store, ...args);
    },
    uploadPlatformAnnouncementAttachment: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.uploadAttachment(store, ...args);
    },
    downloadPlatformAnnouncementAttachment: (...args) => {
      const service = require("../lib/platformAnnouncementsService");
      return service.downloadAttachment(store, ...args);
    },
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
