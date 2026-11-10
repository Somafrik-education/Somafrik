/**
 * NFC-PRES-LOCAL-PR3 — déconnexion : immédiate sans appel en attente (contrat MP-011), confirmée
 * avec appel en attente, jamais destructive sur erreur de lecture SQLCipher.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/runtime/logoutFlow.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import { listSessions, openDraftSession, recordScan, type RcContext } from "../store/repository";
import { createLogoutFlow, type LogoutConfirmation } from "./logoutFlow";
import { createRollCallRuntime } from "./rollCallRuntime";

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const OTHER_TEACHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLASS = "33333333-3333-4333-8333-333333333333";
const ENV = () => ({ environmentId: "production-3f2a9c1d", releaseProfile: "production" });
const session = (userId: string, role = "teacher") => ({ role, user: { id: userId, schoolId: SCHOOL }, school: { id: SCHOOL } });
type Session = ReturnType<typeof session> | null;

function setup(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-logout-${label}-`));
  const platform = createTestPlatform({ dir });
  const runtime = createRollCallRuntime({ platform, environment: ENV });
  return { dir, platform, runtime };
}

/** Écran de confirmation simulé : enregistre les demandes, répond quand le test le décide. */
function harness(runtime: ReturnType<typeof createRollCallRuntime>, initial: Session) {
  const state = { session: initial as Session, cleared: 0, asked: [] as LogoutConfirmation[] };
  let answer: ((value: boolean) => void) | null = null;
  const flow = createLogoutFlow({
    runtime,
    getSession: () => state.session,
    confirm: (request) => {
      state.asked.push(request);
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    },
  });
  const clearNow = () => {
    state.cleared += 1;
    state.session = null;
  };
  return {
    state,
    request: () => flow.request(clearNow),
    answer: (value: boolean) => answer?.(value),
    flow,
  };
}

const dbFiles = (dir: string) => fs.readdirSync(dir).filter((name) => name.endsWith(".db"));

async function draftWithScan(runtime: ReturnType<typeof createRollCallRuntime>, who = session(TEACHER)): Promise<RcContext> {
  const opened = await runtime.activate(who);
  assert.ok(opened.ok);
  const ctx = (opened as unknown as { account: { ctx: RcContext } }).account.ctx;
  const { session: draft } = await openDraftSession(ctx, { classId: CLASS, date: "2026-11-09", packId: null, syncDeadline: null });
  await recordScan(ctx, { sessionId: draft.session_id, scanId: "00000000-0000-4000-8000-000000000101", publicId: "AAAAAAAAAAAAAAAAAAAAAA", proof: "P".repeat(43), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: null });
  await runtime.refreshLogoutGuard(who);
  return ctx;
}

test("Parent sans NFC : session vidée immédiatement, de façon synchrone, aucune base créée", async () => {
  const { dir, platform, runtime } = setup("parent");
  const h = harness(runtime, session(PARENT, "parent_student"));
  // Aucune vérification préalable n'a eu lieu (démarrage) : la déconnexion ne l'attend pas.
  const { result, storage } = h.request();
  assert.equal(result, "logged_out");
  assert.equal(h.state.cleared, 1, "vidée avant tout await");
  assert.equal(h.state.session, null);
  assert.deepEqual(h.state.asked, [], "aucune confirmation");
  await storage;
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(Object.keys(platform.keyStore.dump()), []);
  // Même résultat lorsque la vérification de session a déjà tourné.
  await runtime.onSessionChanged(session(PARENT, "parent_student"));
  const again = harness(runtime, session(PARENT, "parent_student"));
  assert.equal(again.request().result, "logged_out");
  assert.equal(again.state.cleared, 1);
});

test("Enseignant sans appel en attente : immédiat puis crypto-effacement de sa base", async () => {
  const { dir, runtime } = setup("teacher-none");
  await runtime.activate(session(TEACHER));
  assert.equal(dbFiles(dir).length, 1);
  const h = harness(runtime, session(TEACHER));
  const { result, storage } = h.request();
  assert.equal(result, "logged_out");
  assert.equal(h.state.cleared, 1);
  assert.deepEqual(h.state.asked, []);
  assert.equal(await storage, "erased");
  assert.equal(dbFiles(dir).length, 0);
});

test("Enseignant avec appel en attente : annuler garde la session ; valider conserve l'appel en blocked_logout", async () => {
  const { runtime } = setup("teacher-pending");
  await draftWithScan(runtime);
  const h = harness(runtime, session(TEACHER));

  const cancelled = h.request();
  assert.equal(cancelled.result, "awaiting_confirmation");
  assert.equal(h.state.cleared, 0, "rien n'est vidé avant la réponse");
  assert.deepEqual(h.state.asked, [{ kind: "pending", pending: 1 }]);
  h.answer(false);
  await cancelled.storage;
  assert.equal(h.state.cleared, 0, "annulé : toujours connecté");
  assert.ok(runtime.current(), "base toujours ouverte, rien d'effacé");

  const confirmed = h.request();
  h.answer(true);
  assert.equal(await confirmed.storage, undefined);
  assert.equal(h.state.cleared, 1);
  assert.equal(runtime.current(), null);
  const back = await runtime.activate(session(TEACHER));
  const [restored] = await listSessions((back as unknown as { account: { ctx: RcContext } }).account.ctx);
  assert.equal(restored.state, "draft", "brouillon repris par le même compte");
});

