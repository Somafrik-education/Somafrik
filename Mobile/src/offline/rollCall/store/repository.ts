/**
 * NFC-PRES-LOCAL-PR2 — opérations transactionnelles de la base d'appel hors ligne (PR0 §5.4, §6.8, §7).
 *
 * Règles :
 *  - chaque événement est une transaction `BEGIN IMMEDIATE → INSERT/UPDATE → COMMIT` ;
 *  - aucune valeur de succès ni aucun compteur n'est renvoyé avant le COMMIT. Les compteurs sont
 *    lus DANS la transaction (instantané propre à cet événement, même si d'autres scans attendent
 *    dans la file) et ne sont remis à l'appelant qu'une fois le COMMIT réussi ; une erreur SQLite
 *    (disque plein, corruption, COMMIT refusé) annule l'événement et rien n'est renvoyé ;
 *  - chaque lecture et écriture est filtrée sur l'utilisateur et l'établissement du compte ouvert
 *    (défense en profondeur, en plus de la base dédiée au compte) ;
 *  - les invariants d'immutabilité sont aussi imposés par les triggers du schéma.
 *
 * Hors périmètre PR2 : boucle de scan (PR3), exécution réseau de la synchronisation (PR4).
 * Ce module ne fait aucun appel réseau ; il prépare et protège l'état stocké.
 */
import type { L1SqliteLike } from "../../l1/database";
import { CONTRACT_VERSION, ROLL_CALL_MODE, UUID, canonicalJson, computePayloadDigest, isRealDate } from "../crypto/primitives";
import { RC_PENDING_STATES, type RcSessionState } from "./schema";
import { RollCallStorageError, type RcConnection } from "./database";

export const RC_SYNCED_SUMMARY_RETENTION_MS = 7 * 24 * 3600 * 1000;
export const RC_EXPIRED_RETENTION_MS = 7 * 24 * 3600 * 1000;
export const RC_DB_PURGE_GRACE_MS = 7 * 24 * 3600 * 1000;
export const RC_MAX_SCANS = 300;
export const RC_MAX_MANUAL = 300;

export const RC_REPO_ERROR = Object.freeze({
  INPUT_INVALID: "RC_INPUT_INVALID",
  SESSION_NOT_FOUND: "RC_SESSION_NOT_FOUND",
  SESSION_NOT_DRAFT: "RC_SESSION_NOT_DRAFT",
  SCAN_LIMIT: "RC_SCAN_LIMIT",
  STATE_INVALID: "RC_SESSION_STATE_INVALID",
  REVISION_FORBIDDEN: "RC_REVISION_FORBIDDEN",
  OPERATION_MISMATCH: "RC_OPERATION_MISMATCH",
});

export type RcContext = {
  connection: RcConnection;
  identity: { userId: string; schoolId: string };
  nowMs(): number;
  randomUUID(): string;
};

export type RcSessionRow = {
  session_id: string;
  user_id: string;
  school_id: string;
  class_id: string;
  roll_call_date: string;
  mode: string;
  pack_id: string | null;
  state: RcSessionState;
  state_before_logout: RcSessionState | null;
  revision: number;
  operation_id: string | null;
  payload_digest: string | null;
  frozen_body: string | null;
  opened_at: string;
  closed_at: string | null;
  synced_at: string | null;
  expired_at: string | null;
  server_roll_call_id: string | null;
  last_error_code: string | null;
  last_http_status: number | null;
  last_session_state: "not_recorded" | "conflict" | null;
  ever_unconfirmable: number;
  attempt_count: number;
  next_attempt_at: string | null;
  sync_deadline: string;
  summary_counts: string | null;
};

export type RcCounts = { scans: number; verified: number; unknown: number; present: number; late: number; absent: number };

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const ERROR_CODE = /^[A-Z0-9_]{1,64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function fail(code: string, message: string): never {
  throw new RollCallStorageError(code, message);
}

/** Format unique des instants stockés : comparables en texte (`toISOString`, millisecondes, « Z »). */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function canonicalInstant(value: string, field: string): string {
  const ms = typeof value === "string" && ISO_INSTANT.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) fail(RC_REPO_ERROR.INPUT_INVALID, `Instant invalide : ${field}.`);
  return iso(ms);
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail(RC_REPO_ERROR.INPUT_INVALID, `Identifiant invalide : ${field}.`);
  return value as string;
}

function sanitizeErrorCode(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" && ERROR_CODE.test(value) ? value : "UNKNOWN_ERROR";
}

async function sessionFor(ctx: RcContext, db: L1SqliteLike, sessionId: string): Promise<RcSessionRow> {
  const row = await db.getFirstAsync<RcSessionRow>(
    "SELECT * FROM rc_sessions WHERE session_id = ? AND user_id = ? AND school_id = ?",
    [sessionId, ctx.identity.userId, ctx.identity.schoolId],
  );
  if (!row) fail(RC_REPO_ERROR.SESSION_NOT_FOUND, "Appel local introuvable.");
  return row as RcSessionRow;
}

