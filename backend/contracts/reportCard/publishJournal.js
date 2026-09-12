"use strict";

const crypto = require("node:crypto");
const { PUBLISH, VERIFICATION_STATES } = require("./contract");
const { sealSnapshot } = require("./snapshot");
const {
  generateToken,
  hashToken,
  constantTimeEqual,
  wrapToken,
  unwrapToken,
  verificationUrl,
} = require("./verificationSecret");

/**
 * Journal in-memory : simule la frontière atomique LOT 4 sans SQL.
 * Unique (report_card_id, published_snapshot_version).
 */
class PublishJournal {
  constructor({ wrapping, signingKey }) {
    this.wrapping = wrapping;
    this.signingKey = signingKey;
    this.records = new Map();
    this.outbox = [];
  }

  _key(reportCardId, version) {
    return `${reportCardId}::${version}`;
  }

  publish(payload) {
    const key = this._key(payload.report_card_id, payload.published_snapshot_version);
    const existing = this.records.get(key);
    if (existing) return existing;

    const token = generateToken();
    const publicId = crypto.randomUUID();
    const wrapped = wrapToken(token, this.wrapping);
    const sealed = sealSnapshot(payload, this.signingKey);
    const record = Object.freeze({
      report_card_id: payload.report_card_id,
      published_snapshot_version: payload.published_snapshot_version,
      school_id: payload.school_id,
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
    });
    this.records.set(key, record);
    this.outbox.push(
      Object.freeze({
        event: PUBLISH.outbox_event,
        report_card_id: payload.report_card_id,
        public_id: publicId,
        published_snapshot_version: payload.published_snapshot_version,
      })
    );
    return record;
  }

  reprintUrl(reportCardId, version) {
    const record = this.records.get(this._key(reportCardId, version));
    if (!record) throw new Error("unknown published version");
    const token = unwrapToken(record.token_ciphertext, this.wrapping);
    return verificationUrl(record.public_id, token);
  }

  persistWithoutSecrets() {
    const dump = [];
    for (const rec of this.records.values()) {
      dump.push({
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
        verification_status: rec.verification_status,
        status: rec.status,
      });
    }
    return dump;
  }

  static restore(dump, { wrapping, signingKey }) {
    const journal = new PublishJournal({ wrapping, signingKey });
    for (const row of dump) {
      const key = journal._key(row.report_card_id, row.published_snapshot_version);
      journal.records.set(
        key,
        Object.freeze({
          ...row,
          sealed: Object.freeze({ payload: row.sealed_payload, frozen: true }),
        })
      );
    }
    return journal;
  }

  lookupPublic(publicId, token, { expectedSchoolId } = {}) {
    for (const rec of this.records.values()) {
      if (rec.public_id !== publicId) continue;
      if (expectedSchoolId && rec.school_id !== expectedSchoolId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      if (!constantTimeEqual(rec.token_hash, hashToken(token))) {
        return { ok: false, reason: "not_found" };
      }
      return { ok: true, record: rec };
    }
    return { ok: false, reason: "not_found" };
  }
}

function pdfRendersFromPersisted(journal, reportCardId, version) {
  if (PUBLISH.pdf_mints_token) {
    throw new Error("contract forbids PDF minting tokens");
  }
  return journal.reprintUrl(reportCardId, version);
}

module.exports = {
  PublishJournal,
  pdfRendersFromPersisted,
};
