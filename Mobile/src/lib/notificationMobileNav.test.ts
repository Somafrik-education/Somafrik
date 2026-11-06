/**
 * NOTIF-MOBILE-NAV — résolveur unique Push + centre in-app (Android).
 * Exécution : npx tsx src/lib/notificationMobileNav.test.ts
 */
import assert from "node:assert/strict";
import {
  resolveNotificationPushData,
  resolveNotificationRecord,
  resolvePushNavigationData,
  type AllowedPushDestination,
  type AllowedPushNavigationParams,
} from "./pushNotificationDestinations";
import {
  decideNotificationOpen,
  openResolvedNotification,
  resetNotificationOpenStateForTests,
  sessionSchoolCode,
} from "./notificationNavigationOpen";
import {
  consumeInitialPushResponse,
  consumePushTapResponse,
  flushPendingPushNavigation,
  resetPushTapStateForTests,
} from "./pushNotificationTap";

const NOTIF = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OTHER_STUDENT = "33333333-3333-4333-8333-333333333333";
const CONV = "44444444-4444-4444-8444-444444444444";
const MSG = "55555555-5555-4555-8555-555555555555";
const ANN = "66666666-6666-4666-8666-666666666666";
const RES = "77777777-7777-4777-8777-777777777777";
const SLOT = "88888888-8888-4888-8888-888888888888";
const CLASS = "99999999-9999-4999-8999-999999999999";

const ALL_ROUTES = [
  "Home",
  "Messages",
  "Announcements",
  "StudentPresences",
  "StudentNotes",
  "StudentPayments",
  "ReportCards",
  "Timetable",
  "InternalNotifications",
];

const staffSession = { role: "school_admin", user: { schoolCode: "S1" }, school: { code: "S1" } };
const parentSession = {
  role: "parent_student",
  user: { schoolCode: "S1", children: [{ id: STUDENT }] },
  school: { code: "S1" },
};

/** Cibles telles que produites par `eventSpec` (backend). */
const TARGETS: Record<string, Record<string, string>> = {
  conversation: { type: "conversation", conversationId: CONV, messageId: MSG },
  announcement: { type: "announcement", announcementId: ANN },
  attendance: { type: "attendance", attendanceId: RES, studentId: STUDENT },
  grade: { type: "grade", gradeId: RES, studentId: STUDENT },
  report_card: { type: "report_card", reportCardId: RES, studentId: STUDENT },
  payment: { type: "payment", paymentId: RES, studentId: STUDENT },
  finance_obligation: { type: "finance_obligation", obligationId: RES, studentId: STUDENT },
  timetable: { type: "timetable", weeklySlotId: SLOT, classId: CLASS },
  teacher_replacement: { type: "teacher_replacement", replacementId: RES, weeklySlotId: SLOT, classId: CLASS },
};

const LEGACY: Record<string, Record<string, string>> = {
  conversation: { somafrikDestination: "Messages", somafrikConversationId: CONV },
  announcement: { somafrikDestination: "Announcements", somafrikAnnouncementId: ANN },
  finance_obligation: { somafrikDestination: "StudentPayments", somafrikStudentId: STUDENT },
};

/** Données Push #1090 : anciennes clés + contrat canonique (`canonicalPushData`). */
function pushData(type: string, overrides: Record<string, unknown> = {}) {
  const target = TARGETS[type];
  const { type: _t, ...ids } = target;
  const primary = Object.values(ids)[0];
  return {
    somafrikDestination: "Home",
    eventKey: `evt:${type}:${RES}`,
    ...(LEGACY[type] ?? {}),
    notificationId: NOTIF,
    schoolCode: "S1",
    type,
    resourceType: type,
    ...ids,
    resourceId: primary,
    ...overrides,
  };
}

function record(type: string, overrides: Record<string, unknown> = {}) {
  return { type: "notification", id: NOTIF, schoolCode: "S1", navigationTarget: TARGETS[type], ...overrides };
}