async function countsFor(db: L1SqliteLike, sessionId: string): Promise<RcCounts> {
  const scans = await db.getFirstAsync<{ total: number; verified: number }>(
    `SELECT count(*) AS total, sum(CASE WHEN local_status = 'verified_local' THEN 1 ELSE 0 END) AS verified
       FROM rc_scans WHERE session_id = ? AND removed_at IS NULL`,
    [sessionId],
  );
  const marks = await db.getAllAsync<{ status: string; n: number }>(
    "SELECT status, count(*) AS n FROM rc_marks WHERE session_id = ? GROUP BY status",
    [sessionId],
  );
  const byStatus = Object.fromEntries(marks.map((row) => [row.status, Number(row.n)]));
  const total = Number(scans?.total ?? 0);
  const verified = Number(scans?.verified ?? 0);
  return {
    scans: total,
    verified,
    unknown: total - verified,
    present: byStatus.present ?? 0,
    late: byStatus.late ?? 0,
    absent: byStatus.absent ?? 0,
  };
}

/** Compteurs lus dans l'état VALIDÉ de la base (après COMMIT). */
export function readCounts(ctx: RcContext, sessionId: string): Promise<RcCounts> {
  return ctx.connection.read(async (db) => {
    await sessionFor(ctx, db, sessionId);
    return countsFor(db, sessionId);
  });
}

export function getSession(ctx: RcContext, sessionId: string): Promise<RcSessionRow> {
  return ctx.connection.read((db) => sessionFor(ctx, db, sessionId));
}

export function listSessions(ctx: RcContext): Promise<RcSessionRow[]> {
  return ctx.connection.read((db) =>
    db.getAllAsync<RcSessionRow>(
      "SELECT * FROM rc_sessions WHERE user_id = ? AND school_id = ? ORDER BY opened_at, session_id",
      [ctx.identity.userId, ctx.identity.schoolId],
    ),
  );
}

