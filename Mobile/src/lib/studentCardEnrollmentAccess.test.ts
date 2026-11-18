import assert from "node:assert/strict";
import test from "node:test";
import { studentCardEnrollmentAccess } from "./studentCardEnrollmentAccess";

const school = (permissions: string[]) => ({
  role: "school_admin",
  roleKey: "SCHOOL_ADMIN",
  user: { role: "school_admin", roleKey: "SCHOOL_ADMIN" },
  permissions,
});

test("NFC panel is visible and writable with canonical Élèves CRUD grant", () => {
  assert.deepEqual(studentCardEnrollmentAccess(school(["Élèves:CRUD"])), { canRead: true, canUpdate: true });
});

test("NFC panel is read-only with canonical Élèves READ grant", () => {
  assert.deepEqual(studentCardEnrollmentAccess(school(["Élèves:READ"])), { canRead: true, canUpdate: false });
});

test("NFC panel remains hidden with no Élèves grant", () => {
  assert.deepEqual(studentCardEnrollmentAccess(school(["Notes:READ"])), { canRead: false, canUpdate: false });
});

test("NFC panel remains forbidden for parent and platform superadmin despite grants", () => {
  assert.deepEqual(studentCardEnrollmentAccess({
    role: "parent_student", roleKey: "PARENT",
    permissions: ["Élèves:CRUD"],
  }), { canRead: false, canUpdate: false });
  assert.deepEqual(studentCardEnrollmentAccess({
    role: "super_admin", roleKey: "SUPER_ADMIN",
    permissions: ["ALL_PRIVILEGES"],
  }), { canRead: false, canUpdate: false });
});

test("NFC panel remains hidden for missing session", () => {
  assert.deepEqual(studentCardEnrollmentAccess(null), { canRead: false, canUpdate: false });
});
