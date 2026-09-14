"use strict";

/**
 * LOT 11 — artefact source de modèle bulletin (preuve documentaire).
 * Aucune extraction automatique, aucune règle auto, aucun recalcul moteur.
 */

const crypto = require("node:crypto");
const {
  MAX_SOURCE_ARTIFACT_BYTES,
  ALLOWED_MEDIA_TYPES,
  validateSourceBytes,
  createMemorySourceStorage,
} = require("./reportCardSourceStorage");

const PERM_SUBMIT = "REPORT_CARD_SUBMIT_MODEL";
const PERM_CONFIGURE = "REPORT_CARD_CONFIGURE";
const IMMUTABLE_STATUSES = new Set(["READY_FOR_REVIEW", "APPROVED", "ACTIVE", "ARCHIVED"]);

class ReportCardSourceArtifactError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardSourceArtifactError";
    this.code = code;
  }
}

function coded(code) {
  return new ReportCardSourceArtifactError(code);
}

function hasPermission(actor, token) {
  return Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(token));
}

function isPlatformPrivileged(actor) {
  return actor?.platform?.privileged === true;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function nowIso(clock) {
  if (clock && typeof clock.now === "function") {
    const value = clock.now();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && value) return value;
  }
  return new Date().toISOString();
}

function clone(value) {
  if (value == null || typeof value !== "object") return value;
  return structuredClone(value);
}

function createMemoryMetadata() {
  const byId = new Map();
  const byRequest = new Map();
  const idempotency = new Map();
  const audit = [];
  let auditSeq = 0;

  function requestKey(schoolId, requestId) {
    return `${schoolId}::${requestId}`;
  }

  return {
    async save(artifact) {
      byId.set(artifact.artifact_id, clone(artifact));
      const list = byRequest.get(requestKey(artifact.school_id, artifact.request_id)) || [];
      const idx = list.findIndex((row) => row.artifact_id === artifact.artifact_id);
      if (idx >= 0) list[idx] = clone(artifact);
      else list.push(clone(artifact));
      byRequest.set(requestKey(artifact.school_id, artifact.request_id), list);
      if (artifact.idempotency_key) {
        idempotency.set(`${requestKey(artifact.school_id, artifact.request_id)}::${artifact.idempotency_key}`, artifact.artifact_id);
      }
      return clone(artifact);
    },
    async getById(artifactId) {
      const row = byId.get(artifactId);
      return row ? clone(row) : null;
    },
    async listByRequest(schoolId, requestId) {
      return (byRequest.get(requestKey(schoolId, requestId)) || []).map(clone);
    },
    async getByIdempotency(schoolId, requestId, key) {
      const id = idempotency.get(`${requestKey(schoolId, requestId)}::${key}`);
      return id ? this.getById(id) : null;
    },
    async appendAudit(entry) {
      auditSeq += 1;
      const row = { id: auditSeq, ...entry };
      audit.push(row);
      return clone(row);
    },
    async listAudit(schoolId, requestId) {
      return audit.filter((row) => row.school_id === schoolId && row.request_id === requestId).map(clone);
    },
  };
}

