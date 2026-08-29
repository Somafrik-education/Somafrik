"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const schema = read("backend/db/mobilePushDevicesSchema.js");
  const migration = read("backend/db/migrations/20260903_mobile_push_devices.sql");
  const service = read("backend/lib/mobilePushDevicesService.js");
  const expo = read("backend/lib/expoPushService.js");
  const store = read("backend/db/mobilePushDevicesStore.js");
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  const server = read("backend/server.js");
  const appConfig = read("Mobile/app.config.js");
  const plugin = read("Mobile/plugins/withSomafrikAndroidSecurity.js");
  const mobile = read("Mobile/src/services/pushNotifications.ts");
  const api = read("Mobile/src/services/api.ts");
  const gitignore = `${read(".gitignore")}\n${read("Mobile/.gitignore")}`;
  const httpTest = read("backend/lib/mobilePushDevices.http.pg.test.js");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS mobile_push_devices/);
  assert.match(schema, /UNIQUE \(expo_push_token\)/);
  assert.match(migration, /mobile_push_devices/);
  assert.match(bootstrap, /applyMobilePushDevicesSchema/);
  const bootstrapFn = bootstrap.indexOf("async function ensureClientsCanonicalBootstrap");
  const platformCall = bootstrap.indexOf("applyPlatformAnnouncementsSchema", bootstrapFn);
  const pushCall = bootstrap.indexOf("applyMobilePushDevicesSchema", bootstrapFn);
  const linkingCall = bootstrap.indexOf("ensureParentLinkingConstraints", bootstrapFn);
  assert.ok(platformCall > bootstrapFn && pushCall > platformCall && linkingCall > pushCall);

  assert.match(server, /app\.post\("\/api\/mobile\/push-devices"/);
  assert.match(server, /app\.delete\("\/api\/mobile\/push-devices\/current"/);
  assert.match(server, /app\.post\("\/api\/mobile\/push-devices\/test"/);
  assert.doesNotMatch(server, /req\.body\.userId/);
  assert.match(service, /Identité user\/school interdite depuis le client/);
  assert.match(service, /Ciblage par jeton client interdit/);
  assert.match(service, /PUSH-N1 : Android uniquement/);
  assert.match(service, /Test Somafrik/);
  assert.match(service, /Les notifications push Somafrik fonctionnent correctement/);
  assert.match(store, /ON CONFLICT \(expo_push_token\) DO UPDATE/);
  assert.match(expo, /DeviceNotRegistered/);
  assert.match(expo, /MAX_ATTEMPTS = 3/);
  assert.match(httpTest, /authentification obligatoire/);
  assert.match(httpTest, /DeviceNotRegistered/);

  assert.match(appConfig, /expo-notifications/);
  assert.match(appConfig, /somafrik-default/);
  assert.doesNotMatch(appConfig, /android\.permission\.POST_NOTIFICATIONS/);
  assert.doesNotMatch(appConfig, /android\.permission\.VIBRATE/);
  assert.match(appConfig, /googleServicesFile/);
  assert.doesNotMatch(plugin, /POST_NOTIFICATIONS/);
  assert.doesNotMatch(plugin, /android\.permission\.VIBRATE/);

  assert.match(mobile, /getExpoPushTokenAsync/);
  assert.match(mobile, /ProjectId EAS absent/);
  assert.match(api, /revokeCurrentPushDevice/);
  assert.match(gitignore, /firebase-adminsdk/);
  assert.doesNotMatch(mobile, /console\.log\([^)]*expoPushToken/);
  const example = read("Mobile/google-services.json.example");
  assert.doesNotMatch(example, /private_key/);
  assert.match(example, /com\.somafrik\.app/);

  const trackedSecrets = spawnSync(
    "git",
    ["ls-files", "*firebase-adminsdk*", "*fcm-service-account*", "*google-fcm-service-account*"],
    { encoding: "utf8", cwd: ROOT },
  );
  assert.equal((trackedSecrets.stdout || "").trim(), "", "clé privée Firebase suivie par git");
  console.log("verify-mobile-push-n1: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["backend/lib/mobilePushDevicesService.test.js"], "push devices unit");
  run(process.execPath, ["backend/lib/expoPushService.test.js"], "expo push unit");
  run("npx", ["--yes", "tsx", "Mobile/src/services/pushNotifications.test.ts"], "mobile push unit");
  run(process.execPath, ["backend/db/clientsCanonicalBootstrap.test.js"], "clientsCanonicalBootstrap");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour PUSH-N1");
  run(process.execPath, ["backend/lib/mobilePushDevices.http.pg.test.js"], "parcours HTTP PostgreSQL PUSH-N1");
  console.log("verify-mobile-push-n1: GO");
}

main();
