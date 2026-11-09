/**
 * NFC-PRES-LOCAL-PR2 — arrêt brutal (SIGKILL) pendant une transaction, sur un vrai fichier SQLite.
 *   npx --yes tsx --test src/offline/rollCall/store/rollCallCrash.test.ts
 *
 * Un processus fils enregistre N scans validés (COMMIT), puis ouvre une transaction, insère un scan
 * et se tue par SIGKILL avant le COMMIT. Le processus parent rouvre la base : les N scans validés
 * sont intacts, le scan non validé n'existe pas, la base est saine et le brouillon reprend.
 * Le même scénario sur Android (force-stop) est couvert par scripts/run-rc-offline-native-smoke.js.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRollCallAccountManager, type RcActiveAccount } from "./accountManager";
import { createTestPlatform } from "./rcTestPlatform.testutil";
import { listSessions, openDraftSession, readCounts, recordScan } from "./repository";

const IDENTITY = {
  environmentId: "production-3f2a9c1d",
  userId: "22222222-2222-4222-8222-222222222222",
  schoolId: "11111111-1111-4111-8111-111111111111",
};
const CLASS = "33333333-3333-4333-8333-333333333333";
const COMMITTED = 7;

async function child(dir: string) {
  const manager = createRollCallAccountManager(createTestPlatform({ dir }));
  const result = await manager.activate(IDENTITY);
  if (!result.ok) throw new Error(result.code);
  const { ctx } = (result as { account: RcActiveAccount }).account;
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: "2026-11-09", packId: null, syncDeadline: null });
  for (let i = 0; i < COMMITTED; i += 1) {
    await recordScan(ctx, {
      sessionId: session.session_id,
      scanId: `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
      publicId: `CARD${String(i).padStart(18, "0")}`,
      proof: "P".repeat(43),
      medium: "nfc",
      scannedAt: "2026-11-09T07:31:00.000Z",
      match: null,
    });
  }
  fs.writeFileSync(path.join(dir, "committed.flag"), session.session_id);
  await ctx.connection.transaction(async (db) => {
    await db.runAsync(
      "INSERT INTO rc_scans (scan_id, session_id, public_id, proof, medium, scanned_at, local_status) VALUES (?, ?, ?, ?, 'nfc', 'x', 'unknown_local')",
      ["00000000-0000-4000-8000-000000000999", session.session_id, "UNCOMMITTEDCARD0000000", "P".repeat(43)],
    );
    process.kill(process.pid, "SIGKILL"); // arrêt brutal avant COMMIT
  });
}

if (process.env.RC_CRASH_CHILD_DIR) {
  void child(process.env.RC_CRASH_CHILD_DIR);
} else {
  test("SIGKILL au milieu d'une transaction : scans validés intacts, scan non validé absent, reprise du brouillon", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-crash-"));
    const tsx = path.resolve(__dirname, "../../../../node_modules/.bin/tsx");
    const run = spawnSync(fs.existsSync(tsx) ? tsx : "npx", fs.existsSync(tsx) ? [__filename] : ["--yes", "tsx", __filename], {
      env: { ...process.env, RC_CRASH_CHILD_DIR: dir },
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.signal ?? (run.status === 137 ? "SIGKILL" : null), "SIGKILL", `fils tué par SIGKILL (status=${run.status}) ${run.stderr}`);
    const sessionId = fs.readFileSync(path.join(dir, "committed.flag"), "utf8");
    assert.ok(fs.readdirSync(dir).some((name) => name.endsWith(".db-journal")), "journal de restauration chaud laissé par l'arrêt");

    const manager = createRollCallAccountManager(createTestPlatform({ dir }));
    const reopened = await manager.activate(IDENTITY);
    assert.ok(reopened.ok, JSON.stringify(reopened));
    const { ctx } = (reopened as { account: RcActiveAccount }).account;
    const [draft] = await listSessions(ctx);
    assert.equal(draft.session_id, sessionId);
    assert.equal(draft.state, "draft", "brouillon repris");
    assert.equal((await readCounts(ctx, sessionId)).scans, COMMITTED, "uniquement les scans validés");
    const ghost = await ctx.connection.read((db) => db.getFirstAsync("SELECT scan_id FROM rc_scans WHERE public_id = 'UNCOMMITTEDCARD0000000'"));
    assert.equal(ghost, null, "le scan non validé n'existe pas");
    const check = await ctx.connection.read((db) => db.getFirstAsync<{ quick_check: string }>("PRAGMA quick_check"));
    assert.equal(check?.quick_check, "ok");
    // La reprise accepte de nouveaux scans.
    const next = await recordScan(ctx, {
      sessionId,
      scanId: "00000000-0000-4000-8000-000000000998",
      publicId: "UNCOMMITTEDCARD0000000",
      proof: "P".repeat(43),
      medium: "qr",
      scannedAt: "2026-11-09T07:40:00.000Z",
      match: null,
    });
    assert.equal(next.counts.scans, COMMITTED + 1);
  });
}
