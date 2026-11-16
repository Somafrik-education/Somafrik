/**
 * PERF-PR5 — banc reproductible, temps SIMULÉ (minuteurs factices de node:test).
 * Vrai lecteur L1 (loadL1BackedSnapshot), vrai store mémoire L1, vrai coordinateur.
 * « Avant » = comportement historique : repli L1 sur NETWORK_UNAVAILABLE seulement,
 * pas de cache-first, pas de déduplication ni de fraîcheur.
 *   npx --yes tsx src/offline/l1/perfPr5.benchmark.ts
 * Ce ne sont pas des mesures sur appareil Android réel.
 */
import { mock } from "node:test";
import { snapshotFromFailure, snapshotFromSuccess, type ResourceSnapshot } from "../../lib/dataTruth";
import { createL1LoadCoordinator } from "./l1LoadCoordinator";
import { resetL1LifecycleForTests } from "./lifecycle";
import { createMemoryL1Store } from "./memoryStore";
import { isStrictNetworkUnavailable, loadL1BackedSnapshot, readL1Resource, setL1ReadDepsForTests } from "./readModel";
import { applyL1PageAtomically } from "./repository";
import type { L1Partition } from "./types";
import { projectL1Classes } from "./uiProjection";

type Row = { id: string };
const partition: L1Partition = { userId: "user-a", schoolId: "school-1", schoolCode: "SCH-1" };
const session = { user: { id: "user-a", schoolId: "school-1", schoolCode: "SCH-1" }, school: { id: "school-1", code: "SCH-1" } };
const otherSchool = { user: { id: "user-a", schoolId: "school-2", schoolCode: "SCH-2" }, school: { id: "school-2", code: "SCH-2" } };
const TIMEOUT_MS = 20_000;

