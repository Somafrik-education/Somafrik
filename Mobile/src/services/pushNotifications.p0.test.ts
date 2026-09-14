import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  registerAuthenticatedPushDevice,
  resetPushRegistrationStateForTests,
  getLastPushRegistrationOutcome,
} from "./pushNotifications";
import { SOMAFRIK_PUSH_CHANNEL_ID } from "../lib/pushNotificationDestinations";

const here = path.dirname(fileURLToPath(import.meta.url));

function granted() {
  return { status: "granted", granted: true, canAskAgain: true };
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

  console.log("OK Mobile pushNotifications.p0.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
