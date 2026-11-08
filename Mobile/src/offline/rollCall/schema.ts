/**
 * NFC-PRES-LOCAL-PR2 — SQLCipher roll-call schema v1.
 *
 * Separate database for each authenticated account. This module has NO plaintext fallback.
 * Do not open or create the database before checking cipher_version.
 * Source contract: docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md §5.4.
 */
export interface RollCallSqlite {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

export const ROLL_CALL_SCHEMA_VERSION = 1;

export const ROLL_CALL_SCHEMA_V1 = String.raw\`
CREATE TABLE IF NOT EXISTS rc_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rc_packs (
  pack_id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  roll_call_date TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  signed_payload BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS rc_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  roll_call_date TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'teacher' CHECK (mode = 'teacher'),
  pack_id TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft', 'closed', 'syncing', 'synced', 'failed_retryable',
    'failed_action_required', 'unconfirmable', 'expired', 'blocked_logout'
  )),
  state_before_logout TEXT CHECK (state_before_logout IS NULL OR state_before_logout IN (
    'draft', 'closed', 'syncing', 'failed_retryable', 'failed_action_required', 'unconfirmable'
  )),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  operation_id TEXT,
  payload_digest TEXT,
  frozen_body BLOB,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  synced_at TEXT,
  server_roll_call_id TEXT,
  ack_digest TEXT,
  last_error_code TEXT,
  last_session_state TEXT CHECK (last_session_state IS NULL OR last_session_state IN ('not_recorded')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  sync_deadline TEXT NOT NULL,
  CHECK (state = 'draft' OR state = 'blocked_logout' OR state = 'expired'
         OR (operation_id IS NOT NULL AND payload_digest IS NOT NULL AND frozen_body IS NOT NULL)),
  CHECK (payload_digest IS NULL OR
         (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*'))
);

CREATE TABLE IF NOT EXISTS rc_scans (
  scan_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES rc_sessions(session_id) ON DELETE CASCADE,
  public_id TEXT NOT NULL,
  proof TEXT NOT NULL,
  medium TEXT NOT NULL CHECK (medium IN ('nfc', 'qr')),
  scanned_at TEXT NOT NULL,
  local_status TEXT NOT NULL CHECK (local_status IN ('verified_local', 'unknown_local')),
  match_key TEXT,
  removed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rc_scans_active_card
  ON rc_scans(session_id, public_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS rc_marks (
  session_id TEXT NOT NULL REFERENCES rc_sessions(session_id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent')),
  source TEXT NOT NULL CHECK (source IN ('card', 'manual', 'existing', 'default')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, match_key)
);

CREATE TABLE IF NOT EXISTS rc_sync_attempts (
  session_id TEXT NOT NULL REFERENCES rc_sessions(session_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  started_at TEXT NOT NULL,
  http_status INTEGER,
  error_code TEXT,
  PRIMARY KEY (session_id, operation_id, attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rc_one_draft_per_class_day
  ON rc_sessions(class_id, roll_call_date) WHERE state = 'draft';

CREATE INDEX IF NOT EXISTS idx_rc_sessions_due
  ON rc_sessions(state, next_attempt_at, sync_deadline);

CREATE TRIGGER IF NOT EXISTS rc_session_freeze_update
BEFORE UPDATE OF frozen_body, operation_id, payload_digest, revision, state
ON rc_sessions
FOR EACH ROW
WHEN
  (OLD.frozen_body IS NOT NEW.frozen_body OR
   OLD.operation_id IS NOT NEW.operation_id OR
   OLD.payload_digest IS NOT NEW.payload_digest OR
   OLD.revision IS NOT NEW.revision)
  AND NOT (
    OLD.state = 'failed_action_required' AND
    OLD.last_session_state = 'not_recorded' AND
    NEW.state = 'draft' AND
    NEW.revision = OLD.revision + 1 AND
    NEW.frozen_body IS NULL AND
    NEW.operation_id IS NULL AND
    NEW.payload_digest IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'RC_FROZEN_BODY_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_revision_guard
BEFORE UPDATE OF state, revision ON rc_sessions
FOR EACH ROW
WHEN NEW.state = 'draft' AND OLD.state IS NOT 'draft' AND NOT (
  (OLD.state = 'failed_action_required' AND
   OLD.last_session_state = 'not_recorded' AND
   NEW.revision = OLD.revision + 1 AND
   NEW.frozen_body IS NULL AND
   NEW.operation_id IS NULL AND
   NEW.payload_digest IS NULL) OR
  (OLD.state = 'blocked_logout' AND OLD.state_before_logout = 'draft' AND
   NEW.revision = OLD.revision)
)
BEGIN
  SELECT RAISE(ABORT, 'RC_REVISION_NOT_ATTESTED');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_scans_draft_only
BEFORE INSERT ON rc_scans FOR EACH ROW
WHEN (SELECT state FROM rc_sessions WHERE session_id = NEW.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_SCAN_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_marks_draft_only
BEFORE INSERT ON rc_marks FOR EACH ROW
WHEN (SELECT state FROM rc_sessions WHERE session_id = NEW.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_MARK_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_scans_update_draft_only
BEFORE UPDATE ON rc_scans FOR EACH ROW
WHEN (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_SCAN_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_scans_delete_limited
BEFORE DELETE ON rc_scans FOR EACH ROW
WHEN (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) NOT IN ('draft', 'synced', 'expired')
BEGIN
  SELECT RAISE(ABORT, 'RC_SCAN_SESSION_FROZEN');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_marks_delete_draft_only
BEFORE DELETE ON rc_marks FOR EACH ROW
WHEN (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_MARK_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_session_marks_update_draft_only
BEFORE UPDATE ON rc_marks FOR EACH ROW
WHEN (SELECT state FROM rc_sessions WHERE session_id = NEW.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_MARK_SESSION_NOT_DRAFT');
END;
\`;

/**
 * Caller must supply an ALREADY KEYED SQLCipher connection.
 * Recheck encryption prior to ANY DDL; never create a plaintext database.
 */
export async function applyRollCallSchemaV1(db: RollCallSqlite): Promise<void> {
  const row = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
  if (!String(row?.cipher_version ?? "").trim()) {
    throw Object.assign(new Error("SQLCipher requis pour la base des appels"), {
      code: "RC_SQLCIPHER_REQUIRED",
    });
  }
  await db.execAsync("PRAGMA foreign_keys = ON");
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    await db.execAsync(ROLL_CALL_SCHEMA_V1);
    await db.execAsync("INSERT OR IGNORE INTO rc_meta(key, value) VALUES ('schema_version', '1')");
    const version = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM rc_meta WHERE key = 'schema_version'",
    );
    if (version?.value !== String(ROLL_CALL_SCHEMA_VERSION)) {
      throw new Error("RC_SCHEMA_VERSION_UNSUPPORTED");
    }
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK");
    throw error;
  }
}
