"use strict";

const { ReportCardSourceArtifactError } = require("../lib/reportCard/reportCardSourceArtifact");

function iso(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function emptyToNull(value) {
  if (value == null || value === "") return null;
  return value;
}

function intOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function mapMapping(row) {
  if (!row) return null;
  return {
    school_id: row.school_id,
    request_id: row.request_id,
    artifact_id: row.artifact_id,
    artifact_version: intOrNull(row.artifact_version),
    artifact_sha256: row.artifact_sha256,
    valid: Boolean(row.valid),
    profile_id: row.profile_id || null,
    profile_version: intOrNull(row.profile_version),
    profile_spec_sha256: row.profile_spec_sha256 || null,
    schema_id: row.schema_id || null,
    schema_version: intOrNull(row.schema_version),
    schema_spec_sha256: row.schema_spec_sha256 || null,
    template_id: row.template_id || null,
    template_version: intOrNull(row.template_version),
    template_spec_sha256: row.template_spec_sha256 || null,
    updated_at: iso(row.updated_at),
  };
}

function mapAudit(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    school_id: row.school_id,
    request_id: row.request_id,
    artifact_id: row.artifact_id,
    artifact_sha256: row.artifact_sha256,
    artifact_version: intOrNull(row.artifact_version),
    action: row.action,
    to_state: row.to_state,
    actor_id: row.actor_id,
    created_at: iso(row.created_at),
    profile_id: row.profile_id || null,
    profile_version: intOrNull(row.profile_version),
    profile_spec_sha256: row.profile_spec_sha256 || null,
    schema_id: row.schema_id || null,
    schema_version: intOrNull(row.schema_version),
    schema_spec_sha256: row.schema_spec_sha256 || null,
    template_id: row.template_id || null,
    template_version: intOrNull(row.template_version),
    template_spec_sha256: row.template_spec_sha256 || null,
    configuration_audit_id: intOrNull(row.configuration_audit_id),
  };
}

function mapPgError(err) {
  if (err instanceof ReportCardSourceArtifactError) return err;
  if (err && err.code === "23505") {
    const name = String(err.constraint || err.detail || "");
    if (/idempotency/i.test(name)) {
      return new ReportCardSourceArtifactError("IDEMPOTENCY_CONFLICT");
    }
    return new ReportCardSourceArtifactError("CONCURRENCY_CONFLICT");
  }
  return err;
}

function connectFn(db) {
  if (db && typeof db.connect === "function") return () => db.connect();
  if (db && db.pool && typeof db.pool.connect === "function") return () => db.pool.connect();
  return null;
}

