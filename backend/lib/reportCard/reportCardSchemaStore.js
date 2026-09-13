"use strict";

const crypto = require("node:crypto");
const {
  SCHEMA_STATUSES,
  ReportCardSchemaError,
  requireSchoolId,
  assertSameTenant,
  validateSpec,
  specSha256,
} = require("./reportCardSchema");

function createReportCardSchemaStore() {
  const schemas = new Map();
  const versions = new Map();

  function versionsOf(schemaId) {
    if (!versions.has(schemaId)) versions.set(schemaId, []);
    return versions.get(schemaId);
  }

  function getSchema(schoolId, schemaId) {
    requireSchoolId(schoolId);
    const row = schemas.get(schemaId);
    if (!row || row.school_id !== schoolId) {
      throw new ReportCardSchemaError("SCHEMA_NOT_FOUND");
    }
    return row;
  }

  function createSchema({ schoolId, actorSchoolId, schemaKey: key, spec, activate = false }) {
    assertSameTenant(schoolId, actorSchoolId);
    const normalized = validateSpec(spec);
    const schemaId = crypto.randomUUID();
    const schema = Object.freeze({
      id: schemaId,
      school_id: schoolId,
      schema_key: String(key || "default"),
      created_at: new Date().toISOString(),
    });
    for (const existing of schemas.values()) {
      if (existing.school_id === schoolId && existing.schema_key === schema.schema_key) {
        throw new ReportCardSchemaError("SCHEMA_KEY_TAKEN");
      }
    }
    schemas.set(schemaId, schema);
    const version = Object.freeze({
      id: crypto.randomUUID(),
      school_id: schoolId,
      schema_id: schemaId,
      version: 1,
      status: activate ? "ACTIVE" : "DRAFT",
      spec: normalized,
      spec_sha256: specSha256(normalized),
      created_at: new Date().toISOString(),
    });
    versionsOf(schemaId).push(version);
    return { schema, version };
  }

  function addVersion({ schoolId, actorSchoolId, schemaId, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    getSchema(schoolId, schemaId);
    const normalized = validateSpec(spec);
    const list = versionsOf(schemaId);
    const version = Object.freeze({
      id: crypto.randomUUID(),
      school_id: schoolId,
      schema_id: schemaId,
      version: list.length + 1,
      status: "DRAFT",
      spec: normalized,
      spec_sha256: specSha256(normalized),
      created_at: new Date().toISOString(),
    });
    list.push(version);
    return version;
  }

  function activateVersion({ schoolId, actorSchoolId, schemaId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    getSchema(schoolId, schemaId);
    const list = versionsOf(schemaId);
    const target = list.find((row) => row.version === version);
    if (!target || target.school_id !== schoolId) {
      throw new ReportCardSchemaError("VERSION_NOT_FOUND");
    }
    const next = list.map((row) => {
      if (row.version === version) return Object.freeze({ ...row, status: "ACTIVE" });
      if (row.status === "ACTIVE") return Object.freeze({ ...row, status: "SUPERSEDED" });
      return row;
    });
    versions.set(schemaId, next);
    return next.find((row) => row.version === version);
  }

  function updateDraftSpec({ schoolId, actorSchoolId, schemaId, version, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    getSchema(schoolId, schemaId);
    const list = versionsOf(schemaId);
    const idx = list.findIndex((row) => row.version === version);
    if (idx < 0) throw new ReportCardSchemaError("VERSION_NOT_FOUND");
    const current = list[idx];
    if (current.status !== "DRAFT") throw new ReportCardSchemaError("VERSION_IMMUTABLE");
    const normalized = validateSpec(spec);
    const updated = Object.freeze({
      ...current,
      spec: normalized,
      spec_sha256: specSha256(normalized),
    });
    list[idx] = updated;
    return updated;
  }

  function getVersion({ schoolId, actorSchoolId, schemaId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    getSchema(schoolId, schemaId);
    const row = versionsOf(schemaId).find((item) => item.version === version);
    if (!row) throw new ReportCardSchemaError("VERSION_NOT_FOUND");
    return row;
  }

  function getActive({ schoolId, actorSchoolId, schemaId }) {
    assertSameTenant(schoolId, actorSchoolId);
    getSchema(schoolId, schemaId);
    const row = versionsOf(schemaId).find((item) => item.status === "ACTIVE");
    if (!row) throw new ReportCardSchemaError("NO_ACTIVE_VERSION");
    return row;
  }

  function listSchemas(schoolId, actorSchoolId) {
    assertSameTenant(schoolId, actorSchoolId);
    return [...schemas.values()].filter((row) => row.school_id === schoolId);
  }

  return {
    createSchema,
    addVersion,
    activateVersion,
    updateDraftSpec,
    getVersion,
    getActive,
    listSchemas,
    SCHEMA_STATUSES,
  };
}

module.exports = { createReportCardSchemaStore };