export async function countPendingSessions(ctx: RcContext): Promise<number> {
  const placeholders = RC_PENDING_STATES.map(() => "?").join(", ");
  const row = await ctx.connection.read((db) =>
    db.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM rc_sessions WHERE user_id = ? AND school_id = ? AND state IN (${placeholders})`,
      [ctx.identity.userId, ctx.identity.schoolId, ...RC_PENDING_STATES],
    ),
  );
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Packs : contenu signé original, inséré une fois, jamais modifié.
// ---------------------------------------------------------------------------------------------

export function storePack(
  ctx: RcContext,
  input: { packId: string; classId: string; date: string; expiresAt: string; envelopeText: string },
): Promise<void> {
  assertUuid(input.packId, "packId");
  assertUuid(input.classId, "classId");
  if (!isRealDate(input.date) || typeof input.envelopeText !== "string" || input.envelopeText.length === 0) {
    fail(RC_REPO_ERROR.INPUT_INVALID, "Pack invalide.");
  }
  const expiresAt = canonicalInstant(input.expiresAt, "expiresAt");
  return ctx.connection.transaction(async (db) => {
    await db.runAsync(
      `INSERT INTO rc_packs (pack_id, class_id, roll_call_date, expires_at, signed_payload, stored_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (pack_id) DO NOTHING`,
      [input.packId, input.classId, input.date, expiresAt, input.envelopeText, iso(ctx.nowMs())],
    );
  });
}

export function readStoredPackText(ctx: RcContext, packId: string): Promise<string | null> {
  return ctx.connection.read(async (db) => {
    const row = await db.getFirstAsync<{ signed_payload: string }>("SELECT signed_payload FROM rc_packs WHERE pack_id = ?", [packId]);
    return row ? String(row.signed_payload) : null;
  });
}

/** Pack refusé au chargement (signature, révocation, expiration…) : supprimé, jamais réutilisé. */
export function deletePack(ctx: RcContext, packId: string): Promise<void> {
  return ctx.connection.transaction(async (db) => {
    await db.runAsync("DELETE FROM rc_packs WHERE pack_id = ?", [packId]);
  });
}

// ---------------------------------------------------------------------------------------------
// Métadonnées du compte (révocations, horloge de confiance).
// ---------------------------------------------------------------------------------------------

export function readMetaValue(ctx: RcContext, key: string): Promise<string | null> {
  return ctx.connection.read(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM rc_meta WHERE key = ?", [key]);
    return row ? String(row.value) : null;
  });
}

export function writeMetaValue(ctx: RcContext, key: string, value: string): Promise<void> {
  if (!/^[a-z_]{1,64}$/.test(key) || ["schema_version", "account_id", "environment_id", "created_at", "pack_revocations", "last_trusted_time_ms"].includes(key)) {
    fail(RC_REPO_ERROR.INPUT_INVALID, "Clé de métadonnée protégée.");
  }
  return ctx.connection.transaction(async (db) => {
    await db.runAsync("INSERT INTO rc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);
  });
}

// ---------------------------------------------------------------------------------------------
// Sessions : brouillon, scans, marques.
// ---------------------------------------------------------------------------------------------

/**
 * Brouillon de la classe et du jour : reprend celui qui existe (reprise après arrêt), sinon le crée.
 * `syncDeadline` vient du pack signé ; sans pack, l'instant le plus tardif possible de la fin de J+3
 * (D+4 12:00 UTC, fuseau UTC−12) sert de borne locale de purge — le serveur reste seul juge.
 */
export function openDraftSession(
  ctx: RcContext,
  input: { classId: string; date: string; packId: string | null; syncDeadline: string | null },
): Promise<{ session: RcSessionRow; resumed: boolean }> {
  assertUuid(input.classId, "classId");
  if (input.packId !== null) assertUuid(input.packId, "packId");
  if (!isRealDate(input.date)) fail(RC_REPO_ERROR.INPUT_INVALID, "Date d'appel invalide.");
  const deadline =
    input.syncDeadline !== null
      ? canonicalInstant(input.syncDeadline, "syncDeadline")
      : iso(Date.parse(`${input.date}T00:00:00Z`) + (4 * 24 + 12) * 3600 * 1000);
  return ctx.connection.transaction(async (db) => {
    const existing = await db.getFirstAsync<RcSessionRow>(
      "SELECT * FROM rc_sessions WHERE class_id = ? AND roll_call_date = ? AND state = 'draft' AND user_id = ? AND school_id = ?",
      [input.classId, input.date, ctx.identity.userId, ctx.identity.schoolId],
    );
    if (existing) return { session: existing, resumed: true };
    const sessionId = assertUuid(ctx.randomUUID(), "sessionId");
    await db.runAsync(
      `INSERT INTO rc_sessions (session_id, user_id, school_id, class_id, roll_call_date, mode, pack_id, state,
                                revision, opened_at, sync_deadline)
       VALUES (?, ?, ?, ?, ?, 'teacher', ?, 'draft', 1, ?, ?)`,
      [sessionId, ctx.identity.userId, ctx.identity.schoolId, input.classId, input.date, input.packId, iso(ctx.nowMs()), deadline],
    );
    return { session: await sessionFor(ctx, db, sessionId), resumed: false };
  });
}

export type RecordScanInput = {
  sessionId: string;
  scanId: string;
  publicId: string;
  proof: string;
  medium: "nfc" | "qr";
  scannedAt: string;
  /** Rapprochement par un pack vérifié ; null en mode dégradé (« à vérifier »). */
  match: { matchKey: string; studentId: string } | null;
};
export type RecordScanResult = { status: "recorded" | "duplicate"; counts: RcCounts };

/** Un scan = une transaction. Doublon actif de la même carte : aucune écriture. */
export async function recordScan(ctx: RcContext, input: RecordScanInput): Promise<RecordScanResult> {
  assertUuid(input.sessionId, "sessionId");
  assertUuid(input.scanId, "scanId");
  if (typeof input.publicId !== "string" || !PUBLIC_ID.test(input.publicId)) fail(RC_REPO_ERROR.INPUT_INVALID, "Carte invalide.");
  if (typeof input.proof !== "string" || !PROOF.test(input.proof)) fail(RC_REPO_ERROR.INPUT_INVALID, "Preuve invalide.");
  if (input.medium !== "nfc" && input.medium !== "qr") fail(RC_REPO_ERROR.INPUT_INVALID, "Support invalide.");
  if (typeof input.scannedAt !== "string" || !ISO_INSTANT.test(input.scannedAt)) fail(RC_REPO_ERROR.INPUT_INVALID, "Horodatage invalide.");
  if (input.match) {
    if (typeof input.match.matchKey !== "string" || input.match.matchKey === "") fail(RC_REPO_ERROR.INPUT_INVALID, "Rapprochement invalide.");
    assertUuid(input.match.studentId, "studentId");
  }
  return ctx.connection.transaction(async (db): Promise<RecordScanResult> => {
    const session = await sessionFor(ctx, db, input.sessionId);
    // L'état est vérifié AVANT le chemin « doublon » : un doublon sur un appel clôturé est un refus.
    if (session.state !== "draft") fail(RC_REPO_ERROR.SESSION_NOT_DRAFT, "Appel clôturé : aucun nouveau scan.");
    const duplicate = await db.getFirstAsync(
      "SELECT scan_id FROM rc_scans WHERE session_id = ? AND public_id = ? AND removed_at IS NULL",
      [input.sessionId, input.publicId],
    );
    if (duplicate) return { status: "duplicate", counts: await countsFor(db, input.sessionId) };
    const active = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM rc_scans WHERE session_id = ? AND removed_at IS NULL",
      [input.sessionId],
    );
    if (Number(active?.n ?? 0) >= RC_MAX_SCANS) fail(RC_REPO_ERROR.SCAN_LIMIT, "Nombre maximal de scans atteint.");
    await db.runAsync(
      `INSERT INTO rc_scans (scan_id, session_id, public_id, proof, medium, scanned_at, local_status, match_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.scanId,
        input.sessionId,
        input.publicId,
        input.proof,
        input.medium,
        input.scannedAt,
        input.match ? "verified_local" : "unknown_local",
        input.match?.matchKey ?? null,
      ],
    );
    if (input.match) {
      // Le pointage manuel fait foi : un scan ne l'écrase pas.
      await db.runAsync(
        `INSERT INTO rc_marks (session_id, match_key, student_id, status, source, updated_at)
         VALUES (?, ?, ?, 'present', 'card', ?)
         ON CONFLICT (session_id, match_key) DO UPDATE SET status = 'present', source = 'card', updated_at = excluded.updated_at
         WHERE rc_marks.source NOT IN ('manual')`,
        [input.sessionId, input.match.matchKey, input.match.studentId, iso(ctx.nowMs())],
      );
    }
    return { status: "recorded", counts: await countsFor(db, input.sessionId) };
  });
}

