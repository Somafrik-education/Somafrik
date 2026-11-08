/**
 * NFC-PRES-LOCAL-PR2 — schéma local v1 de la base d'appel hors ligne (PR0 §5.4), SQLite / SQLCipher.
 *
 * Une base par compte (environnement × établissement × utilisateur). Les invariants critiques sont
 * portés par le moteur SQLite lui-même (CHECK, index uniques partiels, triggers), pas seulement par
 * le code : une erreur applicative ne peut pas les contourner.
 *
 * Aucune colonne pour le secret de carte, `K`, `token_hash` ou l'UID NFC (test statique).
 */

export const RC_LOCAL_SCHEMA_VERSION = 1;

export const RC_SESSION_STATES = [
  "draft",
  "closed",
  "syncing",
  "synced",
  "failed_retryable",
  "failed_action_required",
  "unconfirmable",
  "expired",
  "blocked_logout",
] as const;
export type RcSessionState = (typeof RC_SESSION_STATES)[number];

/** États « appel en attente » : données non synchronisées à conserver. */
export const RC_PENDING_STATES: readonly RcSessionState[] = [
  "draft",
  "closed",
  "syncing",
  "failed_retryable",
  "failed_action_required",
  "unconfirmable",
  "blocked_logout",
];

/** États où le corps figé, l'opération et le digest existent et sont immuables. */
const FROZEN_STATES = "('closed','syncing','failed_retryable','failed_action_required','unconfirmable')";

/**
 * Transitions autorisées (PR0 §7). Toute autre transition est refusée par le moteur.
 * Les comparaisons portant sur une colonne qui peut être NULL utilisent `IS` : avec `=`, une valeur
 * NULL rend la condition NULL, `NOT (NULL)` reste NULL et le trigger ne se déclencherait pas.
 */
const ALLOWED_TRANSITIONS = `(
  (OLD.state = NEW.state)
  OR (OLD.state = 'draft' AND NEW.state IN ('closed','expired','blocked_logout'))
  OR (OLD.state = 'closed' AND NEW.state IN ('syncing','unconfirmable','expired','blocked_logout'))
  OR (OLD.state = 'syncing' AND NEW.state IN ('synced','failed_retryable','failed_action_required','unconfirmable'))
  OR (OLD.state = 'failed_retryable' AND NEW.state IN ('syncing','unconfirmable','expired','blocked_logout'))
  OR (OLD.state = 'unconfirmable' AND NEW.state IN ('syncing','expired','blocked_logout'))
  OR (OLD.state = 'failed_action_required' AND NEW.state IN ('draft','expired','blocked_logout'))
  OR (OLD.state = 'blocked_logout' AND NEW.state IS OLD.state_before_logout)
)`;

export const RC_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS rc_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- Métadonnées d'identité et de sécurité : jamais supprimées (une absence = corruption, jamais
-- une base neuve). L'identité du compte est immuable.
CREATE TRIGGER IF NOT EXISTS rc_meta_protected_delete BEFORE DELETE ON rc_meta
WHEN OLD.key IN ('schema_version','account_id','environment_id','created_at','pack_revocations','last_trusted_time_ms')
BEGIN
  SELECT RAISE(ABORT, 'RC_META_PROTECTED');
END;

CREATE TRIGGER IF NOT EXISTS rc_meta_identity_immutable BEFORE UPDATE ON rc_meta
WHEN NEW.key IS NOT OLD.key OR OLD.key IN ('schema_version','account_id','environment_id','created_at')
BEGIN
  SELECT RAISE(ABORT, 'RC_META_PROTECTED');
END;

