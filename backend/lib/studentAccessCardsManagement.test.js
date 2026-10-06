"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { RbacService } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  isPlatformPersonalDataForbidden,
} = require("./platformPersonalDataGuard");
const {
  STUDENT_CARD_ERROR,
  STUDENT_CARD_MEDIA,
  SECRET_BYTES,
  generateCardSecrets,
  assertSecretEntropy,
  normalizeMedium,
  mapCardListItem,
  mapIssuedCard,
  sanitizeAuditValue,
  assertNoSecretLeak,
  FORBIDDEN_AUDIT_KEYS,
} = require("./studentAccessCardsManagement");

const ROOT = path.resolve(__dirname, "../..");
const rbac = new RbacService();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("CARTE-PR2 — secret ≥128 bits, hash SHA-256, cardToken publicId.secret", () => {
  const generated = generateCardSecrets();
  assertSecretEntropy(generated);
  assert.equal(SECRET_BYTES >= 16, true);
  assert.equal(generated.secretBits >= 128, true);
  const secretBuf = Buffer.from(generated.secret, "base64url");
  assert.ok(secretBuf.length >= 16, `secret bytes=${secretBuf.length}`);
  assert.equal(crypto.createHash("sha256").update(generated.secret, "utf8").digest("hex"), generated.tokenHash);
  assert.equal(generated.cardToken, `${generated.publicId}.${generated.secret}`);
  assert.equal(generated.cardToken.split(".").length, 2);
  assert.doesNotMatch(generated.publicId, /@|\//);
  assert.notEqual(generated.publicId, generated.secret);
});

test("CARTE-PR2 — public_id n'est pas un UUID étudiant / compteur", () => {
  const samples = new Set(Array.from({ length: 8 }, () => generateCardSecrets().publicId));
  assert.equal(samples.size, 8);
  for (const publicId of samples) {
    assert.doesNotMatch(publicId, /^[0-9]+$/);
    assert.doesNotMatch(publicId, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  }
});

test("CARTE-PR2 — medium accepté uniquement nfc|qr|nfc_qr", () => {
  assert.deepEqual([...STUDENT_CARD_MEDIA], ["nfc", "qr", "nfc_qr"]);
  assert.equal(normalizeMedium("NFC_QR"), "nfc_qr");
  assert.throws(() => normalizeMedium("barcode"), (error) => error.code === STUDENT_CARD_ERROR.INVALID_MEDIUM);
});

test("CARTE-PR2 — DTO liste sans secret/hash/token, DTO émission avec token une fois", () => {
  const row = {
    id: "card-1",
    public_id: "pub",
    token_hash: "a".repeat(64),
    medium: "qr",
    status: "active",
    issued_at: "2026-01-01T00:00:00.000Z",
    revoked_at: null,
    revoke_reason: null,
    replaced_by_card_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const listed = mapCardListItem(row);
  assert.equal(listed.publicId, "pub");
  assert.equal(Object.hasOwn(listed, "cardToken"), false);
  assert.equal(Object.hasOwn(listed, "token_hash"), false);
  assert.equal(Object.hasOwn(listed, "secret"), false);
  const issued = mapIssuedCard(row, "pub.secretvalue");
  assert.equal(issued.cardToken, "pub.secretvalue");
  assert.equal(Object.hasOwn(issued, "token_hash"), false);
});

test("CARTE-PR2 — audit sanitize retire secret/hash/token", () => {
  const cleaned = sanitizeAuditValue({
    cardId: "c1",
    secret: "leak",
    cardToken: "pub.leak",
    token_hash: "abc",
    tokenHash: "abc",
    status: "active",
  });
  assert.equal(cleaned.cardId, "c1");
  assert.equal(cleaned.status, "active");
  assert.equal(cleaned.secret, undefined);
  assert.equal(cleaned.cardToken, undefined);
  assert.equal(cleaned.token_hash, undefined);
  assertNoSecretLeak(cleaned, "audit.newValue");
  for (const key of FORBIDDEN_AUDIT_KEYS) {
    assert.equal(Object.hasOwn(cleaned, key), false, key);
  }
});

test("CARTE-PR2 — RBAC Élèves:READ liste, Élèves:UPDATE mutations, pas de module Cartes", () => {
  const reader = {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    permissions: ["Élèves:READ", "Voir élèves"],
    schoolCode: "CD-LAC-26-001",
  };
  const writer = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Élèves:UPDATE", "Gérer élèves"],
    schoolCode: "CD-LAC-26-001",
  };
  const none = {
    role: "Comptable",
    roleKeys: ["ACCOUNTANT"],
    permissions: ["Paiements:READ"],
    schoolCode: "CD-LAC-26-001",
  };
  assert.equal(rbac.canAccess(reader, "GET /api/students/:id/cards"), true);
  assert.equal(rbac.canAccess(none, "GET /api/students/:id/cards"), false);
  assert.equal(rbac.canAccess(writer, "POST /api/student-cards"), true);
  assert.equal(rbac.canAccess(reader, "POST /api/student-cards"), false);
  assert.equal(rbac.canAccess(none, "POST /api/student-cards/:id/lost"), false);
  assert.equal(rbac.canAccess(writer, "POST /api/student-cards/:id/replace"), true);
});

test("CARTE-PR2 — Superadmin / Admin Pays refusés même avec ALL_PRIVILEGES", () => {
  const routes = [
    "GET /api/students/:id/cards",
    "POST /api/student-cards",
    "POST /api/student-cards/:id/lost",
    "POST /api/student-cards/:id/revoke",
    "POST /api/student-cards/:id/replace",
    "POST /api/student-cards/scan",
  ];
  const superadmin = {
    role: "Super Administrateur Somafrik",
    roleKeys: ["SUPER_ADMIN"],
    permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"],
    schoolCode: "CD-LAC-26-001",
  };
  const pays = {
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
    permissions: ["COUNTRY_PRIVILEGES", "Élèves:UPDATE"],
    schoolCode: "CD-LAC-26-001",
    countryCode: "CD",
  };
  for (const route of routes) {
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(superadmin, route), true, route);
    assert.equal(rbac.canAccess(superadmin, route), false, route);
    assert.equal(rbac.canAccess(pays, route), false, route);
  }
});

test("CARTE-PR3 — scan Présences CREATE/UPDATE, pas de module Cartes ni ALL_PRIVILEGES", () => {
  const server = read("backend/server.js");
  const rbacSrc = read("backend/services/rbacService.js");
  const catalog = read("backend/lib/functionalModulesCatalog.js");
  const presences = read("backend/lib/presencesAttendanceAuthz.js");
  const finance = read("backend/lib/financeRbacRouteMatrix.js");
  const teacher = {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    permissions: ["Présences:CREATE"],
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
    permissions: ["Présences:READ", "Voir présences"],
    schoolCode: "CD-LAC-26-001",
  };
  assert.equal(rbac.canAccess(teacher, "POST /api/student-cards/scan"), true);
  assert.equal(rbac.canAccess({ ...teacher, permissions: ["Présences:UPDATE"] }, "POST /api/student-cards/scan"), true);
  assert.equal(rbac.canAccess(parent, "POST /api/student-cards/scan"), false);
  assert.equal(rbac.canAccess(student, "POST /api/student-cards/scan"), false);
  assert.equal(rbac.canAccess({ ...teacher, permissions: ["Élèves:UPDATE", "ALL_PRIVILEGES"] }, "POST /api/student-cards/scan"), false);
  assert.match(server, /app\.post\("\/api\/student-cards\/scan"/);
  assert.doesNotMatch(rbacSrc, /Cartes:|QR:READ|NFC:READ/);
  assert.doesNotMatch(catalog, /Carte Élève|moduleKey: "cards"/);
  assert.doesNotMatch(presences, /student_access_cards|cardToken/);
  assert.doesNotMatch(finance, /student_access_cards|cardToken|student-cards/);
});
