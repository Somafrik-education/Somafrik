/**
 * NFC-PRES-LOCAL-PR3 — cycle de vie applicatif : connexion, changement de compte, déconnexion.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/runtime/rollCallRuntime.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import { listSessions, openDraftSession, recordScan, type RcContext } from "../store/repository";
import { createRollCallRuntime } from "./rollCallRuntime";

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const OTHER_SCHOOL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_1 = "22222222-2222-4222-8222-222222222222";
const USER_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLASS = "33333333-3333-4333-8333-333333333333";
const session = (userId: string, schoolId = SCHOOL) => ({ user: { id: userId, schoolId }, school: { id: schoolId } });

function setup(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-runtime-${label}-`));
  const platform = createTestPlatform({ dir });
  const runtime = createRollCallRuntime({ platform, environment: () => ({ environmentId: "production-3f2a9c1d", releaseProfile: "production" }) });
  return { dir, platform, runtime };
}

async function draftWithScan(runtime: ReturnType<typeof setup>["runtime"], who = session(USER_1)) {
  const opened = await runtime.activate(who);
  assert.ok(opened.ok);
  const ctx = (opened as unknown as { account: { ctx: RcContext } }).account.ctx;
  const { session: draft } = await openDraftSession(ctx, { classId: CLASS, date: "2026-11-09", packId: null, syncDeadline: null });
  await recordScan(ctx, { sessionId: draft.session_id, scanId: "00000000-0000-4000-8000-000000000101", publicId: "AAAAAAAAAAAAAAAAAAAAAA", proof: "P".repeat(43), medium: "nfc", scannedAt: "2026-11-09T07:31:00Z", match: null });
  return ctx;
}

test("compte n'ayant jamais utilisé l'appel hors ligne : déconnexion sans aucune base créée", async () => {
  const { dir, platform, runtime } = setup("never");
  assert.equal(await runtime.pendingForLogout(session(USER_1)), 0);
  assert.equal(await runtime.logout({ confirmPending: false }), "none");
  assert.deepEqual(fs.readdirSync(dir), [], "ni fichier ni registre");
  assert.deepEqual(Object.keys(platform.keyStore.dump()), [], "ni sel ni clé");
});

test("déconnexion avec appel en attente : confirmation exigée, blocked_logout, reprise par le même compte", async () => {
  const { runtime } = setup("pending");
  await draftWithScan(runtime);
  assert.equal(await runtime.pendingForLogout(session(USER_1)), 1);
  assert.equal(await runtime.logout({ confirmPending: false }), "confirmation_required");
  assert.ok(runtime.current(), "rien n'est fermé sans confirmation");
  assert.equal(await runtime.logout({ confirmPending: true }), "blocked_logout");
  assert.equal(runtime.current(), null);
  // Retour du même compte : brouillon restauré ; un autre compte ne voit rien.
  const other = await runtime.activate(session(USER_2));
  assert.ok(other.ok);
  assert.deepEqual(await listSessions((other as unknown as { account: { ctx: RcContext } }).account.ctx), []);
  const back = await runtime.activate(session(USER_1));
  const [restored] = await listSessions((back as unknown as { account: { ctx: RcContext } }).account.ctx);
  assert.equal(restored.state, "draft");
});

test("déconnexion sans appel en attente : crypto-effacement de la base du compte", async () => {
  const { dir, runtime } = setup("erase");
  await runtime.activate(session(USER_1));
  assert.equal(await runtime.pendingForLogout(session(USER_1)), 0);
  assert.equal(await runtime.logout({ confirmPending: false }), "erased");
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith(".db")).length, 0);
});

test("base fermée d'un compte retrouvée à la déconnexion (application relancée)", async () => {
  const { platform, runtime } = setup("reopen");
  await draftWithScan(runtime);
  await runtime.forcedLogout(); // expiration : conservée, rien d'effacé
  const fresh = createRollCallRuntime({ platform, environment: () => ({ environmentId: "production-3f2a9c1d", releaseProfile: "production" }) });
  assert.equal(await fresh.pendingForLogout(session(USER_1)), 1, "appel en attente retrouvé sans recréer de base");
});

test("changement de compte ou d'établissement : la base ouverte est fermée immédiatement", async () => {
  const { runtime } = setup("switch");
  const ctx = await draftWithScan(runtime);
  await runtime.onSessionChanged(session(USER_1));
  assert.ok(runtime.current(), "même compte : base conservée");
  await runtime.onSessionChanged(session(USER_1, OTHER_SCHOOL));
  assert.equal(runtime.current(), null);
  await assert.rejects(ctx.connection.read(async () => 1), /RC_STORAGE_CLOSED/);
  await runtime.onSessionChanged(null);
  assert.equal(runtime.current(), null);
});

test("identité non authentifiée ou mal formée : aucune base ouverte", async () => {
  const { dir, runtime } = setup("identity");
  for (const bad of [null, { user: { id: "user-1" }, school: { id: SCHOOL } }, { user: { id: USER_1 } }, session(USER_1, "school-1")]) {
    const result = await runtime.activate(bad as never);
    assert.equal(result.ok, false);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
  const noEnv = createRollCallRuntime({ platform: createTestPlatform({ dir }), environment: () => null });
  assert.equal((await noEnv.activate(session(USER_1))).ok, false, "environnement indéterminé : refus");
  const web = createRollCallRuntime({ platform: null, environment: () => ({ environmentId: "production-3f2a9c1d", releaseProfile: "production" }) });
  assert.equal(web.available(), false);
  assert.equal((await web.activate(session(USER_1))).ok, false, "Web : aucun stockage");
  assert.equal(await web.pendingForLogout(session(USER_1)), 0);
});

test("trousseau du build : celui de l'environnement, vide tant que les clés ne sont pas publiées", () => {
  const { runtime } = setup("keyring");
  assert.deepEqual(runtime.keyring()?.keys, []);
  const unknown = createRollCallRuntime({ platform: null, environment: () => ({ environmentId: "staging-3f2a9c1d", releaseProfile: "staging" }) });
  assert.equal(unknown.keyring(), null, "profil inconnu : aucun trousseau, jamais celui d'un autre environnement");
});
