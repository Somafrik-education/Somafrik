import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  isNativePushCompatible,
  registerAuthenticatedPushDevice,
  resetPushRegistrationStateForTests,
  getLastPushRegistrationOutcome,
} from "./pushNotifications";
import { SOMAFRIK_PUSH_CHANNEL_ID } from "../lib/pushNotificationDestinations";

const here = path.dirname(fileURLToPath(import.meta.url));

/** SDK 54 `expoGoConfig` getter returns the EmbeddedManifest object, never null, on EAS APK. */
const EMBEDDED_MANIFEST_EXPO_GO_CONFIG = {
  extra: { eas: { projectId: "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5" } },
  slug: "somafrik",
};

function granted() {
  return { status: "granted", granted: true, canAskAgain: true };
}

function previewNotifications(token = "ExponentPushToken[p0-preview-native]") {
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
      return { data: token };
    },
  };
}

async function main() {
  resetPushRegistrationStateForTests();
  assert.equal(SOMAFRIK_PUSH_CHANNEL_ID, "somafrik-default-v2");

  const runtimeSrc = readFileSync(path.join(here, "../components/PushNotificationsRuntime.tsx"), "utf8");
  const mobileSrc = readFileSync(path.join(here, "pushNotifications.ts"), "utf8");
  const appConfig = readFileSync(path.join(here, "../../app.config.js"), "utf8");
  const plugin = readFileSync(path.join(here, "../../plugins/withSomafrikAndroidSecurity.js"), "utf8");

  assert.match(appConfig, /defaultChannel:\s*"somafrik-default-v2"/);
  assert.doesNotMatch(appConfig, /android\.permission\.POST_NOTIFICATIONS/);
  assert.doesNotMatch(plugin, /POST_NOTIFICATIONS/);
  assert.doesNotMatch(
    runtimeSrc,
    /registerAuthenticatedPushDevice\(\)\.catch\(\(\) => undefined\)/,
    "P0 : l'enregistrement preview ne doit plus être silencieux",
  );
  assert.match(runtimeSrc, /push device registration failed|observePushRegistration/);
  assert.match(mobileSrc, /push device registration failed/);
  assert.match(mobileSrc, /requestPermissionsAsync/);

  const channels: string[] = [];
  let requested = false;
  const httpErrors: unknown[] = [];
  await assert.rejects(
    () =>
      registerAuthenticatedPushDevice({
        platform: "android",
        executionEnvironment: "standalone",
        getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
        getReleaseProfileImpl: () => "preview",
        httpRequestImpl: async () => {
          httpErrors.push("register-failed");
          throw new Error("HTTP 503 enregistrement device");
        },
        notifications: {
          AndroidImportance: { HIGH: 4 },
          async setNotificationChannelAsync(id) {
            channels.push(id);
            return undefined;
          },
          async getPermissionsAsync() {
            return { status: "undetermined", granted: false, canAskAgain: true };
          },
          async requestPermissionsAsync() {
            requested = true;
            return granted();
          },
          async getExpoPushTokenAsync() {
            return { data: "ExponentPushToken[p0-register-fail]" };
          },
        },
      }),
    /HTTP 503/,
  );
  assert.equal(requested, true, "Android 13+ : requestPermissionsAsync si undetermined");
  assert.deepEqual(channels, ["somafrik-default-v2"]);
  const outcome = getLastPushRegistrationOutcome();
  assert.equal(outcome?.status, "failed");
  assert.match(String(outcome?.reason ?? ""), /503/);
  assert.doesNotMatch(JSON.stringify(outcome), /ExponentPushToken/);
  assert.doesNotMatch(JSON.stringify(outcome), /p0-register-fail/);

  const posts: Array<{ path: string; init?: RequestInit }> = [];
  const httpOk = async (path: string, init?: RequestInit) => {
    posts.push({ path, init });
    return { ok: true };
  };

  resetPushRegistrationStateForTests();
  posts.length = 0;
  assert.equal(
    isNativePushCompatible("standalone", EMBEDDED_MANIFEST_EXPO_GO_CONFIG),
    true,
    "EAS preview standalone : expoGoConfig EmbeddedManifest ≠ Expo Go",
  );
  const easStandalone = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    expoGoConfig: EMBEDDED_MANIFEST_EXPO_GO_CONFIG,
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications(),
  });
  assert.equal(easStandalone, "registered");
  assert.equal(posts[0]?.path, "/mobile/push-devices");
  assert.match(String(posts[0]?.init?.body), /"appProfile":"preview"/);
  assert.match(String(posts[0]?.init?.body), /"platform":"android"/);
  assert.doesNotMatch(String(posts[0]?.init?.body), /releaseProfile/);

  resetPushRegistrationStateForTests();
  posts.length = 0;
  assert.equal(isNativePushCompatible("bare", { extra: {} }), true);
  const easBare = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "bare",
    expoGoConfig: { extra: {} },
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications("ExponentPushToken[p0-preview-bare]"),
  });
  assert.equal(easBare, "registered");
  assert.equal(posts[0]?.path, "/mobile/push-devices");
  assert.match(String(posts[0]?.init?.body), /"appProfile":"preview"/);

  resetPushRegistrationStateForTests();
  posts.length = 0;
  assert.equal(
    isNativePushCompatible("storeClient", { hostUri: "exp.host/--/somafrik" }),
    false,
    "Expo Go hostUri must stay unsupported",
  );
  const expoGoHost = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "storeClient",
    expoGoConfig: { hostUri: "exp.host/--/somafrik" },
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications(),
  });
  assert.equal(expoGoHost, "unsupported");
  assert.equal(posts.length, 0);

  assert.equal(
    isNativePushCompatible("storeClient", { debuggerHost: "127.0.0.1:8081" }),
    false,
  );
  const expoGoDebugger = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "storeClient",
    expoGoConfig: { debuggerHost: "127.0.0.1:8081" },
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications(),
  });
  assert.equal(expoGoDebugger, "unsupported");

  assert.equal(
    isNativePushCompatible("standalone", { hostUri: "exp.host/--/somafrik" }),
    false,
    "real Expo Go packager must not be accepted even if env is standalone",
  );

  const ios = await registerAuthenticatedPushDevice({
    platform: "ios",
    executionEnvironment: "standalone",
    expoGoConfig: null,
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    httpRequestImpl: httpOk as never,
    notifications: previewNotifications(),
  });
  assert.equal(ios, "unsupported");

  assert.equal(
    isNativePushCompatible("", EMBEDDED_MANIFEST_EXPO_GO_CONFIG),
    false,
    "empty executionEnvironment must stay fail-closed",
  );

  console.log("OK Mobile pushNotifications.p0.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