-- Horloge de confiance : entier décimal, jamais en recul.
CREATE TRIGGER IF NOT EXISTS rc_meta_trusted_time_monotone BEFORE UPDATE ON rc_meta
WHEN OLD.key = 'last_trusted_time_ms' AND (
  NEW.value IS NULL OR NEW.value = '' OR NEW.value GLOB '*[^0-9]*' OR length(NEW.value) > 16
  OR CAST(NEW.value AS INTEGER) < CAST(OLD.value AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT, 'RC_TRUSTED_TIME_REGRESSION');
END;

-- Révocations : séquence jamais en recul, aucune clé révoquée retirée. Une ancienne valeur
-- illisible fait échouer json_each : la mise à jour est alors refusée (fail-closed).
CREATE TRIGGER IF NOT EXISTS rc_meta_revocations_monotone BEFORE UPDATE ON rc_meta
WHEN OLD.key = 'pack_revocations' AND (
  json_valid(NEW.value) IS NOT 1
  OR json_type(NEW.value, '$.sequence') IS NOT 'integer'
  OR json_type(NEW.value, '$.revokedKeyIds') IS NOT 'array'
  OR json_extract(NEW.value, '$.sequence') < json_extract(OLD.value, '$.sequence')
  OR EXISTS (
    SELECT 1 FROM json_each(OLD.value, '$.revokedKeyIds') AS o
    WHERE o.value NOT IN (SELECT n.value FROM json_each(NEW.value, '$.revokedKeyIds') AS n)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'RC_REVOCATIONS_REGRESSION');
END;

CREATE TABLE IF NOT EXISTS rc_packs (
  pack_id TEXT PRIMARY KEY NOT NULL CHECK (length(pack_id) = 36),
  class_id TEXT NOT NULL CHECK (length(class_id) = 36),
  roll_call_date TEXT NOT NULL CHECK (roll_call_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_at TEXT NOT NULL,
  signed_payload BLOB NOT NULL,
  stored_at TEXT NOT NULL
);

-- Contenu signé original : jamais modifié après l'insertion (seule la suppression est permise).
CREATE TRIGGER IF NOT EXISTS rc_packs_immutable BEFORE UPDATE ON rc_packs
BEGIN
  SELECT RAISE(ABORT, 'RC_PACK_IMMUTABLE');
END;

CREATE TABLE IF NOT EXISTS rc_sessions (
  session_id TEXT PRIMARY KEY NOT NULL CHECK (length(session_id) = 36),
  user_id TEXT NOT NULL CHECK (length(user_id) > 0),
  school_id TEXT NOT NULL CHECK (length(school_id) = 36),
  class_id TEXT NOT NULL CHECK (length(class_id) = 36),
  roll_call_date TEXT NOT NULL CHECK (roll_call_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  mode TEXT NOT NULL CHECK (mode = 'teacher'),
  pack_id TEXT NULL CHECK (pack_id IS NULL OR length(pack_id) = 36),
  state TEXT NOT NULL CHECK (state IN ('draft','closed','syncing','synced','failed_retryable',
                                       'failed_action_required','unconfirmable','expired','blocked_logout')),
  state_before_logout TEXT NULL CHECK (state_before_logout IS NULL OR state_before_logout IN
                                       ('draft','closed','failed_retryable','failed_action_required','unconfirmable')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  operation_id TEXT NULL CHECK (operation_id IS NULL OR length(operation_id) = 36),
  payload_digest TEXT NULL CHECK (payload_digest IS NULL OR (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*')),
  frozen_body BLOB NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT NULL,
  synced_at TEXT NULL,
  expired_at TEXT NULL,
  server_roll_call_id TEXT NULL,
  ack_digest TEXT NULL,
  last_error_code TEXT NULL CHECK (last_error_code IS NULL OR (length(last_error_code) <= 64 AND last_error_code NOT GLOB '*[^A-Z0-9_]*')),
  last_http_status INTEGER NULL CHECK (last_http_status IS NULL OR (last_http_status >= 100 AND last_http_status <= 599)),
  last_session_state TEXT NULL CHECK (last_session_state IS NULL OR last_session_state IN ('not_recorded','conflict')),
  ever_unconfirmable INTEGER NOT NULL DEFAULT 0 CHECK (ever_unconfirmable IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NULL,
  sync_deadline TEXT NOT NULL,
  summary_counts TEXT NULL,
  CHECK (state <> 'draft' OR (operation_id IS NULL AND payload_digest IS NULL AND frozen_body IS NULL)),
  CHECK (state NOT IN ${FROZEN_STATES} OR (operation_id IS NOT NULL AND payload_digest IS NOT NULL AND frozen_body IS NOT NULL)),
  CHECK (state <> 'synced' OR (operation_id IS NOT NULL AND payload_digest IS NOT NULL AND synced_at IS NOT NULL)),
  CHECK ((state = 'blocked_logout') = (state_before_logout IS NOT NULL))
);

-- Un seul brouillon par classe et par jour dans la base du compte.
CREATE UNIQUE INDEX IF NOT EXISTS rc_sessions_one_draft
  ON rc_sessions (class_id, roll_call_date) WHERE state = 'draft';

-- Machine d'état : transitions de PR0 §7 uniquement.
CREATE TRIGGER IF NOT EXISTS rc_sessions_transition BEFORE UPDATE OF state ON rc_sessions
WHEN NOT ${ALLOWED_TRANSITIONS}
BEGIN
  SELECT RAISE(ABORT, 'RC_STATE_TRANSITION_FORBIDDEN');
END;

-- Nouvelle révision : uniquement depuis failed_action_required attesté not_recorded par la dernière
-- réponse serveur de l'opération courante ; opération, digest, corps et attestation remis à zéro.
CREATE TRIGGER IF NOT EXISTS rc_sessions_revision BEFORE UPDATE ON rc_sessions
WHEN (NEW.revision <> OLD.revision OR (NEW.state = 'draft' AND OLD.state NOT IN ('draft','blocked_logout')))
  AND NOT (
    OLD.state IS 'failed_action_required'
    AND OLD.last_session_state IS 'not_recorded'
    AND NEW.state IS 'draft'
    AND NEW.revision IS OLD.revision + 1
    AND NEW.operation_id IS NULL AND NEW.payload_digest IS NULL AND NEW.frozen_body IS NULL
    AND NEW.last_session_state IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'RC_REVISION_FORBIDDEN');
END;

-- Opération et digest figés : modifiables seulement par la règle de révision ci-dessus.
CREATE TRIGGER IF NOT EXISTS rc_sessions_operation_frozen BEFORE UPDATE ON rc_sessions
WHEN OLD.operation_id IS NOT NULL
  AND (NEW.operation_id IS NOT OLD.operation_id OR NEW.payload_digest IS NOT OLD.payload_digest)
  AND NOT (OLD.state = 'failed_action_required' AND NEW.state = 'draft')
BEGIN
  SELECT RAISE(ABORT, 'RC_FROZEN_BODY_IMMUTABLE');
END;

-- Corps figé : jamais remplacé ; effacé seulement après synchronisation confirmée, à l'expiration
-- (sauf session devenue non confirmable, conservée jusqu'à la purge de la base) ou par révision.
CREATE TRIGGER IF NOT EXISTS rc_sessions_body_frozen BEFORE UPDATE ON rc_sessions
WHEN OLD.frozen_body IS NOT NULL AND NEW.frozen_body IS NOT OLD.frozen_body
  AND NOT (
    NEW.frozen_body IS NULL AND (
      NEW.state = 'synced'
      OR (NEW.state = 'expired' AND OLD.ever_unconfirmable = 0)
      OR (OLD.state = 'failed_action_required' AND NEW.state = 'draft')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'RC_FROZEN_BODY_IMMUTABLE');
END;

-- Une session devenue non confirmable le reste dans l'historique (purge du corps différée).
CREATE TRIGGER IF NOT EXISTS rc_sessions_unconfirmable_sticky BEFORE UPDATE OF ever_unconfirmable ON rc_sessions
WHEN OLD.ever_unconfirmable = 1 AND NEW.ever_unconfirmable <> 1
BEGIN
  SELECT RAISE(ABORT, 'RC_UNCONFIRMABLE_STICKY');
END;

-- Identité de la session immuable.
CREATE TRIGGER IF NOT EXISTS rc_sessions_identity BEFORE UPDATE ON rc_sessions
WHEN NEW.session_id IS NOT OLD.session_id OR NEW.user_id IS NOT OLD.user_id OR NEW.school_id IS NOT OLD.school_id
  OR NEW.class_id IS NOT OLD.class_id OR NEW.roll_call_date IS NOT OLD.roll_call_date OR NEW.mode IS NOT OLD.mode
  OR NEW.pack_id IS NOT OLD.pack_id OR NEW.opened_at IS NOT OLD.opened_at
BEGIN
  SELECT RAISE(ABORT, 'RC_SESSION_IDENTITY_IMMUTABLE');
END;

-- Une session non synchronisée n'est jamais supprimée ligne par ligne (seul l'effacement de la base
-- entière, à l'échéance ou au crypto-effacement, la fait disparaître).
CREATE TRIGGER IF NOT EXISTS rc_sessions_no_silent_delete BEFORE DELETE ON rc_sessions
WHEN OLD.state NOT IN ('synced','expired') OR (OLD.state = 'expired' AND OLD.ever_unconfirmable = 1)
BEGIN
  SELECT RAISE(ABORT, 'RC_PENDING_SESSION_DELETE_FORBIDDEN');
END;

CREATE TABLE IF NOT EXISTS rc_scans (
  scan_id TEXT PRIMARY KEY NOT NULL CHECK (length(scan_id) = 36),
  session_id TEXT NOT NULL REFERENCES rc_sessions (session_id) ON DELETE CASCADE,
  public_id TEXT NOT NULL CHECK (length(public_id) = 22 AND public_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  proof TEXT NULL CHECK (proof IS NULL OR (length(proof) = 43 AND proof NOT GLOB '*[^A-Za-z0-9_-]*')),
  medium TEXT NOT NULL CHECK (medium IN ('nfc','qr')),
  scanned_at TEXT NOT NULL,
  local_status TEXT NOT NULL CHECK (local_status IN ('verified_local','unknown_local')),
  match_key TEXT NULL,
  removed_at TEXT NULL,
  CHECK ((local_status = 'verified_local') = (match_key IS NOT NULL))
);

-- Une carte au plus une fois active par session.
CREATE UNIQUE INDEX IF NOT EXISTS rc_scans_one_active_card
  ON rc_scans (session_id, public_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS rc_scans_session ON rc_scans (session_id);

-- Scans modifiables uniquement pendant le brouillon ; après synchronisation ou expiration, seule la
-- purge (preuve effacée, ligne supprimée) est permise.
CREATE TRIGGER IF NOT EXISTS rc_scans_insert_draft_only BEFORE INSERT ON rc_scans
WHEN (SELECT state FROM rc_sessions WHERE session_id = NEW.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_scans_update_rules BEFORE UPDATE ON rc_scans
WHEN NEW.scan_id IS NOT OLD.scan_id OR NEW.session_id IS NOT OLD.session_id OR NEW.public_id IS NOT OLD.public_id
  OR NEW.medium IS NOT OLD.medium OR NEW.scanned_at IS NOT OLD.scanned_at
  OR NEW.local_status IS NOT OLD.local_status OR NEW.match_key IS NOT OLD.match_key
  OR (NEW.proof IS NOT OLD.proof AND NOT (
        NEW.proof IS NULL
        AND (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) IN ('synced','expired')))
  OR (NEW.removed_at IS NOT OLD.removed_at AND NOT (
        OLD.removed_at IS NULL
        AND (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) = 'draft'))
BEGIN
  SELECT RAISE(ABORT, 'RC_SCAN_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS rc_scans_delete_rules BEFORE DELETE ON rc_scans
WHEN (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) NOT IN ('synced','expired')
BEGIN
  SELECT RAISE(ABORT, 'RC_SCAN_DELETE_FORBIDDEN');
END;

CREATE TABLE IF NOT EXISTS rc_marks (
  session_id TEXT NOT NULL REFERENCES rc_sessions (session_id) ON DELETE CASCADE,
  match_key TEXT NOT NULL CHECK (length(match_key) > 0),
  student_id TEXT NOT NULL CHECK (length(student_id) = 36),
  status TEXT NOT NULL CHECK (status IN ('present','late','absent')),
  source TEXT NOT NULL CHECK (source IN ('card','manual','existing','default')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, match_key)
);

CREATE TRIGGER IF NOT EXISTS rc_marks_insert_draft_only BEFORE INSERT ON rc_marks
WHEN (SELECT state FROM rc_sessions WHERE session_id = NEW.session_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RC_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_marks_update_draft_only BEFORE UPDATE ON rc_marks
WHEN (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) IS NOT 'draft'
  OR NEW.session_id IS NOT OLD.session_id OR NEW.match_key IS NOT OLD.match_key OR NEW.student_id IS NOT OLD.student_id
BEGIN
  SELECT RAISE(ABORT, 'RC_SESSION_NOT_DRAFT');
END;

CREATE TRIGGER IF NOT EXISTS rc_marks_delete_rules BEFORE DELETE ON rc_marks
WHEN (SELECT state FROM rc_sessions WHERE session_id = OLD.session_id) NOT IN ('draft','synced','expired')
BEGIN
  SELECT RAISE(ABORT, 'RC_SESSION_NOT_DRAFT');
END;

-- Journal technique minimal : aucune donnée personnelle, aucune preuve.
CREATE TABLE IF NOT EXISTS rc_sync_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL CHECK (length(session_id) = 36),
  operation_id TEXT NOT NULL CHECK (length(operation_id) = 36),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  started_at TEXT NOT NULL,
  http_status INTEGER NULL CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
  error_code TEXT NULL CHECK (error_code IS NULL OR (length(error_code) <= 64 AND error_code NOT GLOB '*[^A-Z0-9_]*')),
  UNIQUE (operation_id, attempt)
);
`;

/** Colonnes interdites (secret de carte, K, empreinte serveur, UID NFC) : contrôle statique. */
export const RC_FORBIDDEN_COLUMN_NAMES = ["secret", "card_token", "token_hash", "card_key", "nfc_uid", "uid"] as const;
