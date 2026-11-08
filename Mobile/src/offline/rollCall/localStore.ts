/**
 * NFC-PRES-LOCAL-PR2 — transactional local attendance operations.
 * Caller must provide a verified SQLCipher connection for ONE authenticated account.
 * Never return success until COMMIT; no HTTP or UI dependency.
 */
export type LocalScan = {
  scanId: string; sessionId: string; publicId: string; proof: string;
  medium: "nfc" | "qr"; scannedAt: string;
  localStatus: "verified_local" | "unknown_local"; matchKey?: string | null;
};
export type LocalSession = {
  sessionId: string; userId: string; schoolId: string; classId: string;
  date: string; openedAt: string; syncDeadline: string; packId?: string | null;
};
export type RollCallStatus = "present" | "late" | "absent";
export type RollCallMarkSource = "card" | "manual" | "existing" | "default";
export type RollCallCounts = { scans: number; marks: number };
export interface LocalRollCallHandle {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}
function required(value: string, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error("RC_INVALID_" + field);
}

export function createRollCallLocalStore(db: LocalRollCallHandle) {
  // All writes on this open database must go through this one queue.
  let tail: Promise<void> = Promise.resolve();
  function transact<T>(callback: () => Promise<T>): Promise<T> {
    const current = tail.catch(() => undefined).then(async () => {
      await db.execAsync("BEGIN IMMEDIATE");
      try {
        const result = await callback();
        await db.execAsync("COMMIT");
        return result;
      } catch (error) {
        try { await db.execAsync("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
    });
    tail = current.then(() => undefined, () => undefined);
    return current;
  }
  async function counts(sessionId: string): Promise<RollCallCounts> {
    const scans = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM rc_scans WHERE session_id = ? AND removed_at IS NULL", [sessionId]);
    const marks = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM rc_marks WHERE session_id = ?", [sessionId]);
    return { scans: scans?.n ?? 0, marks: marks?.n ?? 0 };
  }
  return {
    async openDraft(s: LocalSession) {
      for (const k of ["sessionId","userId","schoolId","classId","date","openedAt","syncDeadline"] as const) {
        required(s[k], k);
      }
      await transact(() => db.runAsync(
        "INSERT INTO rc_sessions(session_id,user_id,school_id,class_id,roll_call_date,pack_id,state,opened_at,sync_deadline) VALUES (?,?,?,?,?,?,'draft',?,?)",
        [s.sessionId,s.userId,s.schoolId,s.classId,s.date,s.packId??null,s.openedAt,s.syncDeadline]));
      return counts(s.sessionId);
    },
    async recordScan(s: LocalScan): Promise<{ duplicate: boolean; counts: RollCallCounts }> {
      for (const k of ["scanId","sessionId","publicId","proof","scannedAt"] as const) required(s[k], k);
      if (!["nfc","qr"].includes(s.medium) ||
          !["verified_local","unknown_local"].includes(s.localStatus)) throw new Error("RC_SCAN_INVALID");
      const duplicate = await transact(async () => {
        const found = await db.getFirstAsync<{ scan_id: string }>(
          "SELECT scan_id FROM rc_scans WHERE session_id = ? AND public_id = ? AND removed_at IS NULL",
          [s.sessionId,s.publicId]);
        if (found) return true;
        await db.runAsync(
          "INSERT INTO rc_scans(scan_id,session_id,public_id,proof,medium,scanned_at,local_status,match_key) VALUES (?,?,?,?,?,?,?,?)",
          [s.scanId,s.sessionId,s.publicId,s.proof,s.medium,s.scannedAt,s.localStatus,s.matchKey??null]);
        return false;
      });
      return { duplicate, counts: await counts(s.sessionId) };
    },
    async recordMark(
      sessionId: string, matchKey: string, status: RollCallStatus,
      source: RollCallMarkSource, updatedAt: string,
    ): Promise<RollCallCounts> {
      required(sessionId,"sessionId"); required(matchKey,"matchKey"); required(updatedAt,"updatedAt");
      if (!["present","late","absent"].includes(status) ||
          !["card","manual","existing","default"].includes(source)) throw new Error("RC_MARK_INVALID");
      await transact(() => db.runAsync(
        "INSERT INTO rc_marks(session_id,match_key,status,source,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(session_id,match_key) DO UPDATE SET status=excluded.status,source=excluded.source,updated_at=excluded.updated_at",
        [sessionId,matchKey,status,source,updatedAt]));
      return counts(sessionId);
    },
    async freeze(
      sessionId: string, operationId: string, payloadDigest: string,
      frozenBody: Uint8Array, closedAt: string,
    ): Promise<void> {
      required(sessionId,"sessionId"); required(operationId,"operationId"); required(closedAt,"closedAt");
      if (!/^[a-f0-9]{64}$/.test(payloadDigest) || frozenBody.length === 0) {
        throw new Error("RC_FROZEN_BODY_INVALID");
      }
      await transact(async () => {
        const row = await db.getFirstAsync<{ state: string }>(
          "SELECT state FROM rc_sessions WHERE session_id = ?", [sessionId]);
        if (row?.state !== "draft") throw new Error("RC_SESSION_NOT_DRAFT");
        await db.runAsync(
          "UPDATE rc_sessions SET state='closed',operation_id=?,payload_digest=?,frozen_body=?,closed_at=? WHERE session_id=? AND state='draft'",
          [operationId,payloadDigest,frozenBody,closedAt,sessionId]);
      });
    },
    counts,
  };
}