/** Retrait d'un scan du brouillon (correction) : trace conservée, carte de nouveau scannable. */
export async function removeScan(ctx: RcContext, sessionId: string, scanId: string): Promise<RcCounts> {
  return ctx.connection.transaction(async (db) => {
    const session = await sessionFor(ctx, db, sessionId);
    if (session.state !== "draft") fail(RC_REPO_ERROR.SESSION_NOT_DRAFT, "Appel clôturé.");
    const scan = await db.getFirstAsync<{ match_key: string | null }>(
      "SELECT match_key FROM rc_scans WHERE session_id = ? AND scan_id = ? AND removed_at IS NULL",
      [sessionId, scanId],
    );
    if (!scan) fail(RC_REPO_ERROR.INPUT_INVALID, "Scan introuvable.");
    await db.runAsync("UPDATE rc_scans SET removed_at = ? WHERE session_id = ? AND scan_id = ?", [iso(ctx.nowMs()), sessionId, scanId]);
    if (scan?.match_key) {
      const other = await db.getFirstAsync(
        "SELECT scan_id FROM rc_scans WHERE session_id = ? AND match_key = ? AND removed_at IS NULL",
        [sessionId, scan.match_key],
      );
      if (!other) {
        await db.runAsync("DELETE FROM rc_marks WHERE session_id = ? AND match_key = ? AND source = 'card'", [sessionId, scan.match_key]);
      }
    }
    return countsFor(db, sessionId);
  });
}

/** Pointage manuel d'un élève du pack (fait foi sur le scan). */
export async function setManualMark(
  ctx: RcContext,
  input: { sessionId: string; matchKey: string; studentId: string; status: "present" | "late" | "absent" },
): Promise<RcCounts> {
  assertUuid(input.studentId, "studentId");
  if (!["present", "late", "absent"].includes(input.status)) fail(RC_REPO_ERROR.INPUT_INVALID, "Statut invalide.");
  if (typeof input.matchKey !== "string" || input.matchKey === "") fail(RC_REPO_ERROR.INPUT_INVALID, "Élève invalide.");
  return ctx.connection.transaction(async (db) => {
    const session = await sessionFor(ctx, db, input.sessionId);
    if (session.state !== "draft") fail(RC_REPO_ERROR.SESSION_NOT_DRAFT, "Appel clôturé.");
    const manualCount = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM rc_marks WHERE session_id = ? AND source IN ('manual','default') AND match_key <> ?",
      [input.sessionId, input.matchKey],
    );
    if (Number(manualCount?.n ?? 0) >= RC_MAX_MANUAL) fail(RC_REPO_ERROR.SCAN_LIMIT, "Nombre maximal de pointages atteint.");
    await db.runAsync(
      `INSERT INTO rc_marks (session_id, match_key, student_id, status, source, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?)
       ON CONFLICT (session_id, match_key) DO UPDATE SET status = excluded.status, source = 'manual', updated_at = excluded.updated_at`,
      [input.sessionId, input.matchKey, input.studentId, input.status, iso(ctx.nowMs())],
    );
    return countsFor(db, input.sessionId);
  });
}

// ---------------------------------------------------------------------------------------------
// Clôture : corps figé, opération et digest (PR0 §6.1, contrat des absences PR1c §3 ter).
// ---------------------------------------------------------------------------------------------

export type RosterEntry = { matchKey: string; studentId: string; existingStatus: string | null };

