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
    corrected_from_version: row.corrected_from_version == null ? null : Number(row.corrected_from_version),
    correction_reason: row.correction_reason || null,
    revoke_reason: row.revoke_reason || null,
    actor_id: row.actor_id || null,
    command_id: row.command_id || null,
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

function mapHistory(row) {
  const rec = mapRecord(row);
  if (!rec) return null;
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
    published_at: payload.published_at || row.published_at || null,
    engine_id: payload.engine_id || row.engine_id || null,
    provenance: payload.provenance || null,
    corrected_from_version: rec.corrected_from_version,
    correction_reason: rec.correction_reason,
    revoke_reason: rec.revoke_reason,
    actor_id: rec.actor_id,
  });
}

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
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

  async function insertPublication({ record, supersedeReportCardId, command }) {
    try {
      return await withTx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))", [
          record.school_id,
          record.report_card_id,
        ]);
        if (record.corrected_from_version != null) {
          const source = await queryOne(
            client,
            `SELECT verification_status FROM report_card_published_snapshots
             WHERE school_id = $1 AND report_card_id = $2 AND published_snapshot_version = $3`,
            [record.school_id, record.report_card_id, record.corrected_from_version]
          );
          if (!source) throw coded("PUBLICATION_NOT_FOUND");
          if (source.verification_status === VERIFICATION_STATES[2]) throw coded("INVALID_TRANSITION");
          if (source.verification_status !== VERIFICATION_STATES[0]) throw coded("CONCURRENCY_CONFLICT");
        }
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
             signing_key_id, engine_id, corrected_from_version, correction_reason,
             actor_id, command_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
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
            record.corrected_from_version == null ? null : record.corrected_from_version,
            record.correction_reason || null,
            record.actor_id || null,
            record.command_id || null,
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
        if (command && command.command_id) {
          await client.query(
            `INSERT INTO report_card_correction_commands (
               school_id, report_card_id, command_id, reason, source_version, result_version, public_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (school_id, report_card_id, command_id) DO NOTHING`,
            [
              command.school_id,
              command.report_card_id,
              command.command_id,
              command.reason,
              command.source_version,
              command.result_version || record.published_snapshot_version,
              command.public_id || record.public_id,
            ]
          );
        }
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

  async function listCurrent(schoolId) {
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT school_id, report_card_id, public_id, published_snapshot_version, verification_status
         FROM report_card_published_snapshots
         WHERE school_id = $1 AND verification_status = $2
         ORDER BY report_card_id ASC, published_snapshot_version DESC`,
        [schoolId, VERIFICATION_STATES[0]]
      );
      return result.rows;
    });
  }

  async function listHistory(schoolId, reportCardId) {
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT *
         FROM report_card_published_snapshots
         WHERE school_id = $1 AND report_card_id = $2
         ORDER BY published_snapshot_version ASC`,
        [schoolId, reportCardId]
      );
      return result.rows.map(mapHistory);
    });
  }

  async function revoke({ schoolId, reportCardId, version, reason, actorId }) {
    return withTx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))", [
        schoolId,
        reportCardId,
      ]);
      const current = await queryOne(
        client,
        `SELECT * FROM report_card_published_snapshots
         WHERE school_id = $1 AND report_card_id = $2 AND published_snapshot_version = $3`,
        [schoolId, reportCardId, version]
      );
      if (!current) throw coded("PUBLICATION_NOT_FOUND");
      if (current.verification_status === VERIFICATION_STATES[2]) {
        return mapRecord(current);
      }
      if (current.verification_status !== VERIFICATION_STATES[0]) {
        throw coded("CONCURRENCY_CONFLICT");
      }
      const updated = await queryOne(
        client,
        `UPDATE report_card_published_snapshots
         SET verification_status = $1,
             revoke_reason = COALESCE(revoke_reason, $2),
             actor_id = COALESCE(actor_id, $3)
         WHERE school_id = $4
           AND report_card_id = $5
           AND published_snapshot_version = $6
           AND verification_status = $7
         RETURNING *`,
        [
          VERIFICATION_STATES[2],
          reason || null,
          actorId || null,
          schoolId,
          reportCardId,
          version,
          VERIFICATION_STATES[0],
        ]
      );
      if (!updated) throw coded("CONCURRENCY_CONFLICT");
      return mapRecord(updated);
    });
  }

  async function findByCommand(schoolId, reportCardId, commandId) {
    return withClient(async (client) =>
      mapRecord(
        await queryOne(
          client,
          `SELECT *
           FROM report_card_published_snapshots
           WHERE school_id = $1 AND report_card_id = $2 AND command_id = $3
           ORDER BY published_snapshot_version DESC
           LIMIT 1`,
          [schoolId, reportCardId, commandId]
        )
      )
    );
  }

  async function findCommand(schoolId, reportCardId, commandId) {
    return withClient(async (client) => {
      const row = await queryOne(
        client,
        `SELECT school_id, report_card_id, command_id, reason, source_version, result_version, public_id
         FROM report_card_correction_commands
         WHERE school_id = $1 AND report_card_id = $2 AND command_id = $3`,
        [schoolId, reportCardId, commandId]
      );
      if (!row) return null;
      return {
        school_id: row.school_id,
        report_card_id: row.report_card_id,
        command_id: row.command_id,
        reason: row.reason,
        source_version: Number(row.source_version),
        result_version: Number(row.result_version),
        public_id: row.public_id,
      };
    });
  }

  async function saveCommand(row) {
    return withClient(async (client) => {
      try {
        const inserted = await queryOne(
          client,
          `INSERT INTO report_card_correction_commands (
             school_id, report_card_id, command_id, reason, source_version, result_version, public_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (school_id, report_card_id, command_id) DO NOTHING
           RETURNING school_id, report_card_id, command_id, reason, source_version, result_version, public_id`,
          [
            row.school_id,
            row.report_card_id,
            row.command_id,
            row.reason,
            row.source_version,
            row.result_version,
            row.public_id,
          ]
        );
        if (inserted) {
          return {
            school_id: inserted.school_id,
            report_card_id: inserted.report_card_id,
            command_id: inserted.command_id,
            reason: inserted.reason,
            source_version: Number(inserted.source_version),
            result_version: Number(inserted.result_version),
            public_id: inserted.public_id,
          };
        }
        const existing = await findCommand(row.school_id, row.report_card_id, row.command_id);
        if (!existing) throw new Error("PUBLICATION_NOT_FOUND");
        if (existing.reason !== row.reason || Number(existing.source_version) !== Number(row.source_version)) {
          throw new IdempotencyConflict();
        }
        return existing;
      } catch (err) {
        if (isUniqueViolation(err)) {
          const existing = await findCommand(row.school_id, row.report_card_id, row.command_id);
          if (existing && existing.reason === row.reason && Number(existing.source_version) === Number(row.source_version)) {
            return existing;
          }
          throw new IdempotencyConflict();
        }
        throw err;
      }
    });
  }

  return {
    find,
    findByPublicId,
    insertPublication,
    listOutbox,
    listCurrent,
    listHistory,
    revoke,
    findCommand,
    findByCommand,
    saveCommand,
  };
}

module.exports = { createReportCardPublicationPgStore };