test("échec de lecture SQLCipher : jamais « 0 en attente », confirmation explicite, rien n'est effacé", async () => {
  const { dir, runtime } = setup("read-error");
  const ctx = await draftWithScan(runtime);
  // Lecture refusée par le moteur (base illisible, disque, clé) au moment de la vérification.
  ctx.connection.read = async () => {
    throw Object.assign(new Error("SQLITE_NOTADB: file is not a database"), { code: "SQLITE_NOTADB" });
  };
  await assert.rejects(runtime.pendingForLogout(session(TEACHER)), /SQLITE_NOTADB/);
  assert.equal((await runtime.refreshLogoutGuard(session(TEACHER)))?.status, "error");

  const h = harness(runtime, session(TEACHER));
  const first = h.request();
  assert.equal(first.result, "awaiting_confirmation");
  assert.deepEqual(h.state.asked, [{ kind: "unverified" }]);
  h.answer(true);
  await first.storage;
  assert.equal(h.state.cleared, 1);
  assert.equal(dbFiles(dir).length, 1, "base conservée");
  assert.equal(runtime.current(), null, "base fermée");
});

test("échec d'ouverture SQLCipher d'une base existante (application relancée) : vérification impossible", async () => {
  const { dir, platform, runtime } = setup("open-error");
  await draftWithScan(runtime);
  await runtime.forcedLogout();
  const [file] = dbFiles(dir);
  const keys = platform.keyStore.dump();
  // Application relancée ; le Keystore ne rend plus la clé du compte.
  const brokenPlatform = { ...platform, keyStore: { ...platform.keyStore, getItem: async () => { throw new Error("KEYSTORE_UNAVAILABLE"); } } };
  const fresh = createRollCallRuntime({ platform: brokenPlatform as never, environment: ENV });
  await fresh.onSessionChanged(session(TEACHER));
  const plan = fresh.planLogout(session(TEACHER));
  assert.equal(plan.kind, "confirm_unverified");
  const h = harness(fresh, session(TEACHER));
  const req = h.request();
  h.answer(true);
  await req.storage;
  assert.ok(fs.existsSync(path.join(dir, file)), "fichier conservé");
  assert.deepEqual(platform.keyStore.dump(), keys, "clé conservée");
});

test("vérification dépassée : un appel apparu après la décision n'est jamais effacé", async () => {
  const { dir, runtime } = setup("stale");
  const opened = await runtime.activate(session(TEACHER));
  assert.ok(opened.ok);
  assert.equal(runtime.planLogout(session(TEACHER)).kind, "immediate");
  // Brouillon créé sans recalcul de l'état (course).
  const ctx = (opened as unknown as { account: { ctx: RcContext } }).account.ctx;
  const { session: draft } = await openDraftSession(ctx, { classId: CLASS, date: "2026-11-09", packId: null, syncDeadline: null });
  await recordScan(ctx, { sessionId: draft.session_id, scanId: "00000000-0000-4000-8000-000000000102", publicId: "AAAAAAAAAAAAAAAAAAAAAA", proof: "P".repeat(43), medium: "nfc", scannedAt: "2026-11-09T07:32:00Z", match: null });
  const h = harness(runtime, session(TEACHER));
  const { result, storage } = h.request();
  assert.equal(result, "logged_out");
  assert.equal(await storage, "blocked_logout");
  assert.equal(dbFiles(dir).length, 1);
});

test("session forcée (expiration) : appel conservé, aucun effacement", async () => {
  const { dir, runtime } = setup("forced");
  await draftWithScan(runtime);
  await runtime.forcedLogout();
  assert.equal(runtime.current(), null);
  assert.equal(dbFiles(dir).length, 1);
  const fresh = createRollCallRuntime({ platform: createTestPlatform({ dir }), environment: ENV });
  assert.equal(await fresh.pendingForLogout(session(TEACHER)), 1);
});

test("changement de compte : décision propre à chaque compte ; confirmation ignorée si la session a changé", async () => {
  const { dir, runtime } = setup("switch");
  await draftWithScan(runtime);
  const h = harness(runtime, session(TEACHER));
  const req = h.request();
  assert.equal(req.result, "awaiting_confirmation");
  // Pendant la confirmation, la session devient celle d'un autre compte.
  h.state.session = session(OTHER_TEACHER);
  await runtime.onSessionChanged(session(OTHER_TEACHER));
  h.answer(true);
  await req.storage;
  assert.equal(h.state.cleared, 0, "aucune déconnexion du nouveau compte");
  assert.equal(dbFiles(dir).length, 1, "appel du premier compte conservé");
  assert.equal(runtime.planLogout(session(OTHER_TEACHER)).kind, "immediate", "l'autre compte n'hérite pas de l'état");
  const other = harness(runtime, session(OTHER_TEACHER));
  assert.equal(other.request().result, "logged_out");
  assert.equal(other.state.cleared, 1);
});

test("double clic sur Déconnexion : une seule confirmation, une seule déconnexion", async () => {
  const { runtime } = setup("double");
  await draftWithScan(runtime);
  const h = harness(runtime, session(TEACHER));
  const first = h.request();
  const second = h.request();
  assert.equal(first.result, "awaiting_confirmation");
  assert.equal(second.result, "ignored");
  assert.equal(h.state.asked.length, 1);
  h.answer(true);
  await first.storage;
  assert.equal(h.state.cleared, 1);
  // Après la fin, une nouvelle demande est de nouveau traitée.
  assert.equal(h.flow.busy(), false);
});
