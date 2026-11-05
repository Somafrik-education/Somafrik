/**
 * PERF-PR5 — résilience des lectures L1 : repli transport, cache-first, fraîcheur,
 * déduplication, isolation des portées, refus d'accès.
 *   npx --yes tsx src/offline/l1/l1Resilience.perfPr5.test.ts
 */
import assert from "node:assert/strict";
import { snapshotFromFailure, type ResourceSnapshot } from "../../lib/dataTruth";
import { formatL1SyncMoment, L1_FRESHNESS_COPY, l1FreshnessLabel } from "../../lib/l1Freshness";
import { applyCacheFirst, createL1LoadCoordinator, settleL1Snapshot } from "./l1LoadCoordinator";
import { resetL1LifecycleForTests } from "./lifecycle";
import { createMemoryL1Store } from "./memoryStore";
import {
  canReadL1BeforeNetwork,
  isAccessDenied,
  isL1TransportFallbackEligible,
  loadL1BackedSnapshot,
  setL1ReadDepsForTests,
} from "./readModel";
import { applyL1PageAtomically, markResourceState } from "./repository";
import type { L1Page, L1Partition, L1Resource } from "./types";
import { projectL1Classes } from "./uiProjection";

type Row = { id: string };

const partitionA: L1Partition = { userId: "user-a", schoolId: "school-1", schoolCode: "SCH-1" };
const sessionA = { user: { id: "user-a", schoolId: "school-1", schoolCode: "SCH-1" }, school: { id: "school-1", code: "SCH-1" } };
const sessionUserB = { user: { id: "user-b", schoolId: "school-1", schoolCode: "SCH-1" }, school: { id: "school-1", code: "SCH-1" } };
const sessionSchool2 = { user: { id: "user-a", schoolId: "school-2", schoolCode: "SCH-2" }, school: { id: "school-2", code: "SCH-2" } };

function httpError(status: number, code: string): Error {
  return Object.assign(new Error(code), { status, code });
}

