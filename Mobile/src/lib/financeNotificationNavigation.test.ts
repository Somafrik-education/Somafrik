import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { navigateRegisteredPushDestination } from "./pushNotificationNavigate";

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "66666666-6666-4666-8666-666666666666";
const ANNOUNCEMENT_ID = "77777777-7777-4777-8777-777777777777";

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
assert.deepEqual(
  resolveInternalNotificationNavigationTarget({
    type: "conversation",
    conversationId: CONVERSATION_ID,
  }),
  { destination: "Messages", params: { conversationId: CONVERSATION_ID } },
);
assert.equal(resolveInternalNotificationNavigationTarget({ type: "conversation" }), null);
assert.deepEqual(
  resolveInternalNotificationNavigationTarget({
    type: "announcement",
    announcementId: ANNOUNCEMENT_ID,
  }),
  { destination: "Announcements", params: { announcementId: ANNOUNCEMENT_ID } },
);
assert.equal(
  resolveInternalNotificationNavigationTarget({
    type: "announcement",
    announcementId: "https://evil.example",
  }),
  null,
);
assert.deepEqual(
  resolvePushNavigationData({
    somafrikDestination: "Messages",
    somafrikConversationId: CONVERSATION_ID,
  }),
  { destination: "Messages", params: { conversationId: CONVERSATION_ID } },
);
assert.deepEqual(
  resolvePushNavigationData({ somafrikDestination: "Messages" }),
  { destination: "Home" },
  "Messages sans conversationId reste fail-safe Home",
);
assert.deepEqual(
  resolvePushNavigationData({
    somafrikDestination: "Announcements",
    somafrikAnnouncementId: ANNOUNCEMENT_ID,
  }),
  { destination: "Announcements", params: { announcementId: ANNOUNCEMENT_ID } },
);
assert.deepEqual(
  resolvePushNavigationData({ somafrikDestination: "InternalNotifications" }),
  { destination: "InternalNotifications" },
);
assert.equal(isAllowlistedPushDestination("Messages"), true);
assert.equal(isAllowlistedPushDestination("Announcements"), true);
assert.equal(isAllowlistedPushDestination("InternalNotifications"), true);

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

resetPushTapStateForTests();
const openedThreads: Array<{ destination: string; conversationId?: string }> = [];
const openThread = (destination: string, params?: { conversationId?: string }) => {
  openedThreads.push({ destination, conversationId: params?.conversationId });
};
assert.equal(
  consumePushTapResponse(
    response("message-push", {
      somafrikDestination: "Messages",
      somafrikConversationId: CONVERSATION_ID,
    }),
    openThread,
    gate(true, true),
  ),
  "navigated",
);
assert.deepEqual(openedThreads, [{ destination: "Messages", conversationId: CONVERSATION_ID }]);

resetPushTapStateForTests();
const coldStart: Array<{ destination: string; conversationId?: string }> = [];
const coldGateReady = { current: false };
assert.equal(
  consumePushTapResponse(
    response("cold-messages", {
      somafrikDestination: "Messages",
      somafrikConversationId: CONVERSATION_ID,
    }),
    (destination, params) => {
      coldStart.push({ destination, conversationId: params?.conversationId });
    },
    {
      isAuthenticated: () => true,
      isReady: () => coldGateReady.current,
    },
  ),
  "queued",
);
assert.equal(coldStart.length, 0, "cold-start avant onReady : aucune navigation");
coldGateReady.current = true;
assert.equal(
  flushPendingPushNavigation(
    (destination, params) => {
      navigateRegisteredPushDestination(
        (name, nextParams) => {
          coldStart.push({ destination: name, conversationId: nextParams?.conversationId });
        },
        destination,
        params,
        ["Home", "StudentPayments"],
      );
    },
    {
      isAuthenticated: () => true,
      isReady: () => coldGateReady.current,
    },
  ),
  true,
);
assert.equal(coldStart.length, 1);
assert.equal(
  coldStart[0]?.destination,
  "Home",
  "cold-start Communication hors graphe RBAC : fallback Home comme le tap à chaud",
);

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const destinationsSrc = readFileSync(join(srcRoot, "lib/pushNotificationDestinations.ts"), "utf8");
const notificationsSrc = readFileSync(join(srcRoot, "screens/InternalNotificationsScreen.tsx"), "utf8");
const messagesSrc = readFileSync(join(srcRoot, "screens/MessagesScreen.tsx"), "utf8");
const announcementsSrc = readFileSync(join(srcRoot, "screens/AnnouncementsScreen.tsx"), "utf8");
assert.match(destinationsSrc, /type["'\s:]*conversation|conversationId/);
assert.match(destinationsSrc, /announcement/);
assert.match(destinationsSrc, /"Messages"/);
assert.match(destinationsSrc, /"Announcements"/);
assert.match(destinationsSrc, /"InternalNotifications"/);
assert.match(notificationsSrc, /Ouvrir|Lire/);
assert.match(messagesSrc, /conversationId/);
assert.match(announcementsSrc, /announcementId/);
assert.match(announcementsSrc, /getCanonicalAnnouncementById/);
assert.match(announcementsSrc, /nextCursor/);
const navigatorSrc = readFileSync(join(srcRoot, "navigation/AppNavigator.tsx"), "utf8");
assert.match(navigatorSrc, /navigateRegisteredPushDestination/);
assert.match(navigatorSrc, /collectRegisteredRouteNames/);

console.log("OK Mobile financeNotificationNavigation.test.ts");
