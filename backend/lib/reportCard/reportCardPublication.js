"use strict";

/**
 * LOT 4 — snapshot immuable, publication atomique, QR stratégie A.
 * Réutilise LOT 0 : JCS, sealSnapshot, Ed25519, wrapping. Pas de PDF ni d'UI publique.
 */

const crypto = require("node:crypto");
const { ENGINE_ID, PUBLISH, VERIFICATION_STATES } = require("../../contracts/reportCard/contract");
const {
  sealSnapshot,
  deepFreeze,
  payloadForRender,
  signingKeyRing,
  payloadFromCanonicalBytes,
} = require("../../contracts/reportCard/snapshot");
const {
  generateToken,
  hashToken,
  constantTimeEqual,
  wrapToken,
  unwrapToken,
  verificationUrl,
} = require("../../contracts/reportCard/verificationSecret");
const { IdempotencyConflict } = require("../../contracts/reportCard/publishJournal");
const { requireSchoolId, assertSameTenant } = require("./academicRuleProfile");

class ReportCardPublicationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardPublicationError";
    this.code = code;
  }
}

function requireNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function requireLayerRef(ref) {
  return Boolean(
    ref &&
      typeof ref === "object" &&
      !Array.isArray(ref) &&
      requireNonEmptyString(ref.id) &&
      Number.isInteger(ref.version) &&
      ref.version >= 1 &&
      requireNonEmptyString(ref.spec_sha256)
  );
}

function assertPublishablePayload(payload) {
  if (payload.engine_id !== ENGINE_ID) {
    throw new ReportCardPublicationError("INVALID_ENGINE");
  }
  const provenance = payload.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new ReportCardPublicationError("INVALID_PROVENANCE");
  }
  if (!requireLayerRef(provenance.profile) || !requireLayerRef(provenance.schema)) {
    throw new ReportCardPublicationError("INVALID_PROVENANCE");
  }
  const version = payload.published_snapshot_version;
  if (!Number.isInteger(version) || version < 1) {
    throw new ReportCardPublicationError("INVALID_SNAPSHOT");
  }
  if (!Array.isArray(payload.students)) {
    throw new ReportCardPublicationError("INVALID_SNAPSHOT");
  }
  for (const student of payload.students) {
    if (
      !student ||
      typeof student !== "object" ||
      !requireNonEmptyString(student.student_id) ||
      !Array.isArray(student.cells) ||
      !Array.isArray(student.slots) ||
      !Array.isArray(student.presence)
    ) {
      throw new ReportCardPublicationError("INVALID_SNAPSHOT");
    }
  }
}

function rejectBranchKeys(value) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectBranchKeys(item);
    return;
  }
  for (const key of Object.keys(value)) {
    if (/^(country|country_id|countryCode|country_code|iso_code|school|school_name|schoolName)$/i.test(key)) {
      throw new ReportCardPublicationError("COUNTRY_SCHOOL_BRANCH_FORBIDDEN", `forbidden key ${key}`);
    }
    if (key !== "school_id") rejectBranchKeys(value[key]);
  }
}

function assertTenant(tenant, payloadSchoolId) {
  if (!tenant || tenant.schoolId == null || tenant.schoolId === "" || tenant.actorSchoolId == null || tenant.actorSchoolId === "") {
    throw new ReportCardPublicationError("TENANT_REQUIRED");
  }
  try {
    requireSchoolId(tenant.schoolId);
    assertSameTenant(tenant.schoolId, tenant.actorSchoolId);
  } catch (err) {
    throw new ReportCardPublicationError(err.code || "TENANT_MISMATCH");
  }
  if (payloadSchoolId != null && payloadSchoolId !== tenant.schoolId) {
    throw new ReportCardPublicationError("TENANT_MISMATCH");
  }
  return tenant.schoolId;
}

function thenable(value, fn) {
  if (value && typeof value.then === "function") return value.then(fn);
  return fn(value);
}

function tokenBinding(record, publicId) {
  return {
    public_id: publicId,
    report_card_id: record.report_card_id,
    published_snapshot_version: record.published_snapshot_version,
    school_id: record.school_id,
  };
}

function freezeRecord(record) {
  return Object.freeze({
    ...record,
    sealed: record.sealed,
  });
}

