"use strict";

const { randomUUID } = require("node:crypto");
const clientsService = require("../lib/clientsService");
const userRoleLifecycleService = require("../lib/userRoleLifecycleService");
const { hashSecret } = require("../services/credentialService");
const {
  asTrimmed,
  toIsoDate,
  parsePayload,
  mapUserRow,
  mapUserRowToAuthAccount,
  mapContactRow,
  mapRelationRow,
  mapMessageRow,
  mapAnnouncementRow,
  schoolPublicProjectionFromSchool,
} = require("../lib/clientsManagement");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createClientsMemoryStore(seed = {}) {
  const tables = {
    users: [],
    userRoles: [],
    teachers: [],
    teacherAssignments: [],
    contacts: [],
    relations: [],
    conversations: [],
    participants: [],
    messages: [],
    reads: [],
    attachments: [],
    announcements: [],
    announcementRecipients: [],
    announcementReads: [],
    schools: clone(seed.platformSchools ?? []),
    countries: clone(seed.countries ?? []),
    students: clone(seed.students ?? []),
    sessions: clone(seed.sessions ?? []),
  };

  if (seed.school) {
    tables.schools.push(seed.school);
  }

  function resolveSchool(code) {
    const { isV2SchoolLoginCode, normalizeSchoolCode } = require("../lib/schoolCodeV2");
    const normalized = normalizeSchoolCode(code);
    if (!normalized || !isV2SchoolLoginCode(normalized)) return null;
    return (
      tables.schools.find((row) => {
        const loginCode = normalizeSchoolCode(row.loginCode ?? row.login_code);
        return loginCode === normalized;
      }) ?? null
    );
  }

  function resolveSchoolCountryCode(school) {
    const explicit = asTrimmed(school.countryCode ?? school.country_code).toUpperCase();
    if (explicit) return explicit;
    const code = asTrimmed(school.loginCode ?? school.login_code).toUpperCase();
    const prefix = code.split("-")[0];
    if (/^[A-Z]{2}$/.test(prefix)) return prefix;
    return "";
  }

  function userCountryProjection(row, school) {
    if (school) {
      return {
        country_code: resolveSchoolCountryCode(school),
        country_name: school.country ?? school.country_name ?? "",
      };
    }
    const profile = parsePayload(row?.profile_payload);
    return {
      country_code: asTrimmed(profile.countryCode).toUpperCase(),
      country_name: profile.countryScope || profile.countryName || "",
    };
  }

  const auditLog = [];
  let transactionDepth = 0;

  function isActiveUserStatus(status) {
    const normalized = String(status ?? "active").toLowerCase();
    return normalized !== "deleted" && normalized !== "archived";
  }

  function bind() {
    return {
      async one(sql, params = []) {
        const query = String(sql ?? "");
        if (!query.includes("FROM users u")) {
          return null;
        }
        const excludeUserId = query.includes("u.id::text <>") ? String(params[params.length - 1] ?? "") : "";
        const isEmail = query.includes("trim(u.email)");
        const isPhone = query.includes("trim(u.phone)");
        const isPlatform = query.includes("u.school_id IS NULL");
        const schoolId = isPlatform ? null : params[0];
        const identityKey = String(params[isPlatform ? 0 : 1] ?? "").toLowerCase();

        const match = tables.users.find((user) => {
          if (!isActiveUserStatus(user.status)) return false;
          if (excludeUserId && String(user.id) === excludeUserId) return false;
          if (isPlatform) {
            if (user.school_id) return false;
          } else if (user.school_id !== schoolId) {
            return false;
          }
          const candidate = isEmail
            ? String(user.email ?? "").trim().toLowerCase()
            : String(user.phone ?? "").trim().toLowerCase();
          return candidate && candidate === identityKey;
        });

        return match ? { id: match.id, user_code: match.user_code } : null;
      },
      async getSchoolByCode(code) {
        const school = resolveSchool(code);
        if (!school) return null;
        const login = asTrimmed(school.loginCode ?? school.login_code).toUpperCase();
        return {
          id: school.id,
          school_code: login,
          login_code: login,
          loginCode: login,
          name: school.name,
          country_id: school.countryId ?? school.country_id ?? "country-seed",
          country_code: resolveSchoolCountryCode(school),
          country_name: school.country ?? school.country_name ?? "",
        };
      },
      async getCountryByCode(code) {
        const normalized = asTrimmed(code).toUpperCase();
        if (!normalized) return null;
        const fromTable = (tables.countries || []).find(
          (row) => asTrimmed(row.iso_code ?? row.code).toUpperCase() === normalized,
        );
        if (fromTable) {
          return {
            id: fromTable.id,
            iso_code: normalized,
            name: fromTable.name ?? normalized,
          };
        }
        const school = tables.schools.find((row) => resolveSchoolCountryCode(row) === normalized);
        if (!school) return null;
        return {
          id: school.countryId ?? school.country_id ?? `country-${normalized.toLowerCase()}`,
          iso_code: normalized,
          name: school.country ?? school.country_name ?? normalized,
        };
      },
      async getUserById(id) {
        const row = tables.users.find((user) => user.id === id || user.user_code === id);
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        return {
          ...row,
          ...schoolPublicProjectionFromSchool(school, "*"),
          ...userCountryProjection(row, school),
        };
      },
      async listSchoolUsers(schoolId) {
        return Promise.all(
          tables.users
            .filter((user) => user.school_id === schoolId && (user.status ?? "active") === "active")
            .map((user) => this.getUserById(user.id)),
        ).then((rows) => rows.filter(Boolean));
      },
      async insertUser(row) {
        if (tables.users.some((user) => user.user_code === row.userCode)) {
          const error = new Error("duplicate user_code");
          error.code = "23505";
          error.constraint = "users_user_code_key";
          throw error;
        }
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          user_code: row.userCode,
          first_name: row.firstName,
          last_name: row.lastName,
          email: row.email,
          phone: row.phone,
          gender: row.gender,
          birth_date: row.birthDate,
          password_hash: row.passwordHash,
          pin_hash: row.passwordHash,
          must_change_password: true,
          role: row.role || null,
          status: row.status,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.users.push(saved);
        return this.getUserById(saved.id);
      },
      async updateUser(id, row) {
        const index = tables.users.findIndex((user) => user.id === id);
        if (index < 0) return null;
        const existing = tables.users[index];
        tables.users[index] = {
          ...existing,
          first_name: row.firstName,
          last_name: row.lastName,
          email: row.email,
          phone: row.phone,
          gender: row.gender,
          birth_date: row.birthDate,
          role: row.role || null,
          status: row.status,
          profile_payload: row.profile ?? existing.profile_payload,
          updated_at: new Date(),
        };
        return this.getUserById(id);
      },
      async updateUserSchoolId(id, schoolId) {
        const index = tables.users.findIndex((user) => user.id === id);
        if (index < 0) return null;
        const existing = tables.users[index];
        const profile = { ...parsePayload(existing.profile_payload) };
        delete profile.countryCode;
        delete profile.countryScope;
        delete profile.schoolCode;
        delete profile.schoolId;
        delete profile.country;
        tables.users[index] = {
          ...existing,
          school_id: schoolId,
          profile_payload: profile,
          updated_at: new Date(),
        };
        return this.getUserById(id);
      },
      async reassignActiveUserRolesSchool(userId, _fromSchoolId, toSchoolId) {
        tables.userRoles = tables.userRoles.map((row) => {
          if (row.user_id !== userId || row.status !== "active" || row.revoked_at) return row;
          return { ...row, school_id: toSchoolId, updated_at: new Date() };
        });
      },
      async revokeUserSessions(userId, reason) {
        let count = 0;
        tables.sessions = tables.sessions.map((row) => {
          if (row.user_id !== userId || row.revoked_at) return row;
          count += 1;
          return { ...row, revoked_at: new Date(), revoke_reason: reason };
        });
        return count;
      },
      async lockUserById(id) {
        return this.getUserById(id);
      },
      async listActiveUserRoleKeys(userId) {
        return tables.userRoles
          .filter((row) => row.user_id === userId && row.status === "active" && !row.revoked_at)
          .map((row) => row.role_key);
      },
      async listActiveUserRoleKeysForSchool(userId, schoolId) {
        const uid = String(userId ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!uid || !sid) return [];
        return tables.userRoles
          .filter(
            (row) =>
              String(row.user_id ?? "") === uid &&
              String(row.school_id ?? "") === sid &&
              row.status === "active" &&
              !row.revoked_at,
          )
          .map((row) => row.role_key);
      },
      async resolveCanonicalUserIdForSchool(principalRef, schoolId) {
        const ref = String(principalRef ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!ref || !sid) return null;
        const asUser = tables.users.find((row) => String(row.id ?? "") === ref);
        if (asUser) {
          const hasRole = tables.userRoles.some(
            (row) =>
              String(row.user_id ?? "") === String(asUser.id) &&
              String(row.school_id ?? "") === sid &&
              row.status === "active" &&
              !row.revoked_at,
          );
          if (hasRole) return String(asUser.id);
        }
        const asTeacher = tables.teachers.find(
          (row) =>
            String(row.id ?? "") === ref &&
            String(row.school_id ?? "") === sid &&
            row.user_id &&
            !["deleted", "archived", "inactive"].includes(String(row.status ?? "active").toLowerCase()),
        );
        return asTeacher?.user_id ? String(asTeacher.user_id) : null;
      },
      async listUserCodes() {
        return tables.users.map((row) => row.user_code);
      },
      async allocateUserCode(year) {
        const { formatUserCode, extractUserCodeSequence } = require("../lib/userRoleLifecycle");
        const existingMax = tables.users.reduce((max, row) => {
          const sequence = extractUserCodeSequence(row.user_code, year);
          return sequence != null ? Math.max(max, sequence) : max;
        }, 0);
        if (!tables.userCodeCounters) tables.userCodeCounters = {};
        const next = Math.max(tables.userCodeCounters[year] ?? 0, existingMax) + 1;
        tables.userCodeCounters[year] = next;
        return formatUserCode(year, next);
      },
      async insertUserRole(row) {
        const { randomUUID } = require("node:crypto");
        const exists = tables.userRoles.find(
          (item) =>
            item.user_id === row.userId &&
            item.role_key === row.roleKey &&
            item.status === "active" &&
            !item.revoked_at &&
            String(item.school_id ?? "") === String(row.schoolId ?? ""),
        );
        if (exists) {
          const error = new Error("duplicate user role");
          error.code = "23505";
          error.constraint = "user_roles_active_school_unique";
          throw error;
        }
        const saved = {
          id: randomUUID(),
          user_id: row.userId,
          school_id: row.schoolId || null,
          role_key: row.roleKey,
          granted_by: row.grantedBy || null,
          granted_at: new Date(),
          revoked_at: null,
          revoked_by: null,
          status: "active",
        };
        tables.userRoles.push(saved);
        return saved;
      },
      async revokeUserRole(row) {
        const index = tables.userRoles.findIndex(
          (item) =>
            item.user_id === row.userId &&
            item.role_key === row.roleKey &&
            item.status === "active" &&
            !item.revoked_at &&
            String(item.school_id ?? "") === String(row.schoolId ?? ""),
        );
        if (index < 0) return null;
        tables.userRoles[index] = {
          ...tables.userRoles[index],
          status: "revoked",
          revoked_at: new Date(),
          revoked_by: row.revokedBy || null,
          updated_at: new Date(),
        };
        return tables.userRoles[index];
      },
      async syncUserPrimaryRole(userId, roleKey) {
        const index = tables.users.findIndex((user) => user.id === userId);
        if (index < 0) return null;
        tables.users[index] = { ...tables.users[index], role: roleKey || null, updated_at: new Date() };
        return tables.users[index];
      },
      async getTeacherBySchoolUser(schoolId, userId) {
        return tables.teachers.find((row) => row.school_id === schoolId && row.user_id === userId) ?? null;
      },
      async findAmbiguousTeacherIdentity(schoolId, identity) {
        const { isExactTeacherCivilIdentity } = require("../lib/teachersManagement");
        return (
          tables.teachers.find((teacher) => {
            if (teacher.school_id !== schoolId) return false;
            if (identity.excludeUserId && String(teacher.user_id) === String(identity.excludeUserId)) return false;
            if (["deleted"].includes(String(teacher.status ?? "active").toLowerCase())) return false;
            const user = tables.users.find((row) => row.id === teacher.user_id);
            if (!user) return false;
            return isExactTeacherCivilIdentity(identity, {
              firstName: user.first_name,
              lastName: user.last_name,
              birthDate: toIsoDate(user.birth_date) || "",
              gender: user.gender,
            });
          }) ?? null
        );
      },
      async insertTeacherForUser(row) {
        const existing = await this.getTeacherBySchoolUser(row.schoolId, row.userId);
        if (existing) return existing;
        const { randomUUID } = require("node:crypto");
        const { generateNextTeacherCodes } = require("../lib/teacherCodeAllocation");
        const seedData = require("../data");
        const school = tables.schools.find((item) => item.id === row.schoolId)
          ?? (seedData.schools ?? []).find((item) => item.id === row.schoolId)
          ?? { loginCode: row.schoolCode, login_code: row.schoolCode, name: "Institut Nuru" };
        const user = tables.users.find((item) => item.id === row.userId);
        const codes = generateNextTeacherCodes(
          school,
          [
            ...tables.teachers.map((item) => item.teacher_code),
            ...(seedData.teachers ?? []).map((item) => item.publicId ?? item.identifier ?? item.id),
          ],
          {
            firstName: row.firstName ?? user?.first_name ?? user?.firstName ?? "Enseignant",
            lastName: row.lastName ?? user?.last_name ?? user?.lastName ?? "Nouveau",
          },
        );
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          user_id: row.userId,
          teacher_code: codes.teacherCode,
          speciality: row.speciality,
          hire_date: row.hireDate,
          status: "active",
        };
        tables.teachers.push(saved);
        return saved;
      },
      async countActiveTeacherAssignments(teacherId) {
        return tables.teacherAssignments.filter(
          (row) => row.teacher_id === teacherId && (row.status ?? "active") === "active",
        ).length;
      },
      async deactivateTeacherProfile(teacherId) {
        const index = tables.teachers.findIndex((row) => row.id === teacherId);
        if (index < 0) return null;
        tables.teachers[index] = { ...tables.teachers[index], status: "inactive" };
        return tables.teachers[index];
      },
      async reactivateTeacherProfile(teacherId) {
        const index = tables.teachers.findIndex((row) => row.id === teacherId);
        if (index < 0) return null;
        tables.teachers[index] = { ...tables.teachers[index], status: "active" };
        return tables.teachers[index];
      },
      async getContactById(id) {
        const row = tables.contacts.find((contact) => contact.id === id);
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        return {
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
          school_name: school?.name ?? "",
        };
      },
      async getContactByIdForUpdate(id) {
        return this.getContactById(id);
      },
      async insertContact(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          country_id: row.countryId,
          first_name: row.firstName,
          last_name: row.lastName,
          contact_type: row.contactType,
          phone: row.phone,
          email: row.email,
          gender: row.gender,
          birth_date: row.birthDate,
          address: row.address,
          status: row.status,
          user_id: null,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.contacts.push(saved);
        return this.getContactById(saved.id);
      },
      async updateContact(id, row) {
        const index = tables.contacts.findIndex((contact) => contact.id === id);
        if (index < 0) return null;
        const existing = tables.contacts[index];
        tables.contacts[index] = {
          ...existing,
          first_name: row.firstName,
          last_name: row.lastName,
          contact_type: row.contactType,
          phone: row.phone,
          email: row.email,
          gender: row.gender,
          birth_date: row.birthDate,
          address: row.address,
          status: row.status,
          profile_payload: row.profile ?? existing.profile_payload,
          updated_at: new Date(),
        };
        return this.getContactById(id);
      },
      async linkContactUser(contactId, userId, profile) {
        const index = tables.contacts.findIndex((contact) => contact.id === contactId);
        if (index < 0) return null;
        tables.contacts[index] = {
          ...tables.contacts[index],
          user_id: userId,
          profile_payload: profile,
          updated_at: new Date(),
        };
        return this.getContactById(contactId);
      },
      async getActiveContactByUserId(schoolId, userId) {
        const row = tables.contacts.find(
          (contact) =>
            contact.school_id === schoolId &&
            String(contact.user_id) === String(userId) &&
            (contact.status ?? "active") === "active",
        );
        return row ? this.getContactById(row.id) : null;
      },
      async findActiveContactByEmail(schoolId, email) {
        const key = asTrimmed(email).toLowerCase();
        if (!key) return null;
        const row = tables.contacts.find(
          (contact) =>
            contact.school_id === schoolId &&
            (contact.status ?? "active") === "active" &&
            asTrimmed(contact.email).toLowerCase() === key,
        );
        return row ? this.getContactById(row.id) : null;
      },
      async findActiveContactByPhone(schoolId, phone) {
        const key = asTrimmed(phone).toLowerCase();
        if (!key) return null;
        const row = tables.contacts.find(
          (contact) =>
            contact.school_id === schoolId &&
            (contact.status ?? "active") === "active" &&
            asTrimmed(contact.phone).toLowerCase() === key,
        );
        return row ? this.getContactById(row.id) : null;
      },
      async advisoryXactLock() {
        return undefined;
      },
      async getStudentById(id) {
        return (
          tables.students.find(
            (student) => student.id === id || student.student_code === id || student.studentCode === id,
          ) ?? null
        );
      },
      async getRelationById(id) {
        const row = tables.relations.find((relation) => String(relation.id) === String(id));
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        const contact = tables.contacts.find((item) => item.id === row.contact_id);
        const student = tables.students.find((item) => item.id === row.student_id);
        return {
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
          contact_name: contact ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() : "",
          student_name: student
            ? `${student.first_name ?? ""} ${student.last_name ?? student.name ?? ""}`.trim()
            : "",
        };
      },
      async getRelationByContactAndStudent(contactId, studentId) {
        const matches = tables.relations.filter(
          (relation) => relation.contact_id === contactId && relation.student_id === studentId,
        );
        const row =
          matches.find((item) => (item.status ?? "active") === "active") || matches[0] || null;
        if (!row) return null;
        return this.getRelationById(row.id);
      },
      async getActiveRelationByContactAndStudent(contactId, studentId) {
        const row = tables.relations.find(
          (relation) =>
            relation.contact_id === contactId &&
            relation.student_id === studentId &&
            (relation.status ?? "active") === "active",
        );
        if (!row) return null;
        return this.getRelationById(row.id);
      },
      async insertRelation(row) {
        const existingActive = tables.relations.find(
          (relation) =>
            relation.contact_id === row.contactId &&
            relation.student_id === row.studentId &&
            (relation.status ?? "active") === "active",
        );
        if (existingActive) return this.getRelationById(existingActive.id);
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          country_id: row.countryId,
          relation_type: "parent_student",
          contact_id: row.contactId,
          student_id: row.studentId,
          status: "active",
          profile_payload: row.profile ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.relations.push(saved);
        return this.getRelationById(saved.id);
      },
      async archiveRelation(id) {
        const index = tables.relations.findIndex((relation) => String(relation.id) === String(id));
        if (index < 0) return null;
        tables.relations[index] = {
          ...tables.relations[index],
          status: "archived",
          updated_at: new Date(),
        };
        return this.getRelationById(id);
      },
      async insertConversation(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          country_id: row.countryId,
          subject: row.subject,
          created_by_user_id: row.createdByUserId,
          status: "active",
          profile_payload: row.profile ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.conversations.push(saved);
        return saved;
      },
      async insertParticipant(row) {
        const existing = tables.participants.find(
          (item) => item.conversation_id === row.conversationId && item.user_id === row.userId,
        );
        if (existing) return existing;
        const saved = {
          id: randomUUID(),
          conversation_id: row.conversationId,
          user_id: row.userId,
          school_id: row.schoolId,
          participant_role: row.role,
          status: "active",
          left_at: null,
          joined_at: new Date(),
        };
        tables.participants.push(saved);
        return saved;
      },
      async insertMessage(row) {
        const saved = {
          id: randomUUID(),
          conversation_id: row.conversationId,
          school_id: row.schoolId,
          country_id: row.countryId,
          sender_user_id: row.senderUserId,
          body: row.body,
          direction: row.direction,
          theme: row.theme,
          priority: row.priority,
          status: "sent",
          attachment_url: row.attachmentUrl,
          profile_payload: row.profile ?? {},
          sent_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.messages.push(saved);
        return saved;
      },
      async getMessageById(id) {
        const row = tables.messages.find((message) => message.id === id);
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        const sender = tables.users.find((user) => user.id === row.sender_user_id);
        return {
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
          sender_phone: sender?.phone ?? "",
          sender_name: asTrimmed(`${sender?.first_name ?? ""} ${sender?.last_name ?? ""}`),
          sender_role_label: sender?.role ?? "",
        };
      },
      async getConversationById(id) {
        const row = tables.conversations.find((item) => item.id === id);
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        return {
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
        };
      },
      async touchConversation(id) {
        const row = tables.conversations.find((item) => item.id === id);
        if (row) row.updated_at = new Date();
        return row ?? null;
      },
      async isConversationParticipant(conversationId, userId, options = {}) {
        const activeOnly = options.activeOnly !== false;
        return tables.participants.some(
          (item) =>
            item.conversation_id === conversationId &&
            item.user_id === userId &&
            (!activeOnly || (item.status ?? "active") === "active"),
        );
      },
      async insertMessageRead(messageId, userId) {
        const existing = tables.reads.find((row) => row.message_id === messageId && row.user_id === userId);
        if (existing) {
          existing.read_at = new Date();
          return existing;
        }
        const saved = { message_id: messageId, user_id: userId, read_at: new Date() };
        tables.reads.push(saved);
        return saved;
      },
      async getMessageRead(messageId, userId) {
        return tables.reads.find((row) => row.message_id === messageId && row.user_id === userId) ?? null;
      },
      async listActiveRoleKeys(userId) {
        return tables.userRoles
          .filter((item) => item.user_id === userId && item.status === "active" && !item.revoked_at)
          .map((item) => item.role_key);
      },
      async listParentLinkedStudentIds(userId, schoolId) {
        const contactIds = tables.contacts
          .filter((contact) => contact.user_id === userId && contact.school_id === schoolId)
          .map((contact) => contact.id);
        return tables.relations
          .filter((relation) => contactIds.includes(relation.contact_id) && relation.status === "active")
          .map((relation) => relation.student_id);
      },
      async resolveSchoolStudent(schoolId, ref) {
        return (
          tables.students.find(
            (student) =>
              student.school_id === schoolId &&
              (String(student.id) === String(ref) || String(student.student_code ?? student.studentCode) === String(ref)),
          ) ?? null
        );
      },
      async listTeacherActiveClassIds() {
        return [];
      },
      async teacherAssignedToStudents() {
        return false;
      },
      async parentLinkedToTeacherClasses() {
        return false;
      },
      async resolveTeacherUserId() {
        return null;
      },
      async listParentUserIdsForStudent() {
        return [];
      },
      async resolveParentUserIdByPhone() {
        return null;
      },
      async listSchoolAdminUserIds(schoolId) {
        return tables.users
          .filter((user) => user.school_id === schoolId && String(user.role ?? "").includes("Admin"))
          .map((user) => user.id);
      },
      async listConversationParticipants(conversationId) {
        return tables.participants
          .filter((item) => item.conversation_id === conversationId)
          .map((item) => {
            const user = tables.users.find((row) => row.id === item.user_id);
            return {
              ...item,
              first_name: user?.first_name,
              last_name: user?.last_name,
              role_label: user?.role,
            };
          });
      },
      async listAttachmentsForEntities(entityType, entityIds) {
        const ids = new Set((entityIds ?? []).map(String));
        return tables.attachments.filter(
          (row) => row.entity_type === entityType && ids.has(String(row.entity_id)) && row.status === "attached",
        );
      },
      async insertAttachment(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          entity_type: row.entityType,
          entity_id: row.entityId,
          file_name: row.fileName,
          mime_type: row.mimeType,
          file_size: row.fileSize,
          storage_key: row.storageKey,
          uploaded_by_user_id: row.uploadedByUserId,
          created_at: new Date(),
          status: row.status || "uploaded",
        };
        tables.attachments.push(saved);
        return saved;
      },
      async getAttachmentById(id) {
        return tables.attachments.find((row) => String(row.id) === String(id)) ?? null;
      },
      async attachToMessage({ attachmentIds, messageId, schoolId, uploadedByUserId }) {
        const attached = [];
        for (const row of tables.attachments) {
          if (
            attachmentIds.includes(row.id) &&
            row.school_id === schoolId &&
            row.uploaded_by_user_id === uploadedByUserId &&
            row.status === "uploaded" &&
            !row.entity_id &&
            row.entity_type === "message"
          ) {
            row.entity_type = "message";
            row.entity_id = messageId;
            row.status = "attached";
            attached.push(row);
          }
        }
        return attached;
      },
      async countUnreadForUser(userId, schoolId) {
        const conversationIds = new Set(
          tables.participants
            .filter((item) => item.user_id === userId && (item.status ?? "active") === "active")
            .map((item) => item.conversation_id),
        );
        return tables.messages.filter((message) => {
          if (message.school_id !== schoolId) return false;
          if (!conversationIds.has(message.conversation_id)) return false;
          if (String(message.sender_user_id) === String(userId)) return false;
          return !tables.reads.some((read) => read.message_id === message.id && read.user_id === userId);
        }).length;
      },
      async listMessagesForUser({ userId, schoolId, bypass }) {
        const conversationIds = new Set(
          tables.participants
            .filter((item) => item.user_id === userId && (item.status ?? "active") === "active")
            .map((item) => item.conversation_id),
        );
        return tables.messages
          .filter((message) => (bypass ? true : message.school_id === schoolId && conversationIds.has(message.conversation_id)))
          .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))
          .map((message) => {
            const read = tables.reads.find((row) => row.message_id === message.id && row.user_id === userId);
            const sender = tables.users.find((user) => user.id === message.sender_user_id);
            const school = tables.schools.find((item) => item.id === message.school_id);
            return {
              ...message,
              school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
              sender_name: asTrimmed(`${sender?.first_name ?? ""} ${sender?.last_name ?? ""}`),
              sender_role_label: sender?.role ?? "",
              reader_read_at: read?.read_at ?? null,
            };
          });
      },
      async listConversationMessagesPage({ conversationId, readerUserId, limit, cursor }) {
        let rows = tables.messages.filter((message) => message.conversation_id === conversationId);
        rows.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at) || String(b.id).localeCompare(String(a.id)));
        if (cursor?.at && cursor?.id) {
          rows = rows.filter(
            (row) =>
              new Date(row.sent_at) < new Date(cursor.at) ||
              (String(row.sent_at) === String(cursor.at) && String(row.id) < String(cursor.id)),
          );
        }
        return rows.slice(0, limit).map((message) => {
          const read = tables.reads.find((row) => row.message_id === message.id && row.user_id === readerUserId);
          const sender = tables.users.find((user) => user.id === message.sender_user_id);
          return {
            ...message,
            sender_name: asTrimmed(`${sender?.first_name ?? ""} ${sender?.last_name ?? ""}`),
            sender_role_label: sender?.role ?? "",
            reader_read_at: read?.read_at ?? null,
          };
        });
      },
      async listConversationsForUser({ userId, schoolId, limit, bypass }) {
        const mine = new Set(
          tables.participants
            .filter((item) => item.user_id === userId && (item.status ?? "active") === "active")
            .map((item) => item.conversation_id),
        );
        return tables.conversations
          .filter((conversation) => (bypass ? true : conversation.school_id === schoolId && mine.has(conversation.id)))
          .slice(0, limit)
          .map((conversation) => {
            const school = tables.schools.find((item) => item.id === conversation.school_id);
            const last = tables.messages
              .filter((message) => message.conversation_id === conversation.id)
              .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0];
            const sender = last ? tables.users.find((user) => user.id === last.sender_user_id) : null;
            return {
              ...conversation,
              school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
              last_message_id: last?.id,
              last_message_body: last?.body,
              last_message_at: last?.sent_at,
              last_sender_user_id: last?.sender_user_id,
              last_sender_name: sender ? asTrimmed(`${sender.first_name ?? ""} ${sender.last_name ?? ""}`) : "",
              unread_count: 0,
            };
          });
      },
      async updateMessageStatus(messageId, status) {
        const index = tables.messages.findIndex((message) => message.id === messageId);
        if (index < 0) return null;
        tables.messages[index] = { ...tables.messages[index], status, updated_at: new Date() };
        return this.getMessageById(messageId);
      },
      async getAnnouncementById(id) {
        const row = tables.announcements.find((announcement) => announcement.id === id);
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        return { ...row, school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "" };
      },
      async insertAnnouncement(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          country_id: row.countryId,
          title: row.title,
          message: row.message,
          target_role: row.targetRole,
          target_class_id: row.targetClassId,
          created_by: row.createdByUserId,
          published_by: row.publishedByUserId || row.createdByUserId,
          published_at: new Date(),
          status: row.status,
          profile_payload: row.profile ?? {},
          audience_payload: row.audience ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.announcements.push(saved);
        return this.getAnnouncementById(saved.id);
      },
      async updateAnnouncement(id, row) {
        const index = tables.announcements.findIndex((announcement) => announcement.id === id);
        if (index < 0) return null;
        const existing = tables.announcements[index];
        tables.announcements[index] = {
          ...existing,
          title: row.title,
          message: row.message,
          target_role: row.targetRole,
          target_class_id: row.targetClassId,
          status: row.status,
          profile_payload: row.profile ?? existing.profile_payload,
          updated_at: new Date(),
        };
        return this.getAnnouncementById(id);
      },
      async archiveAnnouncementRow(id, actorUserId) {
        const index = tables.announcements.findIndex((announcement) => announcement.id === id);
        if (index < 0) return null;
        tables.announcements[index] = {
          ...tables.announcements[index],
          status: "archived",
          archived_at: new Date(),
          archived_by: actorUserId,
          updated_at: new Date(),
        };
        return this.getAnnouncementById(id);
      },
      async insertAnnouncementRecipients(rows) {
        const inserted = [];
        for (const row of rows ?? []) {
          const exists = tables.announcementRecipients.some(
            (item) => item.announcement_id === row.announcementId && item.user_id === row.userId,
          );
          if (exists) continue;
          const saved = {
            announcement_id: row.announcementId,
            school_id: row.schoolId,
            user_id: row.userId,
            recipient_kind: row.recipientKind,
            audience_reason: row.audienceReason ?? {},
            created_at: new Date(),
          };
          tables.announcementRecipients.push(saved);
          inserted.push(saved);
        }
        return inserted;
      },
      async isAnnouncementRecipient(announcementId, userId) {
        return tables.announcementRecipients.some(
          (row) => String(row.announcement_id) === String(announcementId) && String(row.user_id) === String(userId),
        );
      },
      async countAnnouncementRecipients(announcementId) {
        return tables.announcementRecipients.filter((row) => String(row.announcement_id) === String(announcementId)).length;
      },
      async countAnnouncementReads(announcementId) {
        return tables.announcementReads.filter((row) => String(row.announcement_id) === String(announcementId)).length;
      },
      async insertAnnouncementRead(announcementId, userId) {
        const existing = tables.announcementReads.find(
          (row) => String(row.announcement_id) === String(announcementId) && String(row.user_id) === String(userId),
        );
        if (existing) return existing;
        const saved = { announcement_id: announcementId, user_id: userId, read_at: new Date() };
        tables.announcementReads.push(saved);
        return saved;
      },
      async getAnnouncementRead(announcementId, userId) {
        return (
          tables.announcementReads.find(
            (row) => String(row.announcement_id) === String(announcementId) && String(row.user_id) === String(userId),
          ) ?? null
        );
      },
      async countAnnouncementUnreadForUser(userId, schoolId) {
        return tables.announcementRecipients.filter((row) => {
          if (String(row.user_id) !== String(userId) || String(row.school_id) !== String(schoolId)) return false;
          const announcement = tables.announcements.find((item) => item.id === row.announcement_id);
          if (!announcement || announcement.status === "archived" || announcement.archived_at) return false;
          return !tables.announcementReads.some(
            (read) => String(read.announcement_id) === String(row.announcement_id) && String(read.user_id) === String(userId),
          );
        }).length;
      },
      async listAnnouncementsForUser({ userId, schoolId, limit, management }) {
        return tables.announcements
          .filter((row) => {
            if (String(row.school_id) !== String(schoolId)) return false;
            if (management) return true;
            if (row.status === "archived" || row.archived_at) return false;
            return tables.announcementRecipients.some(
              (rec) => rec.announcement_id === row.id && String(rec.user_id) === String(userId),
            );
          })
          .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
          .slice(0, limit)
          .map((row) => ({
            ...row,
            recipients_count: tables.announcementRecipients.filter((rec) => rec.announcement_id === row.id).length,
            reads_count: tables.announcementReads.filter((rec) => rec.announcement_id === row.id).length,
            reader_read_at: tables.announcementReads.find(
              (rec) => rec.announcement_id === row.id && String(rec.user_id) === String(userId),
            )?.read_at,
          }));
      },
      async listSchoolClassesByIds() {
        return [];
      },
      async listSchoolAudienceClasses() {
        return [];
      },
      async listSchoolActiveUserIds(schoolId) {
        return tables.users
          .filter((row) => String(row.school_id) === String(schoolId))
          .map((row) => ({ user_id: row.id }));
      },
      async listSchoolUserIdsByRecipientKind() {
        return [];
      },
      async listClassStudentUserIds() {
        return [];
      },
      async listClassParentUserIds() {
        return [];
      },
      async listClassTeacherUserIds() {
        return [];
      },
      async attachToAnnouncement({ attachmentIds, announcementId, schoolId, uploadedByUserId }) {
        const attached = [];
        for (const row of tables.attachments) {
          if (
            attachmentIds.includes(row.id) &&
            row.school_id === schoolId &&
            row.uploaded_by_user_id === uploadedByUserId &&
            row.status === "uploaded" &&
            !row.entity_id &&
            row.entity_type === "announcement"
          ) {
            row.entity_id = announcementId;
            row.status = "attached";
            attached.push(row);
          }
        }
        return attached;
      },
      async recordClientsAudit(entry) {
        auditLog.push({ ...entry });
      },
    };
  }

  const txApi = bind();
  const store = {
    bind,
    getSchoolByCode: (code) => txApi.getSchoolByCode(code),
    getCountryByCode: (code) => txApi.getCountryByCode(code),
    getUserById: (id) => txApi.getUserById(id),
    async withTransaction(fn) {
      if (transactionDepth > 0) {
        return fn(txApi);
      }
      transactionDepth += 1;
      const snapshot = clone(tables);
      const auditSnapshot = [...auditLog];
      try {
        return await fn(txApi);
      } catch (error) {
        Object.keys(tables).forEach((key) => {
          tables[key] = snapshot[key];
        });
        auditLog.length = 0;
        auditLog.push(...auditSnapshot);
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
    listProjection() {
      const users = tables.users.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        const roleKeys = tables.userRoles
          .filter((item) => item.user_id === row.id && item.status === "active" && !item.revoked_at)
          .map((item) => item.role_key);
        return userRoleLifecycleService.hydrateUser(
          {
            ...row,
            ...schoolPublicProjectionFromSchool(school, "*"),
            ...userCountryProjection(row, school),
          },
          roleKeys,
        );
      });
      const contacts = tables.contacts.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        return mapContactRow({
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
          school_name: school?.name ?? "",
        });
      });
      const relations = tables.relations.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        return mapRelationRow({ ...row, school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "" });
      });
      const messages = tables.messages.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        const sender = tables.users.find((user) => user.id === row.sender_user_id);
        const read = tables.reads.find((item) => item.message_id === row.id);
        return mapMessageRow({
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
          sender_phone: sender?.phone ?? "",
          read_at: read?.read_at,
        });
      });
      const announcements = tables.announcements.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        return mapAnnouncementRow({
          ...row,
          school_code: school ? asTrimmed(school.loginCode ?? school.login_code).toUpperCase() : "",
        });
      });
      return { users, contacts, relations, messages, announcements };
    },
    listAuthAccounts() {
      return tables.users.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        const roleKeys = tables.userRoles
          .filter((item) => item.user_id === row.id && item.status === "active" && !item.revoked_at)
          .map((item) => item.role_key);
        const account = mapUserRowToAuthAccount({
          ...row,
          ...schoolPublicProjectionFromSchool(school, "*"),
          ...userCountryProjection(row, school),
        });
        const hydrated = userRoleLifecycleService.hydrateUser(
          {
            ...row,
            ...schoolPublicProjectionFromSchool(school, "*"),
            school_code: account.schoolCode,
            country_code: account.countryCode,
            country_name: account.countryScope,
          },
          roleKeys,
        );
        return {
          ...account,
          ...hydrated,
          passwordHash: account.passwordHash,
          pinHash: account.pinHash,
          mustChangePassword: account.mustChangePassword,
          hasTemporaryPassword: account.hasTemporaryPassword,
          identifier: account.identifier,
        };
      });
    },
    changeUserPassword(lookupKeys, newPassword) {
      const keys = new Set(
        (Array.isArray(lookupKeys) ? lookupKeys : [lookupKeys])
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      );
      const index = tables.users.findIndex((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        const mapped = mapUserRowToAuthAccount({
          ...row,
          ...schoolPublicProjectionFromSchool(school, "*"),
          ...userCountryProjection(row, school),
        });
        return [mapped.id, mapped.publicId, mapped.identifier].some((value) =>
          keys.has(String(value ?? "").trim()),
        );
      });
      if (index < 0) {
        return null;
      }
      const secretHash = hashSecret(newPassword);
      tables.users[index] = {
        ...tables.users[index],
        password_hash: secretHash,
        pin_hash: secretHash,
        must_change_password: false,
        updated_at: new Date(),
      };
      const school = tables.schools.find((item) => item.id === tables.users[index].school_id);
      return mapUserRowToAuthAccount({
        ...tables.users[index],
        ...schoolPublicProjectionFromSchool(school, "*"),
        ...userCountryProjection(tables.users[index], school),
      });
    },
    resetUserPassword(lookupKeys, temporaryPassword) {
      const keys = new Set(
        (Array.isArray(lookupKeys) ? lookupKeys : [lookupKeys])
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      );
      const index = tables.users.findIndex((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        const mapped = mapUserRowToAuthAccount({
          ...row,
          ...schoolPublicProjectionFromSchool(school, "*"),
          ...userCountryProjection(row, school),
        });
        return [mapped.id, mapped.publicId, mapped.identifier].some((value) =>
          keys.has(String(value ?? "").trim()),
        );
      });
      if (index < 0) {
        return null;
      }
      const secretHash = hashSecret(temporaryPassword);
      tables.users[index] = {
        ...tables.users[index],
        password_hash: secretHash,
        pin_hash: secretHash,
        must_change_password: true,
        updated_at: new Date(),
      };
      const school = tables.schools.find((item) => item.id === tables.users[index].school_id);
      return mapUserRowToAuthAccount({
        ...tables.users[index],
        ...schoolPublicProjectionFromSchool(school, "*"),
        ...userCountryProjection(tables.users[index], school),
      });
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
    ensureStudentRecord(row = {}) {
      const studentCode = asTrimmed(row.student_code || row.studentCode || row.matricule || row.id);
      const id = asTrimmed(row.id || row.student_uuid || studentCode);
      if (!id && !studentCode) return null;
      const existing = tables.students.find(
        (student) =>
          String(student.id) === String(id) ||
          String(student.student_code ?? student.studentCode ?? "") === studentCode,
      );
      if (existing) return existing;
      const saved = {
        id,
        school_id: row.school_id || row.schoolId,
        first_name: row.first_name || row.firstName || "",
        last_name: row.last_name || row.lastName || "",
        student_code: studentCode,
        studentCode,
        status: row.status || "active",
      };
      tables.students.push(saved);
      return saved;
    },
    touchUserLastLogin(lookupKeys = []) {
      const keys = new Set(
        (Array.isArray(lookupKeys) ? lookupKeys : [lookupKeys])
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      );
      tables.users = tables.users.map((row) => {
        const aliases = [row.id, row.user_code, row.email, row.phone]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean);
        if (!aliases.some((alias) => keys.has(alias))) {
          return row;
        }
        return { ...row, last_login_at: new Date(), updated_at: new Date() };
      });
    },
    getAuditLog: () => [...auditLog],
    clearAuditLog: () => {
      auditLog.length = 0;
    },
    _tables: tables,
  };

  return store;
}

module.exports = {
  createClientsMemoryStore,
};
