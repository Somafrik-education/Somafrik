"use strict";

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");
const { planStudentCardBatch } = require("./studentCardBatchPlan");
const {
  generateCardSecrets,
  assertSecretEntropy,
  assertNoSecretLeak,
  readStudentCardHolder,
} = require("./studentAccessCardsManagement");
const { hashCardSecret, tokenHashesMatch } = require("./studentCardCapability");
const { isStudentCardCapabilityEnabled, isStudentCardMasterEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { ROSTER_ENROLLMENT_SQL } = require("./studentEnrollmentC18");

/**
 * CARTE-BATCH-API-02 — préparation, accusé, activation.
 *
 * Une carte préparée reste `issued` et non scannable. Le secret QR n'est renvoyé
 * que par la réponse de préparation, jamais relu. La réception technique du
 * message HTTP ne vaut pas la sauvegarde du document par l'opérateur, et aucune
 * des deux n'active la carte.
 */
const BATCH_PREPARE_TTL_MS = 30 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BATCH_ERROR = Object.freeze({
  PENDING: "STUDENT_CARD_BATCH_PENDING",
  NOT_FOUND: "STUDENT_CARD_BATCH_NOT_FOUND",
  EXPIRED: "STUDENT_CARD_BATCH_EXPIRED",
  RECEIPT_REQUIRED: "STUDENT_CARD_BATCH_RECEIPT_REQUIRED",
  SAVE_REQUIRED: "STUDENT_CARD_BATCH_SAVE_REQUIRED",
  PROOF_INVALID: "STUDENT_CARD_BATCH_PROOF_INVALID",
  ACTIVATED: "STUDENT_CARD_BATCH_ACTIVATED",
  QR_DISABLED: "STUDENT_CARD_QR_DISABLED",
});

const BATCH_AUDIT = Object.freeze({
  PREPARED: "student_card_batch_prepared",
  RECEIVED: "student_card_batch_received",
  SAVED: "student_card_batch_saved",
  ACTIVATED: "student_card_batch_activated",
  ABORTED: "student_card_batch_aborted",
  EXPIRED: "student_card_batch_expired",
});

function nextBatchStatus(status, action) {
  const table = {
    "prepared:technical": "received",
    "prepared:saved": BATCH_ERROR.RECEIPT_REQUIRED,
    "prepared:activate": BATCH_ERROR.SAVE_REQUIRED,
    "prepared:abort": "aborted",
    "prepared:expire": "expired",
    "received:technical": "received",
    "received:saved": "saved",
    "received:activate": BATCH_ERROR.SAVE_REQUIRED,
    "received:abort": "aborted",
    "received:expire": "expired",
    "saved:technical": "saved",
    "saved:saved": "saved",
    "saved:activate": "activated",
    "saved:abort": "aborted",
    "saved:expire": "expired",
    "activated:technical": "activated",
    "activated:saved": "activated",
    "activated:activate": "activated",
    "activated:abort": BATCH_ERROR.ACTIVATED,
    "activated:expire": "activated",
    "expired:technical": BATCH_ERROR.EXPIRED,
    "expired:saved": BATCH_ERROR.EXPIRED,
    "expired:activate": BATCH_ERROR.EXPIRED,
    "expired:abort": BATCH_ERROR.EXPIRED,
    "expired:expire": "expired",
    "aborted:technical": BATCH_ERROR.EXPIRED,
    "aborted:saved": BATCH_ERROR.EXPIRED,
    "aborted:activate": BATCH_ERROR.EXPIRED,
    "aborted:abort": "aborted",
    "aborted:expire": "aborted",
  };
  return table[`${status}:${action}`] ?? BATCH_ERROR.NOT_FOUND;
}

function isBatchError(value) {
  return typeof value === "string" && value.startsWith("STUDENT_CARD_");
}

function batchError(statusCode, message, code, details) {
  const error = createHttpError(statusCode, message, code);
  if (details) error.details = details;
  return error;
}

function transitionError(code) {
  if (code === BATCH_ERROR.RECEIPT_REQUIRED) {
    return batchError(409, "La réception technique du lot n'est pas confirmée.", code);
  }
  if (code === BATCH_ERROR.SAVE_REQUIRED) {
    return batchError(409, "La sauvegarde du document imprimable n'est pas confirmée.", code);
  }
  if (code === BATCH_ERROR.ACTIVATED) {
    return batchError(409, "Le lot est déjà activé.", code);
  }
  if (code === BATCH_ERROR.EXPIRED) {
    return batchError(409, "La préparation a expiré avant activation. Aucune carte active n'a été créée par ce lot.", code);
  }
  return batchError(404, "Lot de cartes introuvable.", BATCH_ERROR.NOT_FOUND);
}

function assertScope(schoolScope) {
  const schoolId = String(schoolScope?.schoolId ?? "").trim();
  if (!schoolId || schoolScope?.mode !== "school") {
    throw batchError(403, "Périmètre établissement requis.", "STUDENT_CARD_TENANT_DENIED");
  }
  return schoolId;
}

function assertClassCode(classCode) {
  const code = typeof classCode === "string" ? classCode.trim() : "";
  if (!code || code.length > 128) {
    throw batchError(400, "Code classe invalide.", "STUDENT_CARD_CLASS_INVALID");
  }
  return code;
}

function assertBatchId(batchId) {
  const id = typeof batchId === "string" ? batchId.trim() : "";
  if (!UUID_RE.test(id)) throw batchError(404, "Lot de cartes introuvable.", BATCH_ERROR.NOT_FOUND);
  return id;
}

function actorId(principal) {
  const id = String(principal?.sub ?? principal?.id ?? "").trim();
  return UUID_RE.test(id) ? id : null;
}

function clock(options) {
  const value = options?.now instanceof Date ? options.now : new Date();
  if (Number.isNaN(value.getTime())) throw new TypeError("Horloge de lot invalide.");
  return value;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function txRepo(tx) {
  return {
    engine: "postgresql",
    query: (sql, params) => tx.query(sql, params),
    one: (sql, params) => tx.one(sql, params),
    all: (sql, params) => tx.all(sql, params),
  };
}

async function withTx(repo, fn) {
  if (typeof repo?.withTransaction !== "function") throw new Error("PostgreSQL transactionnel requis.");
  return repo.withTransaction(fn);
}

async function audit(tx, schoolId, principal, action, batchId, payload) {
  assertNoSecretLeak(payload, "audit.newValue");
  await tx.query(
    `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, new_value)
     VALUES ($1, $2, $3, 'student_card_batch', $4, $5::jsonb)`,
    [schoolId, actorId(principal), action, batchId, JSON.stringify(payload)],
  );
}

async function expireOpenBatches(tx, schoolId, now, principal) {
  const due = await tx.query(
    `SELECT id FROM student_card_batches
      WHERE school_id = $1 AND status IN ('prepared', 'received', 'saved') AND expires_at <= $2
      ORDER BY id
      FOR UPDATE`,
    [schoolId, now],
  );
  if (!Array.isArray(due?.rows)) throw new Error("Lecture PostgreSQL des lots indisponible.");
  for (const row of due.rows) {
    await voidIssuedCards(tx, schoolId, row.id, now, "batch_delivery_expired");
    await tx.query(
      `UPDATE student_card_batches
          SET status = 'expired', updated_at = $3
        WHERE id = $1 AND school_id = $2 AND status IN ('prepared', 'received', 'saved')`,
      [row.id, schoolId, now],
    );
    await audit(tx, schoolId, principal, BATCH_AUDIT.EXPIRED, row.id, {
      batchId: row.id,
      status: "expired",
      reason: "batch_delivery_expired",
    });
  }
}

async function voidIssuedCards(tx, schoolId, batchId, now, reason) {
  await tx.query(
    `UPDATE student_access_cards AS c
        SET status = 'revoked', revoked_at = $3, revoke_reason = $4, updated_at = $3
       FROM student_card_batch_items AS i
      WHERE i.batch_id = $1 AND i.school_id = $2 AND c.id = i.card_id
        AND c.school_id = i.school_id AND c.student_id = i.student_id AND c.status = 'issued'`,
    [batchId, schoolId, now, reason],
  );
  await tx.query(
    `UPDATE student_card_batch_items
        SET outcome = 'voided', updated_at = $3
      WHERE batch_id = $1 AND school_id = $2 AND outcome = 'prepared'`,
    [batchId, schoolId, now],
  );
}

async function assertQrEnabled(tx, schoolId) {
  const repo = txRepo(tx);
  const store = require("../db/schoolSettingsPgStore").createSchoolSettingsPgStore(repo);
  const row = await store.getSettings(schoolId);
  const mapped = mapSettingsRow(row || {});
  if (!isStudentCardMasterEnabled(mapped)) {
    throw batchError(404, "Fonctionnalité carte élève désactivée.", "STUDENT_CARD_DISABLED");
  }
  if (!isStudentCardCapabilityEnabled(mapped, "studentCardQrEnabled")) {
    throw batchError(409, "Les cartes QR sont désactivées pour cet établissement.", BATCH_ERROR.QR_DISABLED);
  }
}

async function loadClass(tx, schoolId, classCode) {
  const found = await tx.query(
    `SELECT id, name, class_code FROM classes
      WHERE school_id = $1 AND class_code = $2
      LIMIT 2`,
    [schoolId, classCode],
  );
  if (!Array.isArray(found?.rows)) throw new Error("Lecture PostgreSQL des classes indisponible.");
  if (found.rows.length !== 1) {
    throw batchError(404, "Classe introuvable ou ambiguë.", "STUDENT_CARD_CLASS_NOT_FOUND");
  }
  return found.rows[0];
}

async function loadRoster(tx, schoolId, classId) {
  const roster = await tx.query(
    `SELECT s.id AS student_id
       FROM enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND y.school_id = e.school_id AND y.is_current IS TRUE
       JOIN classes c ON c.id = e.class_id AND c.school_id = e.school_id AND c.academic_year_id = y.id
       JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
      WHERE e.school_id = $1 AND c.id = $2 AND ${ROSTER_ENROLLMENT_SQL}
      ORDER BY s.id
      FOR UPDATE OF s`,
    [schoolId, classId],
  );
  if (!Array.isArray(roster?.rows)) throw new Error("Lecture PostgreSQL des inscriptions indisponible.");
  return roster.rows.map((row) => String(row.student_id));
}

async function openBatch(tx, schoolId, classId) {
  const row = await tx.one(
    `SELECT id, status, expires_at, class_code
       FROM student_card_batches
      WHERE school_id = $1 AND class_id = $2 AND status IN ('prepared', 'received', 'saved')
      FOR UPDATE`,
    [schoolId, classId],
  );
  return row;
}

async function pendingDetails(tx, batch) {
  const items = await tx.query(
    `SELECT c.public_id
       FROM student_card_batch_items i
       JOIN student_access_cards c ON c.id = i.card_id AND c.school_id = i.school_id
      WHERE i.batch_id = $1
      ORDER BY c.public_id`,
    [batch.id],
  );
  if (!Array.isArray(items?.rows)) throw new Error("Lecture PostgreSQL du lot indisponible.");
  return {
    batchId: batch.id,
    status: batch.status,
    classCode: batch.class_code,
    expiresAt: iso(batch.expires_at),
    secretsRecoverable: false,
    publicIds: items.rows.map((row) => row.public_id),
  };
}

function publicView(batch, entries, counts, extras = {}) {
  return {
    batchId: batch?.id ?? null,
    classCode: batch?.class_code ?? extras.classCode ?? null,
    className: extras.className ?? null,
    status: batch?.status ?? extras.status ?? "not_prepared",
    expiresAt: iso(batch?.expires_at),
    receivedAt: iso(batch?.received_at),
    savedAt: iso(batch?.saved_at),
    activatedAt: iso(batch?.activated_at),
    secretsIncluded: false,
    secretsRecoverable: false,
    counts,
    entries,
  };
}

async function loadItems(tx, schoolId, batchId) {
  const items = await tx.query(
    `SELECT i.student_id, i.card_id, i.outcome, c.public_id, c.status AS card_status, c.token_hash
       FROM student_card_batch_items i
       JOIN student_access_cards c
         ON c.id = i.card_id AND c.school_id = i.school_id AND c.student_id = i.student_id
      WHERE i.batch_id = $1 AND i.school_id = $2
      ORDER BY i.student_id
      FOR UPDATE OF c`,
    [batchId, schoolId],
  );
  if (!Array.isArray(items?.rows)) throw new Error("Lecture PostgreSQL du lot indisponible.");
  return items.rows;
}

function viewEntries(items, scannableFor) {
  return items.map((item) => ({
    studentId: String(item.student_id),
    cardId: String(item.card_id),
    publicId: item.public_id,
    outcome: item.outcome,
    cardStatus: item.card_status,
    scannable: scannableFor(item),
  }));
}

function possessionMatches(items, proofs) {
  if (!Array.isArray(proofs)) return false;
  const byPublicId = new Map();
  for (const proof of proofs) {
    const publicId = typeof proof?.publicId === "string" ? proof.publicId.trim() : "";
    const secret = typeof proof?.secret === "string" && proof.secret.length <= 200 ? proof.secret : "";
    if (!publicId || publicId.length > 200 || !secret || byPublicId.has(publicId)) return false;
    byPublicId.set(publicId, secret);
  }
  if (byPublicId.size !== items.length) return false;
  let ok = items.length > 0;
  for (const item of items) {
    const secret = byPublicId.get(item.public_id) ?? "";
    const match = tokenHashesMatch(hashCardSecret(secret), item.token_hash);
    ok = match && ok;
  }
  return ok;
}

function nonceMatches(nonce, storedHash) {
  const material = typeof nonce === "string" && nonce.length > 0 && nonce.length <= 200 ? nonce : "";
  return tokenHashesMatch(hashCardSecret(material), storedHash);
}

async function loadBatch(tx, schoolId, classCode, batchId) {
  const row = await tx.one(
    `SELECT b.id, b.school_id, b.class_id, b.class_code, b.status, b.expires_at,
            b.delivery_nonce_hash, b.received_at, b.saved_at, b.activated_at, b.aborted_at
       FROM student_card_batches b
       JOIN classes c ON c.id = b.class_id AND c.school_id = b.school_id AND c.class_code = $3
      WHERE b.id = $1 AND b.school_id = $2
      FOR UPDATE OF b`,
    [batchId, schoolId, classCode],
  );
  if (!row) throw batchError(404, "Lot de cartes introuvable.", BATCH_ERROR.NOT_FOUND);
  return row;
}

async function prepareClassCardBatch(repo, schoolScope, classCode, principal, options = {}) {
  const schoolId = assertScope(schoolScope);
  const code = assertClassCode(classCode);
  const now = clock(options);
  return withTx(repo, async (tx) => {
    await expireOpenBatches(tx, schoolId, now, principal);
    const found = await loadClass(tx, schoolId, code);
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`card-batch:${schoolId}:${found.id}`]);
    await assertQrEnabled(tx, schoolId);
    const pending = await openBatch(tx, schoolId, found.id);
    if (pending) {
      throw batchError(
        409,
        "Une préparation de cartes est déjà en cours pour cette classe. Les secrets précédents ne sont pas récupérables.",
        BATCH_ERROR.PENDING,
        await pendingDetails(tx, pending),
      );
    }
    const studentIds = await loadRoster(tx, schoolId, found.id);
    const planRows = [];
    const activeByStudent = new Map();
    for (const studentId of studentIds) {
      const active = await tx.one(
        `SELECT id, public_id, status FROM student_access_cards
          WHERE school_id = $1 AND student_id = $2 AND status = 'active'
          FOR UPDATE`,
        [schoolId, studentId],
      );
      const holder = await readStudentCardHolder(txRepo(tx), studentId, schoolScope);
      activeByStudent.set(studentId, active);
      planRows.push({
        studentId,
        hasActiveCard: Boolean(active),
        eligible: true,
        holderKind: holder?.kind ?? null,
      });
    }
    const plan = planStudentCardBatch(planRows);
    const entries = [];
    for (const entry of plan.entries) {
      if (entry.decision === "already_active") {
        const active = activeByStudent.get(entry.studentId);
        entries.push({
          studentId: entry.studentId,
          decision: "already_active",
          cardId: active?.id ?? null,
          publicId: active?.public_id ?? null,
          scannable: true,
        });
      } else if (entry.decision === "ineligible") {
        entries.push({ studentId: entry.studentId, decision: "ineligible", reason: entry.reason, scannable: false });
      }
    }
    const candidates = plan.entries.filter((entry) => entry.decision === "issue_candidate");
    if (candidates.length === 0) {
      return publicView(null, entries, {
        prepared: 0,
        alreadyActive: plan.counts.alreadyActive,
        ineligible: plan.counts.ineligible,
      }, { classCode: found.class_code, className: found.name, status: "not_prepared" });
    }
    const deliveryNonce = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + BATCH_PREPARE_TTL_MS);
    const batch = await tx.one(
      `INSERT INTO student_card_batches (
         school_id, class_id, class_code, status, expires_at, delivery_nonce_hash, created_by_user_id, updated_at
       ) VALUES ($1, $2, $3, 'prepared', $4, $5, $6, $7)
       RETURNING id, class_code, status, expires_at, received_at, saved_at, activated_at`,
      [schoolId, found.id, found.class_code, expiresAt, hashCardSecret(deliveryNonce), actorId(principal), now],
    );
    const preparedEntries = [];
    for (const candidate of candidates) {
      const generated = generateCardSecrets();
      assertSecretEntropy(generated);
      const card = await tx.one(
        `INSERT INTO student_access_cards (
           school_id, student_id, public_id, token_hash, medium, status, created_by_user_id
         ) VALUES ($1, $2, $3, $4, 'qr', 'issued', $5)
         RETURNING id, public_id, status`,
        [schoolId, candidate.studentId, generated.publicId, generated.tokenHash, actorId(principal)],
      );
      await tx.query(
        `INSERT INTO student_card_batch_items (batch_id, school_id, student_id, card_id, outcome)
         VALUES ($1, $2, $3, $4, 'prepared')`,
        [batch.id, schoolId, candidate.studentId, card.id],
      );
      preparedEntries.push({
        studentId: candidate.studentId,
        decision: "prepared",
        cardId: card.id,
        publicId: card.public_id,
        cardToken: generated.cardToken,
        scannable: false,
      });
    }
    if (options.failAfterInsert === true) {
      throw new Error("Préparation interrompue avant validation.");
    }
    const responseEntries = [...entries, ...preparedEntries].sort((a, b) => a.studentId.localeCompare(b.studentId));
    await audit(tx, schoolId, principal, BATCH_AUDIT.PREPARED, batch.id, {
      batchId: batch.id,
      classCode: found.class_code,
      status: "prepared",
      prepared: preparedEntries.length,
      alreadyActive: plan.counts.alreadyActive,
      ineligible: plan.counts.ineligible,
    });
    return {
      ...publicView(batch, responseEntries.map(({ cardToken, ...rest }) => rest), {
        prepared: preparedEntries.length,
        alreadyActive: plan.counts.alreadyActive,
        ineligible: plan.counts.ineligible,
      }, { className: found.name }),
      secretsIncluded: true,
      deliveryNonce,
      entries: responseEntries,
    };
  });
}

