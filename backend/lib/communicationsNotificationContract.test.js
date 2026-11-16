"use strict";

// NOTIF-CONTRACT : contrat de données Push canonique, sans changer encore le
// résolveur Mobile (PR 2) ni activer l'aperçu privé (préférence ARB-1).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalPushData,
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
} = require("./communicationChannelFanout");
const { TARGET_RESOURCES } = require("./communicationsNavigationTargets");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "55555555-5555-4555-8555-555555555555";
const EVENT_KEY = `communication.message.created:${MESSAGE}`;

test("NOTIF-CONTRACT — la cible conversation vérifie aussi le school_id du message", () => {
  assert.deepEqual(Array.from(TARGET_RESOURCES.conversation), [
    { key: "conversationId", table: "school_conversations" },
    { key: "messageId", table: "school_messages" },
  ]);
});

test("NOTIF-CONTRACT — les clés historiques sont conservées pour le Mobile existant", () => {
  const actual = canonicalPushData(
    { event_key: EVENT_KEY, notification_id: NOTE },
    {
      notificationId: NOTE, schoolCode: "SCH-A",
      navigationTarget: { type: "conversation", conversationId: CONVERSATION, messageId: MESSAGE },
    },
  );
  assert.equal(actual.somafrikDestination, "Messages");
  assert.equal(actual.somafrikConversationId, CONVERSATION);
  assert.equal(actual.eventKey, EVENT_KEY);
  assert.equal(actual.notificationId, NOTE);
  assert.equal(actual.schoolCode, "SCH-A");
  assert.equal(actual.type, "conversation");
  assert.equal(actual.resourceType, "conversation");
  assert.equal(actual.resourceId, CONVERSATION);
  assert.equal(actual.conversationId, CONVERSATION);
  assert.equal(actual.messageId, MESSAGE);
});

test("NOTIF-CONTRACT — cible malformée : aucun resourceId non vérifié", () => {
  const actual = canonicalPushData(
    { event_key: EVENT_KEY, notification_id: NOTE },
    { schoolCode: "https://evil.example", navigationTarget: {
      type: "conversation", conversationId: "https://evil.example", messageId: "../wrong",
    } },
  );
  assert.equal(actual.somafrikDestination, "Home");
  assert.equal(actual.notificationId, NOTE);
  assert.equal(actual.resourceType, undefined);
  assert.equal(actual.resourceId, undefined);
  assert.equal(actual.schoolCode, undefined);
  assert.equal(actual.messageId, undefined);
});

test("NOTIF-CONTRACT — les types inconnus n'ajoutent aucun pointeur métier", () => {
  const actual = canonicalPushData(
    { event_key: EVENT_KEY },
    { navigationTarget: { type: "javascript:", conversationId: CONVERSATION } },
  );
  assert.equal(actual.somafrikDestination, "Home");
  assert.equal(actual.type, undefined);
  assert.equal(actual.resourceId, undefined);
});

test("NOTIF-CONTRACT — contrat générique pour les cibles existantes", () => {
  for (const [type, key] of [
    ["announcement", "announcementId"],
    ["attendance", "attendanceId"],
    ["grade", "gradeId"],
    ["payment", "paymentId"],
    ["report_card", "reportCardId"],
    ["timetable", "weeklySlotId"],
    ["teacher_replacement", "replacementId"],
    ["finance_obligation", "obligationId"],
  ]) {
    const result = canonicalPushData(
      { event_key: EVENT_KEY },
      { navigationTarget: { type, [key]: MESSAGE } },
    );
    assert.equal(result.type, type, type);
    assert.equal(result.resourceId, MESSAGE, type);
    assert.equal(result[key], MESSAGE, type);
  }
});

test("NOTIF-CONTRACT — texte Push indépendant des données personnelles in-app", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE, event_key: EVENT_KEY, event_type: "communication.message.created",
      school_id: SCHOOL, school_code: "SCH-A",
      title: "Message privé de Marie",
      body: "Nom élève et informations scolaires confidentielles",
      navigation_target: { type: "conversation", conversationId: CONVERSATION, messageId: MESSAGE },
    }],
    recipients: [{ notification_id: NOTE, school_id: SCHOOL, user_id: USER }],
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }], ["PUSH"]);
  let expo = null;
  await drainChannelDeliveries(adapter, {
    pushStore: {
      async listActiveForUser() {
        return [{
          user_id: USER, school_id: SCHOOL, backend_environment: "preproduction",
          expo_push_token: "ExponentPushToken[notif-contract]",
        }];
      },
    },
    pushClient: {
      async sendToTokens(_tokens, payload) { expo = payload; return { sent: 1 }; },
    },
    env: { NODE_ENV: "test", APP_ENV: "preproduction" },
  });
  assert.ok(expo, "Push envoyé");
  assert.equal(expo.data.notificationId, NOTE);
  assert.equal(expo.data.messageId, MESSAGE);
  assert.equal(expo.data.schoolCode, "SCH-A");
  assert.equal(expo.title, "Somafrik");
  assert.ok(!expo.body.includes("élève"), "ne révèle pas de données scolaires");
  assert.ok(!expo.body.includes("Marie"), "ne révèle pas l'expéditeur en verrouillage");
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "sent");
});
