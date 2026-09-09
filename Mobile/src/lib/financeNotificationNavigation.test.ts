import assert from "node:assert/strict";
import {
  isAllowlistedPushDestination,
  resolveInternalNotificationNavigationTarget,
  resolvePushNavigationData,
} from "./pushNotificationDestinations";
import {
  consumePushTapResponse,
  flushPendingPushNavigation,
  resetPushTapStateForTests,
} from "./pushNotificationTap";

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

function response(id: string, data: Record<string, unknown>) {
  return {
    identifier: id,
    notification: {
      request: {
        identifier: id,
        content: { data },
      },
    },
  };
}

function gate(authenticated: boolean, ready = true) {
  return {
    isAuthenticated: () => authenticated,
    isReady: () => ready,
  };
}

assert.equal(isAllowlistedPushDestination("StudentPayments"), true);
assert.equal(isAllowlistedPushDestination("https://evil.example"), false);
assert.deepEqual(
  resolvePushNavigationData({
    somafrikDestination: "StudentPayments",
    somafrikStudentId: STUDENT_ID,
  }),
  { destination: "StudentPayments", params: { studentId: STUDENT_ID } },
);
assert.deepEqual(
  resolvePushNavigationData({ somafrikDestination: "StudentPayments" }),
  { destination: "Home" },
  "StudentPayments sans studentId reste fail-safe Home",
);
assert.deepEqual(
  resolvePushNavigationData({ somafrikDestination: "https://evil.example", somafrikStudentId: STUDENT_ID }),
  { destination: "Home" },
);
assert.deepEqual(
  resolveInternalNotificationNavigationTarget({
    type: "finance_obligation",
    studentId: STUDENT_ID,
    obligationId: "obligation-1",
  }),
  { destination: "StudentPayments", params: { studentId: STUDENT_ID } },
);
assert.equal(resolveInternalNotificationNavigationTarget({ type: "finance_obligation" }), null);
assert.equal(resolveInternalNotificationNavigationTarget({ type: "attendance", studentId: STUDENT_ID }), null);

resetPushTapStateForTests();
const navigated: Array<{ destination: string; studentId?: string }> = [];
const navigate = (destination: string, params?: { studentId?: string }) => {
  navigated.push({ destination, studentId: params?.studentId });
};
const queued = consumePushTapResponse(
  response("finance-cold", {
    somafrikDestination: "StudentPayments",
    somafrikStudentId: STUDENT_ID,
  }),
  navigate,
  gate(false, true),
);
assert.equal(queued, "queued");
assert.deepEqual(navigated, []);
assert.equal(flushPendingPushNavigation(navigate, gate(true, true)), true);
assert.deepEqual(navigated, [{ destination: "StudentPayments", studentId: STUDENT_ID }]);

console.log("OK Mobile financeNotificationNavigation.test.ts");
