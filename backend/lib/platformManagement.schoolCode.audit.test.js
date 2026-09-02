"use strict";

/**
 * Audit #456 — GET subscriptions / notifications portent leftover school_code,
 * pas le login_code V2. Preuve que le comparateur Web leftover JWT === schoolCode
 * est SAFE aujourd'hui (contrairement à GET /users).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapSubscriptionRow, mapNotificationRow } = require("./platformManagement");

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEFTOVER = "CD-2026-0001";
const LOGIN = "CD-IN-26-001";

test("mapSubscriptionRow.schoolCode = leftover school_code, pas login_code", () => {
  const mapped = mapSubscriptionRow({
    id: "sub-1",
    school_id: SCHOOL_ID,
    school_code: LEFTOVER,
    country_code: "CD",
    country_name: "RDC",
    plan_name: "Standard",
    price_per_student: 1,
    billing_currency: "USD",
    status: "active",
    profile_payload: {},
  });
  assert.equal(mapped.schoolId, SCHOOL_ID);
  assert.equal(mapped.schoolCode, LEFTOVER);
  assert.notEqual(mapped.schoolCode, LOGIN);
});

test("mapNotificationRow.schoolCode = leftover school_code, pas login_code", () => {
  const mapped = mapNotificationRow({
    id: "n-1",
    school_id: SCHOOL_ID,
    school_code: LEFTOVER,
    country_code: "CD",
    title: "Info",
    message: "x",
    type: "Information",
    status: "unread",
    profile_payload: { audience: "BackOffice" },
  });
  assert.equal(mapped.schoolId, SCHOOL_ID);
  assert.equal(mapped.schoolCode, LEFTOVER);
  assert.notEqual(mapped.schoolCode, LOGIN);
});
