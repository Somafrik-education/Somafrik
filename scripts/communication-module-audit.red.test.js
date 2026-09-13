"use strict";

/**
 * AUDIT-COM-MODULE — tests RED.
 * Chaque cas affirme le comportement métier attendu.
 * Base d'origine des constats : develop@1bf4a057.
 * Base de validation (rebase / diff CTO) : develop@2e7e8e53 (Lots A #628 + B #633).
 * AUDIT-COM-RED-01/02/03 doivent passer (GREEN, Lots A+B).
 * AUDIT-COM-RED-04…06 doivent échouer : preuve des défauts encore ouverts.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sliceBetween(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.lastIndexOf(endToken);
  assert.notEqual(start, -1, `${label}: début introuvable (${startToken})`);
  assert.ok(end > start, `${label}: fin introuvable (${endToken})`);
  return source.slice(start, end + endToken.length);
}

test("AUDIT-COM-RED-01 — Mobile : le modal fil Messages permet de répondre", () => {
  const screen = readRepo("Mobile/src/screens/MessagesScreen.tsx");
  const modal = sliceBetween(screen, "<Modal visible={Boolean(selectedConversation)}", "</Modal>", "modal Messages");

  assert.match(
    modal,
    /FormField|TextInput/,
    "régression Lot A : le modal fil Messages n'a plus de champ de saisie",
  );
  assert.match(
    modal,
    /Envoyer|replyInThread/,
    "régression Lot A : le modal fil Messages n'expose plus l'action Envoyer",
  );
  assert.match(screen, /replyClientsConversationMessage|conversationId/, "régression Lot A : la réponse n'est plus liée au conversationId");
});

test("AUDIT-COM-RED-02 — Mobile C4 : Ouvrir mène au message ou à l'annonce", () => {
  const destinations = readRepo("Mobile/src/lib/pushNotificationDestinations.ts");
  const screen = readRepo("Mobile/src/screens/InternalNotificationsScreen.tsx");

  assert.match(
    destinations,
    /type["'\s:]*conversation|conversationId/,
    "resolveInternalNotificationNavigationTarget ignore les cibles conversation produites par C4",
  );
  assert.match(
    destinations,
    /announcement/,
    "resolveInternalNotificationNavigationTarget ignore les cibles announcement produites par C4",
  );
  assert.match(
    screen,
    /Ouvrir|Lire/,
    "InternalNotificationsScreen n'expose pas Ouvrir/Lire vers la ressource Communication",
  );
});

test("AUDIT-COM-RED-03 — Push Mobile : destination Communication allowlistée", () => {
  const destinations = readRepo("Mobile/src/lib/pushNotificationDestinations.ts");
  assert.match(
    destinations,
    /"Messages"/,
    "ALLOWED_PUSH_DESTINATIONS n'inclut pas Messages : un tap push retombe sur Home",
  );
  assert.match(
    destinations,
    /"Announcements"/,
    "ALLOWED_PUSH_DESTINATIONS n'inclut pas Announcements",
  );
  assert.match(
    destinations,
    /"InternalNotifications"/,
    "ALLOWED_PUSH_DESTINATIONS n'inclut pas InternalNotifications",
  );
});

test("AUDIT-COM-RED-04 — Web Messages : mark-read rafraîchit la liste unreadCount", () => {
  const page = readRepo("web/src/pages/MessagesConversationsPage.tsx");
  const loadThread = sliceBetween(
    page,
    "const loadThread = useCallback",
    "}, [canUpdate, schoolScope, selfId]);",
    "loadThread",
  );
  assert.match(
    loadThread,
    /loadConversations/,
    "après markRead, loadThread ne recharge pas la liste : le badge unreadCount de la carte reste stale",
  );
});

test("AUDIT-COM-RED-05 — Web Messages et Annonces consomment nextCursor", () => {
  const messages = readRepo("web/src/pages/MessagesConversationsPage.tsx");
  const announcements = readRepo("web/src/pages/AnnouncementsPage.tsx");
  assert.match(
    messages,
    /nextCursor/,
    "Messages Web ignore nextCursor API : la liste s'arrête à la première page",
  );
  assert.match(
    announcements,
    /nextCursor/,
    "Annonces Web ignore nextCursor API : la liste s'arrête à la première page",
  );
});

test("AUDIT-COM-RED-06 — Mobile Messages et Annonces consomment nextCursor", () => {
  const messages = readRepo("Mobile/src/screens/MessagesScreen.tsx");
  const announcements = readRepo("Mobile/src/screens/AnnouncementsScreen.tsx");
  assert.match(
    messages,
    /nextCursor/,
    "Messages Mobile ignore nextCursor : pas de chargement des conversations suivantes",
  );
  assert.match(
    announcements,
    /nextCursor/,
    "Annonces Mobile ignore nextCursor : pas de chargement des annonces suivantes",
  );
});
