"use strict";

/**
 * MONO-T1 / F — communication (serveur réel, base jetable, démo seed).
 *
 * Messages (participants), annonces établissement, notifications
 * plateforme : autorisé, anonyme, permission insuffisante,
 * interétablissement (participants et lectures), entrée invalide, absence
 * d'écriture en cas de refus.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
const ids = {};
let messageId = null;
let announcementId = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_communication_it", port: 19966 });
  await server.assertActiveSubscriptionPrecondition();
  const byEmail = async (email) => (await server.one("SELECT id FROM users WHERE email = $1", [email])).id;
  ids.parent = await byEmail("parent.dupont@example.com");
  ids.biAdmin = await byEmail("admin@bujumbura.somafrik");
});

after(async () => {
  if (server) await server.stop();
});

const messagesSnapshot = () => server.snapshot("SELECT id FROM school_messages ORDER BY id");

test("messages : envoi autorisé vers un parent de l'établissement ; le destinataire le lit, BI ne le voit pas", { skip }, async () => {
  const sent = await server.request("POST", "/api/backoffice/messages", {
    token: await server.login("cdAdmin"),
    body: { message: "MONO-T1 admin vers parent", participantUserIds: [ids.parent] },
  });
  assertStatus(sent, 201, "envoi admin CD → parent CD");
  messageId = sent.data.id;
  const parentInbox = await server.request("GET", "/api/backoffice/messages", { token: await server.login("cdParent") });
  assertStatus(parentInbox, 200, "boîte du parent");
  assert.ok(parentInbox.data.some((message) => message.id === messageId), "le parent lit le message");
  const biInbox = await server.request("GET", "/api/backoffice/messages", { token: await server.login("biAdmin") });
  assertStatus(biInbox, 200, "boîte BI");
  assert.ok(!biInbox.data.some((message) => message.id === messageId), "BI ne voit pas le message de CD");
  const biRead = await server.request("GET", `/api/backoffice/messages/${messageId}`, { token: await server.login("biAdmin") });
  assertStatus(biRead, [403, 404], "lecture directe depuis BI");
});

test("messages refusés : participant d'un autre établissement (dans les deux sens), vide, sans destinataire, parent, anonyme — sans écriture", { skip }, async () => {
  const before = await messagesSnapshot();
  const refusals = [
    ["BI → parent CD", "biAdmin", { message: "x", participantUserIds: [ids.parent] }, 403, "FORBIDDEN"],
    ["CD → admin BI", "cdAdmin", { message: "x", participantUserIds: [ids.biAdmin] }, 403, "FORBIDDEN"],
    ["message vide", "cdAdmin", { message: "  ", participantUserIds: [ids.parent] }, 400, undefined],
    ["sans destinataire", "cdAdmin", { message: "x", participantUserIds: [] }, 400, undefined],
    ["parent (envoi interdit)", "cdParent", { message: "x", participantUserIds: [ids.parent] }, 403, "PERMISSION_DENIED"],
    ["anonyme", null, { message: "x", participantUserIds: [ids.parent] }, 401, undefined],
  ];
  for (const [label, account, body, status, code] of refusals) {
    const response = await server.request("POST", "/api/backoffice/messages", { token: account && (await server.login(account)), body });
    assertStatus(response, status, label);
    if (code) assert.equal(response.data.code, code, label);
  }
  assert.equal(await messagesSnapshot(), before, "aucun message écrit après refus");
});

test("annonces : publication admin visible du parent de l'établissement, pas de BI ; enseignant/invalide/anonyme refusés", { skip }, async () => {
  const before = await server.snapshot("SELECT count(*)::int AS n FROM announcements");
  const refusals = [
    ["enseignant", "cdTeacher", { title: "x", message: "y", audience: "Tous" }, 403],
    ["titre vide", "cdAdmin", { title: "  ", message: "y", audience: "Tous" }, 400],
    ["message vide", "cdAdmin", { title: "x", message: "  ", audience: "Tous" }, 400],
    ["anonyme", null, { title: "x", message: "y", audience: "Tous" }, 401],
  ];
  for (const [label, account, body, status] of refusals) {
    assertStatus(await server.request("POST", "/api/backoffice/announcements", { token: account && (await server.login(account)), body }), status, label);
  }
  assert.equal(await server.snapshot("SELECT count(*)::int AS n FROM announcements"), before, "aucune annonce après refus");

  const created = await server.request("POST", "/api/backoffice/announcements", {
    token: await server.login("cdAdmin"),
    body: { title: "MONO-T1 réunion", message: "Réunion générale", audience: "Tous" },
  });
  assertStatus(created, 201, "publication admin CD");
  announcementId = created.data.id;
  assert.equal(created.data.schoolCode, "CD-2026-0001");
  const parent = await server.request("GET", "/api/backoffice/announcements", { token: await server.login("cdParent") });
  assertStatus(parent, 200, "lecture parent");
  assert.ok(parent.data.items.some((item) => item.id === announcementId));
  const bi = await server.request("GET", "/api/backoffice/announcements", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "lecture BI");
  assert.ok(!bi.data.items.some((item) => item.id === announcementId), "BI ne voit pas l'annonce de CD");
  assertStatus(
    await server.request("GET", `/api/backoffice/announcements/${announcementId}`, { token: await server.login("biAdmin") }),
    [403, 404],
    "lecture directe depuis BI",
  );
});

test("notifications plateforme : réservées à la plateforme ; établissement, enseignant, anonyme refusés sans écriture", { skip }, async () => {
  const before = await server.snapshot("SELECT id FROM notifications ORDER BY id");
  for (const [label, account, status] of [
    ["admin établissement", "cdAdmin", 403],
    ["admin BI", "biAdmin", 403],
    ["enseignant", "cdTeacher", 403],
    ["anonyme", null, 401],
  ]) {
    const token = account && (await server.login(account));
    assertStatus(await server.request("GET", "/api/backoffice/notifications", { token }), status, `lecture ${label}`);
    assertStatus(
      await server.request("POST", "/api/backoffice/notifications", { token, body: { title: "x", message: "y", type: "Info" } }),
      status,
      `création ${label}`,
    );
  }
  assert.equal(await server.snapshot("SELECT id FROM notifications ORDER BY id"), before, "aucune notification après refus");
  const created = await server.request("POST", "/api/backoffice/notifications", {
    token: await server.login("superAdmin"),
    body: { title: "MONO-T1", message: "Notification plateforme", type: "Info" },
  });
  assertStatus(created, 201, "création Superadmin");
  assert.equal(created.data.schoolId, null, "notification plateforme, sans établissement");
});
