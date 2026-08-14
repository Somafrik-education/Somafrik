"use strict";

const { randomUUID } = require("node:crypto");
const clientsService = require("../lib/clientsService");
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
          role: row.role,
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
          role: row.role,
          status: row.status,
          profile_payload: row.profile ?? existing.profile_payload,
          updated_at: new Date(),
        };
        return this.getUserById(id);
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
        return mapUserRow({
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
          country_code: school?.countryCode ?? "CD",
          country_name: school?.country ?? "RDC",
        });
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
        return mapUserRowToAuthAccount({
          ...row,
          school_code: school ? asTrimmed(school.code ?? school.schoolCode).toUpperCase() : "*",
          country_code: school?.countryCode ?? "CD",
          country_name: school?.country ?? "RDC",
        });
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
    createContact: (...args) => clientsService.createContact(store, ...args),
    updateContact: (...args) => clientsService.updateContact(store, ...args),
    provisionContactAccount: (...args) => clientsService.provisionContactAccount(store, ...args),
    createRelation: (...args) => clientsService.createRelation(store, ...args),
    sendMessage: (...args) => clientsService.sendMessage(store, ...args),
    markMessageRead: (...args) => clientsService.markMessageRead(store, ...args),
    createAnnouncement: (...args) => clientsService.createAnnouncement(store, ...args),
    updateAnnouncement: (...args) => clientsService.updateAnnouncement(store, ...args),
    archiveAnnouncement: (...args) => clientsService.archiveAnnouncement(store, ...args),
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
