"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label, cwd = ROOT) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const inventory = read("docs/audits/web-push-inventory-2026-09-14.md");
  const operator = read("docs/audits/web-push-operator-vapid-2026-09-14.md");
  const migration = read("backend/db/migrations/20260914_web_push_subscriptions.sql");
  const store = read("backend/db/webPushSubscriptionsStore.js");
  const service = read("backend/lib/webPushSubscriptionsService.js");
  const sender = read("backend/lib/webPushService.js");
  const fanout = read("backend/lib/communicationChannelFanout.js");
  const server = read("backend/server.js");
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  const sw = read("web/public/sw.js");
  const permission = read("web/src/lib/webPushPermission.ts");
  const routing = read("web/src/lib/webPushClickRouting.ts");
  const runtime = read("web/src/components/WebPushRuntime.tsx");
  const layout = read("web/src/components/layout/AppLayout.tsx");
  const envExample = `${read(".env.example")}\n${read(".env.preproduction.example")}\n${read(".env.production.example")}`;

  assert.match(inventory, /ABSENT|ABSENTE/);
  assert.match(operator, /STOP opérateur/);
  assert.match(operator, /VAPID_PRIVATE_KEY/);
  assert.match(migration, /web_push_subscriptions/);
  assert.match(migration, /school_id UUID NOT NULL/);
  assert.match(store, /school_id\s*=\s*\$/);
  assert.match(service, /Identité user\/school interdite depuis le client/);
  assert.match(service, /vapidPublicKey/);
  assert.doesNotMatch(service, /vapidPrivateKey/);
  assert.match(sender, /statusCode === 410|EXPIRED_STATUSES/);
  assert.match(fanout, /dispatchWebPush/);
  assert.match(fanout, /webPushDataForDelivery/);
  assert.match(fanout, /createExpoPushService/);
  assert.match(server, /\/api\/web\/push-config/);
  assert.match(server, /\/api\/web\/push-subscriptions/);
  assert.match(bootstrap, /applyWebPushSubscriptionsSchema/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /resolveWebPushClickPath/);
  assert.doesNotMatch(sw, /clients\.openWindow\(\s*(event\.)?notification\.data\.url/);
  assert.match(permission, /permission === "denied"/);
  assert.match(routing, /url|href/);
  assert.match(runtime, /syncWebPushSubscription/);
  assert.doesNotMatch(runtime, /catch\(\(\)\s*=>\s*undefined\)/);
  assert.match(layout, /<WebPushRuntime/);
  const auth = read("web/src/context/AuthContext.tsx");
  assert.match(auth, /revokeWebPushOnSessionEnd/);
  assert.match(auth, /WEB_PUSH_REVOKE_BUDGET_MS/);
  const getSubStart = permission.indexOf("async function defaultGetSubscription");
  const getSubEnd = permission.indexOf("function logRevokeFailure");
  assert.ok(getSubStart >= 0 && getSubEnd > getSubStart, "defaultGetSubscription manquante");
  const getSubFn = permission.slice(getSubStart, getSubEnd);
  assert.match(getSubFn, /getRegistration/);
  assert.doesNotMatch(getSubFn, /\.ready/);
  assert.match(permission, /WEB_PUSH_REVOKE_BUDGET_MS/);
  const logoutTest = read("web/src/lib/AuthContext.logout.test.tsx");
  assert.match(logoutTest, /VAPID disabled \/ aucun service worker enregistré/);
  assert.match(fanout, /isolateProvider/);
  assert.match(fanout, /already_sent/);
  const serviceTest = read("backend/lib/webPushSubscriptionsService.test.js");
  const deliveryTest = read("backend/lib/webPushDelivery.test.js");
  assert.match(serviceTest, /auth:\s*"test-web-push-auth-key"/);
  assert.match(deliveryTest, /auth:\s*"test-web-push-auth-key"/);
  assert.match(serviceTest, /p256dh:\s*"test-web-push-p256dh-key"/);
  assert.match(deliveryTest, /p256dh:\s*"test-web-push-p256dh-key"/);
  assert.match(envExample, /# VAPID_PUBLIC_KEY=/);
  assert.match(envExample, /# VAPID_PRIVATE_KEY=/);
  assert.doesNotMatch(envExample, /VAPID_PRIVATE_KEY=[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(read("backend/lib/webPushSubscriptionsService.js"), /BEGIN (EC |RSA )?PRIVATE KEY/);
  assert.doesNotMatch(read("web/src/lib/webPushPermission.ts"), /VAPID_PRIVATE_KEY/);
  assert.doesNotMatch(read("web/public/sw.js"), /VAPID_PRIVATE_KEY|firebaseConfig|apiKey/);
}

function main() {
  sourceGuards();
  run(process.execPath, ["--test", "backend/lib/webPushSubscriptionsService.test.js"], "web push service");
  run(process.execPath, ["--test", "backend/lib/webPushSubscriptions.tenant.test.js"], "web push tenant");
  run(process.execPath, ["--test", "backend/lib/webPushDelivery.test.js"], "web push delivery");
  run(process.execPath, ["--test", "backend/lib/communicationChannelFanout.test.js"], "fan-out PUSH existant");
  run(
    "npm",
    [
      "run",
      "test",
      "--",
      "src/lib/webPushPermission.test.ts",
      "src/lib/webPushClickRouting.test.ts",
      "src/lib/AuthContext.webPush.logout.test.tsx",
      "src/lib/AuthContext.logout.test.tsx",
      "src/components/WebPushRuntime.test.tsx",
    ],
    "web push client",
    path.join(ROOT, "web"),
  );
  console.log("verify-web-push.js OK");
}

main();
