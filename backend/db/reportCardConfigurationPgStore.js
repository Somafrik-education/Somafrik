"use strict";

const { ReportCardConfigurationError } = require("../lib/reportCard/reportCardConfiguration");

function iso(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mapRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    school_id: row.school_id,
    model_key: row.model_key,
    status: row.status,
    concurrency_version: Number(row.concurrency_version),
    description: row.description,
    profile_id: row.profile_id,
    profile_version: row.profile_version == null ? null : Number(row.profile_version),
    profile_spec_sha256: row.profile_spec_sha256,
    schema_id: row.schema_id,
    schema_version: row.schema_version == null ? null : Number(row.schema_version),
    schema_spec_sha256: row.schema_spec_sha256,
    rendering_template_id: row.rendering_template_id,
    rendering_template_version:
      row.rendering_template_version == null ? null : Number(row.rendering_template_version),
    rendering_template_spec_sha256: row.rendering_template_spec_sha256,
    engine_id: row.engine_id,
    last_actor_id: row.last_actor_id,
    last_permission: row.last_permission,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function mapTemplateVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    school_id: row.school_id,
    template_id: row.template_id,
    version: Number(row.version),
    status: row.status,
    spec: row.spec,
    spec_sha256: row.spec_sha256,
    created_at: iso(row.created_at),
  };
}

function mapAudit(row) {
  return {
    id: Number(row.id),
    request_id: row.request_id,
    school_id: row.school_id,
    from_state: row.from_state,
    to_state: row.to_state,
    actor_id: row.actor_id,
    permission: row.permission,
    reason: row.reason,
    command_id: row.command_id,
    created_at: iso(row.created_at),
  };
}

function mapBinding(row) {
  if (!row) return null;
  return {
    school_id: row.school_id,
    model_key: row.model_key,
    request_id: row.request_id,
    engine_id: row.engine_id,
    profile_id: row.profile_id,
    profile_version: Number(row.profile_version),
    profile_spec_sha256: row.profile_spec_sha256,
    schema_id: row.schema_id,
    schema_version: Number(row.schema_version),
    schema_spec_sha256: row.schema_spec_sha256,
    rendering_template_id: row.rendering_template_id,
    rendering_template_version: Number(row.rendering_template_version),
    rendering_template_spec_sha256: row.rendering_template_spec_sha256,
    activated_at: iso(row.activated_at),
  };
}

function mapImmutable(err) {
  const message = String(err && err.message);
  if (/AUDIT_IMMUTABLE/i.test(message)) {
    return new ReportCardConfigurationError("AUDIT_IMMUTABLE");
  }
  if (/RENDERING_TEMPLATE_VERSION_IMMUTABLE/i.test(message)) {
    return new ReportCardConfigurationError("VERSION_IMMUTABLE");
  }
  if (err && err.code === "23505") {
    return new ReportCardConfigurationError("IDEMPOTENCY_CONFLICT");
  }
  return err;
}