async function recordBatchReceipt(repo, schoolScope, classCode, batchId, body, principal, options = {}) {
  const schoolId = assertScope(schoolScope);
  const code = assertClassCode(classCode);
  const id = assertBatchId(batchId);
  const kind = body?.kind === "technical" || body?.kind === "saved" ? body.kind : "";
  if (!kind) throw batchError(400, "Type d'accusé invalide.", "STUDENT_CARD_BATCH_RECEIPT_INVALID");
  const now = clock(options);
  return withTx(repo, async (tx) => {
    await expireOpenBatches(tx, schoolId, now, principal);
    await assertQrEnabled(tx, schoolId);
    const batch = await loadBatch(tx, schoolId, code, id);
    const items = await loadItems(tx, schoolId, id);
    if (kind === "technical" && !nonceMatches(body?.deliveryNonce, batch.delivery_nonce_hash)) {
      throw batchError(409, "Preuve de possession du lot incomplète.", BATCH_ERROR.PROOF_INVALID);
    }
    if (kind === "saved" && !possessionMatches(items, body?.proofs)) {
      throw batchError(409, "Preuve de possession du lot incomplète.", BATCH_ERROR.PROOF_INVALID);
    }
    const next = nextBatchStatus(batch.status, kind);
    if (isBatchError(next)) throw transitionError(next);
    if (next !== batch.status) {
      const column = kind === "technical" ? "received_at" : "saved_at";
      await tx.query(
        `UPDATE student_card_batches
            SET status = $4, ${column} = $5, updated_at = $5
          WHERE id = $1 AND school_id = $2 AND status = $3`,
        [id, schoolId, batch.status, next, now],
      );
      await audit(tx, schoolId, principal, kind === "technical" ? BATCH_AUDIT.RECEIVED : BATCH_AUDIT.SAVED, id, {
        batchId: id,
        status: next,
        kind,
      });
    }
    const fresh = await loadBatch(tx, schoolId, code, id);
    const freshItems = await loadItems(tx, schoolId, id);
    return publicView(fresh, viewEntries(freshItems, () => false), {
      prepared: freshItems.filter((item) => item.card_status === "issued").length,
      activated: freshItems.filter((item) => item.outcome === "activated").length,
    });
  });
}

