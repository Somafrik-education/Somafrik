/**
 * NFC-HERMES-CLOCK-01 — horloge de la preuve native (App.rcNativeProof.tsx), deux lancements.
 *
 *   npx --yes tsx --test Mobile/src/offline/rollCall/session/nativeProofClock.test.ts
 *
 * Défaut reproduit : la preuve crée ses appels aux dates FIGÉES des vecteurs (2026-11-09), mais
 * `manager.activate()` lance `runPurge` avec l'horloge RÉELLE de la plateforme. Passée la fin de
 * J+3 (2026-11-12), le 2e lancement voit `expired` (brouillon SQLCipher) et un corps figé purgé
 * (PR3) → `state=expired`, `pr3_persist=MISMATCH`, quel que soit le code testé.
 *
 * Correctif limité au dispositif de test : les preuves SQLCipher et PR3 utilisent une horloge
 * contrôlée, cohérente avec leurs vecteurs. La règle métier J+3 (`runPurge`) n'est pas modifiée.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRollCallAccountManager, type RcActiveAccount } from "../store/accountManager";
import { closeSession, getSession, listSessions, openDraftSession, recordScan, runPurge } from "../store/repository";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import * as proofHelpers from "./offlineRollCallProofHelpers";

const mobileRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const VECTOR_NOW = Date.parse("2026-11-09T07:31:02Z");
const REAL_LATER = Date.parse("2026-11-17T09:42:04Z"); // instant du run CI en échec (44056378791)
const IDENTITY = {
  environmentId: "nativeproof-00000000",
  userId: "00000000-0000-4000-8000-0000000000a1",
  schoolId: "00000000-0000-4000-8000-0000000000a2",
};
const CLASS = "00000000-0000-4000-8000-0000000000a3";

type Proof = typeof proofHelpers & {
  RC_PROOF_VECTOR_NOW_MS?: number;
  withProofClock?: (platform: ReturnType<typeof createTestPlatform>, nowMs: number) => ReturnType<typeof createTestPlatform>;
};
const proof = proofHelpers as Proof;

async function launch(platform: Parameters<typeof createRollCallAccountManager>[0]) {
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(IDENTITY);
  assert.ok(opened.ok, `activation refusée: ${(opened as { code?: string }).code}`);
  return { manager, ctx: (opened as { account: RcActiveAccount }).account.ctx };
}

/** Lancement 1 de la preuve : brouillon SQLCipher (3 scans) + appel clôturé avec corps figé. */
async function firstLaunch(platform: Parameters<typeof createRollCallAccountManager>[0]) {
  const { manager, ctx } = await launch(platform);
  const { session: draft } = await openDraftSession(ctx, { classId: CLASS, date: "2026-11-09", packId: null, syncDeadline: null });
  for (let i = 0; i < 3; i += 1) {
    await recordScan(ctx, {
      sessionId: draft.session_id,
      scanId: `00000000-0000-4000-8000-${String(200 + i).padStart(12, "0")}`,
      publicId: `NATIVEPROOFCARD${String(i).padStart(7, "0")}`,
      proof: "P".repeat(43),
      medium: i % 2 ? "qr" : "nfc",
      scannedAt: new Date(VECTOR_NOW).toISOString(),
      match: null,
    });
  }
  const { session: closedDraft } = await openDraftSession(ctx, { classId: `${CLASS.slice(0, -1)}4`, date: "2026-11-09", packId: null, syncDeadline: null });
  await recordScan(ctx, {
    sessionId: closedDraft.session_id,
    scanId: "00000000-0000-4000-8000-000000000301",
    publicId: "NATIVEPROOFCARD0000009",
    proof: "V".repeat(43),
    medium: "nfc",
    scannedAt: new Date(VECTOR_NOW).toISOString(),
    match: null,
  });
  await closeSession(ctx, closedDraft.session_id);
  await manager.close();
  return { draftId: draft.session_id, closedId: closedDraft.session_id };
}

