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
  const migration = read("backend/db/migrations/20260829_mobile_push_devices.sql");
  const service = read("backend/lib/mobilePushDevicesService.js");
  const expo = read("backend/lib/expoPushService.js");
  const receiptsWorker = read("backend/lib/expoPushReceiptsWorker.js");
  const store = read("backend/db/mobilePushDevicesStore.js");
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const preprodCompose = read("docker-compose.preprod.yml");
  const prodCompose = read("docker-compose.production.yml");
  const appConfig = read("Mobile/app.config.js");
  const plugin = read("Mobile/plugins/withSomafrikAndroidSecurity.js");
  const mobile = read("Mobile/src/services/pushNotifications.ts");
  const runtime = read("Mobile/src/components/PushNotificationsRuntime.tsx");
  const tap = read("Mobile/src/lib/pushNotificationTap.ts");
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const auth = read("Mobile/src/context/AuthContext.tsx");
  const api = read("Mobile/src/services/api.ts");
  const gitignore = `${read(".gitignore")}\n${read("Mobile/.gitignore")}`;
  const httpTest = read("backend/lib/mobilePushDevices.http.pg.test.js");

  assert.equal(fs.existsSync(path.join(ROOT, "backend/db/migrations/20260903_mobile_push_devices.sql")), false);
  assert.match(schema, /20260829_mobile_push_devices\.sql/);
  assert.match(migration, /backend_environment/);
  assert.match(migration, /app_profile/);
  assert.doesNotMatch(migration, /release_profile TEXT NOT NULL/);
  assert.match(migration, /mobile_push_receipts/);
  const addBackendCol = migration.indexOf("ADD COLUMN IF NOT EXISTS backend_environment");
  const addAppCol = migration.indexOf("ADD COLUMN IF NOT EXISTS app_profile");
  const legacyUpdate = migration.indexOf("app_profile = COALESCE(NULLIF(app_profile, ''), release_profile)");
  assert.ok(addBackendCol > 0 && addAppCol > 0 && legacyUpdate > 0);
  assert.ok(
    addBackendCol < legacyUpdate && addAppCol < legacyUpdate,
    "ADD COLUMN backend_environment/app_profile must precede the legacy release_profile UPDATE",
  );
  assert.match(bootstrap, /applyMobilePushDevicesSchema/);
  const bootstrapFn = bootstrap.indexOf("async function ensureClientsCanonicalBootstrap");
  const platformCall = bootstrap.indexOf("applyPlatformAnnouncementsSchema", bootstrapFn);
  const pushCall = bootstrap.indexOf("applyMobilePushDevicesSchema", bootstrapFn);
  const linkingCall = bootstrap.indexOf("ensureParentLinkingConstraints", bootstrapFn);
  assert.ok(platformCall > bootstrapFn && pushCall > platformCall && linkingCall > pushCall);

  assert.match(server, /app\.post\("\/api\/mobile\/push-devices"/);
  assert.match(server, /app\.delete\("\/api\/mobile\/push-devices\/current"/);
  assert.match(server, /app\.post\(\s*"\/api\/mobile\/push-devices\/test"/);
  assert.match(server, /requirePushSelfTestEnvironment/);
  assert.match(server, /requirePushSelfTestActor/);
  assert.match(server, /pushSelfTestRateLimiter/);
  assert.match(server, /startExpoPushReceiptsWorker/);
  assert.doesNotMatch(server, /assertPushReleaseProfileConfigured/);
  assert.doesNotMatch(server, /req\.body\.userId/);
  assert.match(rbac, /POST \/api\/mobile\/push-devices\/test/);
  assert.match(rbac, /Push:TEST/);

  assert.match(preprodCompose, /APP_ENV: \$\{APP_ENV:-preproduction\}/);
  assert.match(prodCompose, /APP_ENV: \$\{APP_ENV:-production\}/);
  assert.doesNotMatch(preprodCompose, /SOMAFRIK_PUSH_RELEASE_PROFILE/);
  assert.doesNotMatch(prodCompose, /SOMAFRIK_PUSH_RELEASE_PROFILE/);

  assert.match(service, /Identité user\/school interdite depuis le client/);
  assert.match(service, /Ciblage par jeton client interdit/);
  assert.match(service, /PUSH-N1 : Android uniquement/);
  assert.match(service, /resolveAppEnv/);
  assert.match(service, /APP_PROFILES_BY_BACKEND/);
  assert.match(service, /resolvePushBackendEnvironment/);
  assert.match(service, /SOMAFRIK_PUSH_SELFTEST_ENABLED/);
  assert.match(service, /Permission push-test requise/);
  assert.match(service, /Auto-test push interdit en production/);
  assert.match(service, /Test Somafrik/);
  assert.match(service, /Les notifications push Somafrik fonctionnent correctement/);
  assert.doesNotMatch(service, /SOMAFRIK_PUSH_RELEASE_PROFILE/);
  assert.doesNotMatch(service, /body\.releaseProfile/);
  assert.match(store, /ON CONFLICT \(expo_push_token\) DO UPDATE/);
  assert.match(store, /backend_environment/);
  assert.match(store, /enqueuePushReceipts/);
  assert.match(expo, /DeviceNotRegistered/);
  assert.match(expo, /enqueuePushReceipts/);
  assert.match(expo, /ticket ≠ livraison/);
  assert.match(receiptsWorker, /next_check_at|nextCheckAt/);
  assert.match(receiptsWorker, /DeviceNotRegistered/);
  assert.match(receiptsWorker, /receipt_expired/);
  assert.match(httpTest, /authentification obligatoire/);
  assert.match(httpTest, /DeviceNotRegistered/);
  assert.match(httpTest, /preview → backend preproduction : accepté/);
  assert.match(httpTest, /preview → backend production : rejeté/);
  assert.match(httpTest, /self-test préprod protégé par permission/);
  assert.match(httpTest, /préprod sans flag interdit le self-test/);
  assert.match(httpTest, /SOMAFRIK_PUSH_SELFTEST_ENABLED: "false"/);
  assert.match(httpTest, /delete env\.SOMAFRIK_PUSH_SELFTEST_ENABLED/);
  assert.match(httpTest, /aucun getReceipts immédiat/);
  assert.match(httpTest, /rate limit/);

  assert.match(appConfig, /expo-notifications/);
  assert.match(appConfig, /somafrik-default/);
  assert.doesNotMatch(appConfig, /android\.permission\.POST_NOTIFICATIONS/);
  assert.doesNotMatch(appConfig, /android\.permission\.VIBRATE/);
  assert.match(appConfig, /googleServicesFile/);
  assert.doesNotMatch(plugin, /POST_NOTIFICATIONS/);
  assert.doesNotMatch(plugin, /android\.permission\.VIBRATE/);

  assert.match(mobile, /getExpoPushTokenAsync/);
  assert.match(mobile, /ProjectId EAS absent/);
  assert.match(mobile, /appProfile/);
  assert.doesNotMatch(mobile, /releaseProfile:/);
  assert.match(runtime, /getLastNotificationResponse/);
  assert.match(runtime, /canPersistFullSession/);
  assert.match(tap, /consumeInitialPushResponse/);
  assert.match(tap, /isAuthenticated/);
  assert.match(tap, /dismissPendingPushNavigation/);
  assert.match(tap, /resolvePushDestination/);
  assert.match(navigator, /session == null|Boolean\(session\) && canPersistFullSession/);
  assert.match(auth, /dismissPendingPushNavigation/);
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
  run(process.execPath, ["backend/lib/expoPushReceiptsWorker.test.js"], "expo receipts différés");
  run(process.execPath, ["backend/lib/rateLimit.push-selftest.test.js"], "rate limit self-test");
  run("npx", ["--yes", "tsx", "Mobile/src/services/pushNotifications.test.ts"], "mobile push unit");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/pushNotificationTap.test.ts"], "mobile cold-start tap");
  run(process.execPath, ["backend/db/clientsCanonicalBootstrap.test.js"], "clientsCanonicalBootstrap");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour PUSH-N1");
  run(process.execPath, ["backend/db/mobilePushDevicesSchema.upgrade.pg.test.js"], "upgrade schéma PUSH-N1 legacy");
  run(process.execPath, ["backend/lib/mobilePushDevices.http.pg.test.js"], "parcours HTTP PostgreSQL PUSH-N1");
  console.log("verify-mobile-push-n1: GO");
}

main();
