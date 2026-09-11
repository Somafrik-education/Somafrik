#!/usr/bin/env node
/**
 * Captures recette Communication :
 * - Web Vite : 1440 et 1024 uniquement (pas 360/390).
 * - Expo / React Native (cible web de Mobile/) : 360dp et 390dp.
 * Le harnais Expo n'est pas Vite. Il exécute Mobile/src/screens/* via expo start --web.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightEntry = require.resolve("playwright", {
  paths: ["/tmp/pw", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules")],
});
const { chromium } = require(playwrightEntry);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/audits/evidence");
const WEB_PORT = 4177;
const EXPO_PORT = 19017;
const SCHOOL = "CD-2026-0001";

const ADMIN_PERMISSIONS = [
  "Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE", "Utilisateurs:DELETE", "Utilisateurs:SUSPEND",
  "Classes:READ", "Classes:CREATE", "Classes:UPDATE", "Classes:DELETE",
  "Élèves:READ", "Élèves:CREATE", "Élèves:UPDATE", "Élèves:DELETE", "Élèves:SUSPEND",
  "Enseignants:READ", "Enseignants:CREATE",
  "Affectations:READ", "Affectations:CREATE", "Affectations:UPDATE",
  "Présences:READ", "Présences:CREATE", "Présences:UPDATE", "Notes:READ", "Bulletins:READ", "Paiements:READ",
  "Notifications:READ", "Notifications:CREATE", "Notifications:UPDATE",
  "Announcements:READ", "Announcements:CREATE", "Announcements:UPDATE",
  "Messages:READ", "Messages:CREATE", "Messages:UPDATE",
  "Documents:READ", "Documents:CREATE", "Documents:UPDATE", "Rapports:READ",
  "Paramètres Établissement:READ", "Paramètres Établissement:UPDATE",
  "Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE",
  "Matières:READ", "Matières:CREATE", "Matières:UPDATE",
  "Examens:READ", "Examens:CREATE", "Examens:UPDATE",
];

const WEB_SESSION = {
  accessToken: "smoke-access",
  refreshToken: "smoke-refresh",
  permissions: ADMIN_PERMISSIONS,
  user: {
    id: "user-smoke-admin",
    firstName: "Admin",
    lastName: "Recette",
    identifier: "admin.recette",
    role: "Admin School",
    schoolCode: SCHOOL,
    schoolPublicCode: SCHOOL,
    schoolId: "11111111-1111-4111-8111-111111111111",
    permissions: ADMIN_PERMISSIONS,
  },
};

const PLATFORM_ANNOUNCEMENT = {
  id: "ann-platform-smoke-1",
  title: "Rentrée Somafrik",
  content: "Message plateforme : les établissements ouvrent lundi.",
  announcementType: "system",
  systemBroadcast: true,
  originLabel: "Annonce Somafrik",
  senderDisplayName: "Somafrik",
  source: "platform",
  domain: "platform",
  type: "platform-announcement",
  publishedAt: "2026-09-10T08:00:00.000Z",
  createdAt: "2026-09-10T08:00:00.000Z",
  audienceLabel: "Tous les utilisateurs Somafrik",
  status: "published",
  attachments: [{ id: "att-platform-1", fileName: "calendrier.pdf" }],
};

const SCHOOL_ANNOUNCEMENT = {
  id: "ann-school-smoke-1",
  title: "Réunion parents",
  content: "Détail établissement : salle 12 à 17h.",
  message: "Détail établissement : salle 12 à 17h.",
  createdByName: "Direction",
  audienceLabel: "Parents · 6ème A",
  status: "published",
  publishedAt: "2026-09-10T09:00:00.000Z",
  schoolCode: SCHOOL,
};

const NOTIFICATION = {
  type: "notification",
  id: "notif-smoke-1",
  schoolCode: SCHOOL,
  eventType: "finance.payment.received",
  sourceEntityType: "payment",
  sourceEntityId: "pay-smoke-1",
  senderType: "system",
  senderUserId: null,
  senderName: "Comptabilité",
  title: "Paiement reçu",
  body: "Le paiement de septembre a été enregistré.",
  createdAt: "2026-09-10T10:00:00.000Z",
  publishedAt: "2026-09-10T10:00:00.000Z",
  status: "Non lu",
  attachments: [{ id: "att-notif-1", fileName: "recu-septembre.pdf" }],
  navigationTarget: { type: "payment", paymentId: "pay-smoke-1" },
};

const CONVERSATION = {
  id: "conv-smoke-1",
  schoolCode: SCHOOL,
  subject: "Absence du 10/09",
  updatedAt: "2026-09-10T11:00:00.000Z",
  unreadCount: 1,
  participants: [
    { userId: "user-parent-smoke", name: "Parent Kalala" },
    { userId: "user-smoke-admin", name: "Admin Recette" },
  ],
  lastMessage: {
    id: "msg-smoke-1",
    body: "Bonjour, Marie sera absente demain.",
    sentAt: "2026-09-10T11:00:00.000Z",
    senderUserId: "user-parent-smoke",
    senderName: "Parent Kalala",
  },
};

const THREAD = [
  {
    id: "msg-smoke-1",
    conversationId: "conv-smoke-1",
    body: "Bonjour, Marie sera absente demain matin.",
    senderUserId: "user-parent-smoke",
    senderName: "Parent Kalala",
    sentAt: "2026-09-10T11:00:00.000Z",
  },
];

function json(body) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

async function fulfillApi(route) {
  const url = new URL(route.request().url());
  const pathName = url.pathname;
  const method = route.request().method().toUpperCase();
  if (pathName.endsWith("/auth/effective-permissions")) {
    return route.fulfill(json({ permissions: ADMIN_PERMISSIONS }));
  }
  if (pathName.includes("/backoffice/platform-announcements")) {
    if (pathName.includes("/unread-count")) return route.fulfill(json({ count: 1 }));
    if (pathName.includes("/ann-platform-smoke-1") && !pathName.includes("/unread")) {
      return route.fulfill(json(PLATFORM_ANNOUNCEMENT));
    }
    return route.fulfill(json({ items: [PLATFORM_ANNOUNCEMENT], nextCursor: null }));
  }
  if (pathName.includes("/backoffice/announcements")) {
    if (pathName.includes("/unread-count")) return route.fulfill(json({ count: 1 }));
    if (pathName.includes("/audience-options")) return route.fulfill(json({ classes: [], recipientKinds: [] }));
    if (pathName.includes("/ann-school-smoke-1")) return route.fulfill(json(SCHOOL_ANNOUNCEMENT));
    return route.fulfill(json({ items: [SCHOOL_ANNOUNCEMENT], nextCursor: null }));
  }
  if (pathName.includes("/backoffice/internal-notifications")) {
    if (pathName.includes("/unread-count")) return route.fulfill(json({ count: 1 }));
    return route.fulfill(json({ items: [NOTIFICATION], nextCursor: null }));
  }
  if (pathName.includes("/backoffice/conversations") && pathName.includes("/messages")) {
    return route.fulfill(json({ items: THREAD, nextCursor: null }));
  }
  if (pathName.includes("/backoffice/conversations")) {
    return route.fulfill(json({ items: [CONVERSATION], nextCursor: null }));
  }
  if (pathName.includes("/backoffice/messages/unread-count")) {
    return route.fulfill(json({ count: 1 }));
  }
  if (pathName.includes("/backoffice/messages/recipients")) {
    return route.fulfill(json({ items: [] }));
  }
  if (pathName.includes("/backoffice/messages")) {
    return route.fulfill(json([]));
  }
  if (pathName.includes("/backoffice/establishments/") && pathName.endsWith("/academic-config")) {
    return route.fulfill(json({ schoolCode: SCHOOL }));
  }
  if (pathName.includes("/backoffice/establishments/")) {
    return route.fulfill(json({
      code: SCHOOL,
      name: "École recette Communication",
      city: "Kinshasa",
      id: "11111111-1111-4111-8111-111111111111",
    }));
  }
  if (pathName.includes("/backoffice/subscription-access")) {
    return route.fulfill(json({ level: "full", plan: "Actif" }));
  }
  if (pathName.includes("/unread-count")) {
    return route.fulfill(json({ count: 0 }));
  }
  if (method === "PATCH" || method === "POST") {
    return route.fulfill(json({ ...NOTIFICATION, readAt: "2026-09-11T00:00:00.000Z", status: "Lu" }));
  }
  return route.fulfill(json([]));
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  const onData = (chunk) => {
    output += chunk.toString();
    if (process.env.COMMUNICATION_UX_SMOKE_LOG === "1") process.stdout.write(chunk);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.output = () => output;
  return child;
}

function waitForOutput(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${pattern}\n${child.output()}`));
    }, timeoutMs);
    const check = (chunk) => {
      if (pattern.test(String(chunk)) || pattern.test(child.output())) {
        clearTimeout(timer);
        child.stdout.off("data", check);
        child.stderr.on("data", check);
        resolve();
      }
    };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    check("");
  });
}

async function waitHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout HTTP ${url}`);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

async function captureWeb(browser) {
  const page = await browser.newPage();
  await page.route("**/api/auth/**", fulfillApi);
  await page.route("**/api/backoffice/**", fulfillApi);
  await page.addInitScript((session) => {
    sessionStorage.setItem("somafrik.web.session", JSON.stringify(session));
    sessionStorage.setItem("somafrik.activeSchoolCode", "CD-2026-0001");
  }, WEB_SESSION);

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${WEB_PORT}/messages`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Communication", level: 2 }).waitFor({ timeout: 45_000 });
    await page.getByTestId("messages-conversation-item").first().click();
    await page.getByTestId("messages-thread").getByText("Marie sera absente").waitFor();
    await shot(page, `communication_web_messages_${width}.png`);

    await page.goto(`http://127.0.0.1:${WEB_PORT}/annonces`, { waitUntil: "domcontentloaded" });
    await page.getByText("Annonce Somafrik").first().waitFor();
    await shot(page, `communication_web_annonces_${width}_liste.png`);
    await page.locator('[data-testid="announcement-item"]').filter({ hasText: "Annonce Somafrik" }).click();
    await page.getByTestId("announcement-detail").getByText("Tous les utilisateurs Somafrik").waitFor();
    await shot(page, `communication_web_annonces_${width}_detail.png`);

    await page.goto(`http://127.0.0.1:${WEB_PORT}/notifications`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Afficher les détails/ }).waitFor();
    await shot(page, `communication_web_notifications_${width}_replie.png`);
    await page.getByRole("button", { name: /Afficher les détails/ }).click();
    await page.getByRole("button", { name: /^Lire$|^Ouvrir$/ }).waitFor();
    await shot(page, `communication_web_notifications_${width}_deplie.png`);
  }
  await page.close();
}

async function captureExpo(browser) {
  const page = await browser.newPage();
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`http://127.0.0.1:${EXPO_PORT}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("communication-ux-smoke-banner").waitFor({ timeout: 60_000 });
    await page.getByText("Communication").first().waitFor();

    await page.getByRole("button", { name: "Annonces" }).click();
    try {
      await page.getByText("Rentrée Somafrik").waitFor({ timeout: 20_000 });
    } catch (error) {
      await shot(page, `communication_expo_debug_${width}.png`);
      throw error;
    }
    await shot(page, `communication_expo_annonces_${width}_replie.png`);
    await page.getByRole("button", { name: /Rentrée Somafrik.*Afficher les détails/ }).click();
    await page.getByText("Tous les utilisateurs Somafrik").waitFor();
    await page.getByRole("button", { name: /Réunion parents.*Afficher les détails/ }).click();
    await page.getByRole("button", { name: /Archiver l'annonce Réunion parents/ }).waitFor();
    await shot(page, `communication_expo_annonces_${width}_deplie.png`);

    await page.getByRole("button", { name: "Notifications" }).click();
    await page.getByText("Paiement reçu").waitFor();
    await shot(page, `communication_expo_notifications_${width}_replie.png`);
    await page.getByRole("button", { name: /Paiement reçu.*Afficher les détails/ }).click();
    await page.getByText("Marquer comme lu").waitFor();
    await shot(page, `communication_expo_notifications_${width}_deplie.png`);

    await page.getByRole("button", { name: "Messages" }).click();
    await page.getByText("Parent Kalala").first().waitFor();
    await page.getByText("Conversations").scrollIntoViewIfNeeded();
    await shot(page, `communication_expo_messages_${width}_liste.png`);
    await page.getByRole("button", { name: "Parent Kalala" }).click();
    await page.getByText("Marie sera absente").first().waitFor();
    await shot(page, `communication_expo_messages_${width}_detail.png`);
  }
  await page.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const web = spawnLogged("npm", ["--prefix", "web", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(WEB_PORT)], {
    cwd: ROOT,
    env: { ...process.env, VITE_API_URL: "http://127.0.0.1:5000" },
  });
  const expo = spawnLogged("npx", ["expo", "start", "--web", "--port", String(EXPO_PORT), "--non-interactive"], {
    cwd: path.join(ROOT, "Mobile"),
    env: {
      ...process.env,
      EXPO_PUBLIC_COMMUNICATION_UX_SMOKE: "1",
      EXPO_PUBLIC_API_URL: "http://127.0.0.1:5000",
      BROWSER: "none",
      CI: "1",
    },
  });

  try {
    await waitForOutput(web, /Local:|localhost:4177/, 90_000);
    await waitHttp(`http://127.0.0.1:${WEB_PORT}/`, 90_000);
    await waitForOutput(expo, /Web is waiting on|http:\/\/localhost:19017|Bundled/, 180_000);
    await waitHttp(`http://127.0.0.1:${EXPO_PORT}`, 180_000);

    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      await captureWeb(browser);
      await captureExpo(browser);
    } finally {
      await browser.close();
    }
  } finally {
    web.kill("SIGTERM");
    expo.kill("SIGTERM");
    try { process.kill(-web.pid, "SIGTERM"); } catch { /* already gone */ }
    try { process.kill(-expo.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