function createReportCardConfigurationPgStore(db) {
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

  function bind(client) {
    async function queryOne(sql, params) {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    }

    return {
      async lockPair(schoolId, modelKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))", [
          String(schoolId),
          String(modelKey),
        ]);
      },
      async insertRequest(row) {
        const inserted = await queryOne(
          `INSERT INTO report_card_configuration_requests (
             id, school_id, model_key, status, concurrency_version, description,
             profile_id, profile_version, profile_spec_sha256,
             schema_id, schema_version, schema_spec_sha256,
             rendering_template_id, rendering_template_version, rendering_template_spec_sha256,
             engine_id, last_actor_id, last_permission, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
           ) RETURNING *`,
          [
            row.id,
            row.school_id,
            row.model_key,
            row.status,
            row.concurrency_version,
            row.description,
            row.profile_id,
            row.profile_version,
            row.profile_spec_sha256,
            row.schema_id,
            row.schema_version,
            row.schema_spec_sha256,
            row.rendering_template_id,
            row.rendering_template_version,
            row.rendering_template_spec_sha256,
            row.engine_id,
            row.last_actor_id,
            row.last_permission,
            row.created_at,
            row.updated_at,
          ]
        );
        return mapRequest(inserted);
      },
      async getRequest(schoolId, requestId) {
        return mapRequest(
          await queryOne(
            `SELECT * FROM report_card_configuration_requests
             WHERE id = $1 AND school_id = $2
             FOR UPDATE`,
            [requestId, schoolId]
          )
        );
      },
      async listRequests(schoolId) {
        const result = await client.query(
          `SELECT * FROM report_card_configuration_requests WHERE school_id = $1 ORDER BY created_at`,
          [schoolId]
        );
        return result.rows.map(mapRequest);
      },
      async saveRequest(row) {
        const updated = await queryOne(
          `UPDATE report_card_configuration_requests SET
             status = $3,
             concurrency_version = $4,
             description = $5,
             profile_id = $6,
             profile_version = $7,
             profile_spec_sha256 = $8,
             schema_id = $9,
             schema_version = $10,
             schema_spec_sha256 = $11,
             rendering_template_id = $12,
             rendering_template_version = $13,
             rendering_template_spec_sha256 = $14,
             engine_id = $15,
             last_actor_id = $16,
             last_permission = $17,
             updated_at = $18
           WHERE id = $1 AND school_id = $2
           RETURNING *`,
          [
            row.id,
            row.school_id,
            row.status,
            row.concurrency_version,
            row.description,
            row.profile_id,
            row.profile_version,
            row.profile_spec_sha256,
            row.schema_id,
            row.schema_version,
            row.schema_spec_sha256,
            row.rendering_template_id,
            row.rendering_template_version,
            row.rendering_template_spec_sha256,
            row.engine_id,
            row.last_actor_id,
            row.last_permission,
            row.updated_at,
          ]
        );
        if (!updated) throw new ReportCardConfigurationError("REQUEST_NOT_FOUND");
        return mapRequest(updated);
      },
      async getActiveByPair(schoolId, modelKey) {
        return mapRequest(
          await queryOne(
            `SELECT * FROM report_card_configuration_requests
             WHERE school_id = $1 AND model_key = $2 AND status = 'ACTIVE'
             FOR UPDATE`,
            [schoolId, modelKey]
          )
        );
      },
      async upsertBinding(row) {
        const saved = await queryOne(
          `INSERT INTO report_card_active_bindings (
             school_id, model_key, request_id, engine_id,
             profile_id, profile_version, profile_spec_sha256,
             schema_id, schema_version, schema_spec_sha256,
             rendering_template_id, rendering_template_version, rendering_template_spec_sha256,
             activated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (school_id, model_key) DO UPDATE SET
             request_id = EXCLUDED.request_id,
             engine_id = EXCLUDED.engine_id,
             profile_id = EXCLUDED.profile_id,
             profile_version = EXCLUDED.profile_version,
             profile_spec_sha256 = EXCLUDED.profile_spec_sha256,
             schema_id = EXCLUDED.schema_id,
             schema_version = EXCLUDED.schema_version,
             schema_spec_sha256 = EXCLUDED.schema_spec_sha256,
             rendering_template_id = EXCLUDED.rendering_template_id,
             rendering_template_version = EXCLUDED.rendering_template_version,
             rendering_template_spec_sha256 = EXCLUDED.rendering_template_spec_sha256,
             activated_at = EXCLUDED.activated_at
           RETURNING *`,
          [
            row.school_id,
            row.model_key,
            row.request_id,
            row.engine_id,
            row.profile_id,
            row.profile_version,
            row.profile_spec_sha256,
            row.schema_id,
            row.schema_version,
            row.schema_spec_sha256,
            row.rendering_template_id,
            row.rendering_template_version,
            row.rendering_template_spec_sha256,
            row.activated_at,
          ]
        );
        return mapBinding(saved);
      },
      async getBinding(schoolId, modelKey) {
        return mapBinding(
          await queryOne(
            `SELECT * FROM report_card_active_bindings WHERE school_id = $1 AND model_key = $2`,
            [schoolId, modelKey]
          )
        );
      },
      async insertAudit(entry) {
        const row = await queryOne(
          `INSERT INTO report_card_configuration_audit (
             request_id, school_id, from_state, to_state, actor_id, permission, reason, command_id, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            entry.request_id,
            entry.school_id,
            entry.from_state,
            entry.to_state,
            entry.actor_id,
            entry.permission,
            entry.reason,
            entry.command_id,
            entry.created_at,
          ]
        );
        return mapAudit(row);
      },
      async listAudit(schoolId, requestId) {
        const result = await client.query(
          `SELECT * FROM report_card_configuration_audit
           WHERE school_id = $1 AND request_id = $2
           ORDER BY id`,
          [schoolId, requestId]
        );
        return result.rows.map(mapAudit);
      },
      async getCommand(commandId) {
        const row = await queryOne(
          `SELECT command_id, school_id, request_id, action FROM report_card_configuration_commands
           WHERE command_id = $1`,
          [commandId]
        );
        return row || null;
      },
      async insertCommand(row) {
        try {
          const saved = await queryOne(
            `INSERT INTO report_card_configuration_commands (command_id, school_id, request_id, action)
             VALUES ($1,$2,$3,$4)
             RETURNING *`,
            [row.command_id, row.school_id, row.request_id, row.action]
          );
          return saved;
        } catch (err) {
          throw mapImmutable(err);
        }
      },
      async createTemplate({ schoolId, templateKey, spec, sha, now }) {
        const template = await queryOne(
          `INSERT INTO report_card_rendering_templates (school_id, template_key, created_at)
           VALUES ($1,$2,$3)
           RETURNING *`,
          [schoolId, templateKey, now]
        );
        const version = await queryOne(
          `INSERT INTO report_card_rendering_template_versions (
             school_id, template_id, version, status, spec, spec_sha256, created_at
           ) VALUES ($1,$2,1,'DRAFT',$3::jsonb,$4,$5)
           RETURNING *`,
          [schoolId, template.id, JSON.stringify(spec), sha, now]
        );
        return { template, version: mapTemplateVersion(version) };
      },
      async addTemplateVersion({ schoolId, templateId, spec, sha, now }) {
        const template = await queryOne(
          `SELECT id FROM report_card_rendering_templates WHERE id = $1 AND school_id = $2`,
          [templateId, schoolId]
        );
        if (!template) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
        const next = await queryOne(
          `SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM report_card_rendering_template_versions
           WHERE template_id = $1 AND school_id = $2`,
          [templateId, schoolId]
        );
        const version = await queryOne(
          `INSERT INTO report_card_rendering_template_versions (
             school_id, template_id, version, status, spec, spec_sha256, created_at
           ) VALUES ($1,$2,$3,'DRAFT',$4::jsonb,$5,$6)
           RETURNING *`,
          [schoolId, templateId, Number(next.version), JSON.stringify(spec), sha, now]
        );
        return mapTemplateVersion(version);
      },
      async getTemplateVersion(schoolId, templateId, versionNo) {
        return mapTemplateVersion(
          await queryOne(
            `SELECT * FROM report_card_rendering_template_versions
             WHERE template_id = $1 AND version = $2 AND school_id = $3`,
            [templateId, versionNo, schoolId]
          )
        );
      },
      async activateTemplateVersion(schoolId, templateId, versionNo) {
        try {
          await client.query(
            `UPDATE report_card_rendering_template_versions
             SET status = 'SUPERSEDED'
             WHERE template_id = $1 AND school_id = $2 AND status = 'ACTIVE' AND version IS DISTINCT FROM $3`,
            [templateId, schoolId, versionNo]
          );
          const updated = await queryOne(
            `UPDATE report_card_rendering_template_versions
             SET status = 'ACTIVE'
             WHERE template_id = $1 AND school_id = $2 AND version = $3
             RETURNING *`,
            [templateId, schoolId, versionNo]
          );
          if (!updated) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
          return mapTemplateVersion(updated);
        } catch (err) {
          throw mapImmutable(err);
        }
      },
      async updateDraftTemplateSpec(schoolId, templateId, versionNo, spec, sha) {
        try {
          const updated = await queryOne(
            `UPDATE report_card_rendering_template_versions
             SET spec = $4::jsonb, spec_sha256 = $5
             WHERE template_id = $1 AND school_id = $2 AND version = $3 AND status = 'DRAFT'
             RETURNING *`,
            [templateId, schoolId, versionNo, JSON.stringify(spec), sha]
          );
          if (!updated) {
            const existing = await queryOne(
              `SELECT status FROM report_card_rendering_template_versions
               WHERE template_id = $1 AND school_id = $2 AND version = $3`,
              [templateId, schoolId, versionNo]
            );
            if (!existing) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
            throw new ReportCardConfigurationError("VERSION_IMMUTABLE");
          }
          return mapTemplateVersion(updated);
        } catch (err) {
          throw mapImmutable(err);
        }
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
        throw mapImmutable(err);
      }
    });
  }

  const root = bind(db);
  return {
    withTx,
    ...root,
  };
}

module.exports = { createReportCardConfigurationPgStore };
