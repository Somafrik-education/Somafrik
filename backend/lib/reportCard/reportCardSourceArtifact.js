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
  const mappings = new Map();
  const audit = [];
  let auditSeq = 0;
  let chain = Promise.resolve();

  function requestKey(schoolId, requestId) {
    return `${schoolId}::${requestId}`;
  }

  function snapshot() {
    return {
      byId: structuredClone(byId),
      byRequest: structuredClone(byRequest),
      idempotency: structuredClone(idempotency),
      mappings: structuredClone(mappings),
      audit: structuredClone(audit),
      auditSeq,
    };
  }

  function restore(snap) {
    byId.clear();
    for (const [key, value] of snap.byId) byId.set(key, clone(value));
    byRequest.clear();
    for (const [key, value] of snap.byRequest) byRequest.set(key, value.map(clone));
    idempotency.clear();
    for (const [key, value] of snap.idempotency) idempotency.set(key, value);
    mappings.clear();
    for (const [key, value] of snap.mappings) mappings.set(key, clone(value));
    audit.length = 0;
    audit.push(...snap.audit.map(clone));
    auditSeq = snap.auditSeq;
  }

  const api = {
    async save(artifact) {
      byId.set(artifact.artifact_id, clone(artifact));
      const list = byRequest.get(requestKey(artifact.school_id, artifact.request_id)) || [];
      const idx = list.findIndex((row) => row.artifact_id === artifact.artifact_id);
      if (idx >= 0) list[idx] = clone(artifact);
      else list.push(clone(artifact));
      byRequest.set(requestKey(artifact.school_id, artifact.request_id), list);
      if (artifact.idempotency_key) {
        idempotency.set(
          `${requestKey(artifact.school_id, artifact.request_id)}::${artifact.idempotency_key}`,
          artifact.artifact_id
        );
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
      return id ? api.getById(id) : null;
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
    async getMapping(schoolId, requestId) {
      const row = mappings.get(requestKey(schoolId, requestId));
      return row ? clone(row) : null;
    },
    async saveMapping(row) {
      const stored = clone(row);
      mappings.set(requestKey(row.school_id, row.request_id), stored);
      return clone(stored);
    },
    async invalidateMapping(schoolId, requestId) {
      const row = mappings.get(requestKey(schoolId, requestId));
      if (!row || row.valid === false) return null;
      row.valid = false;
      mappings.set(requestKey(schoolId, requestId), clone(row));
      return clone(row);
    },
    async lockRequest() {
      return {};
    },
    async withSessionLock(_schoolId, _requestId, fn) {
      return api.withTx(() => fn());
    },
    async withTx(fn) {
      const run = chain.then(async () => {
        const snap = snapshot();
        try {
          return await fn(api);
        } catch (err) {
          restore(snap);
          throw err;
        }
      });
      chain = run.then(
        () => {},
        () => {}
      );
      return run;
    },
  };
  return api;
}

function mappingFieldsFromBound(bound, current) {
  if (!bound) return {};
  return {
    artifact_version: current ? current.version : null,
    profile_id: bound.profile_id || null,
    profile_version: bound.profile_version == null ? null : Number(bound.profile_version),
    profile_spec_sha256: bound.profile_spec_sha256 || null,
    schema_id: bound.schema_id || null,
    schema_version: bound.schema_version == null ? null : Number(bound.schema_version),
    schema_spec_sha256: bound.schema_spec_sha256 || null,
    template_id: bound.rendering_template_id || null,
    template_version:
      bound.rendering_template_version == null ? null : Number(bound.rendering_template_version),
    template_spec_sha256: bound.rendering_template_spec_sha256 || null,
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

  async function currentOf(schoolId, requestId, tx = store) {
    const list = await tx.listByRequest(schoolId, requestId);
    return list.find((row) => row.current) || null;
  }

  async function compensateBlob(storageKey) {
    if (!storageKey || typeof blobs.remove !== "function") return;
    try {
      await blobs.remove(storageKey);
    } catch {
      /* best-effort compensation if the DB commit failed after persist */
    }
  }

  async function withExclusive(schoolId, requestId, fn) {
    const lockKey = `${schoolId}::${requestId}`;
    if (inflight.has(lockKey)) throw coded("CONCURRENCY_CONFLICT");
    inflight.add(lockKey);
    try {
      if (typeof store.withTx === "function") {
        return await store.withTx(async (tx) => {
          let locked = {};
          if (typeof tx.lockRequest === "function") {
            locked = (await tx.lockRequest(schoolId, requestId)) || {};
          }
          return fn(tx, locked);
        });
      }
      return await fn(store, {});
    } finally {
      inflight.delete(lockKey);
    }
  }

  async function withReadyLock(schoolId, requestId, fn) {
    const lockKey = `${schoolId}::${requestId}`;
    if (inflight.has(lockKey)) throw coded("CONCURRENCY_CONFLICT");
    inflight.add(lockKey);
    try {
      if (typeof store.withSessionLock === "function") {
        return await store.withSessionLock(schoolId, requestId, fn);
      }
      return await fn();
    } finally {
      inflight.delete(lockKey);
    }
  }

  function mappingMatches(mapping, artifact) {
    if (!mapping || mapping.valid === false || !artifact) return false;
    return (
      String(mapping.artifact_id) === String(artifact.artifact_id) &&
      Number(mapping.artifact_version) === Number(artifact.version) &&
      String(mapping.artifact_sha256) === String(artifact.sha256)
    );
  }

  async function pinMapping(tx, { schoolId, requestId, artifact, bound, at }) {
    if (typeof tx.saveMapping !== "function") return null;
    const fields = mappingFieldsFromBound(bound, artifact);
    return tx.saveMapping({
      school_id: schoolId,
      request_id: requestId,
      artifact_id: artifact.artifact_id,
      artifact_version: artifact.version,
      artifact_sha256: artifact.sha256,
      valid: true,
      updated_at: at,
      ...fields,
    });
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

    let storageKey = null;
    try {
      return await withExclusive(schoolId, requestId, async (tx, locked) => {
        const lockedStatus = locked && locked.status ? locked.status : request.status;
        if (IMMUTABLE_STATUSES.has(lockedStatus)) throw coded("ARTIFACT_IMMUTABLE");
        const again = key ? await tx.getByIdempotency(schoolId, requestId, key) : null;
        if (again) {
          if (again.sha256 !== digest) throw coded("IDEMPOTENCY_CONFLICT");
          return clone(again);
        }
        const previous = await currentOf(schoolId, requestId, tx);
        if (previous && !replace && !key) {
          throw coded("CONCURRENCY_CONFLICT");
        }
        const at = nowIso(clock);
        const list = await tx.listByRequest(schoolId, requestId);
        const version = list.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0) + 1;
        storageKey = await blobs.persist(bytes);
        if (previous) {
          await tx.save({
            ...previous,
            current: false,
            status: "ARCHIVED",
          });
          await tx.appendAudit({
            school_id: schoolId,
            request_id: requestId,
            artifact_id: previous.artifact_id,
            artifact_sha256: previous.sha256,
            artifact_version: previous.version,
            action: "ARCHIVE",
            to_state: "ARCHIVED",
            actor_id: actor.actorId || "unknown",
            created_at: at,
          });
          if (typeof tx.invalidateMapping === "function") {
            const invalidated = await tx.invalidateMapping(schoolId, requestId);
            if (invalidated) {
              await tx.appendAudit({
                school_id: schoolId,
                request_id: requestId,
                artifact_id: previous.artifact_id,
                artifact_sha256: previous.sha256,
                artifact_version: previous.version,
                action: "INVALIDATE_MAPPING",
                to_state: "MAPPING_STALE",
                actor_id: actor.actorId || "unknown",
                created_at: at,
              });
            }
          }
        }
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
        await tx.save(artifact);
        await tx.appendAudit({
          school_id: schoolId,
          request_id: requestId,
          artifact_id: artifact.artifact_id,
          artifact_sha256: artifact.sha256,
          artifact_version: artifact.version,
          action: previous ? "REPLACE" : "ATTACH",
          to_state: "CURRENT",
          actor_id: actor.actorId || "unknown",
          created_at: at,
        });
        return clone(artifact);
      });
    } catch (err) {
      await compensateBlob(storageKey);
      throw err;
    }
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

  function contentHeaders(artifact, { inline = true } = {}) {
    const ext =
      artifact.media_type === "image/png" ? "png" : artifact.media_type === "image/jpeg" ? "jpg" : "pdf";
    const kind = inline ? "inline" : "attachment";
    return {
      "Content-Type": artifact.media_type,
      "Content-Disposition": `${kind}; filename="bulletin-source.${ext}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    };
  }

  function downloadHeaders(artifact) {
    return contentHeaders(artifact, { inline: false });
  }

  async function openDownload({ actor, schoolId, artifactId, inline = true } = {}) {
    assertCanPreview(actor, schoolId);
    const artifact = await getById({ actor, schoolId, artifactId });
    const bytes = await verifyBytes(artifact);
    return { bytes, headers: contentHeaders(artifact, { inline }), artifact: clone(artifact) };
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
    const at = nowIso(clock);
    await withExclusive(schoolId, requestId, async (tx) => {
      const still = await currentOf(schoolId, requestId, tx);
      if (!still || still.artifact_id !== current.artifact_id || still.sha256 !== current.sha256) {
        throw coded("HASH_MISMATCH");
      }
      await pinMapping(tx, { schoolId, requestId, artifact: still, bound, at });
      await tx.appendAudit({
        school_id: schoolId,
        request_id: requestId,
        artifact_id: still.artifact_id,
        artifact_sha256: still.sha256,
        action: "MAP_EXPLICIT",
        to_state: bound.status,
        actor_id: actor.actorId || "unknown",
        created_at: at,
        ...mappingFieldsFromBound(bound, still),
      });
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
    return withReadyLock(schoolId, requestId, async () => {
      const current = await currentOf(schoolId, requestId);
      if (!current) throw coded("ARTIFACT_REQUIRED");
      const mapping = typeof store.getMapping === "function" ? await store.getMapping(schoolId, requestId) : null;
      if (!mapping || mapping.valid === false) throw coded("MAPPING_REQUIRED");
      if (!mappingMatches(mapping, current)) throw coded("HASH_MISMATCH");
      await verifyBytes(current);
      const ready = await configuration.markReadyForReview({ actor, schoolId, requestId });
      await store.appendAudit({
        school_id: schoolId,
        request_id: requestId,
        artifact_id: current.artifact_id,
        artifact_sha256: current.sha256,
        artifact_version: current.version,
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
    });
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
    contentHeaders,
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
