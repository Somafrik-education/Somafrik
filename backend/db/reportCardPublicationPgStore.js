"use strict";

const { PUBLISH, VERIFICATION_STATES } = require("../contracts/reportCard/contract");
const { deepFreeze, payloadFromCanonicalBytes } = require("../contracts/reportCard/snapshot");
const { IdempotencyConflict } = require("../contracts/reportCard/publishJournal");

function mapRecord(row) {
  if (!row) return null;
  const canonical_bytes = Buffer.isBuffer(row.canonical_bytes)
    ? row.canonical_bytes
    : Buffer.from(row.canonical_bytes);
  return Object.freeze({
    report_card_id: row.report_card_id,
    published_snapshot_version: Number(row.published_snapshot_version),
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
    sealed: Object.freeze({
      payload: deepFreeze(payloadFromCanonicalBytes(canonical_bytes)),
      canonical_bytes,
      snapshot_sha256: row.snapshot_sha256,
      snapshot_signature: row.snapshot_signature,
      signing_key_id: row.signing_key_id,
      frozen: true,
    }),
  });
}

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

function createReportCardPublicationPgStore(db) {
  async function withClient(fn) {
    if (typeof db.connect === "function") {
      const client = await db.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }
    return fn(db);
  }

  async function withTx(fn) {
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    });
  }

  async function queryOne(client, sql, params) {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  }

  async function find(schoolId, reportCardId, version) {
    return withClient(async (client) =>
      mapRecord(
        await queryOne(
          client,
          `SELECT * FROM report_card_published_snapshots
           WHERE school_id = $1 AND report_card_id = $2 AND published_snapshot_version = $3`,
          [schoolId, reportCardId, version]
        )
      )
    );
  }

  async function findByPublicId(publicId) {
    return withClient(async (client) =>
      mapRecord(
        await queryOne(client, `SELECT * FROM report_card_published_snapshots WHERE public_id = $1`, [publicId])
      )
    );
  }

  async function insertPublication({ record, supersedeReportCardId }) {
    try {
      return await withTx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))", [
          record.school_id,
          record.report_card_id,
        ]);
        if (supersedeReportCardId) {
          await client.query(
            `UPDATE report_card_published_snapshots
             SET verification_status = $1
             WHERE school_id = $2
               AND report_card_id = $3
               AND published_snapshot_version IS DISTINCT FROM $4
               AND verification_status = $5`,
            [
              VERIFICATION_STATES[1],
              record.school_id,
              supersedeReportCardId,
              record.published_snapshot_version,
              VERIFICATION_STATES[0],
            ]
          );
        }
        const inserted = await queryOne(
          client,
          `INSERT INTO report_card_published_snapshots (
             school_id, report_card_id, published_snapshot_version, published_at,
             status, verification_status, public_id, token_hash, token_ciphertext,
             wrapping_key_id, canonical_bytes, snapshot_sha256, snapshot_signature,
             signing_key_id, engine_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
           )
           ON CONFLICT (school_id, report_card_id, published_snapshot_version) DO NOTHING
           RETURNING *`,
          [
            record.school_id,
            record.report_card_id,
            record.published_snapshot_version,
            record.sealed.payload.published_at,
            record.status,
            record.verification_status,
            record.public_id,
            record.token_hash,
            record.token_ciphertext,
            record.wrapping_key_id,
            record.sealed.canonical_bytes,
            record.snapshot_sha256,
            record.snapshot_signature,
            record.signing_key_id,
            record.sealed.payload.engine_id,
          ]
        );
        if (!inserted) {
          const existing = mapRecord(
            await queryOne(
              client,
              `SELECT * FROM report_card_published_snapshots
               WHERE school_id = $1 AND report_card_id = $2 AND published_snapshot_version = $3`,
              [record.school_id, record.report_card_id, record.published_snapshot_version]
            )
          );
          if (!existing) throw new Error("PUBLICATION_NOT_FOUND");
          if (existing.snapshot_sha256 !== record.snapshot_sha256) throw new IdempotencyConflict();
          return existing;
        }
        await client.query(
          `INSERT INTO report_card_publish_outbox (
             school_id, report_card_id, published_snapshot_version, public_id, event
           ) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (school_id, report_card_id, published_snapshot_version) DO NOTHING`,
          [
            record.school_id,
            record.report_card_id,
            record.published_snapshot_version,
            record.public_id,
            PUBLISH.outbox_event,
          ]
        );
        return mapRecord(inserted);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await find(
          record.school_id,
          record.report_card_id,
          record.published_snapshot_version
        );
        if (existing && existing.snapshot_sha256 === record.snapshot_sha256) return existing;
        throw new IdempotencyConflict();
      }
      throw err;
    }
  }

  async function listOutbox(schoolId) {
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT event, school_id, report_card_id, public_id, published_snapshot_version
         FROM report_card_publish_outbox
         WHERE school_id = $1
         ORDER BY created_at ASC`,
        [schoolId]
      );
      return result.rows;
    });
  }

  return { find, findByPublicId, insertPublication, listOutbox };
}

module.exports = { createReportCardPublicationPgStore };