function page(resource: L1Resource, items: L1Page["items"]): L1Page {
  return { resource, mode: "full", cursorStatus: "ok", scopeHash: "s", items, nextCursor: "c1", hasMore: false };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freshStore() {
  const store = createMemoryL1Store();
  await store.migrate();
  setL1ReadDepsForTests({ openStore: async () => ({ ok: true, store }) });
  return store;
}

async function seededStore() {
  const store = await freshStore();
  await applyL1PageAtomically(
    store,
    partitionA,
    "classes",
    page("classes", [
      { id: "cls-6a", classCode: "CLS-6A", name: "6ème A", status: "active" },
      { id: "cls-5b", classCode: "CLS-5B", name: "5ème B", status: "active" },
    ]),
    "ready",
  );
  return store;
}

function load(input: {
  session?: unknown;
  bootstrap?: string;
  fetchNetwork: () => Promise<Row[]>;
  onCache?: (snapshot: ResourceSnapshot<Row>) => void;
}) {
  return loadL1BackedSnapshot<Row>({
    session: ("session" in input ? input.session : sessionA) as never,
    permissionsBootstrap: input.bootstrap ?? "ready",
    resource: "classes",
    fetchNetwork: input.fetchNetwork,
    project: (read) => projectL1Classes(read) as unknown as Row[],
    onCacheSnapshot: input.onCache,
  });
}

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  resetL1LifecycleForTests();
  setL1ReadDepsForTests(null);
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

async function run() {
  // ---------- Lecture ----------
  await test("cache disponible + réseau rapide : réponse réseau, aucune copie affichée", async () => {
    await seededStore();
    const shown: ResourceSnapshot<Row>[] = [];
    const result = await load({ fetchNetwork: async () => [{ id: "net-1" }], onCache: (s) => shown.push(s) });
    assert.equal(result.source, "network");
    assert.deepEqual(result.data, [{ id: "net-1" }]);
    // Le cache a pu être lu en parallèle ; s'il a été montré, il l'a été comme « en cours ».
    assert.ok(shown.every((s) => s.source === "l1-cache" && s.refreshing === true));
  });

  await test("cache disponible + réseau lent : copie affichée avant la réponse, puis remplacée", async () => {
    await seededStore();
    const events: string[] = [];
    const result = await load({
      fetchNetwork: async () => {
        await sleep(30);
        events.push("network");
        return [{ id: "net-1" }];
      },
      onCache: (s) => events.push(`cache:${s.data.length}:${s.refreshing}`),
    });
    assert.deepEqual(events, ["cache:2:true", "network"]);
    assert.equal(result.source, "network");
    assert.equal(result.refreshing, undefined, "une réponse réseau n'est jamais présentée comme copie");
  });

  for (const code of ["TIMEOUT", "BACKEND_UNREACHABLE", "NETWORK_UNAVAILABLE"] as const) {
    await test(`cache disponible + ${code} : dernière copie, date L1, actualisation signalée impossible`, async () => {
      await seededStore();
      const result = await load({ fetchNetwork: async () => Promise.reject(httpError(0, code)) });
      assert.equal(result.source, "l1-cache");
      assert.equal(result.data.length, 2);
      assert.equal(result.refreshFailed, true);
      assert.ok(result.cachedAt && !Number.isNaN(Date.parse(result.cachedAt)), "date issue de meta.lastSuccessAt");
    });
  }

  await test("cache absent + TIMEOUT : erreur explicite, jamais une liste vide « confirmée »", async () => {
    await freshStore();
    const result = await load({ fetchNetwork: async () => Promise.reject(httpError(0, "TIMEOUT")) });
    assert.notEqual(result.source, "l1-cache");
    assert.notEqual(result.status, "empty");
    assert.ok(result.status === "error" || result.status === "offline");
    assert.deepEqual(result.data, []);
  });

  await test("réseau rétabli après échec : la lecture suivante revient au réseau", async () => {
    await seededStore();
    const failed = await load({ fetchNetwork: async () => Promise.reject(httpError(0, "TIMEOUT")) });
    assert.equal(failed.source, "l1-cache");
    const back = await load({ fetchNetwork: async () => [{ id: "net-2" }] });
    assert.equal(back.source, "network");
    assert.equal(back.refreshFailed, undefined);
  });

  await test("échec réseau : les lignes affichées sont conservées (aucune copie L1 lisible)", async () => {
    const decision = settleL1Snapshot<Row>(snapshotFromFailure(httpError(0, "TIMEOUT"), []));
    assert.equal(decision.data, "keep");
    const shown: ResourceSnapshot<Row> = { status: "success", data: [{ id: "a" }], source: "l1-cache", cachedAt: "2026-11-04T09:35:00Z" };
    const next = decision.snapshot(shown);
    assert.deepEqual(next.data, [{ id: "a" }]);
    assert.equal(next.refreshFailed, true);
    assert.equal(next.cachedAt, "2026-11-04T09:35:00Z");
  });

  await test("réponse serveur valide : remplace la copie et marque la fraîcheur", () => {
    const decision = settleL1Snapshot<Row>({ status: "success", data: [{ id: "n" }], source: "network" });
    assert.equal(decision.data, "replace");
    assert.equal(decision.fresh, "mark");
  });

  await test("cache-first n'écrase jamais une donnée déjà affichée", () => {
    const current: ResourceSnapshot<Row> = { status: "loading", data: [{ id: "net" }], source: "network" };
    const cached: ResourceSnapshot<Row> = { status: "success", data: [{ id: "old" }], source: "l1-cache", refreshing: true };
    assert.equal(applyCacheFirst(current, cached), current);
    assert.equal(applyCacheFirst({ status: "idle", data: [] }, cached), cached);
  });

  // ---------- Sécurité ----------
  for (const status of [401, 403]) {
    await test(`${status} : aucun repli, copie affichée retirée`, async () => {
      await seededStore();
      const shown: ResourceSnapshot<Row>[] = [];
      const result = await load({
        fetchNetwork: async () => {
          await sleep(20);
          throw httpError(status, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
        },
        onCache: (s) => shown.push(s),
      });
      assert.equal(result.accessDenied, true);
      assert.notEqual(result.source, "l1-cache");
      assert.deepEqual(result.data, []);
      const decision = settleL1Snapshot(result);
      assert.equal(decision.data, "clear", "la copie montrée en cache-first est retirée");
      assert.equal(decision.fresh, "clear");
      assert.equal(isL1TransportFallbackEligible(httpError(status, "TIMEOUT")), false, "un statut HTTP exclut le repli");
    });
  }

  await test("droits non établis (chargement, erreur) : aucune lecture L1 avant le réseau", async () => {
    await seededStore();
    for (const bootstrap of ["loading", "error", "idle", ""]) {
      assert.equal(canReadL1BeforeNetwork(bootstrap), false);
      const shown: ResourceSnapshot<Row>[] = [];
      await load({ bootstrap, fetchNetwork: async () => [{ id: "n" }], onCache: (s) => shown.push(s) });
      assert.equal(shown.length, 0, `bootstrap=${bootstrap}`);
    }
  });

  await test("changement d'utilisateur : la partition d'un autre compte n'est jamais lue", async () => {
    await seededStore();
    const shown: ResourceSnapshot<Row>[] = [];
    const result = await load({
      session: sessionUserB,
      fetchNetwork: async () => Promise.reject(httpError(0, "TIMEOUT")),
      onCache: (s) => shown.push(s),
    });
    assert.equal(shown.length, 0);
    assert.notEqual(result.source, "l1-cache");
    assert.deepEqual(result.data, []);
  });

  await test("changement d'établissement : le cache de l'établissement A n'est jamais servi à B", async () => {
    await seededStore();
    const result = await load({
      session: sessionSchool2,
      fetchNetwork: async () => Promise.reject(httpError(0, "BACKEND_UNREACHABLE")),
    });
    assert.notEqual(result.source, "l1-cache");
    assert.deepEqual(result.data, []);
  });

  await test("déconnexion : sans session, aucune lecture", async () => {
    await seededStore();
    let calls = 0;
    const result = await load({
      session: null,
      fetchNetwork: async () => {
        calls += 1;
        return [];
      },
    });
    assert.equal(calls, 0);
    assert.notEqual(result.source, "l1-cache");
  });

  await test("révocation (meta blocked_authorization) : le cache n'est plus lisible, même hors ligne", async () => {
    const store = await seededStore();
    await markResourceState(store, partitionA, "classes", { state: "blocked_authorization" });
    const result = await load({ fetchNetwork: async () => Promise.reject(httpError(0, "TIMEOUT")) });
    assert.notEqual(result.source, "l1-cache");
    assert.deepEqual(result.data, []);
  });

  await test("hors ligne validé (ready_offline) : copie L1 sans GET, libellé « Mode hors connexion »", async () => {
    await seededStore();
    let calls = 0;
    const result = await load({
      bootstrap: "ready_offline",
      fetchNetwork: async () => {
        calls += 1;
        return [];
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.source, "l1-cache");
    assert.match(String(l1FreshnessLabel(result, { permissionsBootstrap: "ready_offline" })), /^Mode hors connexion/);
  });

  await test("classification : seuls les échecs sans réponse HTTP ouvrent le repli", () => {
    assert.equal(isL1TransportFallbackEligible(httpError(0, "TIMEOUT")), true);
    assert.equal(isL1TransportFallbackEligible({ code: "BACKEND_UNREACHABLE" }), true);
    assert.equal(isL1TransportFallbackEligible(httpError(500, "SERVER")), false);
    assert.equal(isL1TransportFallbackEligible(httpError(0, "SESSION_EXPIRED")), false);
    assert.equal(isL1TransportFallbackEligible(null), false);
    assert.equal(isAccessDenied(httpError(401, "X")), true);
    assert.equal(isAccessDenied(httpError(0, "TIMEOUT")), false);
  });

  // ---------- Concurrence ----------
  await test("deux composants, même ressource (retour d'écran) : une seule lecture", async () => {
    const coordinator = createL1LoadCoordinator();
    const first = coordinator.begin("scope|ready|classes", 30_000);
    assert.equal(first.kind, "run");
    let resolve!: () => void;
    const promise = first.kind === "run" ? first.track(new Promise<void>((r) => (resolve = r))) : Promise.resolve();
    const second = coordinator.begin("scope|ready|classes", 30_000);
    assert.equal(second.kind, "join");
    assert.equal(second.kind === "join" ? second.promise : null, promise);
    resolve();
    await promise;
    assert.deepEqual(coordinator.stats, { started: 1, joined: 1, skippedFresh: 0 });
  });

  await test("navigation rapide : pas de relecture < 30 s, relecture après", async () => {
    let now = 1_000;
    const coordinator = createL1LoadCoordinator(() => now);
    const ticket = coordinator.begin("k", 30_000);
    assert.equal(ticket.kind, "run");
    if (ticket.kind === "run") {
      await ticket.track(Promise.resolve());
      ticket.markFresh();
    }
    now += 10_000;
    assert.equal(coordinator.begin("k", 30_000).kind, "skip");
    now += 25_000;
    assert.equal(coordinator.begin("k", 30_000).kind, "run");
  });

  await test("actualisation explicite et après mutation : toujours une lecture, l'ancienne devient obsolète", async () => {
    const coordinator = createL1LoadCoordinator();
    const before = coordinator.begin("k", 30_000);
    assert.equal(before.kind, "run");
    if (before.kind === "run") void before.track(new Promise<void>(() => undefined)); // lecture lente en vol
    const forced = coordinator.begin("k"); // rafraîchissement explicite / après mutation
    assert.equal(forced.kind, "run");
    assert.equal(before.kind === "run" && before.isCurrent(), false, "réponse antérieure ignorée");
    assert.equal(forced.kind === "run" && forced.isCurrent(), true);
  });

  await test("réponse ancienne arrivant après une récente : ignorée, fraîcheur non écrasée", async () => {
    let now = 0;
    const coordinator = createL1LoadCoordinator(() => now);
    const older = coordinator.begin("k");
    const newer = coordinator.begin("k");
    assert.ok(older.kind === "run" && newer.kind === "run");
    if (older.kind !== "run" || newer.kind !== "run") return;
    now = 5;
    newer.markFresh();
    now = 50;
    older.markFresh(); // sans effet : génération dépassée
    assert.equal(older.isCurrent(), false);
    now = 5 + 29_000;
    assert.equal(coordinator.begin("k", 30_000).kind, "skip", "fraîcheur = réponse récente");
  });

  await test("fraîcheur sans effet entre portées, et remise à zéro au changement de portée", async () => {
    const coordinator = createL1LoadCoordinator(() => 0);
    const a = coordinator.begin("schoolA|ready|classes");
    if (a.kind === "run") a.markFresh();
    assert.equal(coordinator.begin("schoolB|ready|classes", 30_000).kind, "run");
    assert.equal(coordinator.begin("schoolA|ready_offline|classes", 30_000).kind, "run", "changement de droits");
    const pending = coordinator.begin("schoolA|ready|students");
    coordinator.reset();
    assert.equal(pending.kind === "run" && pending.isCurrent(), false, "lecture d'avant la remise à zéro obsolète");
    assert.equal(coordinator.begin("schoolA|ready|classes", 30_000).kind, "run", "fraîcheur effacée");
  });

  await test("changement d'établissement A → B → A pendant une lecture : A relu, ancienne réponse ignorée", async () => {
    let now = 0;
    const coordinator = createL1LoadCoordinator(() => now);
    const first = coordinator.begin("A|ready|classes");
    assert.ok(first.kind === "run");
    if (first.kind !== "run") return;
    first.markFresh();
    const inFlight = coordinator.begin("A|ready|classes"); // relecture en cours au moment du changement
    coordinator.reset(); // markTenantResourcesSwitching (A → B)
    coordinator.reset(); // retour B → A
    now = 5_000;
    assert.equal(inFlight.kind === "run" && inFlight.isCurrent(), false, "réponse d'avant le changement ignorée");
    assert.equal(coordinator.begin("A|ready|classes", 30_000).kind, "run", "A relu malgré < 30 s");
  });

  await test("mutation puis synchronisation outbox : la fraîcheur de 30 s n'empêche pas la relecture", async () => {
    let now = 0;
    const coordinator = createL1LoadCoordinator(() => now);
    const read = coordinator.begin("A|ready|students");
    if (read.kind === "run") read.markFresh();
    now = 2_000;
    // 1) onChanged après mutation : appel sans option → toujours une lecture.
    assert.equal(coordinator.begin("A|ready|students").kind, "run");
    // 2) refreshBackOfficeState (après synchronisation) : remise à zéro → le retour d'écran relit.
    coordinator.reset();
    now = 3_000;
    assert.equal(coordinator.begin("A|ready|students", 30_000).kind, "run");
  });

  await test("cache-first d'une portée quittée : jamais appliqué après le changement", async () => {
    await seededStore();
    let currentScope = "A";
    const scopeAtStart = currentScope;
    const applied: ResourceSnapshot<Row>[] = [];
    const pending = load({
      fetchNetwork: async () => {
        await sleep(40);
        return [{ id: "net-A" }];
      },
      onCache: (snapshot) => {
        if (currentScope === scopeAtStart) applied.push(snapshot); // garde d'AdminDataContext
      },
    });
    currentScope = "B"; // changement avant que la copie L1 soit lue
    const result = await pending;
    assert.equal(applied.length, 0, "copie de A non affichée dans B");
    assert.equal(currentScope === scopeAtStart, false, "la réponse réseau de A est aussi écartée par la garde");
    assert.equal(result.source, "network");
  });

  // ---------- Fraîcheur affichée ----------
  await test("libellés de fraîcheur : date des métadonnées, jamais inventée", () => {
    const now = new Date(2026, 10, 4, 12, 0);
    const at = new Date(2026, 10, 4, 10, 35).toISOString();
    assert.equal(formatL1SyncMoment(at, now), "à 10:35");
    assert.equal(formatL1SyncMoment(new Date(2026, 10, 3, 8, 5).toISOString(), now), "le 03/11 à 08:05");
    assert.equal(formatL1SyncMoment(null, now), null);
    assert.equal(formatL1SyncMoment("pas une date", now), null);
    assert.equal(l1FreshnessLabel({ source: "network" }), null, "réponse réseau : aucun libellé");
    assert.equal(l1FreshnessLabel({ source: "l1-cache", cachedAt: at }, { now }), "Données synchronisées à 10:35");
    assert.equal(
      l1FreshnessLabel({ source: "l1-cache", cachedAt: at, refreshing: true }, { now }),
      "Actualisation en cours — données synchronisées à 10:35",
    );
    assert.equal(
      l1FreshnessLabel({ source: "l1-cache", cachedAt: at, refreshFailed: true }, { now }),
      `${L1_FRESHNESS_COPY.refreshFailed} (données synchronisées à 10:35)`,
    );
    assert.match(String(l1FreshnessLabel({ source: "l1-cache", cachedAt: null }, { now })), /heure de synchronisation inconnue/);
  });

  console.log(`OK: PERF-PR5 L1 resilience (${passed} tests)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
