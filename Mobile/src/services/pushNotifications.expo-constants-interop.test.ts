import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  classifyNativePushCompatibility,
  getLastPushRegistrationOutcome,
  isNativePushCompatible,
  registerAuthenticatedPushDevice,
  resetPushRegistrationStateForTests,
  setExpoConstantsModuleForTests,
} from "./pushNotifications";
import { SOMAFRIK_PUSH_CHANNEL_ID } from "../lib/pushNotificationDestinations";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5";

/** Expo SDK 54 Metro/Hermes: `require("expo-constants")` is a namespace around `export default`. */
const SDK54_DEFAULT_EXPORT = {
  default: {
    executionEnvironment: "bare",
    expoGoConfig: {
      extra: { eas: { projectId: PROJECT_ID } },
      debuggerHost: "10.0.2.2:8081",
      hostUri: "10.0.2.2:8081",
      slug: "somafrik",
    },
    expoConfig: { extra: { eas: { projectId: PROJECT_ID } } },
    easConfig: { projectId: PROJECT_ID },
  },
};

function granted() {
  return { status: "granted", granted: true, canAskAgain: true };
}

async function main() {
  const serviceSrc = readFileSync(path.join(here, "pushNotifications.ts"), "utf8");
  assert.match(serviceSrc, /setExpoConstantsModuleForTests/);
  assert.doesNotMatch(serviceSrc, /console\.log\([^)]*expoPushToken/);

  assert.equal(
    String((SDK54_DEFAULT_EXPORT as { executionEnvironment?: string }).executionEnvironment ?? ""),
    "",
    "shape runtime SDK54 : executionEnvironment n'est pas au top-level",
  );

  resetPushRegistrationStateForTests();
  setExpoConstantsModuleForTests(SDK54_DEFAULT_EXPORT);
  const classification = classifyNativePushCompatibility();
  assert.equal(
    classification.env,
    "bare",
    "SDK54 default export : executionEnvironment ne doit plus être vide",
  );
  assert.equal(
    classification.compatible,
    true,
    "SDK54 default export bare ≠ unsupported_env",
  );
  assert.notEqual(classification.exitPoint, "unsupported_env");
  assert.equal(isNativePushCompatible(), true);

  resetPushRegistrationStateForTests();
  setExpoConstantsModuleForTests(SDK54_DEFAULT_EXPORT);
  const sequence: string[] = [];
  let asked = false;
  const result = await registerAuthenticatedPushDevice({
    platform: "android",
    androidSdk: 33,
    postNotificationsGranted: false,
    postNotificationsCanAskAgain: true,
    requestPostNotificationsImpl: async () => {
      asked = true;
      sequence.push("post_notifications");
      return granted();
    },
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
        sequence.push("token");
        return { data: "ExponentPushToken[sdk54-default-export]" };
      },
    },
  });
  assert.equal(asked, true, "après unwrap default : prompt POST_NOTIFICATIONS");
  assert.equal(result, "registered");
  assert.deepEqual(sequence, [
    `channel:${SOMAFRIK_PUSH_CHANNEL_ID}`,
    "post_notifications",
    "token",
    "post:/mobile/push-devices",
  ]);
  const outcome = getLastPushRegistrationOutcome();
  assert.equal(outcome?.exitPoint, "registered");
  assert.equal(outcome?.executionEnvironment, "bare");
  assert.equal(outcome?.channelCreated, true);
  assert.equal(outcome?.postNotificationsRequested, true);
  assert.doesNotMatch(JSON.stringify(outcome), /ExponentPushToken|10\.0\.2\.2/);

  resetPushRegistrationStateForTests();
  setExpoConstantsModuleForTests({ default: { executionEnvironment: "storeClient" } });
  assert.equal(isNativePushCompatible(), false);
  assert.equal(classifyNativePushCompatibility().exitPoint, "unsupported_store_client");

  resetPushRegistrationStateForTests();
  setExpoConstantsModuleForTests({
    default: {
      executionEnvironment: "standalone",
      expoGoConfig: { hostUri: "exp.host/--/somafrik" },
    },
  });
  assert.equal(isNativePushCompatible(), false, "standalone + exp.host reste unsupported");
  assert.equal(classifyNativePushCompatibility().exitPoint, "unsupported_packager");

  resetPushRegistrationStateForTests();
  setExpoConstantsModuleForTests({ default: {} });
  assert.equal(isNativePushCompatible(), false, "env réellement absent après normalisation : fail-closed");
  assert.equal(classifyNativePushCompatibility().exitPoint, "unsupported_env");

  resetPushRegistrationStateForTests();
  setExpoConstantsModuleForTests({ executionEnvironment: "bare" });
  assert.equal(isNativePushCompatible(), true, "CJS top-level sans default reste lisible");

  console.log("OK Mobile pushNotifications.expo-constants-interop.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
