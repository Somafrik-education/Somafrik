import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  registerAuthenticatedPushDevice,
  revokeCurrentPushDevice,
  resetPushRegistrationStateForTests,
  getLastRegisteredPushTokenForTests,
  sendControlledPushTest,
  TEST_PUSH_CONFIRM,
} from "./pushNotifications";
import { isAllowlistedPushDestination } from "../lib/pushNotificationDestinations";

function granted() {
  return { status: "granted", granted: true, canAskAgain: true };
}

function denied() {
  return { status: "denied", granted: false, canAskAgain: false };
}

async function main() {
  resetPushRegistrationStateForTests();
  const posts: Array<{ path: string; init?: RequestInit }> = [];
  const httpRequestImpl = async (path: string, init?: RequestInit) => {
    posts.push({ path, init });
    return { ok: true };
  };

  const alreadyGranted = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpRequestImpl as never,
    notifications: {
      AndroidImportance: { DEFAULT: 3 },
      async setNotificationChannelAsync() {
        return undefined;
      },
      async getPermissionsAsync() {
        return granted();
      },
      async requestPermissionsAsync() {
        throw new Error("requestPermissionsAsync ne doit pas être appelé si déjà accordé");
      },
      async getExpoPushTokenAsync() {
        return { data: "ExponentPushToken[test-granted]" };
      },
    },
  });
  assert.equal(alreadyGranted, "registered");
  assert.equal(posts.length, 1);
  assert.match(String(posts[0].init?.body), /ExponentPushToken\[test-granted\]/);
  assert.match(String(posts[0].init?.body), /"appProfile":"preview"/);
  assert.doesNotMatch(String(posts[0].init?.body), /releaseProfile/);
  assert.equal(getLastRegisteredPushTokenForTests(), "ExponentPushToken[test-granted]");

  resetPushRegistrationStateForTests();
  posts.length = 0;
  let requested = false;
  const asked = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "bare",
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpRequestImpl as never,
    notifications: {
      async getPermissionsAsync() {
        return { status: "undetermined", granted: false, canAskAgain: true };
      },
      async requestPermissionsAsync() {
        requested = true;
        return granted();
      },
      async getExpoPushTokenAsync() {
        return { data: "ExponentPushToken[test-asked]" };
      },
    },
  });
  assert.equal(requested, true);
  assert.equal(asked, "registered");

  resetPushRegistrationStateForTests();
  posts.length = 0;
  const refused = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    httpRequestImpl: httpRequestImpl as never,
    notifications: {
      async getPermissionsAsync() {
        return denied();
      },
      async requestPermissionsAsync() {
        return denied();
      },
      async getExpoPushTokenAsync() {
        throw new Error("getExpoPushTokenAsync ne doit pas être appelé sans permission");
      },
    },
  });
  assert.equal(refused, "permission_denied");
  assert.equal(posts.length, 0);
  assert.equal(getLastRegisteredPushTokenForTests(), null);

  await assert.rejects(
    () =>
      registerAuthenticatedPushDevice({
        platform: "android",
        executionEnvironment: "standalone",
        getProjectId: () => null,
        httpRequestImpl: httpRequestImpl as never,
        notifications: {
          async getPermissionsAsync() {
            return granted();
          },
          async requestPermissionsAsync() {
            return granted();
          },
          async getExpoPushTokenAsync() {
            throw new Error("projectId absent");
          },
        },
      }),
    /ProjectId EAS absent/,
  );

  resetPushRegistrationStateForTests();
  posts.length = 0;
  const nativeStoreClient = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "storeClient",
    expoGoConfig: null,
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpRequestImpl as never,
    notifications: {
      async getPermissionsAsync() {
        return granted();
      },
      async requestPermissionsAsync() {
        return granted();
      },
      async getExpoPushTokenAsync() {
        return { data: "ExponentPushToken[test-store-client-native]" };
      },
    },
  });
  assert.equal(nativeStoreClient, "registered");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.path, "/mobile/push-devices");

  const expoGo = await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "storeClient",
    expoGoConfig: { hostUri: "expo-go" },
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    httpRequestImpl: httpRequestImpl as never,
  });
  assert.equal(expoGo, "unsupported");

  await sendControlledPushTest({
    httpRequestImpl: httpRequestImpl as never,
    getReleaseProfileImpl: () => "preview",
  });
  const testBody = String(posts.at(-1)?.init?.body);
  assert.match(testBody, new RegExp(TEST_PUSH_CONFIRM));
  assert.doesNotMatch(testBody, /ExponentPushToken/);

  resetPushRegistrationStateForTests();
  await registerAuthenticatedPushDevice({
    platform: "android",
    executionEnvironment: "standalone",
    getProjectId: () => "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5",
    getReleaseProfileImpl: () => "preview",
    httpRequestImpl: httpRequestImpl as never,
    notifications: {
      async getPermissionsAsync() {
        return granted();
      },
      async requestPermissionsAsync() {
        return granted();
      },
      async getExpoPushTokenAsync() {
        return { data: "ExponentPushToken[test-logout]" };
      },
    },
  });
  const revoked = await revokeCurrentPushDevice({ httpRequestImpl: httpRequestImpl as never });
  assert.equal(revoked.revoked, true);
  assert.equal(getLastRegisteredPushTokenForTests(), null);

  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "pushNotifications.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /console\.log\([^)]*expoPushToken/);
  assert.doesNotMatch(src, /safeLogger\.(info|warn|error|debug)\([^)]*expoPushToken/);
  assert.equal(isAllowlistedPushDestination("https://evil.example"), false);
  assert.equal(isAllowlistedPushDestination("Home"), true);

  console.log("OK Mobile pushNotifications.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
