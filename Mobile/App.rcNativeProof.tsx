/**
 * NFC-PRES-LOCAL-PR2 — entrée de RECETTE native (jamais l'application livrée).
 *
 * Sélectionnée par Metro uniquement si SOMAFRIK_RC_NATIVE_PROOF_ENTRY=1 au moment du bundle
 * (metro.config.js), comme les autres entrées de recette. Elle exécute dans l'APK, donc sous
 * Hermes Android :
 *  1. le gate S13 : suite de parité sur docs/audits/NFC-PRES-LOCAL-PR0-vectors.json et
 *     docs/audits/NFC-PRES-LOCAL-PR2-vectors.json (mêmes fonctions que les tests Node) ;
 *  2. la preuve SQLCipher de la base d'appel : cipher_version, écriture, fermeture, arrêt forcé
 *     (piloté par scripts/run-rc-offline-native-proof.js), réouverture et relecture, refus avec une
 *     mauvaise clé et sans clé, en-tête du fichier différent de « SQLite format 3 ».
 *
 * Journal logcat : identifiants de cas, compteurs et booléens uniquement — aucune clé, aucun sel,
 * aucune preuve. Identité FICTIVE (environnement `nativeproof-00000000`, UUID de test).
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { runRollCallParitySuite } from "./src/offline/rollCall/crypto/parity";
import {
  createRollCallAccountManager,
  loadLastTrustedTime,
  loadRevocationState,
  recordTrustedTime,
  saveRevocationState,
  type RcActiveAccount,
} from "./src/offline/rollCall/store/accountManager";
import { createNativeRollCallPlatform } from "./src/offline/rollCall/store/nativePlatform";
import { getSession, listSessions, openDraftSession, readCounts, recordScan, type RcContext } from "./src/offline/rollCall/store/repository";
import { validatePackKeyring } from "./src/offline/rollCall/pack/keyring";
import { acceptDownloadedPack } from "./src/offline/rollCall/pack/packService";
import {
  closeOfflineRollCall,
  findLatestSessionForProof,
  openOfflineRollCall,
  prepareOfflinePack,
  processCard,
} from "./src/offline/rollCall/session/offlineRollCallProofHelpers";
import { safeLogger } from "./src/services/safeLogger";

/* eslint-disable @typescript-eslint/no-require-imports */
const vectors = require("../docs/audits/NFC-PRES-LOCAL-PR0-vectors.json");
const pr2Vectors = require("../docs/audits/NFC-PRES-LOCAL-PR2-vectors.json");
/* eslint-enable @typescript-eslint/no-require-imports */

const TAG = "RC_NATIVE_PROOF";
const IDENTITY = {
  environmentId: "nativeproof-00000000",
  userId: "00000000-0000-4000-8000-0000000000a1",
  schoolId: "00000000-0000-4000-8000-0000000000a2",
};
const CLASS = "00000000-0000-4000-8000-0000000000a3";
const SCANS = 3;

/**
 * Une seule exécution par processus JS : un double montage de l'effet ou une recréation de
 * l'activité ne doit jamais lancer deux preuves concurrentes sur la même base.
 */
let proofRun: Promise<string> | null = null;

function log(line: string) {
  safeLogger.warn(`${TAG} ${line}`);
}

async function refusesToRead(open: () => Promise<{ execAsync(sql: string): Promise<void>; getFirstAsync(sql: string): Promise<unknown>; closeAsync(): Promise<void> }>, key: string | null) {
  const db = await open();
  try {
    if (key !== null) await db.execAsync(`PRAGMA key = '${key}'`);
    await db.getFirstAsync("SELECT count(*) AS n FROM rc_sessions");
    return false;
  } catch {
    return true;
  } finally {
    await db.closeAsync().catch(() => undefined);
  }
}