/**
 * Clôture explicite du brouillon. Dans UNE transaction :
 *  1. chaque inscrit du pack non scanné, non pointé et sans statut antérieur reçoit une marque
 *     `default` = absent (le serveur ne crée jamais d'absence lui-même) ;
 *  2. le corps du lot est construit (scans triés par scanId, pointages triés par studentId) ;
 *  3. `operationId`, `payloadDigest` (JCS + SHA-256) et `frozen_body` sont écrits ; les triggers
 *     les rendent immuables.
 * `roster` = élèves du pack VÉRIFIÉ ; null en mode dégradé (aucune absence déduite).
 */
export async function closeSession(
  ctx: RcContext,
  sessionId: string,
  roster: readonly RosterEntry[] | null,
): Promise<{ operationId: string; payloadDigest: string; frozenBody: string }> {
  return ctx.connection.transaction(async (db) => {
    const session = await sessionFor(ctx, db, sessionId);
    if (session.state !== "draft") fail(RC_REPO_ERROR.SESSION_NOT_DRAFT, "Appel déjà clôturé.");
    const now = iso(ctx.nowMs());
    if (roster) {
      const marked = new Set(
        (await db.getAllAsync<{ match_key: string }>("SELECT match_key FROM rc_marks WHERE session_id = ?", [sessionId])).map((row) => row.match_key),
      );
      for (const student of roster) {
        if (marked.has(student.matchKey) || student.existingStatus !== null) continue;
        assertUuid(student.studentId, "studentId");
        await db.runAsync(
          "INSERT INTO rc_marks (session_id, match_key, student_id, status, source, updated_at) VALUES (?, ?, ?, 'absent', 'default', ?)",
          [sessionId, student.matchKey, student.studentId, now],
        );
      }
    }
    const scans = await db.getAllAsync<{ scan_id: string; public_id: string; proof: string; medium: string; scanned_at: string }>(
      "SELECT scan_id, public_id, proof, medium, scanned_at FROM rc_scans WHERE session_id = ? AND removed_at IS NULL",
      [sessionId],
    );
    const marks = await db.getAllAsync<{ student_id: string; status: string }>(
      "SELECT student_id, status FROM rc_marks WHERE session_id = ? AND source IN ('manual','default')",
      [sessionId],
    );
    if (scans.length > RC_MAX_SCANS || marks.length > RC_MAX_MANUAL) fail(RC_REPO_ERROR.SCAN_LIMIT, "Lot trop volumineux.");
    const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const operationId = assertUuid(ctx.randomUUID(), "operationId");
    const body: Record<string, unknown> = {
      contractVersion: CONTRACT_VERSION,
      operationId,
      sessionId: session.session_id,
      revision: Number(session.revision),
      schoolId: session.school_id,
      classId: session.class_id,
      date: session.roll_call_date,
      mode: ROLL_CALL_MODE,
      packId: session.pack_id,
      complete: true,
      scans: scans
        .map((scan) => ({ scanId: scan.scan_id, publicId: scan.public_id, proof: scan.proof, medium: scan.medium, scannedAt: scan.scanned_at }))
        .sort((a, b) => byCodeUnits(a.scanId, b.scanId)),
      manual: marks.map((mark) => ({ studentId: mark.student_id, status: mark.status })).sort((a, b) => byCodeUnits(a.studentId, b.studentId)),
    };
    const payloadDigest = computePayloadDigest(body);
    const frozenBody = canonicalJson({ ...body, payloadDigest });
    await db.runAsync(
      `UPDATE rc_sessions SET state = 'closed', operation_id = ?, payload_digest = ?, frozen_body = ?, closed_at = ?
        WHERE session_id = ? AND state = 'draft'`,
      [operationId, payloadDigest, frozenBody, now, sessionId],
    );
    return { operationId, payloadDigest, frozenBody };
  });
}

// ---------------------------------------------------------------------------------------------
// Synchronisation : invariants de stockage (l'exécution réseau relève de PR4).
// ---------------------------------------------------------------------------------------------

/**
 * Début d'une tentative : closed / failed_retryable / unconfirmable → syncing. Renvoie le corps figé
 * à envoyer À L'IDENTIQUE et son operationId, uniquement après COMMIT.
 */
export function beginSyncAttempt(ctx: RcContext, sessionId: string): Promise<{ operationId: string; frozenBody: string; attempt: number }> {
  return ctx.connection.transaction(async (db) => {
    const session = await sessionFor(ctx, db, sessionId);
    if (!["closed", "failed_retryable", "unconfirmable"].includes(session.state)) {
      fail(RC_REPO_ERROR.STATE_INVALID, "Aucun envoi possible dans cet état.");
    }
    const attempt = Number(session.attempt_count) + 1;
    await db.runAsync("UPDATE rc_sessions SET state = 'syncing', attempt_count = ? WHERE session_id = ?", [attempt, sessionId]);
    await db.runAsync(
      "INSERT INTO rc_sync_attempts (session_id, operation_id, attempt, started_at) VALUES (?, ?, ?, ?)",
      [sessionId, session.operation_id, attempt, iso(ctx.nowMs())],
    );
    return { operationId: session.operation_id as string, frozenBody: String(session.frozen_body), attempt };
  });
}

