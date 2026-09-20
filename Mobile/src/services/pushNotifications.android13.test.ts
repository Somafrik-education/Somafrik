import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  getLastPushRegistrationOutcome,
  observePushRegistrationFailure,
  registerAuthenticatedPushDevice,
  resetPushRegistrationStateForTests,
} from "./pushNotifications";
import { SOMAFRIK_PUSH_CHANNEL_ID } from "../lib/pushNotificationDestinations";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5";

function granted() {
  return { status: "granted", granted: true, canAskAgain: true };
}

function denied(canAskAgain = false) {
  return { status: "denied", granted: false, canAskAgain };
}

function previewNotifications() {
  return {
    AndroidImportance: { HIGH: 4 },
    async setNotificationChannelAsync() {
      return undefined;
    },
    async getPermissionsAsync() {
      return granted();
    },
    async requestPermissionsAsync() {
      return granted();
    },
    async getExpoPushTokenAsync() {
      return { data: "ExponentPushToken[android13-preview]" };
    },
  };
}

async function main() {
  const runtimeSrc = readFileSync(path.join(here, "../components/PushNotificationsRuntime.tsx"), "utf8");
  const serviceSrc = readFileSync(path.join(here, "pushNotifications.ts"), "utf8");

  assert.match(runtimeSrc, /canPersistFullSession/);
  assert.match(runtimeSrc, /if \(!canonical\) return/);
  assert.match(
    runtimeSrc,
    /registerAuthenticatedPushDevice|startAuthenticatedPushRegistration/,
    "après login canonique le runtime doit lancer l'enregistrement",
  );
  assert.doesNotMatch(
    runtimeSrc,
    /registerAuthenticatedPushDevice\(\)\.catch\(\(\) => undefined\)/,
    "l'échec d'enregistrement ne doit plus être avalé",
  );
  assert.match(runtimeSrc, /observePushRegistrationFailure/);
  assert.match(serviceSrc, /export function getLastPushRegistrationOutcome/);
  assert.match(serviceSrc, /export function observePushRegistrationFailure/);
  assert.match(serviceSrc, /POST_NOTIFICATIONS/);
  assert.doesNotMatch(serviceSrc, /console\.log\([^)]*expoPushToken/);
  assert.doesNotMatch(serviceSrc, /safeLogger\.(info|warn|error|debug)\([^)]*expoPushToken/);
  const unchecked = serviceSrc.slice(serviceSrc.indexOf("async function registerAuthenticatedPushDeviceUnchecked"));
  const channelCall = unchecked.indexOf("setNotificationChannelAsync");
  const android13Call = unchecked.indexOf("ensureAndroid13PostNotifications");
  assert.ok(channelCall > 0 && android13Call > channelCall, "canal v2 avant POST_NOTIFICATIONS");

  resetPushRegistrationStateForTests();
  const posts: Array<{ path: string; init?: RequestInit }> = [];
  const sequence: string[] = [];
  const httpOk = async (path: string, init?: RequestInit) => {
    sequence.push(`post:${path}`);
    posts.push({ path, init });
    return { ok: true };
  };

  let asked = false;
  let tokenRequested = false;
  const orderedNotifications = {
    AndroidImportance: { HIGH: 4 },
    async setNotificationChannelAsync(id: string) {
      sequence.push(`channel:${id}`);
      return undefined;
    },
    async getPermissionsAsync() {
      return granted();
    },
    async requestPermissionsAsync() {
      sequence.push("expo_request_permissions");
      return granted();
    },
    async getExpoPushTokenAsync() {
      tokenRequested = true;
      sequence.push("token");
      return { data: "ExponentPushToken[android13-preview]" };
    },
  };
  const android13Prompt = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    expoGoConfig: { extra: { eas: { projectId: PROJECT_ID } } },
    androidSdk: 33,
    postNotificationsGranted: false,
    postNotificationsCanAskAgain: true,
    requestPostNotificationsImpl: async () => {
      asked = true;
      sequence.push("post_notifications");
      return granted();
    },
    getProjectId: () => PROJECT_ID,
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpOk as never,
    notifications: orderedNotifications,
  });
  assert.equal(
    asked,
    true,
    "Android 13 / SDK 33 : POST_NOTIFICATIONS non accordée + canAskAgain => prompt",
  );
  assert.equal(android13Prompt, "registered");
  assert.equal(getLastPushRegistrationOutcome()?.status, "registered");
  assert.equal(posts[0]?.path, "/mobile/push-devices");
  assert.match(String(posts[0]?.init?.body), /"appProfile":"preview"/);
  assert.deepEqual(sequence, [
    `channel:${SOMAFRIK_PUSH_CHANNEL_ID}`,
    "post_notifications",
    "token",
    "post:/mobile/push-devices",
  ]);

  resetPushRegistrationStateForTests();
  posts.length = 0;
  sequence.length = 0;
  asked = false;
  tokenRequested = false;
  const refused = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    expoGoConfig: { extra: {} },
    androidSdk: 33,
    postNotificationsGranted: false,
    postNotificationsCanAskAgain: true,
    requestPostNotificationsImpl: async () => {
      asked = true;
      sequence.push("post_notifications");
      return denied(true);
    },
    getProjectId: () => PROJECT_ID,
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpOk as never,
    notifications: orderedNotifications,
  });
  assert.equal(asked, true);
  assert.equal(refused, "permission_denied");
  assert.equal(getLastPushRegistrationOutcome()?.status, "permission_denied");
  assert.equal(tokenRequested, false, "refus : aucun token demandé");
  assert.equal(posts.length, 0);
  assert.deepEqual(sequence, [`channel:${SOMAFRIK_PUSH_CHANNEL_ID}`, "post_notifications"]);

  resetPushRegistrationStateForTests();
  posts.length = 0;
  asked = false;
  const noReprompt = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    expoGoConfig: { extra: {} },
    androidSdk: 33,
    postNotificationsGranted: false,
    postNotificationsCanAskAgain: false,
    requestPostNotificationsImpl: async () => {
      asked = true;
      return denied(false);
    },
    getProjectId: () => PROJECT_ID,
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications(),
  });
  assert.equal(asked, false, "canAskAgain === false : ne pas relancer le prompt");
  assert.equal(noReprompt, "permission_denied");
  assert.equal(posts.length, 0);

  resetPushRegistrationStateForTests();
  posts.length = 0;
  const storeClient = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "storeClient",
    expoGoConfig: { extra: {} },
    androidSdk: 33,
    postNotificationsGranted: false,
    postNotificationsCanAskAgain: true,
    requestPostNotificationsImpl: async () => granted(),
    getProjectId: () => PROJECT_ID,
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications(),
  });
  assert.equal(storeClient, "unsupported");
  assert.equal(getLastPushRegistrationOutcome()?.status, "unsupported");
  assert.equal(posts.length, 0);

  observePushRegistrationFailure(new Error("Jeton ExpoPushToken[secret-device] indisponible"));
  const failed = getLastPushRegistrationOutcome();
  assert.equal(failed?.status, "failed");
  assert.doesNotMatch(JSON.stringify(failed), /ExpoPushToken|secret-device/);

  console.log("OK Mobile pushNotifications.android13.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