let requests = 0;
function network(delayMs: number, outcome: "ok" | "timeout" = "ok") {
  return () => {
    requests += 1;
    return new Promise<Row[]>((resolve, reject) => {
      if (outcome === "timeout") {
        setTimeout(() => reject(Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" })), TIMEOUT_MS);
      } else {
        setTimeout(() => resolve([{ id: "fresh" }]), delayMs);
      }
    });
  };
}

async function prepare(withCache: boolean) {
  resetL1LifecycleForTests();
  const store = createMemoryL1Store();
  await store.migrate();
  if (withCache) {
    await applyL1PageAtomically(
      store,
      partition,
      "classes",
      {
        resource: "classes",
        mode: "full",
        cursorStatus: "ok",
        scopeHash: "s",
        items: [{ id: "cls-1", classCode: "C1", name: "6ème A", status: "active" }],
        nextCursor: "c",
        hasMore: false,
      },
      "ready",
    );
  }
  setL1ReadDepsForTests({ openStore: async () => ({ ok: true, store }) });
}

/** Modèle du code historique (avant PERF-PR5). */
async function legacyLoad(fetchNetwork: () => Promise<Row[]>, sess: unknown = session): Promise<ResourceSnapshot<Row>> {
  try {
    return snapshotFromSuccess(await fetchNetwork(), { source: "network" });
  } catch (error) {
    if (!isStrictNetworkUnavailable(error)) return snapshotFromFailure(error, []);
    const read = await readL1Resource({ session: sess as never, resource: "classes" });
    return read.ok ? snapshotFromSuccess(projectL1Classes(read) as unknown as Row[], { source: "l1-cache" }) : snapshotFromFailure(error, []);
  }
}

async function measure(
  run: (onCache: (s: ResourceSnapshot<Row>) => void) => Promise<ResourceSnapshot<Row>>,
  authorizedCacheExists: boolean,
) {
  const start = Date.now();
  let cacheAt: number | null = null;
  let finalAt: number | null = null;
  let final: ResourceSnapshot<Row> | null = null;
  void run(() => {
    cacheAt ??= Date.now() - start;
  }).then((snapshot) => {
    finalAt = Date.now() - start;
    final = snapshot;
  });
  for (let elapsed = 0; elapsed < TIMEOUT_MS + 1_000 && finalAt === null; elapsed += 10) {
    mock.timers.tick(10);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }
  const snapshot = final as ResourceSnapshot<Row> | null;
  return {
    cacheShownMs: cacheAt,
    freshShownMs: snapshot?.source === "network" ? finalAt : null,
    settledMs: finalAt,
    rowsShown: snapshot?.data.length ?? 0,
    source: snapshot?.source ?? null,
    emptyScreen: (snapshot?.data.length ?? 0) === 0 && cacheAt === null,
    // Écran laissé vide alors qu'une copie L1 autorisée existait pour cette session.
    emptyDespiteAuthorizedCache: authorizedCacheExists && (snapshot?.data.length ?? 0) === 0 && cacheAt === null,
  };
}

const after = (fetchNetwork: () => Promise<Row[]>, sess: unknown = session) => (onCache: (s: ResourceSnapshot<Row>) => void) =>
  loadL1BackedSnapshot<Row>({
    session: sess as never,
    permissionsBootstrap: "ready",
    resource: "classes",
    fetchNetwork,
    project: (read) => projectL1Classes(read) as unknown as Row[],
    onCacheSnapshot: onCache,
  });

async function main() {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const results: Record<string, unknown> = {};
  const scenario = async (name: string, withCache: boolean, delay: number, outcome: "ok" | "timeout" = "ok") => {
    await prepare(withCache);
    requests = 0;
    const before = await measure(() => legacyLoad(network(delay, outcome)), withCache);
    const beforeRequests = requests;
    await prepare(withCache);
    requests = 0;
    const now = await measure(after(network(delay, outcome)), withCache);
    results[name] = { before: { ...before, requests: beforeRequests }, after: { ...now, requests } };
  };

  await scenario("ouverture sans cache (réseau 300 ms)", false, 300);
  await scenario("ouverture avec cache (réseau 300 ms)", true, 300);
  await scenario("forte latence (réseau 3 000 ms)", true, 3_000);
  await scenario("timeout HTTP 20 s, avec cache", true, 0, "timeout");
  await scenario("timeout HTTP 20 s, sans cache", false, 0, "timeout");

  // Retour rapide entre deux écrans : 2 retours à 10 s d'intervalle après une lecture.
  {
    const coordinator = createL1LoadCoordinator(() => Date.now());
    let net = 0;
    const visit = async (maxAgeMs?: number) => {
      const ticket = coordinator.begin("scope|ready|classes", maxAgeMs);
      if (ticket.kind !== "run") return;
      net += 1;
      await ticket.track(Promise.resolve());
      ticket.markFresh();
    };
    await visit();
    mock.timers.tick(10_000);
    await visit(30_000);
    mock.timers.tick(10_000);
    await visit(30_000);
    results["retour rapide entre écrans (3 visites en 20 s)"] = {
      before: { requests: 3 },
      after: { requests: net, skippedFresh: coordinator.stats.skippedFresh },
    };
  }

  // Plusieurs lectures simultanées : 4 composants demandent la même ressource.
  {
    const coordinator = createL1LoadCoordinator(() => Date.now());
    let net = 0;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 4; i += 1) {
      const ticket = coordinator.begin("scope|ready|students", 30_000);
      if (ticket.kind === "join") promises.push(ticket.promise);
      if (ticket.kind === "run") {
        net += 1;
        promises.push(ticket.track(new Promise<void>((resolve) => setTimeout(resolve, 300))));
      }
    }
    mock.timers.tick(300);
    await Promise.all(promises);
    results["lectures simultanées (4 composants)"] = {
      before: { requests: 4 },
      after: { requests: net, deduplicated: coordinator.stats.joined },
    };
  }

  // Reconnexion : un délai dépassé puis le réseau revient.
  {
    await prepare(true);
    requests = 0;
    const cut = await measure(after(network(0, "timeout")), true);
    const back = await measure(after(network(300)), true);
    results["reconnexion après interruption"] = { interrupted: cut, reconnected: back, requests };
  }

  // Changement d'établissement : la copie de l'établissement A n'est jamais servie à B.
  {
    await prepare(true);
    requests = 0;
    // Aucune copie autorisée pour B : la copie de A existe mais ne doit jamais apparaître.
    const switched = await measure(after(network(0, "timeout"), otherSchool), false);
    results["changement d'établissement (B, réseau en délai)"] = { after: switched };
  }

  mock.timers.reset();
  console.log(`PERF-PR5-BENCH ${JSON.stringify(results, null, 1)}`);
}

void main();
