"use strict";

function iso(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mapArtifact(row) {
  if (!row) return null;
  return {
    artifact_id: row.id,
    request_id: row.request_id,
    school_id: row.school_id,
    version: Number(row.version),
    current: Boolean(row.current),
    status: row.status,
    media_type: row.media_type,
    byte_size: Number(row.byte_size),
    sha256: row.sha256,
    original_filename: row.original_filename || "",
    storage_key: row.storage_key,
    idempotency_key: row.idempotency_key,
    created_by: row.created_by,
    created_at: iso(row.created_at),
  };
}

function createReportCardSourceArtifactPgStore(db) {
  return {
    async save(artifact) {
      await db.query(
        `INSERT INTO report_card_source_artifacts (
           id, school_id, request_id, version, current, status, media_type, byte_size,
           sha256, original_filename, storage_key, idempotency_key, created_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           current = EXCLUDED.current,
           status = EXCLUDED.status`,
        [
          artifact.artifact_id,
          artifact.school_id,
          artifact.request_id,
          artifact.version,
          artifact.current,
          artifact.status,
          artifact.media_type,
          artifact.byte_size,
          artifact.sha256,
          artifact.original_filename,
          artifact.storage_key,
          artifact.idempotency_key,
          artifact.created_by,
          artifact.created_at,
        ]
      );
      return artifact;
    },
    async getById(artifactId) {
      const { rows } = await db.query(`SELECT * FROM report_card_source_artifacts WHERE id = $1`, [artifactId]);
      return mapArtifact(rows[0]);
    },
    async listByRequest(schoolId, requestId) {
      const { rows } = await db.query(
        `SELECT * FROM report_card_source_artifacts
         WHERE school_id = $1 AND request_id = $2
         ORDER BY version ASC`,
        [schoolId, requestId]
      );
      return rows.map(mapArtifact);
    },
    async getByIdempotency(schoolId, requestId, key) {
      const { rows } = await db.query(
        `SELECT * FROM report_card_source_artifacts
         WHERE school_id = $1 AND request_id = $2 AND idempotency_key = $3
         LIMIT 1`,
        [schoolId, requestId, key]
      );
      return mapArtifact(rows[0]);
    },
    async appendAudit(entry) {
      const { rows } = await db.query(
        `INSERT INTO report_card_source_artifact_audit (
           school_id, request_id, artifact_id, artifact_sha256, action, to_state, actor_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          entry.school_id,
          entry.request_id,
          entry.artifact_id || null,
          entry.artifact_sha256 || null,
          entry.action,
          entry.to_state || null,
          entry.actor_id,
          entry.created_at,
        ]
      );
      const row = rows[0];
      return {
        id: Number(row.id),
        school_id: row.school_id,
        request_id: row.request_id,
        artifact_id: row.artifact_id,
        artifact_sha256: row.artifact_sha256,
        action: row.action,
        to_state: row.to_state,
        actor_id: row.actor_id,
        created_at: iso(row.created_at),
      };
    },
    async listAudit(schoolId, requestId) {
      const { rows } = await db.query(
        `SELECT * FROM report_card_source_artifact_audit
         WHERE school_id = $1 AND request_id = $2
         ORDER BY id ASC`,
        [schoolId, requestId]
      );
      return rows.map((row) => ({
        id: Number(row.id),
        school_id: row.school_id,
        request_id: row.request_id,
        artifact_id: row.artifact_id,
        artifact_sha256: row.artifact_sha256,
        action: row.action,
        to_state: row.to_state,
        actor_id: row.actor_id,
        created_at: iso(row.created_at),
      }));
    },
  };
}

module.exports = { createReportCardSourceArtifactPgStore };
