"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  mobilePushDataForDelivery,
} = require("./communicationChannelFanout");

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_KEY = "finance.payment.due:55555555-5555-4555-8555-555555555555";

function envPreprod() {
  return { NODE_ENV: "test", APP_ENV: "preproduction" };
}

test("finance_obligation produit une destination Mobile StudentPayments allowlistée", () => {
  assert.deepEqual(
    mobilePushDataForDelivery(
      { event_key: EVENT_KEY },
      { navigationTarget: { type: "finance_obligation", studentId: STUDENT_ID } },
    ),
    {
      somafrikDestination: "StudentPayments",
      somafrikStudentId: STUDENT_ID,
      eventKey: EVENT_KEY,
    },
  );
});

test("target inconnu reste fail-safe Home", () => {
  assert.deepEqual(
    mobilePushDataForDelivery(
      { event_key: EVENT_KEY },
      { navigationTarget: { type: "https://evil.example", studentId: STUDENT_ID } },
    ),
    { somafrikDestination: "Home", eventKey: EVENT_KEY },
  );
});

test("fan-out PUSH PAYMENT_DUE transmet StudentPayments + studentId à Expo", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: EVENT_KEY,
      event_type: "finance.payment.due",
      school_id: SCHOOL_ID,
      title: "Paiement arrivé à échéance",
      body: "Un paiement scolaire est arrivé à échéance.",
      navigation_target: {
        type: "finance_obligation",
        studentId: STUDENT_ID,
        obligationId: "55555555-5555-4555-8555-555555555555",
      },
    }],
    recipients: [{
      notification_id: NOTE_ID,
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      recipient_kind: "parent",
    }],
  });

  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }], ["PUSH"]);
  let expoPayload = null;
  await drainChannelDeliveries(adapter, {
    pushStore: {
      async listActiveForUser() {
        return [{
          user_id: USER_ID,
          school_id: SCHOOL_ID,
          expo_push_token: "ExponentPushToken[finance-navigation]",
          backend_environment: "preproduction",
        }];
      },
    },
    pushClient: {
      async sendToTokens(_tokens, payload) {
        expoPayload = payload;
        return { sent: 1 };
      },
    },
    env: envPreprod(),
  });

  assert.equal(expoPayload?.data?.somafrikDestination, "StudentPayments");
  assert.equal(expoPayload?.data?.somafrikStudentId, STUDENT_ID);
  assert.equal(expoPayload?.data?.eventKey, EVENT_KEY);
  assert.equal(adapter.deliveries[0].status, "sent");
});
