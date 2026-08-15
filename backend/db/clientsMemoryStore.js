"use strict";

const { randomUUID } = require("node:crypto");
const clientsService = require("../lib/clientsService");
const userRoleLifecycleService = require("../lib/userRoleLifecycleService");
const { hashSecret } = require("../services/credentialService");
const {
  asTrimmed,
  parsePayload,
  mapUserRow,
  mapUserRowToAuthAccount,
  mapContactRow,
  mapRelationRow,
  mapMessageRow,
  mapAnnouncementRow,
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
    announcements: [],
    schools: clone(seed.platformSchools ?? []),
    students: clone(seed.students ?? []),
  };

  if (seed.school) {
    tables.schools.push(seed.school);
  }

  function resolveSchool(code) {
    const normalized = asTrimmed(code).toUpperCase();
    return tables.schools.find((row) => asTrimmed(row.code ?? row.schoolCode).toUpperCase() === normalized) ?? null;
  }

  function resolveSchoolCountryCode(school) {
    const code = asTrimmed(school.code ?? school.schoolCode).toUpperCase();
    const prefix = code.split("-")[0];
    if (/^[A-Z]{2}$/.test(prefix)) return prefix;
    return asTrimmed(school.countryCode ?? school.country_code ?? "CD").toUpperCase();
  }

  const auditLog = [];

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
        return {
          id: school.id,
          school_code: asTrimmed(school.code ?? school.schoolCode).toUpperCase(),
          name: school.name,
          country_id: school.countryId ?? school.country_id ?? "country-seed",
          country_code: resolveSchoolCountryCode(school),
          country_name: school.country ?? school.country_name ?? "RDC",
        };
      },
      async getUserById(id) {
        const row = tables.users.find((user) => user.id === id || user.user_code === id);
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        return {
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
          country_code: school?.countryCode ?? "CD",
          country_name: school?.country ?? "RDC",
        };
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
      async lockUserById(id) {
        return this.getUserById(id);
      },
      async listActiveUserRoleKeys(userId) {
        return tables.userRoles
          .filter((row) => row.user_id === userId && row.status === "active" && !row.revoked_at)
          .map((row) => row.role_key);
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
              birthDate: user.birth_date ? String(user.birth_date).slice(0, 10) : "",
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
        const codes = generateNextTeacherCodes(row.schoolCode, [
          ...tables.teachers.map((item) => item.teacher_code),
          ...(seedData.teachers ?? []).map((item) => item.publicId ?? item.identifier ?? item.id),
        ]);
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
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "",
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
      async getStudentById(id) {
        return (
          tables.students.find(
            (student) => student.id === id || student.student_code === id || student.studentCode === id,
          ) ?? null
        );
      },
      async getRelationByContactAndStudent(contactId, studentId) {
        const row = tables.relations.find(
          (relation) => relation.contact_id === contactId && relation.student_id === studentId,
        );
        if (!row) return null;
        const school = tables.schools.find((item) => item.id === row.school_id);
        return { ...row, school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "" };
      },
      async insertRelation(row) {
        const existing = tables.relations.find(
          (relation) => relation.contact_id === row.contactId && relation.student_id === row.studentId,
        );
        if (existing) return this.getRelationByContactAndStudent(row.contactId, row.studentId);
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
        return this.getRelationByContactAndStudent(row.contactId, row.studentId);
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
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "",
          sender_phone: sender?.phone ?? "",
        };
      },
      async isConversationParticipant(conversationId, userId) {
        return tables.participants.some(
          (item) => item.conversation_id === conversationId && item.user_id === userId,
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
        return { ...row, school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "" };
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
          published_at: new Date(),
          status: row.status,
          profile_payload: row.profile ?? {},
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
      async recordClientsAudit(entry) {
        auditLog.push({ ...entry });
      },
    };
  }

  const txApi = bind();
  const store = {
    bind,
    getSchoolByCode: (code) => txApi.getSchoolByCode(code),
    getUserById: (id) => txApi.getUserById(id),
    withTransaction(fn) {
      return fn(txApi);
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
            school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
            country_code: school?.countryCode ?? "CD",
            country_name: school?.country ?? "RDC",
          },
          roleKeys,
        );
      });
      const contacts = tables.contacts.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        return mapContactRow({
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "",
          school_name: school?.name ?? "",
        });
      });
      const relations = tables.relations.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        return mapRelationRow({ ...row, school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "" });
      });
      const messages = tables.messages.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        const sender = tables.users.find((user) => user.id === row.sender_user_id);
        const read = tables.reads.find((item) => item.message_id === row.id);
        return mapMessageRow({
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "",
          sender_phone: sender?.phone ?? "",
          read_at: read?.read_at,
        });
      });
      const announcements = tables.announcements.map((row) => {
        const school = tables.schools.find((item) => item.id === row.school_id);
        return mapAnnouncementRow({
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "",
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
        const teacher = tables.teachers.find((item) => item.user_id === row.id);
        const account = mapUserRowToAuthAccount({
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
          country_code: school?.countryCode ?? "CD",
          country_name: school?.country ?? "RDC",
        });
        const hydrated = userRoleLifecycleService.hydrateUser(
          {
            ...row,
            school_code: account.schoolCode,
            country_code: account.countryCode,
            country_name: account.countryScope,
          },
          roleKeys,
        );
        const teacherLogin = String(teacher?.teacher_code ?? "").match(/(ENS-\d+)$/i)?.[1]?.toUpperCase() ?? "";
        return {
          ...account,
          ...hydrated,
          passwordHash: account.passwordHash,
          pinHash: account.pinHash,
          mustChangePassword: account.mustChangePassword,
          hasTemporaryPassword: account.hasTemporaryPassword,
          identifier: teacherLogin || account.identifier,
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
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
          country_code: school?.countryCode ?? "CD",
          country_name: school?.country ?? "RDC",
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
        school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
        country_code: school?.countryCode ?? "CD",
        country_name: school?.country ?? "RDC",
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
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
          country_code: school?.countryCode ?? "CD",
          country_name: school?.country ?? "RDC",
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
        school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
        country_code: school?.countryCode ?? "CD",
        country_name: school?.country ?? "RDC",
      });
    },
    createUser: (...args) => clientsService.createUser(store, ...args),
    updateUser: (...args) => clientsService.updateUser(store, ...args),
    grantUserRole: (...args) => userRoleLifecycleService.grantRole(store, ...args),
    revokeUserRole: (...args) => userRoleLifecycleService.revokeRole(store, ...args),
    listAssignableUserRoles: (...args) =>
      userRoleLifecycleService.listAssignableRolesForPrincipal(store, ...args),
    createContact: (...args) => clientsService.createContact(store, ...args),
    updateContact: (...args) => clientsService.updateContact(store, ...args),
    provisionContactAccount: (...args) => clientsService.provisionContactAccount(store, ...args),
    createRelation: (...args) => clientsService.createRelation(store, ...args),
    sendMessage: (...args) => clientsService.sendMessage(store, ...args),
    markMessageRead: (...args) => clientsService.markMessageRead(store, ...args),
    createAnnouncement: (...args) => clientsService.createAnnouncement(store, ...args),
    updateAnnouncement: (...args) => clientsService.updateAnnouncement(store, ...args),
    archiveAnnouncement: (...args) => clientsService.archiveAnnouncement(store, ...args),
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