function createReportCardSourceArtifactPgStore(db) {
  async function withClient(fn) {
    const connect = connectFn(db);
    if (connect) {
      const client = await connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }
    return fn(db);
  }

  function bind(client) {
    return {
      async lockRequest(schoolId, requestId) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))", [
          String(schoolId),
          String(requestId),
        ]);
        const locked = await client.query(
          `SELECT id, status FROM report_card_configuration_requests
           WHERE id = $1 AND school_id = $2
           FOR UPDATE`,
          [requestId, schoolId]
        );
        if (!locked.rowCount) {
          throw new ReportCardSourceArtifactError("REQUEST_NOT_FOUND");
        }
        await client.query(
          `SELECT id FROM report_card_source_artifacts
           WHERE school_id = $1 AND request_id = $2
           FOR UPDATE`,
          [schoolId, requestId]
        );
        await client.query(
          `SELECT request_id FROM report_card_source_artifact_mapping
           WHERE school_id = $1 AND request_id = $2
           FOR UPDATE`,
          [schoolId, requestId]
        );
        return { status: locked.rows[0].status };
      },
      async getMapping(schoolId, requestId) {
        const { rows } = await client.query(
          `SELECT * FROM report_card_source_artifact_mapping
           WHERE school_id = $1 AND request_id = $2`,
          [schoolId, requestId]
        );
        return mapMapping(rows[0]);
      },
      async saveMapping(row) {
        const { rows } = await client.query(
          `INSERT INTO report_card_source_artifact_mapping (
             school_id, request_id, artifact_id, artifact_version, artifact_sha256, valid,
             profile_id, profile_version, profile_spec_sha256,
             schema_id, schema_version, schema_spec_sha256,
             template_id, template_version, template_spec_sha256, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (school_id, request_id) DO UPDATE SET
             artifact_id = EXCLUDED.artifact_id,
             artifact_version = EXCLUDED.artifact_version,
             artifact_sha256 = EXCLUDED.artifact_sha256,
             valid = EXCLUDED.valid,
             profile_id = EXCLUDED.profile_id,
             profile_version = EXCLUDED.profile_version,
             profile_spec_sha256 = EXCLUDED.profile_spec_sha256,
             schema_id = EXCLUDED.schema_id,
             schema_version = EXCLUDED.schema_version,
             schema_spec_sha256 = EXCLUDED.schema_spec_sha256,
             template_id = EXCLUDED.template_id,
             template_version = EXCLUDED.template_version,
             template_spec_sha256 = EXCLUDED.template_spec_sha256,
             updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [
            row.school_id,
            row.request_id,
            row.artifact_id,
            row.artifact_version,
            row.artifact_sha256,
            row.valid !== false,
            emptyToNull(row.profile_id),
            intOrNull(row.profile_version),
            emptyToNull(row.profile_spec_sha256),
            emptyToNull(row.schema_id),
            intOrNull(row.schema_version),
            emptyToNull(row.schema_spec_sha256),
            emptyToNull(row.template_id),
            intOrNull(row.template_version),
            emptyToNull(row.template_spec_sha256),
            row.updated_at || new Date().toISOString(),
          ]
        );
        return mapMapping(rows[0]);
      },
      async invalidateMapping(schoolId, requestId) {
        const { rows } = await client.query(
          `UPDATE report_card_source_artifact_mapping
           SET valid = FALSE, updated_at = NOW()
           WHERE school_id = $1 AND request_id = $2 AND valid = TRUE
           RETURNING *`,
          [schoolId, requestId]
        );
        return mapMapping(rows[0]);
      },
      async save(artifact) {
        await client.query(
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
        const { rows } = await client.query(`SELECT * FROM report_card_source_artifacts WHERE id = $1`, [
          artifactId,
        ]);
        return mapArtifact(rows[0]);
      },
      async listByRequest(schoolId, requestId) {
        const { rows } = await client.query(
          `SELECT * FROM report_card_source_artifacts
           WHERE school_id = $1 AND request_id = $2
           ORDER BY version ASC`,
          [schoolId, requestId]
        );
        return rows.map(mapArtifact);
      },
      async getByIdempotency(schoolId, requestId, key) {
        const { rows } = await client.query(
          `SELECT * FROM report_card_source_artifacts
           WHERE school_id = $1 AND request_id = $2 AND idempotency_key = $3
           LIMIT 1`,
          [schoolId, requestId, key]
        );
        return mapArtifact(rows[0]);
      },
      async appendAudit(entry) {
        const { rows } = await client.query(
          `INSERT INTO report_card_source_artifact_audit (
             school_id, request_id, artifact_id, artifact_sha256, artifact_version,
             action, to_state, actor_id, created_at,
             profile_id, profile_version, profile_spec_sha256,
             schema_id, schema_version, schema_spec_sha256,
             template_id, template_version, template_spec_sha256,
             configuration_audit_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           RETURNING *`,
          [
            entry.school_id,
            entry.request_id,
            emptyToNull(entry.artifact_id),
            emptyToNull(entry.artifact_sha256),
            intOrNull(entry.artifact_version),
            entry.action,
            emptyToNull(entry.to_state),
            entry.actor_id,
            entry.created_at,
            emptyToNull(entry.profile_id),
            intOrNull(entry.profile_version),
            emptyToNull(entry.profile_spec_sha256),
            emptyToNull(entry.schema_id),
            intOrNull(entry.schema_version),
            emptyToNull(entry.schema_spec_sha256),
            emptyToNull(entry.template_id),
            intOrNull(entry.template_version),
            emptyToNull(entry.template_spec_sha256),
            intOrNull(entry.configuration_audit_id),
          ]
        );
        return mapAudit(rows[0]);
      },
      async listAudit(schoolId, requestId) {
        const { rows } = await client.query(
          `SELECT * FROM report_card_source_artifact_audit
           WHERE school_id = $1 AND request_id = $2
           ORDER BY id ASC`,
          [schoolId, requestId]
        );
        return rows.map(mapAudit);
      },
    };
  }

  async function withTx(fn) {
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(bind(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw mapPgError(err);
      }
    });
  }

  async function withSessionLock(schoolId, requestId, fn) {
    return withClient(async (client) => {
      await client.query("SELECT pg_advisory_lock(hashtext($1::text), hashtext($2::text))", [
        String(schoolId),
        String(requestId),
      ]);
      try {
        return await fn();
      } finally {
        await client
          .query("SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))", [
            String(schoolId),
            String(requestId),
          ])
          .catch(() => {});
      }
    });
  }

  const root = bind(db);
  return {
    withTx,
    withSessionLock,
    ...root,
  };
}

module.exports = { createReportCardSourceArtifactPgStore };