const EXPECTED: Record<string, { destination: AllowedPushDestination; params?: AllowedPushNavigationParams }> = {
  conversation: { destination: "Messages", params: { conversationId: CONV } },
  announcement: { destination: "Announcements", params: { announcementId: ANN } },
  attendance: { destination: "StudentPresences", params: { studentId: STUDENT } },
  grade: { destination: "StudentNotes", params: { studentId: STUDENT } },
  report_card: { destination: "ReportCards", params: { studentId: STUDENT } },
  payment: { destination: "StudentPayments", params: { studentId: STUDENT } },
  finance_obligation: { destination: "StudentPayments", params: { studentId: STUDENT } },
  timetable: { destination: "Timetable" },
  teacher_replacement: { destination: "Timetable" },
};

function makeRef(routeNames = ALL_ROUTES, ready = true) {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    ref: {
      isReady: () => ready,
      getRootState: () => ({ routeNames, routes: [{ name: "Home" }] }),
      navigate: (...args: never[]) => {
        calls.push([args[0] as unknown as string, args[1] as unknown]);
      },
    },
  };
}

type Case = { id: string; run: () => void | Promise<void> };

const cases: Case[] = [
  {
    id: "NAV-01 destination correcte pour chaque type (Push canonique)",
    run() {
      for (const [type, expected] of Object.entries(EXPECTED)) {
        const resolved = resolveNotificationPushData(pushData(type));
        assert.equal(resolved.resolved, true, type);
        assert.equal(resolved.destination, expected.destination, type);
        assert.deepEqual(resolved.params, expected.params, type);
        assert.deepEqual(resolved.meta, { notificationId: NOTIF, schoolCode: "S1" }, type);
      }
    },
  },
  {
    id: "NAV-02 résolution identique Push et centre in-app",
    run() {
      for (const type of Object.keys(EXPECTED)) {
        const push = resolveNotificationPushData(pushData(type));
        const inbox = resolveNotificationRecord(record(type));
        assert.deepEqual(
          { destination: inbox.destination, params: inbox.params, meta: inbox.meta },
          { destination: push.destination, params: push.params, meta: push.meta },
          type,
        );
        const decisionPush = decideNotificationOpen(push, staffSession, ALL_ROUTES);
        const decisionInbox = decideNotificationOpen(inbox, staffSession, ALL_ROUTES, { schoolCode: "S1" });
        assert.deepEqual(decisionInbox, decisionPush, type);
      }
    },
  },
  {
    id: "NAV-03 compatibilité anciens payloads",
    run() {
      assert.deepEqual(resolvePushNavigationData(LEGACY.conversation), { destination: "Messages", params: { conversationId: CONV } });
      assert.deepEqual(resolvePushNavigationData(LEGACY.announcement), { destination: "Announcements", params: { announcementId: ANN } });
      assert.deepEqual(resolvePushNavigationData(LEGACY.finance_obligation), { destination: "StudentPayments", params: { studentId: STUDENT } });
      assert.deepEqual(resolvePushNavigationData({ somafrikDestination: "Home" }), { destination: "Home" });
      assert.deepEqual(resolvePushNavigationData({ somafrikDestination: "InternalNotifications" }), { destination: "InternalNotifications" });
      // Ancien Push sans schoolCode : autorisé, le serveur reste juge de l'accès.
      const legacy = resolveNotificationPushData(LEGACY.conversation);
      const decision = decideNotificationOpen(legacy, staffSession, ALL_ROUTES);
      assert.equal(decision.ok, true);
      assert.equal(decision.ok && decision.markRead, undefined, "pas de notificationId : aucun marquage");
      // Contrat canonique prioritaire sur l'ancienne clé incohérente.
      const mixed = resolveNotificationPushData(pushData("grade", { somafrikDestination: "Messages", somafrikConversationId: CONV }));
      assert.equal(mixed.destination, "StudentNotes");
    },
  },
  {
    id: "NAV-04 refus des identifiants malformés",
    run() {
      for (const bad of ["not-a-uuid", "https://evil.example", `${STUDENT}/../x`, "", 42, null, {}, [STUDENT]]) {
        const canonical = resolveNotificationPushData(pushData("attendance", { studentId: bad, somafrikDestination: "Home" }));
        assert.equal(canonical.destination, "Home", String(bad));
        assert.equal(canonical.params, undefined);
        const legacy = resolveNotificationPushData({ somafrikDestination: "Messages", somafrikConversationId: bad });
        assert.equal(legacy.destination, "Home", String(bad));
        assert.equal(resolveNotificationRecord(record("conversation", { navigationTarget: { type: "conversation", conversationId: bad } })).resolved, false);
      }
      const badNotif = resolveNotificationPushData(pushData("grade", { notificationId: "x' OR 1=1", schoolCode: "S1;DROP" }));
      assert.deepEqual(badNotif.meta, {}, "notificationId et schoolCode invalides ignorés");
    },
  },
  {
    id: "NAV-05 refus des routes et types inconnus",
    run() {
      for (const destination of ["https://evil.example", "Payments", "Users", "javascript:alert(1)", "__proto__"]) {
        assert.equal(resolveNotificationPushData({ somafrikDestination: destination }).destination, "Home", destination);
      }
      for (const type of ["unknown", "__proto__", "constructor", "toString", "notification.manual"]) {
        assert.equal(resolveNotificationRecord({ id: NOTIF, navigationTarget: { type, studentId: STUDENT } }).resolved, false, type);
      }
      // Route non enregistrée pour la session (ex. rôle sans Bulletins) : refus, retour accueil.
      const { ref, calls } = makeRef(["Home", "Messages"]);
      const decision = openResolvedNotification(resolveNotificationPushData(pushData("report_card")), staffSession, { navigation: ref });
      assert.deepEqual(decision, { ok: false, reason: "route_unavailable" });
      assert.deepEqual(calls, [["Home", undefined]]);
    },
  },
  {
    id: "NAV-06 protection contre le changement d'établissement",
    run() {
      resetNotificationOpenStateForTests();
      const marks: string[] = [];
      const { ref, calls } = makeRef();
      const foreign = resolveNotificationPushData(pushData("conversation", { schoolCode: "S2" }));
      const decision = openResolvedNotification(foreign, staffSession, {
        navigation: ref,
        markRead: async (id) => {
          marks.push(id);
        },
      });
      assert.deepEqual(decision, { ok: false, reason: "school_mismatch" });
      assert.deepEqual(calls, [["Home", undefined]], "aucune ouverture de la conversation d'un autre établissement");
      assert.deepEqual(marks, [], "aucun marquage lu hors établissement");
      // Casse indifférente, mais même établissement.
      assert.equal(decideNotificationOpen(resolveNotificationPushData(pushData("conversation", { schoolCode: "s1" })), staffSession, ALL_ROUTES).ok, true);
      // Session plateforme (`*`) : aucun contexte d'établissement valide.
      const platform = { role: "super_admin", user: { schoolCode: "*" } };
      assert.equal(sessionSchoolCode(platform), "");
      assert.deepEqual(decideNotificationOpen(resolveNotificationPushData(pushData("conversation")), platform, ALL_ROUTES), {
        ok: false,
        reason: "school_mismatch",
      });
      assert.deepEqual(decideNotificationOpen(resolveNotificationPushData(LEGACY.conversation), platform, ALL_ROUTES), {
        ok: false,
        reason: "platform_scope",
      });
      // Centre in-app : comparé à l'établissement actif.
      assert.equal(decideNotificationOpen(resolveNotificationRecord(record("conversation")), staffSession, ALL_ROUTES, { schoolCode: "S2" }).ok, false);
    },
  },
  {
    id: "NAV-07 périmètre parent : enfant non rattaché refusé",
    run() {
      assert.equal(decideNotificationOpen(resolveNotificationPushData(pushData("attendance")), parentSession, ALL_ROUTES).ok, true);
      for (const type of ["attendance", "grade", "payment", "report_card"]) {
        const foreignChild = resolveNotificationPushData(pushData(type, { studentId: OTHER_STUDENT }));
        assert.deepEqual(decideNotificationOpen(foreignChild, parentSession, ALL_ROUTES), { ok: false, reason: "parent_scope" }, type);
      }
      // Bulletins : l'écran n'a pas de paramètre élève → présélection de l'enfant rattaché.
      const decision = decideNotificationOpen(resolveNotificationPushData(pushData("report_card")), parentSession, ALL_ROUTES);
      assert.equal(decision.ok && decision.selectStudentId, STUDENT);
      const selected: string[] = [];
      const { ref, calls } = makeRef();
      openResolvedNotification(resolveNotificationPushData(pushData("report_card")), parentSession, {
        navigation: ref,
        selectStudent: (id) => selected.push(id),
      });
      assert.deepEqual(selected, [STUDENT]);
      assert.equal(calls[0]?.[0], "ReportCards");
    },
  },
  {
    id: "NAV-08 marquage lu idempotent, erreur réseau sans effet sur la navigation",
    async run() {
      resetNotificationOpenStateForTests();
      const marks: string[] = [];
      let changed = 0;
      const { ref, calls } = makeRef();
      const deps = {
        navigation: ref,
        markRead: async (id: string, school: string) => {
          marks.push(`${school}:${id}`);
        },
        onReadChanged: () => {
          changed += 1;
        },
      };
      const resolved = resolveNotificationPushData(pushData("announcement"));
      openResolvedNotification(resolved, staffSession, deps);
      openResolvedNotification(resolved, staffSession, deps);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(marks, [`S1:${NOTIF}`], "un seul appel de marquage");
      assert.equal(changed, 1, "compteurs rafraîchis une fois");
      assert.equal(calls.length, 2, "chaque clic explicite ouvre la ressource");
      assert.ok(calls.every(([name, params]) => name === "Announcements" && (params as { announcementId?: string })?.announcementId === ANN));

      resetNotificationOpenStateForTests();
      let attempts = 0;
      const failing = makeRef();
      const failingDeps = {
        navigation: failing.ref,
        markRead: async () => {
          attempts += 1;
          throw new Error("network down");
        },
        onReadChanged: () => {
          changed += 100;
        },
      };
      openResolvedNotification(resolveNotificationPushData(pushData("grade")), parentSession, failingDeps);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(failing.calls, [["StudentNotes", { studentId: STUDENT }]], "navigation inchangée malgré l'erreur");
      assert.equal(changed, 1, "pas de rafraîchissement sur échec");
      openResolvedNotification(resolveNotificationPushData(pushData("grade")), parentSession, failingDeps);
      await new Promise((r) => setImmediate(r));
      assert.equal(attempts, 2, "après échec, un nouvel essai reste possible");
    },
  },
  {
    id: "NAV-09 reprise sans double navigation (froid + écouteur, session tardive)",
    async run() {
      resetPushTapStateForTests();
      resetNotificationOpenStateForTests();
      const marks: string[] = [];
      const { ref, calls } = makeRef();
      let session: typeof staffSession | null = null;
      const open = (destination: AllowedPushDestination, params?: AllowedPushNavigationParams, resolved?: ReturnType<typeof resolveNotificationPushData>) => {
        openResolvedNotification(resolved ?? { destination, params, resolved: false, meta: {} }, session, {
          navigation: ref,
          markRead: async (id) => {
            marks.push(id);
          },
        });
      };
      const gate = { isReady: () => true, isAuthenticated: () => Boolean(session) };
      const response = { identifier: "push-1", notification: { request: { identifier: "push-1", content: { data: pushData("conversation") } } } };
      assert.equal(await consumeInitialPushResponse(async () => response, open, gate), "queued", "application fermée, session non prête");
      assert.equal(consumePushTapResponse(response, open, gate), "ignored", "écouteur : même réponse ignorée");
      assert.equal(calls.length, 0);
      session = staffSession;
      assert.equal(flushPendingPushNavigation(open, gate), true);
      assert.equal(flushPendingPushNavigation(open, gate), false);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(calls, [["Messages", { conversationId: CONV }]], "une seule navigation après connexion");
      assert.deepEqual(marks, [NOTIF], "un seul marquage");
    },
  },
  {
    id: "NAV-10 contrôle d'établissement évalué avec la session au moment de l'ouverture",
    run() {
      resetPushTapStateForTests();
      const { ref, calls } = makeRef();
      let session: { role: string; user: { schoolCode: string }; school: { code: string } } | null = null;
      const open = (destination: AllowedPushDestination, params?: AllowedPushNavigationParams, resolved?: ReturnType<typeof resolveNotificationPushData>) => {
        openResolvedNotification(resolved!, session, { navigation: ref });
      };
      const gate = { isReady: () => true, isAuthenticated: () => Boolean(session) };
      const response = { identifier: "push-2", notification: { request: { identifier: "push-2", content: { data: pushData("payment") } } } };
      assert.equal(consumePushTapResponse(response, open, gate), "queued");
      session = { role: "school_admin", user: { schoolCode: "S2" }, school: { code: "S2" } };
      flushPendingPushNavigation(open, gate);
      assert.deepEqual(calls, [["Home", undefined]], "connexion sur un autre établissement : Push refusé");
    },
  },
  {
    id: "NAV-11 notification sans ressource, déjà lue ou archivée",
    async run() {
      // Notification manuelle (aucune cible) : le Push ouvre le centre de notifications.
      const manual = resolveNotificationPushData({ somafrikDestination: "Home", eventKey: "notification.manual:x", notificationId: NOTIF, schoolCode: "S1" });
      assert.equal(manual.destination, "InternalNotifications");
      // Dans le centre, une notification sans cible n'a pas de bouton « Ouvrir ».
      assert.equal(decideNotificationOpen(resolveNotificationRecord({ id: NOTIF, schoolCode: "S1", navigationTarget: {} }), staffSession, ALL_ROUTES).ok, false);
      // Cible vidée par le serveur (ressource d'un autre établissement, P0) : non ouvrable.
      assert.equal(resolveNotificationRecord({ id: NOTIF, navigationTarget: {} }).resolved, false);
      // Archivée / supprimée : le serveur répond 404 au marquage → aucune incidence sur la navigation.
      resetNotificationOpenStateForTests();
      const { ref, calls } = makeRef();
      openResolvedNotification(resolveNotificationPushData(pushData("announcement")), staffSession, {
        navigation: ref,
        markRead: async () => {
          throw Object.assign(new Error("Notification introuvable."), { status: 404 });
        },
      });
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(calls, [["Announcements", { announcementId: ANN }]]);
    },
  },
  {
    id: "NAV-12 navigation non prête : aucune navigation, aucun marquage",
    async run() {
      resetNotificationOpenStateForTests();
      const marks: string[] = [];
      const { ref, calls } = makeRef(ALL_ROUTES, false);
      const decision = openResolvedNotification(resolveNotificationPushData(pushData("grade")), staffSession, {
        navigation: ref,
        markRead: async (id) => {
          marks.push(id);
        },
      });
      await new Promise((r) => setImmediate(r));
      assert.equal(decision.ok, false);
      assert.deepEqual(calls, []);
      assert.deepEqual(marks, []);
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`ok - ${testCase.id}`);
  }
  console.log(`OK Mobile notificationMobileNav.test.ts (${cases.length} cas)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
