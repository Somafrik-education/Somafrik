"use strict";

// Tests de régression au niveau du service. Ne remplacent PAS les tests HTTP/PostgreSQL (§5.1).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createRequire } = require("node:module");

const sourcePath = path.join(__dirname, "communicationsNotificationsService.js");
const realRequire = createRequire(sourcePath);
const SCHOOL = "00000000-0000-4000-8000-000000000001";
const OTHER_SCHOOL = "00000000-0000-4000-8000-000000000002";
const NOTIFICATION = "00000000-0000-4000-8000-000000000003";
const ATTACHMENT = "00000000-0000-4000-8000-000000000004";

function loadService() {
  const mocks = {
    "./clientsManagement": {
      CLIENTS_ERROR: { FORBIDDEN: "FORBIDDEN" },
      asTrimmed: (v) => String(v ?? "").trim(),
      createClientsError: (status, message) => Object.assign(new Error(message), { statusCode: status }),
      formatDateTime: (v) => String(v),
      ignoreClientScope: (v) => v,
    },
    "./communicationsMessagesService": {
      requireSchool: async (store) => ({ school: { id: store.schoolId }, schoolCode: "S1", tx: store }),
      actorUserId: (principal) => principal.userId,
      displayName: () => "Auteur",
    },
    "./communicationsAttachments": {
      validateUploadBuffer: () => {}, persistAttachmentBytes: () => {},
      removeStoredAttachment: () => {}, readAttachmentBytes: async () => Buffer.from("test"),
      mapAttachmentRow: (r) => r,
    },
    "./communicationsPreferences": { enabledChannelsForUser: async () => ["IN_APP"] },
    "./communicationsNavigationTargets": { sanitizeNavigationTargets: async (_tx, _school, rows) => rows },
    "./communicationsPaymentDueEligibility": { isPaymentDueEligible: () => true },
    "./schoolNotificationPolicy": {
      resolveAllowedChannels: () => ["IN_APP"],
      getSchoolPolicyEventsBySchoolId: async () => ({}),
      isSchoolWideRecipientKind: () => false,
      recipientCategoriesFromContext: () => [],
      resolveUserRecipientCategories: async () => [],
      expandSchoolWideRecipientKinds: async () => [],
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), {
    require: (name) => mocks[name] ?? realRequire(name),
    module: mod, exports: mod.exports, Buffer, console, process, setTimeout, clearTimeout,
  }, { filename: sourcePath });
  return mod.exports;
}

function makeStore({ viewer, recipient = "parent", author = "admin", eventType = "attendance.student.absent", schoolId = SCHOOL }) {
  const row = {
    id: NOTIFICATION, school_id: SCHOOL, school_code: "S1",
    event_type: eventType, sender_user_id: author, recipient_kind: "parent",
    recipient_user_id: viewer === recipient ? viewer : null,
    title: "Absence", body: "Information privée", navigation_target: {},
  };
  const calls = [];
  const store = {
    schoolId, calls,
    getAttachmentById: async () => ({
      id: ATTACHMENT, school_id: SCHOOL, entity_type: "notification",
      entity_id: NOTIFICATION, status: "attached", storage_key: "dummy", file_name: "x.txt",
      mime_type: "text/plain",
    }),
    one: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes("SELECT n.*, s.school_code")) {
        assert.match(sql, /r\.user_id AS recipient_user_id/);
        assert.match(sql, /r\.school_id = n\.school_id/);
        return args[2] === SCHOOL ? row : null;
      }
      if (sql.includes("SELECT 1 FROM communication_notifications n")) {
        assert.match(sql, /r\.user_id IS NOT NULL/);
        assert.match(sql, /n\.event_type = 'notification\.manual'/);
        assert.match(sql, /n\.sender_user_id = \$2::uuid/);
        return schoolId === SCHOOL && (viewer === recipient || (eventType === "notification.manual" && viewer === author))
          ? { ok: 1 } : null;
      }
      throw new Error("Unexpected SQL in P0 regression probe");
    },
  };
  return store;
}

for (const role of ["SCHOOL_ADMIN", "SECRETARY", "PREFET_ETUDES"]) {
  test(`P0-01 — ${role} non destinataire ne peut pas lire une notification privée`, async () => {
    const service = loadService();
    const principal = { userId: "admin", role, permissions: ["Notifications:UPDATE", "ALL_PRIVILEGES"] };
    await assert.rejects(
      service.get(makeStore({ viewer: "admin" }), NOTIFICATION, principal),
      (err) => err.statusCode === 404,
    );
  });
}

test("P0-01 — le destinataire peut lire sa notification même non lue", async () => {
  const service = loadService();
  const item = await service.get(makeStore({ viewer: "parent" }), NOTIFICATION, { userId: "parent" });
  assert.equal(item.id, NOTIFICATION);
  assert.equal(item.body, "Information privée");
});

test("P0-01 — l'auteur ne voit que ses propres notifications manuelles", async () => {
  const service = loadService();
  const principal = { userId: "admin", permissions: ["Notifications:UPDATE"] };
  const manual = makeStore({ viewer: "admin", eventType: "notification.manual" });
  assert.equal((await service.get(manual, NOTIFICATION, principal)).id, NOTIFICATION);
  await assert.rejects(service.get(makeStore({ viewer: "admin" }), NOTIFICATION, principal),
    (err) => err.statusCode === 404);
});

test("P0-01 — autre établissement : aucun détail", async () => {
  const service = loadService();
  await assert.rejects(
    service.get(makeStore({ viewer: "parent", schoolId: OTHER_SCHOOL }), NOTIFICATION, { userId: "parent" }),
    (err) => err.statusCode === 404,
  );
});

test("P0-01 — pièce jointe refusée au gestionnaire non destinataire", async () => {
  const service = loadService();
  const principal = { userId: "admin", permissions: ["Notifications:UPDATE"] };
  await assert.rejects(
    service.downloadAttachment(makeStore({ viewer: "admin" }), ATTACHMENT, principal),
    (err) => err.statusCode === 404,
  );
});

test("P0-01 — pièce jointe autorisée au destinataire ou à son auteur manuel", async () => {
  const service = loadService();
  const recipient = await service.downloadAttachment(makeStore({ viewer: "parent" }), ATTACHMENT, { userId: "parent" });
  assert.equal(recipient.fileName, "x.txt");
  const author = await service.downloadAttachment(
    makeStore({ viewer: "admin", eventType: "notification.manual" }),
    ATTACHMENT, { userId: "admin" },
  );
  assert.equal(author.fileName, "x.txt");
});
