"use strict";

const {
  ReportCardSchemaError,
  requireSchoolId,
  assertSameTenant,
  validateSpec,
  specSha256,
} = require("../lib/reportCard/reportCardSchema");

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    school_id: row.school_id,
    schema_id: row.schema_id,
    version: Number(row.version),
    status: row.status,
    spec: row.spec,
    spec_sha256: row.spec_sha256,
    created_at: row.created_at,
  };
}

function createReportCardSchemaPgStore(db) {
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

  async function requireSchema(client, schoolId, schemaId, { forUpdate = false } = {}) {
    const schema = await queryOne(
      client,
      `SELECT id FROM report_card_schemas WHERE id = $1 AND school_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [schemaId, schoolId]
    );
    if (!schema) throw new ReportCardSchemaError("SCHEMA_NOT_FOUND");
    return schema;
  }

  async function createSchema({ schoolId, actorSchoolId, schemaKey, spec, activate = false }) {
    assertSameTenant(schoolId, actorSchoolId);
    requireSchoolId(schoolId);
    const normalized = validateSpec(spec);
    const sha = specSha256(normalized);
    try {
      return await withTx(async (client) => {
        const schemaRes = await client.query(
          `INSERT INTO report_card_schemas (school_id, schema_key)
           VALUES ($1, $2)
           RETURNING id, school_id, schema_key, created_at`,
          [schoolId, String(schemaKey || "default")]
        );
        const schema = schemaRes.rows[0];
        const versionRes = await client.query(
          `INSERT INTO report_card_schema_versions
             (school_id, schema_id, version, status, spec, spec_sha256)
           VALUES ($1, $2, 1, $3, $4::jsonb, $5)
           RETURNING *`,
          [schoolId, schema.id, activate ? "ACTIVE" : "DRAFT", JSON.stringify(normalized), sha]
        );
        return { schema, version: mapVersion(versionRes.rows[0]) };
      });
    } catch (err) {
      if (err.code === "23505") throw new ReportCardSchemaError("SCHEMA_KEY_TAKEN");
      throw err;
    }
  }

  async function addVersion({ schoolId, actorSchoolId, schemaId, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    const normalized = validateSpec(spec);
    const sha = specSha256(normalized);
    return withTx(async (client) => {
      await requireSchema(client, schoolId, schemaId, { forUpdate: true });
      const next = await queryOne(
        client,
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
         FROM report_card_schema_versions
         WHERE schema_id = $1 AND school_id = $2`,
        [schemaId, schoolId]
      );
      const versionRes = await client.query(
        `INSERT INTO report_card_schema_versions
           (school_id, schema_id, version, status, spec, spec_sha256)
         VALUES ($1, $2, $3, 'DRAFT', $4::jsonb, $5)
         RETURNING *`,
        [schoolId, schemaId, Number(next.next), JSON.stringify(normalized), sha]
      );
      return mapVersion(versionRes.rows[0]);
    });
  }

  async function activateVersion({ schoolId, actorSchoolId, schemaId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withTx(async (client) => {
      await requireSchema(client, schoolId, schemaId);
      const target = await queryOne(
        client,
        `SELECT id FROM report_card_schema_versions
         WHERE schema_id = $1 AND version = $2 AND school_id = $3
         FOR UPDATE`,
        [schemaId, version, schoolId]
      );
      if (!target) throw new ReportCardSchemaError("VERSION_NOT_FOUND");
      await client.query(
        `UPDATE report_card_schema_versions
         SET status = 'SUPERSEDED'
         WHERE schema_id = $1 AND school_id = $2 AND status = 'ACTIVE' AND version <> $3`,
        [schemaId, schoolId, version]
      );
      const updated = await queryOne(
        client,
        `UPDATE report_card_schema_versions
         SET status = 'ACTIVE'
         WHERE schema_id = $1 AND version = $2 AND school_id = $3
         RETURNING *`,
        [schemaId, version, schoolId]
      );
      return mapVersion(updated);
    });
  }

  async function updateDraftSpec({ schoolId, actorSchoolId, schemaId, version, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      await requireSchema(client, schoolId, schemaId);
      const current = await queryOne(
        client,
        `SELECT * FROM report_card_schema_versions
         WHERE schema_id = $1 AND version = $2 AND school_id = $3`,
        [schemaId, version, schoolId]
      );
      if (!current) throw new ReportCardSchemaError("VERSION_NOT_FOUND");
      if (current.status !== "DRAFT") throw new ReportCardSchemaError("VERSION_IMMUTABLE");
      const normalized = validateSpec(spec);
      const sha = specSha256(normalized);
      try {
        const updated = await queryOne(
          client,
          `UPDATE report_card_schema_versions
           SET spec = $1::jsonb, spec_sha256 = $2
           WHERE id = $3 AND school_id = $4 AND status = 'DRAFT'
           RETURNING *`,
          [JSON.stringify(normalized), sha, current.id, schoolId]
        );
        if (!updated) throw new ReportCardSchemaError("VERSION_IMMUTABLE");
        return mapVersion(updated);
      } catch (err) {
        if (String(err.message).includes("REPORT_CARD_SCHEMA_VERSION_IMMUTABLE")) {
          throw new ReportCardSchemaError("VERSION_IMMUTABLE");
        }
        throw err;
      }
    });
  }

  async function getVersion({ schoolId, actorSchoolId, schemaId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      await requireSchema(client, schoolId, schemaId);
      const row = await queryOne(
        client,
        `SELECT * FROM report_card_schema_versions
         WHERE schema_id = $1 AND version = $2 AND school_id = $3`,
        [schemaId, version, schoolId]
      );
      if (!row) throw new ReportCardSchemaError("VERSION_NOT_FOUND");
      return mapVersion(row);
    });
  }

  async function getActive({ schoolId, actorSchoolId, schemaId }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      await requireSchema(client, schoolId, schemaId);
      const row = await queryOne(
        client,
        `SELECT * FROM report_card_schema_versions
         WHERE schema_id = $1 AND school_id = $2 AND status = 'ACTIVE'`,
        [schemaId, schoolId]
      );
      if (!row) throw new ReportCardSchemaError("NO_ACTIVE_VERSION");
      return mapVersion(row);
    });
  }

  async function listSchemas(schoolId, actorSchoolId) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT id, school_id, schema_key, created_at
         FROM report_card_schemas WHERE school_id = $1
         ORDER BY created_at`,
        [schoolId]
      );
      return result.rows;
    });
  }

  return {
    createSchema,
    addVersion,
    activateVersion,
    updateDraftSpec,
    getVersion,
    getActive,
    listSchemas,
  };
}

module.exports = { createReportCardSchemaPgStore };
