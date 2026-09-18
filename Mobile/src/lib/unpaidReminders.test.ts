import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REMINDER_COOLDOWN_DAYS,
  buildReminderMessage,
  canForceUnpaidReminder,
  canSendReminder,
  canSendUnpaidReminder,
} from "./unpaidReminders";

const now = new Date("2026-08-19T12:00:00.000Z");

test("canSendReminder — cooldown 3 jours, même dataset que Web", () => {
  assert.equal(REMINDER_COOLDOWN_DAYS, 3);
  assert.equal(canSendReminder([], "STU-1", 3, now).allowed, true);

  const recent = canSendReminder(
    [{ studentId: "STU-1", sendStatus: "Envoyée", sentAt: "2026-08-18T09:00:00.000Z" }],
    "STU-1",
    3,
    now,
  );
  assert.equal(recent.allowed, false);
  assert.match(recent.message ?? "", /19-08-2026|18-08-2026/);

  const failed = canSendReminder(
    [{ studentId: "STU-1", sendStatus: "Échouée", sentAt: "2026-08-18T09:00:00.000Z" }],
    "STU-1",
    3,
    now,
  );
  assert.equal(failed.allowed, true);

  const expired = canSendReminder(
    [{ studentId: "STU-1", sendStatus: "Envoyée", sentAt: "2026-08-15T09:00:00.000Z" }],
    "STU-1",
    3,
    now,
  );
  assert.equal(expired.allowed, true);
});

function session(permissions: string[]) {
  return { role: "accountant", permissions, user: { id: "acc-1", permissions } };
}

test("canSendUnpaidReminder — Impayés:CREATE | Paiements:UPDATE", () => {
  assert.equal(canSendUnpaidReminder(session(["Impayés:READ"])), false);
  assert.equal(canSendUnpaidReminder(session(["Impayés:CREATE"])), true);
  assert.equal(canSendUnpaidReminder(session(["Paiements:UPDATE"])), true);
  assert.equal(canForceUnpaidReminder(session(["Paiements:UPDATE"])), false);
  assert.equal(canForceUnpaidReminder(session(["Impayés:CREATE"])), true);
});

test("buildReminderMessage — DTO amountDue, pas de recalcul", () => {
  const message = buildReminderMessage(
    {
      studentName: "Amina K.",
      periodLabel: "T1 2026",
      amountDue: 55000,
      currency: "CDF",
      dueDate: "2026-08-01",
      daysLate: 18,
    },
    "Lycée Demo",
  );
  assert.match(message, /Amina K/);
  assert.match(message, /55[\s\u00a0]?000 CDF/);
  assert.match(message, /T1 2026/);
  assert.doesNotMatch(message, /100000/);
});