export type SyncOutcome =
  | { kind: "network" }
  | {
      kind: "http";
      httpStatus: number;
      errorCode?: string | null;
      sessionState?: string | null;
      ack?: { operationId?: unknown; revision?: unknown; payloadDigest?: unknown; rollCallId?: unknown; counts?: unknown } | null;
    };

export type SyncDecision = {
  state: "synced" | "failed_retryable" | "failed_action_required" | "unconfirmable";
  lastSessionState: "not_recorded" | "conflict" | null;
  errorCode: string | null;
};

/**
 * Règles Mobile de PR0 §6.8 (pures). Une nouvelle révision n'est permise que si la réponse porte
 * `sessionState: "not_recorded"` ; un refus d'accès, un timeout ou une erreur 5xx ne l'autorisent jamais.
 */
export function decideSyncOutcome(session: Pick<RcSessionRow, "operation_id" | "revision" | "payload_digest">, outcome: SyncOutcome): SyncDecision {
  if (outcome.kind === "network") return { state: "failed_retryable", lastSessionState: null, errorCode: "NETWORK_ERROR" };
  const status = outcome.httpStatus;
  const code = sanitizeErrorCode(outcome.errorCode ?? null);
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) return { state: "failed_retryable", lastSessionState: null, errorCode: "RESPONSE_UNREADABLE" };
  if (status >= 200 && status < 300) {
    const ack = outcome.ack;
    const matches =
      !!ack &&
      ack.operationId === session.operation_id &&
      ack.revision === Number(session.revision) &&
      ack.payloadDigest === session.payload_digest;
    return matches
      ? { state: "synced", lastSessionState: null, errorCode: null }
      : { state: "failed_action_required", lastSessionState: null, errorCode: "ACK_MISMATCH" };
  }
  if (outcome.sessionState === "not_recorded") return { state: "failed_action_required", lastSessionState: "not_recorded", errorCode: code };
  if (outcome.sessionState === "conflict") return { state: "failed_action_required", lastSessionState: "conflict", errorCode: code };
  if (status === 408 || status === 429 || status >= 500) return { state: "failed_retryable", lastSessionState: null, errorCode: code ?? `HTTP_${status}` };
  if (status === 401 || status === 403 || status === 404) return { state: "unconfirmable", lastSessionState: null, errorCode: code ?? `HTTP_${status}` };
  return { state: "failed_action_required", lastSessionState: null, errorCode: code ?? `HTTP_${status}` };
}

/**
 * Enregistre la réponse de la tentative en cours. `synced` efface, dans la même transaction, les
 * preuves, le corps figé et le pack (données personnelles), et conserve un résumé de compteurs.
 */
export function recordSyncOutcome(ctx: RcContext, sessionId: string, operationId: string, outcome: SyncOutcome): Promise<SyncDecision> {
  return ctx.connection.transaction(async (db) => {
    const session = await sessionFor(ctx, db, sessionId);
    if (session.state !== "syncing") fail(RC_REPO_ERROR.STATE_INVALID, "Aucune tentative en cours.");
    if (session.operation_id !== operationId) fail(RC_REPO_ERROR.OPERATION_MISMATCH, "Réponse d'une autre opération.");
    const decision = decideSyncOutcome(session, outcome);
    const now = iso(ctx.nowMs());
    const httpStatus = outcome.kind === "http" && Number.isSafeInteger(outcome.httpStatus) && outcome.httpStatus >= 100 && outcome.httpStatus <= 599
      ? outcome.httpStatus
      : null;
    await db.runAsync(
      "UPDATE rc_sync_attempts SET http_status = ?, error_code = ? WHERE operation_id = ? AND attempt = ?",
      [httpStatus, decision.errorCode, operationId, Number(session.attempt_count)],
    );
    if (decision.state === "synced") {
      const ack = outcome.kind === "http" ? outcome.ack : null;
      const counts = ack?.counts && typeof ack.counts === "object" ? ack.counts : null;
      const summary = counts ? canonicalJson(pickCounts(counts as Record<string, unknown>)) : null;
      await db.runAsync(
        `UPDATE rc_sessions SET state = 'synced', synced_at = ?, frozen_body = NULL, last_error_code = NULL,
                last_http_status = ?, last_session_state = NULL, server_roll_call_id = ?, summary_counts = ?
          WHERE session_id = ?`,
        [now, httpStatus, typeof ack?.rollCallId === "string" && UUID.test(ack.rollCallId) ? ack.rollCallId : null, summary, sessionId],
      );
      await db.runAsync("UPDATE rc_scans SET proof = NULL WHERE session_id = ?", [sessionId]);
      await purgePackIfUnused(db, session.pack_id);
    } else {
      await db.runAsync(
        `UPDATE rc_sessions SET state = ?, last_error_code = ?, last_http_status = ?, last_session_state = ?,
                ever_unconfirmable = CASE WHEN ? = 'unconfirmable' THEN 1 ELSE ever_unconfirmable END
          WHERE session_id = ?`,
        [decision.state, decision.errorCode, httpStatus, decision.lastSessionState, decision.state, sessionId],
      );
    }
    return decision;
  });
}

