"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RbacService } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  isPlatformPersonalDataForbidden,
} = require("./platformPersonalDataGuard");
const {
  STUDENT_CARD_CAPABILITY_HTTP_KEYS,
  projectStudentCardCapabilitiesHttp,
} = require("./studentCardCapabilities");

function mobileAttendanceScanEnabled(settings) {
  return settings?.studentCardEnabled === true
    && settings?.studentCardQrEnabled === true
    && settings?.studentCardAttendanceEnabled === true;
}

const ROOT = path.resolve(__dirname, "../..");
const rbac = new RbacService();
const ROUTE = "GET /api/student-cards/capabilities";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("CAP-09/10/12 — projection HTTP = 5 booléens fail-closed, sans PII", () => {
  assert.deepEqual([...STUDENT_CARD_CAPABILITY_HTTP_KEYS], [
    "studentCardEnabled",
    "studentCardQrEnabled",
    "studentCardNfcEnabled",
    "studentCardAttendanceEnabled",
    "studentCardFinanceCheckEnabled",
  ]);
  const empty = projectStudentCardCapabilitiesHttp(null);
  assert.deepEqual(empty, {
    studentCardEnabled: false,
    studentCardQrEnabled: false,
    studentCardNfcEnabled: false,
    studentCardAttendanceEnabled: false,
    studentCardFinanceCheckEnabled: false,
  });
  const invalid = projectStudentCardCapabilitiesHttp({
    student_card_enabled: "true",
    student_card_qr_enabled: 1,
    student_card_nfc_enabled: "yes",
    student_card_attendance_enabled: null,
    student_card_finance_check_enabled: undefined,
    school_code: "CD-LAC-26-001",
    name: "Lycée Secret",
    card_token: "pub.secret",
    amount: 15000,
  });
  assert.deepEqual(invalid, empty);
  assert.deepEqual(Object.keys(invalid), [...STUDENT_CARD_CAPABILITY_HTTP_KEYS]);
  const serialized = JSON.stringify(invalid);
  assert.equal(serialized.includes("CD-LAC"), false);
  assert.equal(serialized.includes("Lycée"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("15000"), false);
  assert.equal(invalid.studentCardNfcEnabled, false);
});

test("CAP-11 — master false + sous-flags true : DTO brut, Mobile fail-closed", () => {
  const dto = projectStudentCardCapabilitiesHttp({
    student_card_enabled: false,
    student_card_qr_enabled: true,
    student_card_nfc_enabled: true,
    student_card_attendance_enabled: true,
    student_card_finance_check_enabled: true,
  });
  assert.equal(dto.studentCardEnabled, false);
  assert.equal(dto.studentCardQrEnabled, true);
  assert.equal(dto.studentCardNfcEnabled, true);
  assert.equal(dto.studentCardAttendanceEnabled, true);
  assert.equal(mobileAttendanceScanEnabled(dto), false);
});

test("CAP-NFC — NFC projeté indépendamment du QR, fail-closed", () => {
  const on = projectStudentCardCapabilitiesHttp({
    student_card_enabled: true,
    student_card_qr_enabled: false,
    student_card_nfc_enabled: true,
    student_card_attendance_enabled: true,
  });
  assert.equal(on.studentCardNfcEnabled, true);
  assert.equal(on.studentCardQrEnabled, false);
  const off = projectStudentCardCapabilitiesHttp({
    student_card_enabled: true,
    student_card_nfc_enabled: 1,
  });
  assert.equal(off.studentCardNfcEnabled, false);
});

test("CAP-01/02/03/04/05 — RBAC Présences CREATE/UPDATE, pas Paramètres", () => {
  const update = {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    permissions: ["Présences:UPDATE"],
    schoolCode: "CD-LAC-26-001",
  };
  const create = { ...update, permissions: ["Présences:CREATE"] };
  const readOnly = { ...update, permissions: ["Présences:READ"] };
  const financeOnly = {
    role: "Comptable",
    roleKeys: ["ACCOUNTANT"],
    permissions: ["Impayés:READ", "Paiements:READ", "Frais & tarifs:READ"],
    schoolCode: "CD-LAC-26-001",
  };
  const settingsRead = {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    permissions: ["Paramètres Établissement:READ"],
    schoolCode: "CD-LAC-26-001",
  };
  const parent = {
    role: "Parent",
    roleKeys: ["PARENT"],
    permissions: ["Présences:READ", "Voir présences", "Voir enfant"],
    schoolCode: "CD-LAC-26-001",
  };
  const student = {
    role: "Élève / Étudiant",
    roleKeys: ["STUDENT"],
    permissions: ["Présences:READ"],
    schoolCode: "CD-LAC-26-001",
  };
  assert.equal(rbac.canAccess(update, ROUTE), true);
  assert.equal(rbac.canAccess(create, ROUTE), true);
  assert.equal(rbac.canAccess(readOnly, ROUTE), false);
  assert.equal(rbac.canAccess(financeOnly, ROUTE), false);
  assert.equal(rbac.canAccess(settingsRead, ROUTE), false);
  assert.equal(rbac.canAccess(parent, ROUTE), false);
  assert.equal(rbac.canAccess(student, ROUTE), false);
});

test("CAP-06/07 — Superadmin / Admin Pays refus school-domain", () => {
  const superadmin = {
    role: "Super Administrateur Somafrik",
    roleKeys: ["SUPER_ADMIN"],
    permissions: ["ALL_PRIVILEGES", "Présences:UPDATE"],
    schoolCode: "CD-LAC-26-001",
  };
  const pays = {
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
    permissions: ["COUNTRY_PRIVILEGES", "Présences:CREATE"],
    schoolCode: "CD-LAC-26-001",
    countryCode: "CD",
  };
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(ROUTE), true);
  assert.equal(isPlatformPersonalDataForbidden(superadmin, ROUTE), true);
  assert.equal(isPlatformPersonalDataForbidden(pays, ROUTE), true);
  assert.equal(rbac.canAccess(superadmin, ROUTE), false);
  assert.equal(rbac.canAccess(pays, ROUTE), false);
});

test("CAP source — GET capabilities aligné scan, pas school-settings", () => {
  const server = read("backend/server.js");
  const rbacSrc = read("backend/services/rbacService.js");
  const attendance = read("Mobile/src/screens/TeacherAttendanceScreen.tsx");
  const api = read("Mobile/src/services/studentCardScanApi.ts");
  assert.match(server, /app\.get\("\/api\/student-cards\/capabilities"/);
  assert.match(rbacSrc, /"GET \/api\/student-cards\/capabilities": \["Présences:CREATE", "Présences:UPDATE"\]/);
  assert.doesNotMatch(rbacSrc, /"GET \/api\/student-cards\/capabilities": \[[^\]]*Paramètres Établissement/);
  assert.match(api, /\/student-cards\/capabilities/);
  assert.doesNotMatch(api, /schoolCode/);
  assert.match(attendance, /getStudentCardCapabilities/);
  assert.doesNotMatch(attendance, /getSchoolSettings\(/);
});
