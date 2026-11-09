/**
 * NFC-STATUT-PRESENCE-01 — revue CTO : isolation des statuts NFC locaux affichés par l'écran des
 * présences, par environnement / établissement / compte / classe / date, et absence de blocage
 * de la lecture NFC suivante.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/session/localRollCallIsolation.test.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import type { AttendanceStatus } from "../../../lib/attendanceTruth";
import { createRollCallAccountManager, type RcActiveAccount } from "../store/accountManager";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import { openDraftSession, recordScan, type RcContext } from "../store/repository";
import type { RcIdentity } from "../store/database";
import {
  createLocalRollCallStatusLoader,
  localRollCallScopeKey,
  notifyWithoutBlocking,
  statusesForScope,
  type LocalStatusesResult,
} from "./localRollCallStatusLoader";
import { loadLocalRollCallStatuses } from "./localRollCallStatuses";

const ENV = "production-3f2a9c1d";
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "55555555-5555-4555-8555-555555555555";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "66666666-6666-4666-8666-666666666666";
// Même classe et mêmes élèves dans les deux comptes : le pire cas de collision.
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const IDS = Array.from({ length: 35 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`);
const ROWS = IDS.map((id) => ({ id }));
const A: RcIdentity = { environmentId: ENV, schoolId: SCHOOL_A, userId: USER_A };
const B: RcIdentity = { environmentId: ENV, schoolId: SCHOOL_B, userId: USER_B };
const scopeOf = (identity: RcIdentity, extra: Partial<{ classId: string; date: string }> = {}) => ({ ...identity, classId: CLASS, date: DATE, ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const fakeCtx = (label: string) => ({ label }) as unknown as RcContext;

function harness() {
  const accounts = { A: { identity: A, ctx: fakeCtx("A") }, B: { identity: B, ctx: fakeCtx("B") } };
  let active: { identity: RcIdentity; ctx: RcContext } | null = accounts.A;
  const applied: LocalStatusesResult[] = [];
  const reads: Array<{ ctx: RcContext; gate: ReturnType<typeof deferred<Record<string, AttendanceStatus>>> }> = [];
  const loader = createLocalRollCallStatusLoader({
    currentAccount: () => active,
    apply: (result) => applied.push(result),
    read: async (ctx) => {
      const gate = deferred<Record<string, AttendanceStatus>>();
      reads.push({ ctx, gate });
      return gate.promise;
    },
  });
  return { accounts, loader, applied, reads, activate: (next: keyof typeof accounts | null) => (active = next ? accounts[next] : null) };
}

const A_STATUSES = Object.fromEntries(IDS.slice(0, 22).map((id) => [id, "Présent"])) as Record<string, AttendanceStatus>;
const B_STATUSES = Object.fromEntries(IDS.slice(0, 3).map((id) => [id, "Présent"])) as Record<string, AttendanceStatus>;

test("clé de portée : environnement, établissement, compte, classe et date ; incomplète → aucune lecture", () => {
  const base = localRollCallScopeKey(scopeOf(A));
  assert.ok(base);
  for (const variant of [
    { ...scopeOf(A), environmentId: "staging-1" },
    scopeOf({ ...A, schoolId: SCHOOL_B }),
    scopeOf({ ...A, userId: USER_B }),
    scopeOf(A, { classId: "77777777-7777-4777-8777-777777777777" }),
    scopeOf(A, { date: "2026-11-10" }),
  ]) assert.notEqual(localRollCallScopeKey(variant), base);
  assert.equal(localRollCallScopeKey(null), null);
  assert.equal(localRollCallScopeKey({ ...scopeOf(A), userId: "" }), null);
  assert.equal(localRollCallScopeKey({ ...scopeOf(A), environmentId: "" }), null);
});

test("lecture SQLCipher de A retardée, activation de B (même classe, mêmes élèves) : rien de A n'apparaît dans B", async () => {
  const h = harness();
  h.loader.setScope(scopeOf(A));
  const pendingA = h.loader.reload(ROWS);
  // Changement de compte pendant la lecture : portée B, base B active.
  h.activate("B");
  const keyB = h.loader.setScope(scopeOf(B));
  const pendingB = h.loader.reload(ROWS);
  h.reads[0].gate.resolve(A_STATUSES); // réponse tardive de A
  assert.equal(await pendingA, "stale");
  h.reads[1].gate.resolve(B_STATUSES);
  assert.equal(await pendingB, "applied");
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].scopeKey, keyB);
  assert.deepEqual(h.applied[0].statuses, B_STATUSES);
  assert.equal(h.reads[1].ctx, h.accounts.B.ctx, "B lu dans SA base");
  // Même si un résultat de A était encore en mémoire, l'affichage le filtre par clé.
  const resultA: LocalStatusesResult = { scopeKey: localRollCallScopeKey(scopeOf(A))!, statuses: A_STATUSES };
  assert.deepEqual(statusesForScope(resultA, keyB), {});
});

test("compte changé sans changement de portée à l'écran (base B active, portée encore A) : lecture refusée", async () => {
  const h = harness();
  h.activate("B");
  h.loader.setScope(scopeOf(A));
  assert.equal(await h.loader.reload(ROWS), "other_account");
  assert.equal(h.reads.length, 0, "aucune lecture dans la base d'un autre compte");
  assert.deepEqual(h.applied, [{ scopeKey: localRollCallScopeKey(scopeOf(A)), statuses: {} }]);
});

test("base remplacée pendant la lecture (déconnexion puis activation de B) : résultat de A jeté", async () => {
  const h = harness();
  h.loader.setScope(scopeOf(A));
  const pending = h.loader.reload(ROWS);
  h.activate(null); // déconnexion
  h.activate("B"); // activation B, portée de l'écran pas encore mise à jour
  h.reads[0].gate.resolve(A_STATUSES);
  assert.equal(await pending, "stale");
  assert.equal(h.applied.length, 0);
});

test("réponse après fermeture de l'écran : jamais appliquée", async () => {
  const h = harness();
  h.loader.setScope(scopeOf(A));
  const pending = h.loader.reload(ROWS);
  h.loader.cancel();
  h.reads[0].gate.resolve(A_STATUSES);
  assert.equal(await pending, "stale");
  assert.equal(h.applied.length, 0);
});

test("lectures dans le désordre : seule la plus récente s'applique ; reprise de A après B", async () => {
  const h = harness();
  const keyA = h.loader.setScope(scopeOf(A));
  const first = h.loader.reload(ROWS);
  const second = h.loader.reload(ROWS);
  h.reads[1].gate.resolve(A_STATUSES);
  h.reads[0].gate.resolve({});
  assert.deepEqual([await first, await second], ["stale", "applied"]);
  assert.deepEqual(h.applied.map((r) => r.statuses), [A_STATUSES], "l'ancienne lecture (vide) n'écrase pas la récente");
  // B puis retour à A : A relu dans sa propre base.
  h.activate("B");
  h.loader.setScope(scopeOf(B));
  const b = h.loader.reload(ROWS);
  h.reads[2].gate.resolve(B_STATUSES);
  await b;
  h.activate("A");
  assert.equal(h.loader.setScope(scopeOf(A)), keyA);
  const back = h.loader.reload(ROWS);
  h.reads[3].gate.resolve(A_STATUSES);
  assert.equal(await back, "applied");
  assert.equal(h.reads[3].ctx, h.accounts.A.ctx);
  assert.deepEqual(h.applied.at(-1), { scopeKey: keyA, statuses: A_STATUSES });
});

async function realAccount(platform: ReturnType<typeof createTestPlatform>, identity: RcIdentity) {
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(identity);
  assert.ok(opened.ok);
  return { manager, account: (opened as { account: RcActiveAccount }).account };
}

async function scanStudents(ctx: RcContext, count: number) {
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: null, syncDeadline: null });
  for (let i = 0; i < count; i += 1) {
    await recordScan(ctx, {
      sessionId: session.session_id,
      scanId: crypto.randomUUID(),
      publicId: crypto.randomBytes(16).toString("base64url"),
      proof: crypto.randomBytes(32).toString("base64url"),
      medium: "nfc",
      scannedAt: "2026-11-09T07:31:00.000Z",
      match: { matchKey: `MK-${i}`, studentId: IDS[i % IDS.length] },
    });
  }
  return session;
}

test("SQLCipher réel : deux comptes, même classe et mêmes élèves ; chaque base ne montre que ses scans", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-isolation-"));
  const platform = createTestPlatform({ dir, now: { ms: Date.parse("2026-11-09T08:00:00Z") } });
  const a = await realAccount(platform, A);
  await scanStudents(a.account.ctx, 22);
  await a.manager.close();
  const b = await realAccount(platform, B);
  await scanStudents(b.account.ctx, 3);
  let active: RcActiveAccount | null = b.account;
  const applied: LocalStatusesResult[] = [];
  const loader = createLocalRollCallStatusLoader({ currentAccount: () => active, apply: (r) => applied.push(r) });
  // Portée A pendant que la base B est ouverte : aucune lecture, rien affiché.
  loader.setScope(scopeOf(A));
  assert.equal(await loader.reload(ROWS), "other_account");
  assert.deepEqual(applied.at(-1)?.statuses, {});
  // Portée B : exactement les 3 scans de B, jamais les 22 de A.
  loader.setScope(scopeOf(B));
  assert.equal(await loader.reload(ROWS), "applied");
  assert.deepEqual(Object.keys(applied.at(-1)!.statuses).sort(), IDS.slice(0, 3).sort());
  // Retour à A : la base A est rouverte par le gestionnaire de compte, pas par l'écran.
  await b.manager.close();
  const a2 = await realAccount(platform, A);
  active = a2.account;
  loader.setScope(scopeOf(A));
  assert.equal(await loader.reload(ROWS), "applied");
  assert.equal(Object.keys(applied.at(-1)!.statuses).length, 22);
  await a2.manager.close();
});

test("performance : relecture post-scan différée, jamais attendue par la lecture NFC suivante", async () => {
  // 1. La notification ne s'exécute pas dans la boucle de lecture : elle est planifiée.
  const scheduled: Array<() => void> = [];
  let called = 0;
  notifyWithoutBlocking(() => (called += 1), (fn) => scheduled.push(fn));
  assert.equal(called, 0, "retour immédiat, avant toute relecture");
  scheduled[0]();
  assert.equal(called, 1);
  notifyWithoutBlocking(() => {
    throw new Error("écran indisponible");
  }, (fn) => fn()); // une erreur de l'écran n'interrompt jamais l'appel

  // 2. Durée mesurée d'une relecture (Node + SQLite chiffré de test, PAS un appareil Android).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-perf-"));
  const { manager, account } = await realAccount(createTestPlatform({ dir, now: { ms: Date.parse("2026-11-09T08:00:00Z") } }), A);
  await scanStudents(account.ctx, 35);
  const sample = async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      await loadLocalRollCallStatuses(account.ctx, { classId: CLASS, date: DATE, students: ROWS });
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    return { median: times[10], p95: times[18] };
  };
  const at35 = await sample();
  console.log(`  relecture locale (35 scans) : médiane ${at35.median.toFixed(2)} ms, p95 ${at35.p95.toFixed(2)} ms`);
  assert.ok(at35.p95 < 250, `relecture trop lente : ${at35.p95} ms`);
  await manager.close();

  // 3. Le source de la modale : la relecture de l'écran n'est jamais attendue dans submitToken.
  const modal = fs.readFileSync(path.join(__dirname, "../../../components/OfflineRollCallModal.tsx"), "utf8");
  assert.match(modal, /notifyWithoutBlocking\(onLocalChangeRef\.current\)/);
  assert.doesNotMatch(modal, /await\s+onLocalChange/);
  const screen = fs.readFileSync(path.join(__dirname, "../../../screens/TeacherAttendanceScreen.tsx"), "utf8");
  assert.match(screen, /statusesForScope\(localRollCallResult, localRollCallKey\)/);
  assert.match(screen, /setLocalRollCallResult\(null\);\s*\n\s*localLoaderRef\.current\?\.setScope\(localRollCallScope\)/, "purge synchrone au changement de portée");
  assert.match(screen, /localLoaderRef\.current\?\.cancel\(\)/);
  assert.match(screen, /identityFor\(session\)/);
});
