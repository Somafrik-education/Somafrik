"use strict";

/**
 * PR E — préférences utilisateur par canal (TESTS FIRST).
 *
 * Trois trous réellement démontrés ; aucun GREEN.
 * Ne pas étendre ce fichier à Expo/FCM, tenant PUSH, idempotence,
 * isolation des pannes ou dispatcher unique (déjà GREEN #544/#545/#549).
 *
 * PUSH = Expo + FCM (infrastructure). EMAIL = SMTP / Brevo-as-SMTP.
 * Les préférences sont par CANAL, jamais par fournisseur.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PREFS_MODULE = "backend/lib/communicationsPreferences.js";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function persistenceCorpus() {
  const parts = [
    read("backend/db/schema.sql"),
    read("backend/db/communicationsNotificationsSchema.js"),
    read("backend/db/clientsSchema.js"),
  ];
  const migDir = path.join(ROOT, "backend/db/migrations");
  for (const name of fs.readdirSync(migDir)) {
    if (/\.(sql|js)$/.test(name)) {
      parts.push(fs.readFileSync(path.join(migDir, name), "utf8"));
    }
  }
  return parts.join("\n");
}

test("RED-COM-05A — aucune persistance canonique user + school + channel", () => {
  const hasModule = fs.existsSync(path.join(ROOT, PREFS_MODULE));
  const corpus = persistenceCorpus();
  const hasTable = /user_communication_preferences|communication_preferences|notification_preferences/.test(
    corpus,
  );
  const usersSql = read("backend/db/schema.sql");
  const usersBlock = usersSql.slice(
    usersSql.indexOf("CREATE TABLE IF NOT EXISTS users"),
    usersSql.indexOf("CREATE TABLE IF NOT EXISTS user_roles"),
  );
  const hasUserChannelFlags = /email_enabled|push_enabled|notifications_enabled|in_app_enabled/.test(
    `${usersBlock}\n${read("backend/db/clientsSchema.js")}`,
  );

  assert.equal(
    hasModule || hasTable || hasUserChannelFlags,
    true,
    "aucune préférence persistée UNIQUE(user_id, school_id, channel) pour IN_APP | PUSH | EMAIL",
  );
});

test("RED-COM-05B — aucune résolution eventPolicy ∩ userPreferences", () => {
  const dispatcher = require("./communicationsDispatcher");
  assert.equal(
    typeof dispatcher.resolveEffectiveChannels,
    "function",
    "aucune fonction resolveEffectiveChannels : le dispatcher ignore les destinataires (void recipients) et n'intersecte pas la politique d'événement avec les préférences utilisateur",
  );

  const channels = dispatcher.resolveEffectiveChannels({
    eventType: "pedagogy.grade.published",
    eventPolicyChannels: ["IN_APP", "PUSH", "EMAIL"],
    userEnabledChannels: ["IN_APP", "PUSH"],
    schoolId: "11111111-1111-4111-8111-111111111111",
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  });
  assert.deepEqual(
    [...channels].sort(),
    ["IN_APP", "PUSH"],
    "EMAIL optionnel désactivé doit sortir de effectiveChannels sans toucher IN_APP ni PUSH",
  );
});

test("RED-COM-05F/G — canal mandatory EMAIL pour auth.password.reset", () => {
  const dispatcher = require("./communicationsDispatcher");
  assert.equal(
    typeof dispatcher.mandatoryChannelsForEvent,
    "function",
    "aucune notion mandatoryChannels distincte des canaux optionnels — un futur EMAIL=false bloquerait auth.password.reset",
  );
  assert.deepEqual(
    dispatcher.mandatoryChannelsForEvent("auth.password.reset"),
    ["EMAIL"],
    "auth.password.reset doit déclarer EMAIL obligatoire, indépendamment des préférences",
  );

  assert.equal(
    typeof dispatcher.resolveEffectiveChannels,
    "function",
    "resolveEffectiveChannels requis pour unionner mandatory ∪ (policy ∩ prefs)",
  );
  const channels = dispatcher.resolveEffectiveChannels({
    eventType: "auth.password.reset",
    eventPolicyChannels: ["EMAIL"],
    userEnabledChannels: [],
  });
  assert.equal(
    channels.includes("EMAIL"),
    true,
    "EMAIL=false ne doit jamais bloquer auth.password.reset",
  );
});