test("CLOCK-01 RED — horloge réelle au 2e lancement : la preuve voit expired (défaut reproduit, J+3 inchangée)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-clock-red-"));
  const now = { ms: VECTOR_NOW };
  const platform = createTestPlatform({ dir, now });
  const ids = await firstLaunch(platform);
  now.ms = REAL_LATER; // l'émulateur relance l'application avec l'horloge réelle
  const { manager, ctx } = await launch(platform);
  try {
    const draft = await getSession(ctx, ids.draftId);
    const closed = await getSession(ctx, ids.closedId);
    assert.equal(draft.state, "expired", "la règle J+3 expire bien un appel du 2026-11-09 le 2026-11-17");
    assert.equal(closed.state, "expired");
    assert.equal(closed.frozen_body, null, "corps figé purgé : pr3_persist ne peut que valoir MISMATCH");
  } finally {
    await manager.close();
  }
});

test("CLOCK-01 GREEN — horloge contrôlée des vecteurs : brouillon et appel clôturé survivent au relancement", async () => {
  assert.equal(typeof proof.withProofClock, "function", "withProofClock manquant (offlineRollCallProofHelpers)");
  assert.equal(proof.RC_PROOF_VECTOR_NOW_MS, VECTOR_NOW, "horloge de preuve = instant des vecteurs PR0");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-clock-green-"));
  const now = { ms: REAL_LATER }; // horloge réelle de l'appareil, bien après J+3
  const platform = createTestPlatform({ dir, now });
  const pinned = proof.withProofClock!(platform, proof.RC_PROOF_VECTOR_NOW_MS!);
  const ids = await firstLaunch(pinned);
  now.ms = REAL_LATER + 60_000; // arrêt forcé puis relancement
  const { manager, ctx } = await launch(proof.withProofClock!(platform, proof.RC_PROOF_VECTOR_NOW_MS!));
  try {
    assert.equal((await getSession(ctx, ids.draftId)).state, "draft");
    const closed = await getSession(ctx, ids.closedId);
    assert.equal(closed.state, "closed");
    assert.notEqual(closed.frozen_body, null, "corps figé conservé après relancement");
    assert.equal((await listSessions(ctx)).length, 2);
  } finally {
    await manager.close();
  }
});

test("CLOCK-01 — la règle métier J+3 reste appliquée à l'horloge réelle (runPurge non modifié)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-clock-rule-"));
  const now = { ms: VECTOR_NOW };
  const platform = createTestPlatform({ dir, now });
  const { manager, ctx } = await launch(platform);
  try {
    const { session } = await openDraftSession(ctx, { classId: CLASS, date: "2026-11-09", packId: null, syncDeadline: null });
    now.ms = Date.parse("2026-11-12T12:00:00Z");
    await runPurge(ctx);
    assert.equal((await getSession(ctx, session.session_id)).state, "draft", "avant la fin de J+3 : conservé");
    now.ms = Date.parse("2026-11-14T00:00:00Z");
    await runPurge(ctx);
    assert.equal((await getSession(ctx, session.session_id)).state, "expired", "après la fin de J+3 : expiré");
  } finally {
    await manager.close();
  }
});

test("CLOCK-01 — contrat de l'entrée de recette : SQLCipher et PR3 sous horloge contrôlée, PR4 sous horloge réelle", () => {
  const app = fs.readFileSync(path.join(mobileRoot, "App.rcNativeProof.tsx"), "utf8");
  const section = (name: string, next: string) => app.slice(app.indexOf(`async function ${name}`), app.indexOf(next));
  const sqlcipher = section("runSqlCipherProof", "async function runPr3PipelineProof");
  const pr3 = section("runPr3PipelineProof", "const PR4_IDENTITY");
  const pr4 = section("runPr4SyncProof", "export default function App");
  for (const [label, body] of [["SQLCipher", sqlcipher], ["PR3", pr3]] as const) {
    assert.match(body, /createRollCallAccountManager\(withProofClock\(platform, RC_PROOF_VECTOR_NOW_MS\)\)/, `${label} : manager sous horloge contrôlée`);
  }
  assert.doesNotMatch(pr4, /withProofClock/, "PR4 garde l'horloge réelle (attente réelle du backoff)");
  assert.match(pr4, /createRollCallAccountManager\(platform\)/);
  const purge = fs.readFileSync(path.join(mobileRoot, "src/offline/rollCall/store/repository.ts"), "utf8");
  assert.match(purge, /AND sync_deadline <= \?`,\n\s+\[now\],/, "runPurge compare toujours à l'horloge du contexte");
});
