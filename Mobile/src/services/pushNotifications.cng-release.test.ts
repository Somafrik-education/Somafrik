import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  getLastPushRegistrationOutcome,
  isNativePushCompatible,
  registerAuthenticatedPushDevice,
  resetPushRegistrationStateForTests,
} from "./pushNotifications";
import { SOMAFRIK_PUSH_CHANNEL_ID } from "../lib/pushNotificationDestinations";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5";

/** EmbeddedManifest leftover on a local CNG release APK — not Expo Go. */
const CNG_LOCAL_RELEASE_MANIFEST = {
  extra: { eas: { projectId: PROJECT_ID } },
  debuggerHost: "10.0.2.2:8081",
  hostUri: "10.0.2.2:8081",
  slug: "somafrik",
};

function granted() {
  return { status: "granted", granted: true, canAskAgain: true };
}

async function main() {
  const serviceSrc = readFileSync(path.join(here, "pushNotifications.ts"), "utf8");
  const runtimeSrc = readFileSync(path.join(here, "../components/PushNotificationsRuntime.tsx"), "utf8");
  assert.match(runtimeSrc, /observePushRuntimeEvent\("mounted"\)/);
  assert.match(runtimeSrc, /observePushRuntimeEvent\("canonical"/);
  assert.match(serviceSrc, /exitPoint/);
  assert.match(serviceSrc, /unsupported_packager/);
  assert.doesNotMatch(serviceSrc, /console\.log\([^)]*expoPushToken/);
  assert.doesNotMatch(JSON.stringify(CNG_LOCAL_RELEASE_MANIFEST), /ExponentPushToken/);

  assert.equal(
    isNativePushCompatible("bare", CNG_LOCAL_RELEASE_MANIFEST),
    true,
    "CNG local release : leftover debuggerHost ≠ Expo Go",
  );
  assert.equal(isNativePushCompatible("storeClient", CNG_LOCAL_RELEASE_MANIFEST), false);
  assert.equal(isNativePushCompatible("standalone", { hostUri: "exp.host/--/somafrik" }), false);
  assert.equal(isNativePushCompatible("", CNG_LOCAL_RELEASE_MANIFEST), false);

  resetPushRegistrationStateForTests();
  const sequence: string[] = [];
  let asked = false;
  let tokenRequested = false;
  const result = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "bare",
    expoGoConfig: CNG_LOCAL_RELEASE_MANIFEST,
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
    httpRequestImpl: async (path, init) => {
      sequence.push(`post:${path}`);
      return { ok: true, path, init };
    },
    notifications: {
      AndroidImportance: { HIGH: 4 },
      async setNotificationChannelAsync(id: string) {
        sequence.push(`channel:${id}`);
        return undefined;
      },
      async getPermissionsAsync() {
        return granted();
      },
      async requestPermissionsAsync() {
        return granted();
      },
      async getExpoPushTokenAsync() {
        tokenRequested = true;
        sequence.push("token");
        return { data: "ExponentPushToken[cng-local-release]" };
      },
    },
  });

  assert.equal(
    asked,
    true,
    "CNG local release ne doit pas sortir avant PermissionsAndroid.request",
  );
  assert.equal(result, "registered");
  assert.equal(tokenRequested, true);
  assert.deepEqual(sequence, [
    `channel:${SOMAFRIK_PUSH_CHANNEL_ID}`,
    "post_notifications",
    "token",
    "post:/mobile/push-devices",
  ]);
  const outcome = getLastPushRegistrationOutcome();
  assert.equal(outcome?.status, "registered");
  assert.equal(outcome?.exitPoint, "registered");
  assert.equal(outcome?.executionEnvironment, "bare");
  assert.equal(outcome?.androidSdk, 33);
  assert.doesNotMatch(JSON.stringify(outcome), /ExponentPushToken|10\.0\.2\.2/);

  console.log("OK Mobile pushNotifications.cng-release.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