function toHistoryRow(rec) {
  const payload = rec.sealed && rec.sealed.payload ? rec.sealed.payload : {};
  return Object.freeze({
    school_id: rec.school_id,
    report_card_id: rec.report_card_id,
    published_snapshot_version: rec.published_snapshot_version,
    verification_status: rec.verification_status,
    public_id: rec.public_id,
    snapshot_sha256: rec.snapshot_sha256,
    snapshot_signature: rec.snapshot_signature,
    signing_key_id: rec.signing_key_id,
    published_at: payload.published_at || rec.published_at || null,
    engine_id: payload.engine_id || rec.engine_id || null,
    provenance: payload.provenance || null,
    corrected_from_version: rec.corrected_from_version == null ? null : rec.corrected_from_version,
    correction_reason: rec.correction_reason || null,
    revoke_reason: rec.revoke_reason || null,
    actor_id: rec.actor_id || null,
  });
}

function createMemoryStore(dump) {
  const records = new Map();
  const outbox = [];
  const commands = new Map();

  function key(schoolId, reportCardId, version) {
    return `${schoolId}\0${reportCardId}\0${version}`;
  }

  function restoreRow(row) {
    const canonical_bytes = Buffer.from(row.canonical_bytes, "base64");
    const sealed = Object.freeze({
      payload: deepFreeze(structuredClone(row.sealed_payload || payloadFromCanonicalBytes(canonical_bytes))),
      canonical_bytes,
      snapshot_sha256: row.snapshot_sha256,
      snapshot_signature: row.snapshot_signature,
      signing_key_id: row.signing_key_id,
      frozen: true,
    });
    records.set(
      key(row.school_id, row.report_card_id, row.published_snapshot_version),
      freezeRecord({
        report_card_id: row.report_card_id,
        published_snapshot_version: row.published_snapshot_version,
        school_id: row.school_id,
        status: row.status,
        verification_status: row.verification_status,
        public_id: row.public_id,
        token_hash: row.token_hash,
        token_ciphertext: row.token_ciphertext,
        wrapping_key_id: row.wrapping_key_id,
        snapshot_sha256: row.snapshot_sha256,
        snapshot_signature: row.snapshot_signature,
        signing_key_id: row.signing_key_id,
        sealed,
        corrected_from_version: row.corrected_from_version,
        correction_reason: row.correction_reason,
        revoke_reason: row.revoke_reason,
        actor_id: row.actor_id,
        command_id: row.command_id,
      })
    );
  }

  if (Array.isArray(dump)) {
    for (const row of dump) restoreRow(row);
  }

  return {
    find(schoolId, reportCardId, version) {
      return records.get(key(schoolId, reportCardId, version)) || null;
    },
    findByPublicId(publicId) {
      for (const rec of records.values()) {
        if (rec.public_id === publicId) return rec;
      }
      return null;
    },
    insertPublication({ record, supersedeReportCardId, command }) {
      if (record.corrected_from_version != null) {
        const source = records.get(key(record.school_id, record.report_card_id, record.corrected_from_version));
        if (!source) {
          throw new ReportCardPublicationError("PUBLICATION_NOT_FOUND");
        }
        if (source.verification_status === VERIFICATION_STATES[2]) {
          throw new ReportCardPublicationError("INVALID_TRANSITION");
        }
        if (source.verification_status !== VERIFICATION_STATES[0]) {
          throw new ReportCardPublicationError("CONCURRENCY_CONFLICT");
        }
      }
      if (supersedeReportCardId) {
        for (const [mapKey, rec] of records) {
          if (
            rec.school_id === record.school_id &&
            rec.report_card_id === supersedeReportCardId &&
            rec.published_snapshot_version !== record.published_snapshot_version &&
            rec.verification_status === VERIFICATION_STATES[0]
          ) {
            records.set(mapKey, freezeRecord({ ...rec, verification_status: VERIFICATION_STATES[1] }));
          }
        }
      }
      const mapKey = key(record.school_id, record.report_card_id, record.published_snapshot_version);
      const existing = records.get(mapKey);
      if (existing) {
        if (existing.snapshot_sha256 !== record.snapshot_sha256) throw new IdempotencyConflict();
        return existing;
      }
      const frozen = freezeRecord(record);
      records.set(mapKey, frozen);
      outbox.push(
        Object.freeze({
          event: PUBLISH.outbox_event,
          school_id: record.school_id,
          report_card_id: record.report_card_id,
          public_id: record.public_id,
          published_snapshot_version: record.published_snapshot_version,
        })
      );
      if (command && command.command_id) {
        this.saveCommand(command);
      }
      return frozen;
    },
    listOutbox(schoolId) {
      return outbox.filter((item) => item.school_id === schoolId);
    },
    listCurrent(schoolId) {
      const out = [];
      for (const rec of records.values()) {
        if (rec.school_id !== schoolId) continue;
        if (rec.verification_status !== VERIFICATION_STATES[0]) continue;
        out.push(
          Object.freeze({
            school_id: rec.school_id,
            report_card_id: rec.report_card_id,
            public_id: rec.public_id,
            published_snapshot_version: rec.published_snapshot_version,
            verification_status: rec.verification_status,
          })
        );
      }
      return out;
    },
    listHistory(schoolId, reportCardId) {
      const out = [];
      for (const rec of records.values()) {
        if (rec.school_id !== schoolId) continue;
        if (reportCardId && rec.report_card_id !== reportCardId) continue;
        out.push(toHistoryRow(rec));
      }
      return out.sort(
        (a, b) =>
          String(a.report_card_id).localeCompare(String(b.report_card_id)) ||
          a.published_snapshot_version - b.published_snapshot_version
      );
    },
    revoke({ schoolId, reportCardId, version, reason, actorId }) {
      const mapKey = key(schoolId, reportCardId, version);
      const rec = records.get(mapKey);
      if (!rec) return null;
      if (rec.verification_status === VERIFICATION_STATES[2]) {
        return freezeRecord({ ...rec, revoke_reason: rec.revoke_reason || reason, actor_id: rec.actor_id || actorId });
      }
      if (rec.verification_status !== VERIFICATION_STATES[0]) {
        throw new ReportCardPublicationError("CONCURRENCY_CONFLICT");
      }
      const next = freezeRecord({
        ...rec,
        verification_status: VERIFICATION_STATES[2],
        revoke_reason: reason,
        actor_id: actorId,
      });
      records.set(mapKey, next);
      return next;
    },
    findCommand(schoolId, reportCardId, commandId) {
      return commands.get(`${schoolId}\0${reportCardId}\0${commandId}`) || null;
    },
    findByCommand(schoolId, reportCardId, commandId) {
      let found = null;
      for (const rec of records.values()) {
        if (
          rec.school_id === schoolId &&
          rec.report_card_id === reportCardId &&
          rec.command_id === commandId
        ) {
          if (!found || rec.published_snapshot_version > found.published_snapshot_version) found = rec;
        }
      }
      return found;
    },
    saveCommand(row) {
      const existing = commands.get(`${row.school_id}\0${row.report_card_id}\0${row.command_id}`);
      if (existing) {
        if (existing.reason !== row.reason || existing.source_version !== row.source_version) {
          throw new IdempotencyConflict();
        }
        return existing;
      }
      const frozen = Object.freeze({ ...row });
      commands.set(`${row.school_id}\0${row.report_card_id}\0${row.command_id}`, frozen);
      return frozen;
    },
    dump() {
      const rows = [];
      for (const rec of records.values()) {
        rows.push({
          report_card_id: rec.report_card_id,
          published_snapshot_version: rec.published_snapshot_version,
          school_id: rec.school_id,
          public_id: rec.public_id,
          token_hash: rec.token_hash,
          token_ciphertext: rec.token_ciphertext,
          wrapping_key_id: rec.wrapping_key_id,
          snapshot_sha256: rec.snapshot_sha256,
          snapshot_signature: rec.snapshot_signature,
          signing_key_id: rec.signing_key_id,
          sealed_payload: rec.sealed.payload,
          canonical_bytes: rec.sealed.canonical_bytes.toString("base64"),
          verification_status: rec.verification_status,
          status: rec.status,
          corrected_from_version: rec.corrected_from_version,
          correction_reason: rec.correction_reason,
          revoke_reason: rec.revoke_reason,
          actor_id: rec.actor_id,
          command_id: rec.command_id,
        });
      }
      return rows;
    },
  };
}

