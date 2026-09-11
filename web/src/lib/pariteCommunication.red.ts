/**
 * Lot Communication — écarts causaux Web (inspection du code livré).
 * Doivent échouer sur develop@193c5df3 avant GREEN.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COM_FILTER_UNREAD,
  COM_MODULE_TITLE,
  COM_RETRY,
  COM_SEARCH_PLACEHOLDER,
} from "./pariteCommunicationUxContract";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "COM-01",
    title: "Badge Messages Topbar = GET /backoffice/messages/unread-count",
    run() {
      const topbar = read("components/layout/Topbar.tsx");
      assert.match(
        topbar,
        /useMessagesUnreadCount|messagesApi\.unreadCount/,
        "Topbar compte encore les messages via scopedMessages DataContext au lieu de GET unread-count",
      );
      assert.doesNotMatch(
        topbar,
        /scopedMessages\(scopeUser, state\)\.filter/,
        "Topbar dérive encore le non-lu Messages du snapshot BackOffice",
      );
    },
  },
  {
    id: "COM-02",
    title: "Messages Web : chargement / erreur + Réessayer distincts du vide",
    run() {
      const page = read("pages/MessagesConversationsPage.tsx");
      assert.match(page, /LoadingState|Chargement/, "Messages n'expose pas d'état de chargement");
      assert.match(page, new RegExp(COM_RETRY), "Messages n'offre pas Réessayer après erreur API");
      assert.match(
        page,
        /EmptyState|Aucune conversation/,
        "Messages n'a pas d'état vide explicite",
      );
    },
  },
  {
    id: "COM-03",
    title: "Messages Web : recherche sur la liste canonique",
    run() {
      const page = read("pages/MessagesConversationsPage.tsx");
      assert.match(page, new RegExp(COM_SEARCH_PLACEHOLDER), "Messages n'a pas de champ Rechercher");
      assert.match(page, /type="search"|EntityListSearch|communication-search/);
    },
  },
  {
    id: "COM-04",
    title: "Annonces Web : audienceLabel API visible au détail, pas dans la carte compacte",
    run() {
      const page = read("pages/AnnouncementsPage.tsx");
      const listStart = page.indexOf("visibleItems.map");
      const detailStart = page.indexOf("announcement-detail");
      assert.notEqual(listStart, -1, "liste Annonces introuvable");
      assert.notEqual(detailStart, -1, "détail Annonces introuvable");
      const listBlock = page.slice(listStart, detailStart);
      const detailBlock = page.slice(detailStart);
      assert.doesNotMatch(
        listBlock,
        /row\.audienceLabel/,
        "la carte compacte Annonces répète encore audienceLabel",
      );
      assert.match(
        detailBlock,
        /audienceLabel/,
        "le panneau détail Annonces n'affiche pas audienceLabel API",
      );
    },
  },
  {
    id: "COM-05",
    title: "Chrome module Communication sur Messages / Annonces / Notifications",
    run() {
      const messages = read("pages/MessagesConversationsPage.tsx");
      const announcements = read("pages/AnnouncementsPage.tsx");
      const notifications = read("components/communications/InternalNotificationsCenter.tsx");
      const layout = read("components/layout/AppLayout.tsx");
      for (const [name, source] of [
        ["Messages", messages],
        ["Annonces", announcements],
        ["Notifications", notifications],
      ] as const) {
        assert.match(
          source,
          new RegExp(COM_MODULE_TITLE),
          `${name} n'affiche pas le titre module Communication`,
        );
      }
      assert.match(
        layout,
        /\/messages[\s\S]{0,200}Communication|Communication[\s\S]{0,200}\/messages/,
        "AppLayout ne titre pas /messages Communication",
      );
    },
  },
  {
    id: "COM-06",
    title: "Messages Web : filtre Tous / Non lus sur unreadCount API",
    run() {
      const page = read("pages/MessagesConversationsPage.tsx");
      assert.match(page, new RegExp(COM_FILTER_UNREAD), "Messages n'a pas le filtre Non lus");
      assert.match(page, /unreadCount/, "le filtre Non lus doit s'appuyer sur unreadCount serveur");
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
console.log(`parite Communication Web — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_COM_WEB_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: Communication Web");