function pickCounts(counts: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["present", "late", "absent", "excused", "enrolled"]) {
    const value = counts[key];
    if (Number.isSafeInteger(value) && (value as number) >= 0) out[key] = value as number;
  }
  return out;
}

async function purgePackIfUnused(db: L1SqliteLike, packId: string | null): Promise<void> {
  if (!packId) return;
  const user = await db.getFirstAsync(
    "SELECT session_id FROM rc_sessions WHERE pack_id = ? AND state NOT IN ('synced','expired')",
    [packId],
  );
  if (!user) await db.runAsync("DELETE FROM rc_packs WHERE pack_id = ?", [packId]);
}

/**
 * Nouvelle révision (PR0 §6.8) : permise uniquement si la DERNIÈRE réponse de l'opération courante
 * atteste `not_recorded`. Même sessionId, revision + 1 ; l'operationId sera neuf à la clôture.
 */
export function reviseSession(ctx: RcContext, sessionId: string): Promise<RcSessionRow> {
  return ctx.connection.transaction(async (db) => {
    const session = await sessionFor(ctx, db, sessionId);
    if (session.state !== "failed_action_required" || session.last_session_state !== "not_recorded") {
      fail(RC_REPO_ERROR.REVISION_FORBIDDEN, "Révision interdite sans attestation not_recorded du serveur.");
    }
    // Les absences déduites à la clôture précédente sont recalculées à la prochaine clôture.
    await db.runAsync(
      `UPDATE rc_sessions SET state = 'draft', revision = revision + 1, operation_id = NULL, payload_digest = NULL,
              frozen_body = NULL, closed_at = NULL, last_session_state = NULL
        WHERE session_id = ?`,
      [sessionId],
    );
    await db.runAsync("DELETE FROM rc_marks WHERE session_id = ? AND source = 'default'", [sessionId]);
    return sessionFor(ctx, db, sessionId);
  });
}

/** Application tuée pendant un envoi : la réponse est inconnue, renvoi identique (jamais de révision). */
export function recoverInterruptedSyncs(ctx: RcContext): Promise<number> {
  return ctx.connection.transaction(async (db) => {
    const rows = await db.getAllAsync<{ session_id: string }>(
      "SELECT session_id FROM rc_sessions WHERE state = 'syncing' AND user_id = ? AND school_id = ?",
      [ctx.identity.userId, ctx.identity.schoolId],
    );
    for (const row of rows) {
      await db.runAsync(
        "UPDATE rc_sessions SET state = 'failed_retryable', last_error_code = 'INTERRUPTED', last_session_state = NULL WHERE session_id = ?",
        [row.session_id],
      );
    }
    return rows.length;
  });
}