function createReportCardPublication({
  signingKey,
  wrapping,
  wrappingKeys = [],
  signingKeys = [],
  store,
  dump,
} = {}) {
  if (!signingKey || !wrapping) {
    throw new ReportCardPublicationError("KEYS_REQUIRED");
  }
  const wrappingKeyMap = new Map();
  for (const key of wrappingKeys) wrappingKeyMap.set(key.wrapping_key_id, key);
  wrappingKeyMap.set(wrapping.wrapping_key_id, wrapping);
  const ringKeys = [...signingKeys];
  if (signingKey) ringKeys.push(signingKey);
  const keyRing = signingKeyRing(ringKeys);
  const persistence = store || createMemoryStore(dump);
  const cardLocks = new Map();

  function withCardLock(schoolId, reportCardId, fn) {
    const lockKey = `${schoolId}\0${reportCardId}`;
    const previous = cardLocks.get(lockKey);
    if (!previous) {
      try {
        const result = fn();
        if (result && typeof result.then === "function") {
          cardLocks.set(
            lockKey,
            result.then(
              () => undefined,
              () => undefined
            )
          );
        }
        return result;
      } catch (err) {
        throw err;
      }
    }
    const next = previous.then(fn, fn);
    cardLocks.set(
      lockKey,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  function wrappingFor(wrappingKeyId) {
    const key = wrappingKeyMap.get(wrappingKeyId);
    if (!key) {
      const err = new ReportCardPublicationError("WRAPPING_KEY_UNKNOWN");
      throw err;
    }
    return key;
  }

  function requireRecord(record) {
    if (!record) throw new ReportCardPublicationError("PUBLICATION_NOT_FOUND");
    return record;
  }

  function publish({ tenant, payload, lineage, command } = {}) {
    if (!payload || typeof payload !== "object") throw new ReportCardPublicationError("INVALID_PAYLOAD");
    rejectBranchKeys(payload);
    const schoolId = assertTenant(tenant, payload.school_id);
    assertPublishablePayload(payload);
    const sealed = sealSnapshot(payload, signingKey);
    return withCardLock(schoolId, payload.report_card_id, () =>
      thenable(persistence.find(schoolId, payload.report_card_id, payload.published_snapshot_version), (existing) => {
        if (existing) {
          if (existing.snapshot_sha256 !== sealed.snapshot_sha256) throw new IdempotencyConflict();
          return existing;
        }
        const publicId = crypto.randomUUID();
        const token = generateToken();
        const wrapped = wrapToken(token, wrapping, tokenBinding(payload, publicId));
        const commandId = (command && command.commandId) || (lineage && lineage.command_id) || null;
        const commandRow =
          commandId &&
          Object.freeze({
            school_id: schoolId,
            report_card_id: payload.report_card_id,
            command_id: commandId,
            reason: (command && command.reason) || (lineage && lineage.correction_reason) || null,
            source_version:
              (command && command.sourceVersion) || (lineage && lineage.corrected_from_version) || null,
            result_version: payload.published_snapshot_version,
            public_id: publicId,
          });
        const record = {
          report_card_id: payload.report_card_id,
          published_snapshot_version: payload.published_snapshot_version,
          school_id: schoolId,
          status: "PUBLISHED",
          verification_status: VERIFICATION_STATES[0],
          public_id: publicId,
          token_hash: hashToken(token),
          token_ciphertext: wrapped.token_ciphertext,
          wrapping_key_id: wrapped.wrapping_key_id,
          snapshot_sha256: sealed.snapshot_sha256,
          snapshot_signature: sealed.snapshot_signature,
          signing_key_id: sealed.signing_key_id,
          sealed,
          corrected_from_version: lineage && lineage.corrected_from_version,
          correction_reason: lineage && lineage.correction_reason,
          actor_id: lineage && lineage.actor_id,
          command_id: commandId,
        };
        return thenable(
          persistence.insertPublication({
            record,
            supersedeReportCardId: payload.report_card_id,
            command: commandRow,
          }),
          (inserted) => inserted
        );
      })
    );
  }

  function lookup({ tenant, reportCardId, version } = {}) {
    const schoolId = assertTenant(tenant);
    return thenable(persistence.find(schoolId, reportCardId, version), (record) => requireRecord(record));
  }

  function reprintUrl({ tenant, reportCardId, version } = {}) {
    return thenable(lookup({ tenant, reportCardId, version }), (record) => {
      const token = unwrapToken(
        record.token_ciphertext,
        wrappingFor(record.wrapping_key_id),
        tokenBinding(record, record.public_id)
      );
      if (!constantTimeEqual(hashToken(token), record.token_hash)) {
        throw new ReportCardPublicationError("TOKEN_HASH_MISMATCH");
      }
      return verificationUrl(record.public_id, token);
    });
  }

  function payloadForRenderPublished({ tenant, reportCardId, version } = {}) {
    return thenable(lookup({ tenant, reportCardId, version }), (record) =>
      payloadForRender(record.sealed, keyRing)
    );
  }

  function lookupPublic({ publicId, token } = {}) {
    if (!requireNonEmptyString(publicId) || token == null || token === "") {
      return { ok: false, reason: "not_found" };
    }
    return thenable(persistence.findByPublicId(publicId), (record) => {
      if (!record) return { ok: false, reason: "not_found" };
      if (!constantTimeEqual(record.token_hash, hashToken(token))) {
        return { ok: false, reason: "not_found" };
      }
      try {
        return {
          ok: true,
          payload: payloadForRender(record.sealed, keyRing),
          verification_status: record.verification_status,
        };
      } catch (err) {
        return { ok: false, reason: err.code || "SNAPSHOT_SIGNATURE_INVALID" };
      }
    });
  }

  function listOutbox({ tenant } = {}) {
    const schoolId = assertTenant(tenant);
    return persistence.listOutbox(schoolId);
  }

  function listCurrent({ tenant } = {}) {
    const schoolId = assertTenant(tenant);
    if (typeof persistence.listCurrent !== "function") {
      throw new ReportCardPublicationError("PUBLICATION_NOT_FOUND");
    }
    return thenable(persistence.listCurrent(schoolId), (rows) => rows || []);
  }

  function listHistory({ tenant, reportCardId } = {}) {
    const schoolId = assertTenant(tenant);
    if (typeof persistence.listHistory !== "function") {
      throw new ReportCardPublicationError("PUBLICATION_NOT_FOUND");
    }
    return thenable(persistence.listHistory(schoolId, reportCardId), (rows) => rows || []);
  }

  function revoke({ tenant, reportCardId, version, reason, actorId } = {}) {
    const schoolId = assertTenant(tenant);
    if (!requireNonEmptyString(reason) || !String(reason).trim()) {
      throw new ReportCardPublicationError("REASON_REQUIRED");
    }
    if (typeof persistence.revoke !== "function") {
      throw new ReportCardPublicationError("PUBLICATION_NOT_FOUND");
    }
    return withCardLock(schoolId, reportCardId, () =>
      thenable(lookup({ tenant, reportCardId, version }), (record) =>
        thenable(
          persistence.revoke({
            schoolId,
            reportCardId,
            version: record.published_snapshot_version,
            reason: String(reason).trim(),
            actorId,
          }),
          (updated) => requireRecord(updated)
        )
      )
    );
  }

  function findCommand({ tenant, reportCardId, commandId } = {}) {
    const schoolId = assertTenant(tenant);
    if (typeof persistence.findCommand !== "function" || !commandId) return null;
    return persistence.findCommand(schoolId, reportCardId, commandId);
  }

  function findByCommand({ tenant, reportCardId, commandId } = {}) {
    const schoolId = assertTenant(tenant);
    if (!commandId) return null;
    if (typeof persistence.findByCommand === "function") {
      return persistence.findByCommand(schoolId, reportCardId, commandId);
    }
    return null;
  }

  function saveCommand({ tenant, reportCardId, commandId, reason, sourceVersion, resultVersion, publicId } = {}) {
    const schoolId = assertTenant(tenant);
    if (typeof persistence.saveCommand !== "function") {
      throw new ReportCardPublicationError("PUBLICATION_NOT_FOUND");
    }
    return persistence.saveCommand({
      school_id: schoolId,
      report_card_id: reportCardId,
      command_id: commandId,
      reason,
      source_version: sourceVersion,
      result_version: resultVersion,
      public_id: publicId,
    });
  }

  function persistWithoutSecrets() {
    if (typeof persistence.dump !== "function") {
      throw new ReportCardPublicationError("DUMP_UNSUPPORTED");
    }
    return persistence.dump();
  }

  return {
    publish,
    lookup,
    reprintUrl,
    payloadForRender: payloadForRenderPublished,
    lookupPublic,
    listOutbox,
    listCurrent,
    listHistory,
    revoke,
    findCommand,
    findByCommand,
    saveCommand,
    persistWithoutSecrets,
  };
}

module.exports = {
  createReportCardPublication,
  createMemoryStore,
  ReportCardPublicationError,
  IdempotencyConflict,
};