async function runSqlCipherProof(): Promise<string> {
  const platform = createNativeRollCallPlatform();
  if (!platform) return "platform=unavailable";
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(IDENTITY);
  if (!opened.ok) return `open=failed code=${opened.code}`;
  const account = (opened as { account: RcActiveAccount }).account;
  log(`cipher_version=${account.cipherVersion.trim() ? account.cipherVersion : "EMPTY"}`);
  const header = await platform.fs.readHeader(account.fileName, 16);
  const plaintext = !!header && String.fromCharCode(...header) === "SQLite format 3\u0000";
  log(`header=${header ? (plaintext ? "PLAINTEXT" : "encrypted") : "missing"}`);

  const sessions = await listSessions(account.ctx);
  if (sessions.length === 0) {
    const { session } = await openDraftSession(account.ctx, { classId: CLASS, date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10), packId: null, syncDeadline: null });
    for (let i = 0; i < SCANS; i += 1) {
      await recordScan(account.ctx, {
        sessionId: session.session_id,
        scanId: `00000000-0000-4000-8000-${String(200 + i).padStart(12, "0")}`,
        publicId: `NATIVEPROOFCARD${String(i).padStart(7, "0")}`,
        proof: "P".repeat(43),
        medium: i % 2 ? "qr" : "nfc",
        scannedAt: new Date().toISOString(),
        match: null,
      });
    }
    const counts = await readCounts(account.ctx, session.session_id);
    // État de sécurité (révocations, horloge) : écritures monotones, puis tentatives de recul
    // refusées par les triggers SQL (fonctions JSON du SQLCipher natif).
    await saveRevocationState(account.ctx, { sequence: 1, revokedKeyIds: ["rc-pack-nativeproof-1"] });
    await recordTrustedTime(account.ctx, 1_800_000_000_000);
    const regressions = [
      "UPDATE rc_meta SET value = '{\"sequence\":0,\"revokedKeyIds\":[]}' WHERE key = 'pack_revocations'",
      "UPDATE rc_meta SET value = '1' WHERE key = 'last_trusted_time_ms'",
      "DELETE FROM rc_meta WHERE key = 'pack_revocations'",
    ];
    let refused = 0;
    for (const sql of regressions) {
      try {
        await account.ctx.connection.transaction((db) => db.execAsync(sql));
      } catch (error) {
        if (/^RC_(REVOCATIONS_REGRESSION|TRUSTED_TIME_REGRESSION|META_PROTECTED)$/.test(String((error as { code?: string })?.code))) refused += 1;
      }
    }
    log(`meta_guard=${refused === regressions.length ? "refused" : `ACCEPTED_${regressions.length - refused}`}`);
    await manager.close();
    log(`closed=ok`);
    return `persist=init scans=${counts.scans}`;
  }
  const draft = sessions[0];
  const counts = await readCounts(account.ctx, draft.session_id);
  const revocations = await loadRevocationState(account.ctx);
  const trusted = await loadLastTrustedTime(account.ctx);
  const metaOk = revocations.sequence === 1 && revocations.revokedKeyIds.join(",") === "rc-pack-nativeproof-1" && trusted === 1_800_000_000_000;
  log(`meta_persist=${metaOk ? "ok" : "MISMATCH"}`);
  await manager.close();
  // Mauvaise clé, puis aucune clé : le fichier doit rester illisible (aucun SQLite en clair).
  const SQLite = require("expo-sqlite") as typeof import("expo-sqlite");
  const open = () => SQLite.openDatabaseAsync(account.fileName, { useNewConnection: true }) as never;
  const wrongKey = await refusesToRead(open, "0".repeat(64));
  const noKey = await refusesToRead(open, null);
  log(`wrong_key=${wrongKey ? "refused" : "ACCEPTED"} no_key=${noKey ? "refused" : "ACCEPTED"}`);
  return `persist=ok scans=${counts.scans} state=${draft.state}`;
}

/**
 * PR3 — parcours d'appel complet sous Hermes, sur les vecteurs du contrat : pack de test signé
 * (clé de TEST V-9, recette uniquement), carte vecteur, preuve HMAC, rapprochement, COMMIT,
 * doublon, clôture. La preuve calculée sur l'appareil doit être exactement V-4.
 */