async function activateClassCardBatch(repo, schoolScope, classCode, batchId, body, principal, options = {}) {
  const schoolId = assertScope(schoolScope);
  const code = assertClassCode(classCode);
  const id = assertBatchId(batchId);
  const now = clock(options);
  return withTx(repo, async (tx) => {
    await expireOpenBatches(tx, schoolId, now, principal);
    await assertQrEnabled(tx, schoolId);
    const batch = await loadBatch(tx, schoolId, code, id);
    const items = await loadItems(tx, schoolId, id);
    if (!possessionMatches(items, body?.proofs)) {
      throw batchError(409, "Preuve de possession du lot incomplète.", BATCH_ERROR.PROOF_INVALID);
    }
    const next = nextBatchStatus(batch.status, "activate");
    if (isBatchError(next)) throw transitionError(next);
    if (batch.status !== "activated") {
      for (const item of items) {
        const otherActive = await tx.one(
          `SELECT id FROM student_access_cards
            WHERE school_id = $1 AND student_id = $2 AND status = 'active' AND id <> $3
            FOR UPDATE`,
          [schoolId, item.student_id, item.card_id],
        );
        if (otherActive || item.card_status !== "issued") {
          await tx.query(
            `UPDATE student_access_cards
                SET status = 'revoked', revoked_at = $3, revoke_reason = 'batch_superseded_by_active', updated_at = $3
              WHERE id = $1 AND school_id = $2 AND status = 'issued'`,
            [item.card_id, schoolId, now],
          );
          await tx.query(
            `UPDATE student_card_batch_items SET outcome = 'skipped_active', updated_at = $3
              WHERE batch_id = $1 AND card_id = $2`,
            [id, item.card_id, now],
          );
          continue;
        }
        const updated = await tx.query(
          `UPDATE student_access_cards
              SET status = 'active', updated_at = $3
            WHERE id = $1 AND school_id = $2 AND student_id = $4 AND status = 'issued' AND token_hash = $5
            RETURNING id`,
          [item.card_id, schoolId, now, item.student_id, item.token_hash],
        );
        if (!updated.rowCount) {
          throw new Error("Activation interrompue : la carte préparée a changé.");
        }
        await tx.query(
          `UPDATE student_card_batch_items SET outcome = 'activated', updated_at = $3
            WHERE batch_id = $1 AND card_id = $2`,
          [id, item.card_id, now],
        );
      }
      if (options.failBeforeCommit === true) throw new Error("Activation interrompue avant validation.");
      await tx.query(
        `UPDATE student_card_batches
            SET status = 'activated', activated_at = $3, updated_at = $3
          WHERE id = $1 AND school_id = $2 AND status = 'saved'`,
        [id, schoolId, now],
      );
      await audit(tx, schoolId, principal, BATCH_AUDIT.ACTIVATED, id, {
        batchId: id,
        status: "activated",
        cards: items.map((item) => ({ cardId: item.card_id, studentId: item.student_id })),
      });
    }
    const fresh = await loadBatch(tx, schoolId, code, id);
    const freshItems = await loadItems(tx, schoolId, id);
    return publicView(fresh, viewEntries(freshItems, (item) => item.card_status === "active" && item.outcome === "activated"), {
      activated: freshItems.filter((item) => item.outcome === "activated").length,
      skippedActive: freshItems.filter((item) => item.outcome === "skipped_active").length,
    });
  });
}

