/**
 * Lot Communication — écarts causaux Mobile (inspection du code livré).
 * Doivent échouer sur develop@193c5df3 avant GREEN.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COM_MODULE_TITLE, COM_SEARCH_PLACEHOLDER, COM_FILTER_UNREAD } from "./pariteCommunicationUxContract";

const mobileRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(mobileRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "COM-10",
    title: "Messages Mobile liste GET /backoffice/conversations",
    run() {
      const screen = read("screens/MessagesScreen.tsx");
      const hydration = read("services/domainHydrationApi.ts");
      assert.match(
        `${screen}\n${hydration}`,
        /\/backoffice\/conversations/,
        "MessagesScreen hydrate encore GET /backoffice/messages plat au lieu des conversations",
      );
      assert.match(
        screen,
        /getCanonicalConversations|listConversations/,
        "MessagesScreen n'appelle pas la liste conversations",
      );
    },
  },
  {
    id: "COM-11",
    title: "Messages Mobile ne refiltre pas la liste canonique par parentPhone/direction",
    run() {
      const screen = read("screens/MessagesScreen.tsx");
      assert.doesNotMatch(
        screen,
        /parentPhone === parentPhone/,
        "MessagesScreen masque encore des fils canoniques via parentPhone",
      );
      assert.doesNotMatch(
        screen,
        /direction === "Parent vers enseignant"/,
        "MessagesScreen masque encore des fils canoniques via direction métier locale",
      );
    },
  },
  {
    id: "COM-12",
    title: "Messages Mobile : non lu = GET /messages/unread-count",
    run() {
      const screen = read("screens/MessagesScreen.tsx");
      assert.match(
        screen,
        /unread-count|getMessagesUnreadCount|useMessagesUnreadCount/,
        "MessagesScreen compte encore les non lus via MessageService local",
      );
      assert.doesNotMatch(
        screen,
        /countUnreadForRole/,
        "MessagesScreen utilise encore countUnreadForRole (statuts Nouveau/direction)",
      );
    },
  },
  {
    id: "COM-13",
    title: "KPI Accueil Messages = unread-count, pas status Nouveau + direction",
    run() {
      const home = read("screens/HomeScreen.tsx");
      assert.match(
        home,
        /getMessagesUnreadCount|useMessagesUnreadCount/,
        "Accueil ne lit pas GET /messages/unread-count",
      );
      assert.doesNotMatch(
        home,
        /status === "Nouveau"/,
        "Accueil dérive encore le KPI Messages de status === Nouveau",
      );
    },
  },
  {
    id: "COM-14",
    title: "C4 Mobile : compteur non lu = GET unread-count, pas la page chargée",
    run() {
      const screen = read("screens/InternalNotificationsScreen.tsx");
      assert.match(
        screen,
        /getInternalNotificationsUnreadCount|useInternalNotificationsUnreadCount/,
        "InternalNotificationsScreen n'utilise pas le compteur serveur",
      );
      assert.doesNotMatch(
        screen,
        /rows\.filter\(\(row\) => !row\.readAt\)/,
        "le sous-titre C4 compte encore les lignes de la page chargée",
      );
    },
  },
  {
    id: "COM-15",
    title: "C4 Mobile consomme nextCursor",
    run() {
      const screen = read("screens/InternalNotificationsScreen.tsx");
      const api = read("services/internalNotificationsApi.ts");
      assert.match(screen, /nextCursor/, "InternalNotificationsScreen ignore nextCursor");
      assert.match(
        api,
        /cursor/,
        "listInternalNotifications n'accepte pas le curseur serveur",
      );
    },
  },
  {
    id: "COM-16",
    title: "Menu Mobile expose Messages si le droit existe",
    run() {
      const menu = read("screens/MenuScreen.tsx");
      assert.match(
        menu,
        /route:\s*"Messages"/,
        "MenuScreen n'a pas d'entrée Messages (Annonces/Notifications seulement)",
      );
    },
  },
  {
    id: "COM-17",
    title: "Chrome Communication sur Messages / Annonces / Notifications Mobile",
    run() {
      const messages = read("screens/MessagesScreen.tsx");
      const announcements = read("screens/AnnouncementsScreen.tsx");
      const notifications = read("screens/InternalNotificationsScreen.tsx");
      for (const [name, source] of [
        ["Messages", messages],
        ["Annonces", announcements],
        ["Notifications", notifications],
      ] as const) {
        assert.match(
          source,
          new RegExp(COM_MODULE_TITLE),
          `${name} Mobile n'affiche pas le titre module Communication`,
        );
        assert.match(
          source,
          new RegExp(COM_SEARCH_PLACEHOLDER),
          `${name} Mobile n'a pas Rechercher`,
        );
        assert.match(
          source,
          new RegExp(COM_FILTER_UNREAD),
          `${name} Mobile n'a pas le filtre Non lus`,
        );
      }
    },
  },
];

const failed: { id: string; title: string; message: string }[] = [];
const passedIds: string[] = [];
for (const testCase of cases) {
  try {
    testCase.run();
    passedIds.push(testCase.id);
  } catch (error) {
    failed.push({
      id: testCase.id,
      title: testCase.title,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const failedIds = failed.map((item) => item.id);
console.log(`parite Communication Mobile — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_COM_MOBILE_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: Communication Mobile");