async function runPr3PipelineProof(): Promise<string> {
  const platform = createNativeRollCallPlatform();
  if (!platform) return "pr3=platform_unavailable";
  const input = vectors.inputs as Record<string, string>;
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate({ environmentId: "nativeproof-00000000", userId: input.actorUserId, schoolId: input.schoolId });
  if (!opened.ok) return `pr3=open_failed code=${opened.code}`;
  const base = (opened as { account: RcActiveAccount }).account.ctx;
  try {
    const latest = await findLatestSessionForProof(base, input.classId, input.date);
    if (latest) {
      // Lancement 2 : l'appel clôturé (corps figé, preuve V-4) a survécu à l'arrêt forcé.
      const body = JSON.parse(String((await getSession(base, latest.session_id)).frozen_body ?? "{}"));
      const proofOk = body?.scans?.[0]?.proof === vectors.expected["V-4_proof_nfc"];
      return `pr3_persist=${latest.state === "closed" && proofOk ? "ok" : "MISMATCH"}`;
    }
    // Horloge et identifiants déterministes = ceux des vecteurs (sessionId …0004, scanId …0006, operationId …0008).
    const ids = [input.sessionId, input.scanId, "00000000-0000-4000-8000-000000000008"];
    const ctx: RcContext = { ...base, nowMs: () => Date.parse("2026-11-09T07:31:02Z"), randomUUID: () => ids.shift() ?? "00000000-0000-4000-8000-0000000000ff" };
    const keyring = validatePackKeyring("recette", [{ keyId: "rc-pack-test-1", publicKey: vectors.expected["V-9_ed25519_test_pub_raw"], status: "active" }]);
    const envelopeText = JSON.stringify({
      pack: vectors.testPack,
      signature: { alg: "Ed25519", keyId: "rc-pack-test-1", value: vectors.expected["V-10_pack_signature"] },
      revocations: { list: pr2Vectors.revocations.list, signature: pr2Vectors.revocations.signature },
    });
    const expected = { schoolId: input.schoolId, actorUserId: input.actorUserId, classId: input.classId, date: input.date };
    const accepted = await acceptDownloadedPack(ctx, { keyring, envelopeText, expected });
    if (!accepted.ok) return `pr3=pack_refused code=${accepted.code}`;
    const pack = await prepareOfflinePack(ctx, { keyring, ...expected });
    if (pack.status !== "verified") return `pr3=pack_unusable code=${pack.reason}`;
    const rollCall = await openOfflineRollCall(ctx, { classId: input.classId, date: input.date, pack: pack.verified });
    const token = `somafrik:card:${input.publicId}.${input.secret}`;
    const first = await processCard(ctx, rollCall, { token, medium: "nfc", actorUserId: input.actorUserId });
    const again = await processCard(ctx, rollCall, { token, medium: "qr", actorUserId: input.actorUserId });
    const closed = await closeOfflineRollCall(ctx, rollCall);
    if (!closed.ok) return `pr3=close_failed`;
    const body = JSON.parse(String((await getSession(ctx, rollCall.session.session_id)).frozen_body));
    const proofOk = body.scans?.[0]?.proof === vectors.expected["V-4_proof_nfc"];
    const verdict = first.kind === "recorded" && again.kind === "duplicate" && proofOk && /^[0-9a-f]{64}$/.test(closed.payloadDigest);
    return `pr3=${verdict ? "ok" : "MISMATCH"} first=${first.kind} again=${again.kind} proof=${proofOk ? "V-4" : "DIFF"}`;
  } finally {
    await manager.close();
  }
}

export default function App() {
  const [status, setStatus] = useState("NFC-PRES-LOCAL-PR2 — recette native en cours");
  useEffect(() => {
    if (proofRun) {
      void proofRun.then(setStatus, () => setStatus("Erreur de recette"));
      return;
    }
    proofRun = (async () => {
      try {
        const report = runRollCallParitySuite(vectors, pr2Vectors);
        for (const entry of report.cases) log(`S13_CASE ${entry.id} ${entry.ok ? "ok" : "FAIL"}`);
        log(`S13 engine=${report.engine} passed=${report.passed} total=${report.total} failed=${report.failed.join(",") || "none"}`);
        const sqlcipher = await runSqlCipherProof();
        log(sqlcipher);
        log(await runPr3PipelineProof());
        log("done");
        return `S13 ${report.passed}/${report.total} (${report.engine}) — ${sqlcipher}`;
      } catch (error) {
        log(`error=${(error as Error)?.name ?? "Error"}:${String((error as { code?: string })?.code ?? "")}`);
        return "Erreur de recette";
      }
    })();
    void proofRun.then(setStatus);
  }, []);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text>{status}</Text>
    </View>
  );
}