/** Compte désactivé ou retiré constaté par le serveur : aucune révision implicite, état non confirmable. */
export function markAccountUnconfirmable(ctx: RcContext): Promise<number> {
  return ctx.connection.transaction(async (db) => {
    const rows = await db.getAllAsync<{ session_id: string }>(
      "SELECT session_id FROM rc_sessions WHERE state IN ('closed','failed_retryable','syncing') AND user_id = ? AND school_id = ?",
      [ctx.identity.userId, ctx.identity.schoolId],
    );
    for (const row of rows) {
      await db.runAsync(
        "UPDATE rc_sessions SET state = 'unconfirmable', ever_unconfirmable = 1, last_error_code = 'ACCOUNT_UNCONFIRMABLE', last_session_state = NULL WHERE session_id = ?",
        [row.session_id],
      );
    }
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------
// Déconnexion et reconnexion du même compte (PR0 §5.3).
// ---------------------------------------------------------------------------------------------

export function blockSessionsForLogout(ctx: RcContext): Promise<number> {
  return ctx.connection.transaction(async (db) => {
    await db.runAsync(
      "UPDATE rc_sessions SET state = 'failed_retryable', last_error_code = 'INTERRUPTED' WHERE state = 'syncing' AND user_id = ? AND school_id = ?",
      [ctx.identity.userId, ctx.identity.schoolId],
    );
    const rows = await db.getAllAsync<{ session_id: string; state: RcSessionState }>(
      `SELECT session_id, state FROM rc_sessions
        WHERE state IN ('draft','closed','failed_retryable','failed_action_required','unconfirmable') AND user_id = ? AND school_id = ?`,
      [ctx.identity.userId, ctx.identity.schoolId],
    );
    for (const row of rows) {
      await db.runAsync("UPDATE rc_sessions SET state = 'blocked_logout', state_before_logout = ? WHERE session_id = ?", [row.state, row.session_id]);
    }
    return rows.length;
  });
}

export function restoreSessionsAfterLogin(ctx: RcContext): Promise<number> {
  return ctx.connection.transaction(async (db) => {
    const rows = await db.getAllAsync<{ session_id: string }>(
      "SELECT session_id FROM rc_sessions WHERE state = 'blocked_logout' AND user_id = ? AND school_id = ?",
      [ctx.identity.userId, ctx.identity.schoolId],
    );
    for (const row of rows) {
      await db.runAsync("UPDATE rc_sessions SET state = state_before_logout, state_before_logout = NULL WHERE session_id = ?", [row.session_id]);
    }
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------
// Échéances et purge des données personnelles (PR0 §5.5).
// ---------------------------------------------------------------------------------------------

export type PurgeReport = { expired: number; deletedSessions: number; deletedPacks: number };

/**
 * Au-delà de `sync_deadline` : session `expired` (preuves, corps figé et noms supprimés ; compteurs
 * conservés). Exception : une session devenue non confirmable garde son corps figé jusqu'à la purge
 * de la base. Résumés synchronisés et sessions expirées supprimés après 7 jours ; packs expirés
 * supprimés. Un brouillon n'est jamais purgé avant son échéance.
 */
export function runPurge(ctx: RcContext): Promise<PurgeReport> {
  return ctx.connection.transaction(async (db) => {
    const nowMs = ctx.nowMs();
    const now = iso(nowMs);
    const overdue = await db.getAllAsync<{ session_id: string; pack_id: string | null; ever_unconfirmable: number; state: string }>(
      `SELECT session_id, pack_id, ever_unconfirmable, state FROM rc_sessions
        WHERE state IN ('draft','closed','failed_retryable','failed_action_required','unconfirmable') AND sync_deadline <= ?`,
      [now],
    );
    for (const row of overdue) {
      const keepBody = Number(row.ever_unconfirmable) === 1 || row.state === "unconfirmable";
      if (row.state === "unconfirmable") {
        await db.runAsync("UPDATE rc_sessions SET ever_unconfirmable = 1 WHERE session_id = ?", [row.session_id]);
      }
      await db.runAsync(
        `UPDATE rc_sessions SET state = 'expired', expired_at = ?, frozen_body = CASE WHEN ? = 1 THEN frozen_body ELSE NULL END
          WHERE session_id = ?`,
        [now, keepBody ? 1 : 0, row.session_id],
      );
      if (!keepBody) await db.runAsync("UPDATE rc_scans SET proof = NULL WHERE session_id = ?", [row.session_id]);
    }
    const synced = await db.runAsync("DELETE FROM rc_sessions WHERE state = 'synced' AND synced_at <= ?", [iso(nowMs - RC_SYNCED_SUMMARY_RETENTION_MS)]);
    const expired = await db.runAsync(
      "DELETE FROM rc_sessions WHERE state = 'expired' AND ever_unconfirmable = 0 AND expired_at <= ?",
      [iso(nowMs - RC_EXPIRED_RETENTION_MS)],
    );
    const packs = await db.runAsync(
      `DELETE FROM rc_packs WHERE expires_at <= ?
          OR pack_id NOT IN (SELECT pack_id FROM rc_sessions WHERE pack_id IS NOT NULL AND state NOT IN ('synced','expired'))
             AND stored_at <= ?`,
      [now, iso(nowMs - 48 * 3600 * 1000)],
    );
    for (const row of overdue) await purgePackIfUnused(db, row.pack_id);
    const changes = (result: unknown) => Number((result as { changes?: number })?.changes ?? 0);
    return { expired: overdue.length, deletedSessions: changes(synced) + changes(expired), deletedPacks: changes(packs) };
  });
}

/** Échéance de crypto-effacement de la base fermée : max(sync_deadline) + 7 jours. */
export async function computeAccountPurgeAt(ctx: RcContext): Promise<number> {
  const row = await ctx.connection.read((db) =>
    db.getFirstAsync<{ deadline: string | null }>("SELECT max(sync_deadline) AS deadline FROM rc_sessions"),
  );
  const deadline = row?.deadline ? Date.parse(row.deadline) : ctx.nowMs();
  return Math.max(deadline, ctx.nowMs()) + RC_DB_PURGE_GRACE_MS;
}