async function abortClassCardBatch(repo, schoolScope, classCode, batchId, principal, options = {}) {
  const schoolId = assertScope(schoolScope);
  const code = assertClassCode(classCode);
  const id = assertBatchId(batchId);
  const now = clock(options);
  return withTx(repo, async (tx) => {
    await expireOpenBatches(tx, schoolId, now, principal);
    const batch = await loadBatch(tx, schoolId, code, id);
    const next = nextBatchStatus(batch.status, "abort");
    if (isBatchError(next)) throw transitionError(next);
    if (batch.status !== "aborted") {
      await voidIssuedCards(tx, schoolId, id, now, "batch_delivery_aborted");
      await tx.query(
        `UPDATE student_card_batches
            SET status = 'aborted', aborted_at = $3, updated_at = $3
          WHERE id = $1 AND school_id = $2 AND status = $4`,
        [id, schoolId, now, batch.status],
      );
      await audit(tx, schoolId, principal, BATCH_AUDIT.ABORTED, id, { batchId: id, status: "aborted" });
    }
    const fresh = await loadBatch(tx, schoolId, code, id);
    const items = await loadItems(tx, schoolId, id);
    return publicView(fresh, viewEntries(items, () => false), {
      voided: items.filter((item) => item.outcome === "voided").length,
    });
  });
}

async function readClassCardBatch(repo, schoolScope, classCode, batchId, principal = null, options = {}) {
  const schoolId = assertScope(schoolScope);
  const code = assertClassCode(classCode);
  const id = assertBatchId(batchId);
  const now = clock(options);
  return withTx(repo, async (tx) => {
    await expireOpenBatches(tx, schoolId, now, principal);
    const batch = await loadBatch(tx, schoolId, code, id);
    const items = await loadItems(tx, schoolId, id);
    return publicView(batch, viewEntries(items, (item) => item.card_status === "active"), {
      issued: items.filter((item) => item.card_status === "issued").length,
      active: items.filter((item) => item.card_status === "active").length,
      revoked: items.filter((item) => item.card_status === "revoked").length,
    });
  });
}

module.exports = {
  BATCH_PREPARE_TTL_MS,
  BATCH_ERROR,
  BATCH_AUDIT,
  nextBatchStatus,
  prepareClassCardBatch,
  recordBatchReceipt,
  activateClassCardBatch,
  abortClassCardBatch,
  readClassCardBatch,
};
