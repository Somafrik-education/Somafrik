"use strict";

/**
 * P1-03 — Messages scolaires fail-closed. Superadmin n'est pas un Admin School.
 *
 *   node --test backend/lib/communicationsMessages.p1-03.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const { isPlatformPersonalDataForbidden } = require("./platformPersonalDataGuard");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { resolveFinanceSchoolScope } = require("./financeSchoolScope");
const {
  listConversations,
  listAuthorizedRecipients,
  unreadCount,
  getConversation,
  resolveWritableSchoolCode,
} = require("./communicationsMessagesService");
const { PLATFORM_PERSONAL_DATA_DENY } = require("./platformPersonalDataGuard");

const SCHOOL_A = "CD-2026-0001";
const SCHOOL_B = "BI-2026-0001";

const SUPER = {
  sub: "user-super",
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};

function expectDenied(error, status = 403) {
  return error?.statusCode === status;
}

function schoolStore() {
  return {
    getSchoolByCode: async (code) => {
      const normalized = String(code ?? "").toUpperCase();
      if (normalized === SCHOOL_A) return { id: "school-a", school_code: SCHOOL_A, country_code: "CD" };
      if (normalized === SCHOOL_B) return { id: "school-b", school_code: SCHOOL_B, country_code: "BI" };
      return null;
    },
    listConversationsForUser: async ({ schoolId }) => {
      if (schoolId === "school-a") {
        return [{ id: "conv-a", school_code: SCHOOL_A, school_id: "school-a", status: "active" }];
      }
      if (schoolId === "school-b") {
        return [{ id: "conv-b", school_code: SCHOOL_B, school_id: "school-b", status: "active" }];
      }
      return [{ id: "conv-leak", school_code: "*", school_id: "*" }];
    },
    getConversationById: async (id) => {
      if (id === "conv-a") return { id: "conv-a", school_id: "school-a", school_code: SCHOOL_A, status: "active" };
      if (id === "conv-b") return { id: "conv-b", school_id: "school-b", school_code: SCHOOL_B, status: "active" };
      return null;
    },
    isConversationParticipant: async () => true,
    listConversationParticipants: async () => [],
    listSchoolUsers: async (schoolId) => {
      if (schoolId === "school-a") return [{ id: "recv-a", role: "Parent", first_name: "A", last_name: "Parent" }];
      if (schoolId === "school-b") return [{ id: "recv-b", role: "Parent", first_name: "B", last_name: "Parent" }];
      return [{ id: "recv-all", role: "Parent" }];
    },
    getUserById: async (id) => ({ id, role: "Admin School", school_id: "school-a" }),
    listActiveRoleKeys: async () => ["SCHOOL_ADMIN"],
    countUnreadForUser: async (_userId, schoolId) => (schoolId === "school-a" ? 3 : 99),
  };
}

test("P1-03 aucun principal → Messages refusés", async () => {
  await assert.rejects(() => listConversations(schoolStore(), null, {}), expectDenied);
  await assert.rejects(() => listAuthorizedRecipients(schoolStore(), undefined, {}), expectDenied);
  await assert.rejects(() => unreadCount(schoolStore(), "", {}), expectDenied);
  assert.throws(() => resolveWritableSchoolCode(null, { effectiveSchoolCode: SCHOOL_A }), expectDenied);
});

test("P1-03 Superadmin sans scope établissement → aucune donnée scolaire", async () => {
  await assert.rejects(() => listConversations(schoolStore(), SUPER, {}), (error) => {
    return error.statusCode === 403 && error.code === PLATFORM_PERSONAL_DATA_DENY;
  });
  await assert.rejects(() => unreadCount(schoolStore(), SUPER, {}), expectDenied);
});

test("P1-03 Superadmin avec établissement sélectionné → refus total (pas une capacité plateforme)", async () => {
  await assert.rejects(
    () => listConversations(schoolStore(), SUPER, { effectiveSchoolCode: SCHOOL_A }),
    (error) => error.statusCode === 403 && error.code === PLATFORM_PERSONAL_DATA_DENY,
  );
  await assert.rejects(
    () => listAuthorizedRecipients(schoolStore(), { ...SUPER, schoolCode: SCHOOL_A }, {}),
    expectDenied,
  );
});

test("P1-03 ALL_PRIVILEGES seul → aucun accès global Messages", async () => {
  const principal = { sub: "priv", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" };
  assert.equal(isSuperAdminPrincipal(principal), false);
  assert.throws(() => resolveWritableSchoolCode(principal, {}), expectDenied);
  await assert.rejects(() => listConversations(schoolStore(), principal, {}), expectDenied);
});

test("P1-03 schoolCode \"*\" seul → aucun accès global", async () => {
  const principal = { sub: "star", role: "Admin School", schoolCode: "*" };
  assert.throws(() => resolveWritableSchoolCode(principal, { effectiveSchoolCode: SCHOOL_A }), expectDenied);
  await assert.rejects(() => listConversations(schoolStore(), principal, { effectiveSchoolCode: SCHOOL_A }), expectDenied);
});

test("P1-03 Admin School A → Messages A autorisés", async () => {
  const adminA = {
    sub: "admin-a",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: SCHOOL_A,
    permissions: ["Messages:READ"],
  };
  const listed = await listConversations(schoolStore(), adminA, {});
  assert.deepEqual(
    listed.items.map((row) => row.id),
    ["conv-a"],
  );
  const recipients = await listAuthorizedRecipients(schoolStore(), adminA, {});
  assert.equal(
    recipients.items.some((row) => row.userId === "recv-b"),
    false,
  );
  const unread = await unreadCount(schoolStore(), adminA, {});
  assert.equal(unread.count, 3);
});

test("P1-03 Admin School A → Messages B refusés", async () => {
  const adminA = {
    sub: "admin-a",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: SCHOOL_A,
  };
  assert.equal(
    resolveWritableSchoolCode(adminA, { effectiveSchoolCode: SCHOOL_B }),
    SCHOOL_A,
    "schoolCode / effectiveSchoolCode client ignorés ; JWT A fait autorité",
  );
  const listed = await listConversations(schoolStore(), adminA, { effectiveSchoolCode: SCHOOL_B });
  assert.deepEqual(
    listed.items.map((row) => row.id),
    ["conv-a"],
  );
  await assert.rejects(() => getConversation(schoolStore(), "conv-b", adminA, {}), (error) => {
    return error.statusCode === 403 || error.statusCode === 404;
  });
});

test("P1-03 utilisateur scolaire autorisé A → périmètre A uniquement", async () => {
  const teacher = {
    sub: "teacher-a",
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: SCHOOL_A,
    permissions: ["Messages:READ", "Messages:CREATE"],
  };
  const listed = await listConversations(schoolStore(), teacher, {});
  assert.equal(listed.items.every((row) => row.schoolCode === SCHOOL_A), true);
  assert.equal(resolveWritableSchoolCode(teacher, { schoolCode: SCHOOL_B }), SCHOOL_A);
});

test("P1-03 Admin Pays non reconnu comme lecteur Messages scolaires", async () => {
  const country = {
    sub: "country",
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
    permissions: ["COUNTRY_PRIVILEGES"],
    schoolCode: "*",
    countryCode: "CD",
  };
  await assert.rejects(
    () => listConversations(schoolStore(), country, { effectiveSchoolCode: SCHOOL_A }),
    expectDenied,
  );
});

test("P1-03 unification P1-02 / Finance P1-01 / PII P0 inchangés", () => {
  const rbac = new RbacService();
  assert.equal(isSuperAdminPrincipal(SUPER), true);
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/students"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/students"), false);
  assert.equal(rbac.canAccess(SUPER, "GET /api/backoffice/conversations"), false);
  assert.equal(rbac.canAccess(SUPER, "GET /api/finance/fee-grids"), false);
  assert.equal(resolveFinanceSchoolScope(SUPER).mode, "none");
});

test("garde source : SUPER_ADMIN / schoolCode * ne deviennent pas all messages", () => {
  const source = fs.readFileSync(path.join(__dirname, "communicationsMessagesService.js"), "utf8");
  assert.match(source, /function denyPlatformSchoolMessages/);
  assert.match(source, /isPlatformAdminPrincipal\(principal\)/);
  assert.match(source, /Établissement requis \(effectiveSchoolCode\)/);
  assert.match(source, /function canBypassParticipation\(\) \{\s*return false;/);
  const bypass = source.slice(
    source.indexOf("function canBypassParticipation"),
    source.indexOf("async function listConversations"),
  );
  assert.match(bypass, /return false;/);
  assert.doesNotMatch(bypass, /return true;/);
  assert.doesNotMatch(source, /mode:\s*["']all["']/);
  assert.doesNotMatch(source, /SUPER_ADMIN[^\n]{0,80}all messages/i);
  assert.doesNotMatch(
    source.slice(source.indexOf("function resolveWritableSchoolCode"), source.indexOf("async function requireSchool")),
    /schoolCode === ["']\*["']\s*&&/,
  );
});