function createReportCardSourceArtifact({ configuration, storage, metadata, clock } = {}) {
  const blobs = storage || createMemorySourceStorage();
  const store = metadata || createMemoryMetadata();
  const inflight = new Set();

  function requireSchoolId(schoolId) {
    if (schoolId == null || schoolId === "") throw coded("TENANT_REQUIRED");
    return schoolId;
  }

  function assertCanSubmit(actor, schoolId) {
    requireSchoolId(schoolId);
    if (!hasPermission(actor, PERM_SUBMIT)) throw coded("RBAC_DENIED");
    if (actor?.actorSchoolId !== schoolId) throw coded("TENANT_MISMATCH");
  }

  function assertCanPreview(actor, schoolId) {
    requireSchoolId(schoolId);
    if (isPlatformPrivileged(actor) && hasPermission(actor, PERM_CONFIGURE)) return;
    if (!hasPermission(actor, PERM_SUBMIT)) throw coded("RBAC_DENIED");
    if (actor?.actorSchoolId !== schoolId) throw coded("TENANT_MISMATCH");
  }

  function assertCanConfigure(actor, schoolId) {
    requireSchoolId(schoolId);
    if (!hasPermission(actor, PERM_CONFIGURE)) throw coded("RBAC_DENIED");
    if (!isPlatformPrivileged(actor)) throw coded("RBAC_DENIED");
  }

  async function loadConfigurationRequest(actor, schoolId, requestId) {
    if (!configuration || typeof configuration.getRequest !== "function") {
      throw coded("REQUEST_NOT_FOUND");
    }
    try {
      return await configuration.getRequest({ actor, schoolId, requestId });
    } catch (err) {
      if (err && err.code) throw err;
      throw coded("REQUEST_NOT_FOUND");
    }
  }

  async function currentOf(schoolId, requestId) {
    const list = await store.listByRequest(schoolId, requestId);
    return list.find((row) => row.current) || null;
  }

  function withExclusive(requestId, fn) {
    if (inflight.has(requestId)) throw coded("CONCURRENCY_CONFLICT");
    inflight.add(requestId);
    return Promise.resolve()
      .then(fn)
      .finally(() => inflight.delete(requestId));
  }

  async function putArtifact({
    actor,
    schoolId,
    requestId,
    bytes,
    declaredMime,
    originalFilename,
    idempotencyKey,
    replace,
  }) {
    assertCanSubmit(actor, schoolId);
    const request = await loadConfigurationRequest(actor, schoolId, requestId);
    if (IMMUTABLE_STATUSES.has(request.status)) throw coded("ARTIFACT_IMMUTABLE");

    const validated = validateSourceBytes(bytes, declaredMime, originalFilename);
    const digest = sha256Hex(bytes);
    const key = asTrimmed(idempotencyKey);

    if (key) {
      const existing = await store.getByIdempotency(schoolId, requestId, key);
      if (existing) {
        if (existing.sha256 !== digest) throw coded("IDEMPOTENCY_CONFLICT");
        return clone(existing);
      }
    }

    return withExclusive(requestId, async () => {
      const again = key ? await store.getByIdempotency(schoolId, requestId, key) : null;
      if (again) {
        if (again.sha256 !== digest) throw coded("IDEMPOTENCY_CONFLICT");
        return clone(again);
      }
      const previous = await currentOf(schoolId, requestId);
      if (previous && !replace && !key) {
        throw coded("CONCURRENCY_CONFLICT");
      }
      const at = nowIso(clock);
      if (previous) {
        previous.current = false;
        previous.status = "ARCHIVED";
        await store.save(previous);
        await store.appendAudit({
          school_id: schoolId,
          request_id: requestId,
          artifact_id: previous.artifact_id,
          artifact_sha256: previous.sha256,
          action: "ARCHIVE",
          to_state: "ARCHIVED",
          actor_id: actor.actorId || "unknown",
          created_at: at,
        });
      }
      const list = await store.listByRequest(schoolId, requestId);
      const version = list.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0) + 1;
      const storageKey = await blobs.persist(bytes);
      const artifact = {
        artifact_id: crypto.randomUUID(),
        request_id: requestId,
        school_id: schoolId,
        version,
        current: true,
        status: "CURRENT",
        media_type: validated.mediaType,
        byte_size: validated.byteSize,
        sha256: digest,
        original_filename: originalFilename == null ? "" : String(originalFilename),
        storage_key: storageKey,
        idempotency_key: key || null,
        created_by: actor.actorId || "unknown",
        created_at: at,
      };
      await store.save(artifact);
      await store.appendAudit({
        school_id: schoolId,
        request_id: requestId,
        artifact_id: artifact.artifact_id,
        artifact_sha256: artifact.sha256,
        action: previous ? "REPLACE" : "ATTACH",
        to_state: "CURRENT",
        actor_id: actor.actorId || "unknown",
        created_at: at,
      });
      return clone(artifact);
    });
  }

  async function attachToRequest(args = {}) {
    return putArtifact({ ...args, replace: false });
  }

  async function replaceCurrent(args = {}) {
    return putArtifact({ ...args, replace: true });
  }

  async function getCurrent({ actor, schoolId, requestId } = {}) {
    assertCanPreview(actor, schoolId);
    await loadConfigurationRequest(actor, schoolId, requestId);
    const current = await currentOf(schoolId, requestId);
    if (!current) throw coded("ARTIFACT_REQUIRED");
    return clone(current);
  }

  async function getById({ actor, schoolId, artifactId } = {}) {
    assertCanPreview(actor, schoolId);
    const row = await store.getById(artifactId);
    if (!row || row.school_id !== schoolId) throw coded("REQUEST_NOT_FOUND");
    return clone(row);
  }

  async function verifyBytes(artifact) {
    let bytes;
    try {
      bytes = await blobs.read(artifact.storage_key);
    } catch (err) {
      if (err && (err.code === "ARTIFACT_NOT_FOUND" || err.code === "ENOENT")) throw coded("ARTIFACT_CORRUPT");
      throw err;
    }
    if (!Buffer.isBuffer(bytes) || sha256Hex(bytes) !== artifact.sha256) {
      throw coded("HASH_MISMATCH");
    }
    return bytes;
  }

  function downloadHeaders(artifact) {
    const ext =
      artifact.media_type === "image/png" ? "png" : artifact.media_type === "image/jpeg" ? "jpg" : "pdf";
    return {
      "Content-Type": artifact.media_type,
      "Content-Disposition": `attachment; filename="bulletin-source.${ext}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    };
  }

  async function openDownload({ actor, schoolId, artifactId } = {}) {
    assertCanPreview(actor, schoolId);
    const artifact = await getById({ actor, schoolId, artifactId });
    const bytes = await verifyBytes(artifact);
    return { bytes, headers: downloadHeaders(artifact), artifact: clone(artifact) };
  }

  async function mapExplicit({
    actor,
    schoolId,
    requestId,
    fromArtifact,
    profile,
    schema,
    template,
    artifact_id,
    artifact_version,
  } = {}) {
    assertCanConfigure(actor, schoolId);
    if (fromArtifact || !profile || !schema || !template) {
      throw coded("MAPPING_NOT_EXPLICIT");
    }
    const current = await currentOf(schoolId, requestId);
    if (!current) throw coded("ARTIFACT_REQUIRED");
    if (artifact_id && artifact_id !== current.artifact_id) throw coded("HASH_MISMATCH");
    if (artifact_version != null && Number(artifact_version) !== Number(current.version)) {
      throw coded("HASH_MISMATCH");
    }
    await verifyBytes(current);
    const bound = await configuration.bindBundle({
      actor,
      schoolId,
      requestId,
      profile,
      schema,
      template,
    });
    await store.appendAudit({
      school_id: schoolId,
      request_id: requestId,
      artifact_id: current.artifact_id,
      artifact_sha256: current.sha256,
      action: "MAP_EXPLICIT",
      to_state: bound.status,
      actor_id: actor.actorId || "unknown",
      created_at: nowIso(clock),
      profile_id: profile.id,
      schema_id: schema.id,
      template_id: template.id,
    });
    return {
      artifact_id: current.artifact_id,
      artifact_version: current.version,
      artifact_sha256: current.sha256,
      profile,
      schema,
      template,
      request: bound,
    };
  }

  async function markReadyForReview({ actor, schoolId, requestId } = {}) {
    assertCanConfigure(actor, schoolId);
    const current = await currentOf(schoolId, requestId);
    if (!current) throw coded("ARTIFACT_REQUIRED");
    await verifyBytes(current);
    const ready = await configuration.markReadyForReview({ actor, schoolId, requestId });
    await store.appendAudit({
      school_id: schoolId,
      request_id: requestId,
      artifact_id: current.artifact_id,
      artifact_sha256: current.sha256,
      action: "READY_FOR_REVIEW",
      to_state: "READY_FOR_REVIEW",
      actor_id: actor.actorId || "unknown",
      created_at: nowIso(clock),
    });
    return {
      ...clone(ready),
      artifact_id: current.artifact_id,
      artifact_version: current.version,
      artifact_sha256: current.sha256,
    };
  }

  async function listAudit({ actor, schoolId, requestId } = {}) {
    assertCanPreview(actor, schoolId);
    await loadConfigurationRequest(actor, schoolId, requestId);
    return store.listAudit(schoolId, requestId);
  }

  return {
    attachToRequest,
    replaceCurrent,
    getCurrent,
    getById,
    openDownload,
    mapExplicit,
    markReadyForReview,
    listAudit,
    downloadHeaders,
    toPublicArtifact,
  };
}

function asTrimmed(value) {
  return value == null ? "" : String(value).trim();
}

function toPublicArtifact(artifact) {
  if (!artifact) return null;
  return {
    artifact_id: artifact.artifact_id,
    request_id: artifact.request_id,
    school_id: artifact.school_id,
    version: artifact.version,
    current: artifact.current,
    status: artifact.status,
    media_type: artifact.media_type,
    byte_size: artifact.byte_size,
    sha256: artifact.sha256,
    original_filename: artifact.original_filename,
    created_by: artifact.created_by,
    created_at: artifact.created_at,
  };
}

module.exports = {
  createReportCardSourceArtifact,
  ReportCardSourceArtifactError,
  MAX_SOURCE_ARTIFACT_BYTES,
  ALLOWED_MEDIA_TYPES,
  toPublicArtifact,
};
