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
  BATCH_PREPARE_TTL_MS,
  BATCH_ERROR,
  nextBatchStatus,
} = require("./studentCardBatchIssue");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");
const { STUDENT_CARD_BATCHES_SCHEMA_SQL } = require("../db/studentCardBatchesSchema");

const SERVER = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const rbac = new RbacService();

const ROUTES = [
  ["POST", "/api/classes/:classCode/student-cards/batches", "prepareClassCardBatch"],
  ["GET", "/api/classes/:classCode/student-cards/batches/:batchId", "readClassCardBatch"],
  ["POST", "/api/classes/:classCode/student-cards/batches/:batchId/receipt", "recordBatchReceipt"],
  ["POST", "/api/classes/:classCode/student-cards/batches/:batchId/activate", "activateClassCardBatch"],
  ["POST", "/api/classes/:classCode/student-cards/batches/:batchId/abort", "abortClassCardBatch"],
];

function routeSlice(marker, nextMarker) {
  const start = SERVER.indexOf(marker);
  const end = SERVER.indexOf(nextMarker, start + marker.length);
  assert.ok(start >= 0 && end > start, marker);
  return SERVER.slice(start, end);
}

test("le socle des cartes ne crée pas les lots, le boot canonique les applique après classes", () => {
  assert.doesNotMatch(STUDENT_ACCESS_CARDS_SCHEMA_SQL, /student_card_batches/);
  assert.doesNotMatch(STUDENT_ACCESS_CARDS_SCHEMA_SQL, /REFERENCES classes/);
  assert.match(STUDENT_CARD_BATCHES_SCHEMA_SQL, /REFERENCES classes\(id\)/);
  assert.match(STUDENT_CARD_BATCHES_SCHEMA_SQL, /student_card_batch_items_student_tenant_fk/);
  assert.match(STUDENT_CARD_BATCHES_SCHEMA_SQL, /student_card_batch_items_card_tenant_fk/);
  assert.match(STUDENT_CARD_BATCHES_SCHEMA_SQL, /student_card_batches_one_open_per_class/);
  const repo = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  const schemaIdx = repo.indexOf("await this.query(schema)");
  const cardsIdx = repo.indexOf("ensureStudentAccessCardsCanonicalSchema");
  const batchesIdx = repo.indexOf("ensureStudentCardBatchesCanonicalSchema");
  assert.ok(schemaIdx > 0 && cardsIdx > schemaIdx && batchesIdx > cardsIdx);
});

test("préparation QR : durée maximale de 30 minutes", () => {
  assert.equal(BATCH_PREPARE_TTL_MS, 30 * 60 * 1000);
});

test("transitions de lot : réception, sauvegarde et activation restent distinctes", () => {
  const expected = {
    "prepared:technical": "received",
    "prepared:saved": BATCH_ERROR.RECEIPT_REQUIRED,
    "prepared:activate": BATCH_ERROR.SAVE_REQUIRED,
    "prepared:abort": "aborted",
    "prepared:expire": "expired",
    "received:technical": "received",
    "received:saved": "saved",
    "received:activate": BATCH_ERROR.SAVE_REQUIRED,
    "received:abort": "aborted",
    "received:expire": "expired",
    "saved:technical": "saved",
    "saved:saved": "saved",
    "saved:activate": "activated",
    "saved:abort": "aborted",
    "saved:expire": "expired",
    "activated:technical": "activated",
    "activated:saved": "activated",
    "activated:activate": "activated",
    "activated:abort": BATCH_ERROR.ACTIVATED,
    "activated:expire": "activated",
    "expired:technical": BATCH_ERROR.EXPIRED,
    "expired:saved": BATCH_ERROR.EXPIRED,
    "expired:activate": BATCH_ERROR.EXPIRED,
    "expired:abort": BATCH_ERROR.EXPIRED,
    "expired:expire": "expired",
    "aborted:technical": BATCH_ERROR.EXPIRED,
    "aborted:saved": BATCH_ERROR.EXPIRED,
    "aborted:activate": BATCH_ERROR.EXPIRED,
    "aborted:abort": "aborted",
    "aborted:expire": "aborted",
  };
  for (const [key, value] of Object.entries(expected)) {
    const [status, action] = key.split(":");
    assert.equal(nextBatchStatus(status, action), value, key);
  }
  assert.equal(nextBatchStatus("prepared", "unknown"), BATCH_ERROR.NOT_FOUND);
  assert.equal(nextBatchStatus("missing", "activate"), BATCH_ERROR.NOT_FOUND);
});

test("routes de lot : auth, permission, no-store, sans idempotence ni émission unitaire", () => {
  const markers = ROUTES.map(([method, route]) => {
    const verb = method === "GET" ? "app.get" : "app.post";
    return `${verb}("${route}"`;
  });
  markers.push('app.get("/api/students/:id/cards"');
  for (let index = 0; index < ROUTES.length; index += 1) {
    const [method, route, fn] = ROUTES[index];
    const slice = routeSlice(markers[index], markers[index + 1]);
    const key = `${method} ${route}`;
    assert.match(slice, /requireAuth/);
    assert.match(slice, new RegExp(`requirePermission\\("${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`));
    assert.match(slice, /Cache-Control", "no-store"/);
    assert.match(slice, new RegExp(fn));
    assert.doesNotMatch(slice, /withIdempotency/);
    assert.doesNotMatch(slice, /issueStudentCard/);
    assert.doesNotMatch(slice, /failAfterInsert|failBeforeCommit/);
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(key), true, key);
    const writer = {
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Élèves:UPDATE", "Gérer élèves"],
      schoolCode: "CD-BAT-26-001",
    };
    const reader = {
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      permissions: ["Paiements:READ"],
      schoolCode: "CD-BAT-26-001",
    };
    const superadmin = {
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      permissions: ["ALL_PRIVILEGES", "Élèves:UPDATE"],
      schoolCode: "CD-BAT-26-001",
    };
    assert.equal(rbac.canAccess(writer, key), true, key);
    assert.equal(rbac.canAccess(reader, key), false, key);
    assert.equal(isPlatformPersonalDataForbidden(superadmin, key), true, key);
    assert.equal(rbac.canAccess(superadmin, key), false, key);
  }
  const prepare = routeSlice(markers[0], markers[1]);
  assert.doesNotMatch(prepare, /req\.body/);
  assert.match(prepare, /result\.batchId \? 201 : 200/);
  const receipt = routeSlice(markers[2], markers[3]);
  const activate = routeSlice(markers[3], markers[4]);
  assert.match(receipt, /req\.body/);
  assert.match(activate, /req\.body/);
});
