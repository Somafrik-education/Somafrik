"use strict";

/**
 * LOT 6 — workflow établissement → Superadmin → activation du bundle bulletin.
 * Aucun mint QR, aucun rendu PDF, aucune publication de snapshot.
 */

const crypto = require("node:crypto");
const { ENGINE_ID, TEMPLATE_REQUEST_STATES } = require("../../contracts/reportCard/contract");
const { isCalculablePassRule } = require("./academicRuleProfile");
const { validateAgainstProfile } = require("./reportCardSchema");
const {
  normalizeRenderingTemplate,
  rejectCountrySchoolKeys,
  specSha256,
  RenderingTemplateError,
} = require("./renderingTemplate");

const PERM_SUBMIT = "REPORT_CARD_SUBMIT_MODEL";
const PERM_CONFIGURE = "REPORT_CARD_CONFIGURE";
const PERM_APPROVE = "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE";
const MODEL_KEY_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const SUPERADMIN_TRANSITIONS = Object.freeze({
  SUBMITTED: Object.freeze(["UNDER_REVIEW", "REJECTED"]),
  UNDER_REVIEW: Object.freeze(["CONFIGURING", "REJECTED"]),
  CONFIGURING: Object.freeze(["READY_FOR_REVIEW", "REJECTED"]),
  READY_FOR_REVIEW: Object.freeze(["REJECTED"]),
  CHANGES_REQUESTED: Object.freeze(["CONFIGURING", "REJECTED"]),
  APPROVED: Object.freeze(["ACTIVE"]),
  ACTIVE: Object.freeze(["ARCHIVED"]),
});

const SCHOOL_APPROVE_TRANSITIONS = Object.freeze({
  READY_FOR_REVIEW: Object.freeze(["CHANGES_REQUESTED", "APPROVED"]),
});

class ReportCardConfigurationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardConfigurationError";
    this.code = code;
  }
}

function clone(value) {
  if (value == null || typeof value !== "object") return value;
  return structuredClone(value);
}

function nowIso(clock) {
  if (clock && typeof clock.now === "function") {
    const value = clock.now();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && value) return value;
  }
  return new Date().toISOString();
}

function hasPermission(actor, token) {
  return Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(token));
}

function isPlatformPrivileged(actor) {
  return actor?.platform?.privileged === true;
}

function requireSchoolId(schoolId) {
  if (schoolId == null || schoolId === "") {
    throw new ReportCardConfigurationError("TENANT_REQUIRED");
  }
  return schoolId;
}

function assertSchoolActor(actor, schoolId) {
  if (actor?.actorSchoolId !== schoolId) {
    throw new ReportCardConfigurationError("TENANT_MISMATCH");
  }
}

function assertCanSubmit(actor, schoolId) {
  requireSchoolId(schoolId);
  if (!hasPermission(actor, PERM_SUBMIT)) {
    throw new ReportCardConfigurationError("RBAC_DENIED");
  }
  assertSchoolActor(actor, schoolId);
}

function assertCanApprove(actor, schoolId) {
  requireSchoolId(schoolId);
  if (!hasPermission(actor, PERM_APPROVE)) {
    throw new ReportCardConfigurationError("RBAC_DENIED");
  }
  assertSchoolActor(actor, schoolId);
}

function assertCanConfigure(actor, schoolId) {
  requireSchoolId(schoolId);
  if (!hasPermission(actor, PERM_CONFIGURE)) {
    throw new ReportCardConfigurationError("RBAC_DENIED");
  }
  if (!isPlatformPrivileged(actor)) {
    throw new ReportCardConfigurationError("PLATFORM_CONTEXT_REQUIRED");
  }
}

function assertCanRead(actor, schoolId) {
  requireSchoolId(schoolId);
  if (isPlatformPrivileged(actor) && hasPermission(actor, PERM_CONFIGURE)) return;
  if (!hasPermission(actor, PERM_SUBMIT) && !hasPermission(actor, PERM_APPROVE)) {
    throw new ReportCardConfigurationError("RBAC_DENIED");
  }
  assertSchoolActor(actor, schoolId);
}

function requireModelKey(modelKey) {
  const key = String(modelKey || "").trim();
  if (!MODEL_KEY_RE.test(key)) {
    throw new ReportCardConfigurationError("MODEL_KEY_REQUIRED");
  }
  return key;
}

function freezeRequest(row) {
  return clone(row);
}

function wrapTemplateError(err) {
  if (err instanceof RenderingTemplateError || (err && err.code)) {
    const wrapped = new ReportCardConfigurationError(err.code, err.message);
    return wrapped;
  }
  return err;
}

function createInMemoryConfigurationPersistence() {
  const requests = new Map();
  const templates = new Map();
  const versions = new Map();
  const audit = [];
  const commands = new Map();
  const bindings = new Map();
  let auditSeq = 0;
  let chain = Promise.resolve();

  function versionsOf(templateId) {
    if (!versions.has(templateId)) versions.set(templateId, []);
    return versions.get(templateId);
  }

  function bindingKey(schoolId, modelKey) {
    return `${schoolId}::${modelKey}`;
  }

  const api = {
    async withTx(fn) {
      const result = chain.then(() => fn(api));
      chain = result.then(
        () => {},
        () => {}
      );
      return result;
    },
    async lockPair() {},
    async insertRequest(row) {
      requests.set(row.id, clone(row));
      return freezeRequest(requests.get(row.id));
    },
    async getRequest(schoolId, requestId) {
      const row = requests.get(requestId);
      if (!row || row.school_id !== schoolId) return null;
      return freezeRequest(row);
    },
    async listRequests(schoolId) {
      return [...requests.values()].filter((row) => row.school_id === schoolId).map(freezeRequest);
    },
    async saveRequest(row) {
      requests.set(row.id, clone(row));
      return freezeRequest(requests.get(row.id));
    },
    async getActiveByPair(schoolId, modelKey) {
      const row = [...requests.values()].find(
        (item) => item.school_id === schoolId && item.model_key === modelKey && item.status === "ACTIVE"
      );
      return row ? freezeRequest(row) : null;
    },
    async upsertBinding(row) {
      bindings.set(bindingKey(row.school_id, row.model_key), clone(row));
      return clone(bindings.get(bindingKey(row.school_id, row.model_key)));
    },
    async getBinding(schoolId, modelKey) {
      const row = bindings.get(bindingKey(schoolId, modelKey));
      return row ? clone(row) : null;
    },
    async insertAudit(entry) {
      auditSeq += 1;
      audit.push(
        Object.freeze({
          id: auditSeq,
          ...clone(entry),
        })
      );
      return audit[audit.length - 1];
    },
    async listAudit(schoolId, requestId) {
      return audit.filter((row) => row.school_id === schoolId && row.request_id === requestId).map((row) => clone(row));
    },
    async getCommand(commandId) {
      const row = commands.get(commandId);
      return row ? clone(row) : null;
    },
    async insertCommand(row) {
      if (commands.has(row.command_id)) {
        throw new ReportCardConfigurationError("IDEMPOTENCY_CONFLICT");
      }
      commands.set(row.command_id, clone(row));
      return clone(commands.get(row.command_id));
    },
    async createTemplate({ schoolId, templateKey, spec, sha, now }) {
      const templateId = crypto.randomUUID();
      templates.set(templateId, {
        id: templateId,
        school_id: schoolId,
        template_key: templateKey,
        created_at: now,
      });
      const version = {
        id: crypto.randomUUID(),
        school_id: schoolId,
        template_id: templateId,
        version: 1,
        status: "DRAFT",
        spec,
        spec_sha256: sha,
        created_at: now,
      };
      versionsOf(templateId).push(version);
      return { template: clone(templates.get(templateId)), version: clone(version) };
    },
    async addTemplateVersion({ schoolId, templateId, spec, sha, now }) {
      const template = templates.get(templateId);
      if (!template || template.school_id !== schoolId) {
        throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      }
      const list = versionsOf(templateId);
      const version = {
        id: crypto.randomUUID(),
        school_id: schoolId,
        template_id: templateId,
        version: list.length + 1,
        status: "DRAFT",
        spec,
        spec_sha256: sha,
        created_at: now,
      };
      list.push(version);
      return clone(version);
    },
    async getTemplateVersion(schoolId, templateId, versionNo) {
      const template = templates.get(templateId);
      if (!template || template.school_id !== schoolId) return null;
      const row = versionsOf(templateId).find((item) => item.version === versionNo);
      return row ? clone(row) : null;
    },
    async activateTemplateVersion(schoolId, templateId, versionNo) {
      const template = templates.get(templateId);
      if (!template || template.school_id !== schoolId) {
        throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      }
      const list = versionsOf(templateId);
      const target = list.find((item) => item.version === versionNo);
      if (!target) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      const next = list.map((item) => {
        if (item.version === versionNo) return { ...item, status: "ACTIVE" };
        if (item.status === "ACTIVE") return { ...item, status: "SUPERSEDED" };
        return item;
      });
      versions.set(templateId, next);
      return clone(next.find((item) => item.version === versionNo));
    },
    async updateDraftTemplateSpec(schoolId, templateId, versionNo, spec, sha) {
      const list = versionsOf(templateId);
      const idx = list.findIndex((item) => item.version === versionNo);
      if (idx < 0) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      const current = list[idx];
      if (current.school_id !== schoolId) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      if (current.status !== "DRAFT") throw new ReportCardConfigurationError("VERSION_IMMUTABLE");
      list[idx] = { ...current, spec, spec_sha256: sha };
      return clone(list[idx]);
    },
  };
  return api;
}

function createReportCardConfiguration({
  profileStore,
  schemaStore,
  persistence: persistenceArg,
  clock,
} = {}) {
  if (!profileStore || !schemaStore) {
    throw new ReportCardConfigurationError("STORES_REQUIRED");
  }
  const persistence = persistenceArg || createInMemoryConfigurationPersistence();

  function inTx(fn) {
    if (typeof persistence.withTx === "function") return persistence.withTx(fn);
    return fn(persistence);
  }

  async function writeAudit(store, { request, fromStatus, toStatus, actor, permission, reason, commandId, at }) {
    return store.insertAudit({
      request_id: request.id,
      school_id: request.school_id,
      from_state: fromStatus,
      to_state: toStatus,
      actor_id: actor.actorId || "unknown",
      permission,
      reason: reason || null,
      command_id: commandId || null,
      created_at: at,
    });
  }

  async function loadRequest(store, schoolId, requestId) {
    const row = await store.getRequest(schoolId, requestId);
    if (!row) throw new ReportCardConfigurationError("REQUEST_NOT_FOUND");
    return row;
  }

  async function applyTransition(store, request, toStatus, actor, permission, { reason, commandId, at, extra } = {}) {
    if (!TEMPLATE_REQUEST_STATES.includes(toStatus)) {
      throw new ReportCardConfigurationError("INVALID_TRANSITION");
    }
    const fromStatus = request.status;
    const updated = {
      ...request,
      ...extra,
      status: toStatus,
      last_actor_id: actor.actorId || "unknown",
      last_permission: permission,
      concurrency_version: Number(request.concurrency_version || 1) + 1,
      updated_at: at,
    };
    const saved = await store.saveRequest(updated);
    await writeAudit(store, {
      request: saved,
      fromStatus,
      toStatus,
      actor,
      permission,
      reason,
      commandId,
      at,
    });
    return freezeRequest(saved);
  }

  async function loadProfileVersion(schoolId, profileId, version) {
    try {
      return await Promise.resolve(
        profileStore.getVersion({ schoolId, actorSchoolId: schoolId, profileId, version })
      );
    } catch (err) {
      if (err && (err.code === "VERSION_NOT_FOUND" || err.code === "PROFILE_NOT_FOUND")) {
        throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      }
      throw err;
    }
  }

  async function loadSchemaVersion(schoolId, schemaId, version) {
    try {
      return await Promise.resolve(
        schemaStore.getVersion({ schoolId, actorSchoolId: schoolId, schemaId, version })
      );
    } catch (err) {
      if (err && (err.code === "VERSION_NOT_FOUND" || err.code === "SCHEMA_NOT_FOUND")) {
        throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
      }
      throw err;
    }
  }

  async function validateBundle(store, schoolId, refs, { requireFrozenTemplate = true } = {}) {
    if (!refs?.profile?.id || !Number.isInteger(Number(refs.profile.version))) {
      throw new ReportCardConfigurationError("INVALID_BUNDLE");
    }
    if (!refs?.schema?.id || !Number.isInteger(Number(refs.schema.version))) {
      throw new ReportCardConfigurationError("INVALID_BUNDLE");
    }
    if (!refs?.template?.id || !Number.isInteger(Number(refs.template.version))) {
      throw new ReportCardConfigurationError("INVALID_BUNDLE");
    }
    const profile = await loadProfileVersion(schoolId, refs.profile.id, Number(refs.profile.version));
    if (!isCalculablePassRule(profile.spec)) {
      throw new ReportCardConfigurationError("PROFILE_NOT_CALCULABLE");
    }
    if (profile.status === "DRAFT") {
      throw new ReportCardConfigurationError("BUNDLE_VERSION_MUTABLE");
    }
    const schema = await loadSchemaVersion(schoolId, refs.schema.id, Number(refs.schema.version));
    if (schema.status === "DRAFT") {
      throw new ReportCardConfigurationError("BUNDLE_VERSION_MUTABLE");
    }
    try {
      validateAgainstProfile(schema.spec, profile.spec);
    } catch (err) {
      if (err && err.code === "INVALID_PROFILE_REFERENCE") {
        throw new ReportCardConfigurationError("INVALID_PROFILE_REFERENCE");
      }
      throw new ReportCardConfigurationError("INVALID_BUNDLE");
    }
    const template = await store.getTemplateVersion(schoolId, refs.template.id, Number(refs.template.version));
    if (!template) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
    let normalized;
    try {
      normalized = normalizeRenderingTemplate(template.spec);
    } catch (err) {
      throw wrapTemplateError(err);
    }
    if (!normalized) throw new ReportCardConfigurationError("RENDERING_TEMPLATE_REQUIRED");
    if (requireFrozenTemplate && template.status === "DRAFT") {
      throw new ReportCardConfigurationError("BUNDLE_VERSION_MUTABLE");
    }
    return {
      profile,
      schema,
      template,
      engine_id: ENGINE_ID,
      profile_spec_sha256: profile.spec_sha256,
      schema_spec_sha256: schema.spec_sha256,
      rendering_template_spec_sha256: template.spec_sha256 || specSha256(normalized),
    };
  }

  async function submitModel({ actor, schoolId, modelKey, description, spec } = {}) {
    assertCanSubmit(actor, schoolId);
    if (spec !== undefined) {
      try {
        rejectCountrySchoolKeys(spec);
      } catch (err) {
        throw wrapTemplateError(err);
      }
    }
    const key = requireModelKey(modelKey);
    const at = nowIso(clock);
    const row = {
      id: crypto.randomUUID(),
      school_id: schoolId,
      model_key: key,
      status: "SUBMITTED",
      concurrency_version: 1,
      description: description == null ? null : String(description),
      profile_id: null,
      profile_version: null,
      profile_spec_sha256: null,
      schema_id: null,
      schema_version: null,
      schema_spec_sha256: null,
      rendering_template_id: null,
      rendering_template_version: null,
      rendering_template_spec_sha256: null,
      engine_id: null,
      last_actor_id: actor.actorId || "unknown",
      last_permission: PERM_SUBMIT,
      created_at: at,
      updated_at: at,
    };
    return inTx(async (store) => {
      const saved = await store.insertRequest(row);
      await writeAudit(store, {
        request: saved,
        fromStatus: null,
        toStatus: "SUBMITTED",
        actor,
        permission: PERM_SUBMIT,
        at,
      });
      return freezeRequest(saved);
    });
  }

  async function startReview({ actor, schoolId, requestId } = {}) {
    assertCanConfigure(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (!(SUPERADMIN_TRANSITIONS[request.status] || []).includes("UNDER_REVIEW")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      return applyTransition(store, request, "UNDER_REVIEW", actor, PERM_CONFIGURE, { at });
    });
  }

  async function startConfiguring({ actor, schoolId, requestId } = {}) {
    assertCanConfigure(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (!(SUPERADMIN_TRANSITIONS[request.status] || []).includes("CONFIGURING")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      return applyTransition(store, request, "CONFIGURING", actor, PERM_CONFIGURE, { at });
    });
  }

  async function resumeConfiguring(args) {
    return startConfiguring(args);
  }

  async function saveRenderingTemplate({ actor, schoolId, requestId, spec } = {}) {
    assertCanConfigure(actor, schoolId);
    let normalized;
    try {
      normalized = normalizeRenderingTemplate(spec);
    } catch (err) {
      throw wrapTemplateError(err);
    }
    if (!normalized) throw new ReportCardConfigurationError("RENDERING_TEMPLATE_REQUIRED");
    const sha = specSha256(normalized);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (request.status !== "CONFIGURING") {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      let version;
      if (request.rendering_template_id) {
        version = await store.addTemplateVersion({
          schoolId,
          templateId: request.rendering_template_id,
          spec: normalized,
          sha,
          now: at,
        });
      } else {
        const created = await store.createTemplate({
          schoolId,
          templateKey: `req-${request.id}`,
          spec: normalized,
          sha,
          now: at,
        });
        version = created.version;
      }
      return {
        template_id: version.template_id,
        version: version.version,
        spec_sha256: version.spec_sha256,
        status: version.status,
      };
    });
  }

  async function bindBundle({ actor, schoolId, requestId, profile, schema, template } = {}) {
    assertCanConfigure(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (request.status !== "CONFIGURING") {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      const bundle = await validateBundle(store, schoolId, { profile, schema, template }, { requireFrozenTemplate: false });
      const updated = {
        ...request,
        profile_id: bundle.profile.profile_id || bundle.profile.id,
        profile_version: bundle.profile.version,
        profile_spec_sha256: bundle.profile_spec_sha256,
        schema_id: bundle.schema.schema_id || bundle.schema.id,
        schema_version: bundle.schema.version,
        schema_spec_sha256: bundle.schema_spec_sha256,
        rendering_template_id: bundle.template.template_id,
        rendering_template_version: bundle.template.version,
        rendering_template_spec_sha256: bundle.rendering_template_spec_sha256,
        engine_id: ENGINE_ID,
        last_actor_id: actor.actorId || "unknown",
        last_permission: PERM_CONFIGURE,
        concurrency_version: Number(request.concurrency_version || 1) + 1,
        updated_at: at,
      };
      const saved = await store.saveRequest(updated);
      await writeAudit(store, {
        request: saved,
        fromStatus: request.status,
        toStatus: request.status,
        actor,
        permission: PERM_CONFIGURE,
        reason: "bind_bundle",
        at,
      });
      return freezeRequest(saved);
    });
  }

  async function markReadyForReview({ actor, schoolId, requestId } = {}) {
    assertCanConfigure(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (!(SUPERADMIN_TRANSITIONS[request.status] || []).includes("READY_FOR_REVIEW")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      if (!request.profile_id || !request.schema_id || !request.rendering_template_id) {
        throw new ReportCardConfigurationError("INVALID_BUNDLE");
      }
      const refs = {
        profile: { id: request.profile_id, version: request.profile_version },
        schema: { id: request.schema_id, version: request.schema_version },
        template: { id: request.rendering_template_id, version: request.rendering_template_version },
      };
      await validateBundle(store, schoolId, refs, { requireFrozenTemplate: false });
      const template = await store.getTemplateVersion(
        schoolId,
        request.rendering_template_id,
        request.rendering_template_version
      );
      if (template && template.status === "DRAFT") {
        await store.activateTemplateVersion(schoolId, request.rendering_template_id, request.rendering_template_version);
      }
      await validateBundle(store, schoolId, refs, { requireFrozenTemplate: true });
      return applyTransition(store, request, "READY_FOR_REVIEW", actor, PERM_CONFIGURE, { at });
    });
  }

  async function requestChanges({ actor, schoolId, requestId, comment } = {}) {
    assertCanApprove(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (!(SCHOOL_APPROVE_TRANSITIONS[request.status] || []).includes("CHANGES_REQUESTED")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      return applyTransition(store, request, "CHANGES_REQUESTED", actor, PERM_APPROVE, {
        at,
        reason: comment || null,
      });
    });
  }

  async function approve({ actor, schoolId, requestId } = {}) {
    assertCanApprove(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (!(SCHOOL_APPROVE_TRANSITIONS[request.status] || []).includes("APPROVED")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      return applyTransition(store, request, "APPROVED", actor, PERM_APPROVE, { at });
    });
  }

  async function reject({ actor, schoolId, requestId, reason } = {}) {
    assertCanConfigure(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const request = await loadRequest(store, schoolId, requestId);
      if (!(SUPERADMIN_TRANSITIONS[request.status] || []).includes("REJECTED")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      return applyTransition(store, request, "REJECTED", actor, PERM_CONFIGURE, { at, reason });
    });
  }

  async function activate({ actor, schoolId, requestId, commandId } = {}) {
    assertCanConfigure(actor, schoolId);
    const at = nowIso(clock);
    return inTx(async (store) => {
      const initial = await loadRequest(store, schoolId, requestId);
      await store.lockPair(schoolId, initial.model_key);
      if (commandId) {
        const existing = await store.getCommand(commandId);
        if (existing) {
          if (existing.request_id !== requestId || existing.action !== "activate") {
            throw new ReportCardConfigurationError("IDEMPOTENCY_CONFLICT");
          }
          return loadRequest(store, schoolId, existing.request_id);
        }
      }
      const request = await loadRequest(store, schoolId, requestId);
      if (request.status === "ACTIVE") {
        if (commandId) {
          try {
            await store.insertCommand({
              command_id: commandId,
              request_id: request.id,
              school_id: schoolId,
              action: "activate",
            });
          } catch (err) {
            if (!err || err.code !== "IDEMPOTENCY_CONFLICT") throw err;
          }
        }
        return freezeRequest(request);
      }
      if (!(SUPERADMIN_TRANSITIONS[request.status] || []).includes("ACTIVE")) {
        throw new ReportCardConfigurationError("INVALID_TRANSITION");
      }
      if (!request.profile_id || !request.schema_id || !request.rendering_template_id) {
        throw new ReportCardConfigurationError("INVALID_BUNDLE");
      }
      const bundle = await validateBundle(
        store,
        schoolId,
        {
          profile: { id: request.profile_id, version: request.profile_version },
          schema: { id: request.schema_id, version: request.schema_version },
          template: { id: request.rendering_template_id, version: request.rendering_template_version },
        },
        { requireFrozenTemplate: true }
      );
      if (
        request.profile_spec_sha256 !== bundle.profile_spec_sha256 ||
        request.schema_spec_sha256 !== bundle.schema_spec_sha256 ||
        request.rendering_template_spec_sha256 !== bundle.rendering_template_spec_sha256
      ) {
        throw new ReportCardConfigurationError("BUNDLE_VERSION_MUTABLE");
      }
      const previous = await store.getActiveByPair(schoolId, request.model_key);
      if (previous && previous.id !== request.id) {
        await applyTransition(store, previous, "ARCHIVED", actor, PERM_CONFIGURE, {
          at,
          reason: "replaced",
          commandId,
        });
      }
      const extra = {
        engine_id: ENGINE_ID,
        profile_spec_sha256: bundle.profile_spec_sha256,
        schema_spec_sha256: bundle.schema_spec_sha256,
        rendering_template_spec_sha256: bundle.rendering_template_spec_sha256,
      };
      const active = await applyTransition(store, request, "ACTIVE", actor, PERM_CONFIGURE, {
        at,
        commandId,
        extra,
      });
      await store.upsertBinding({
        school_id: schoolId,
        model_key: request.model_key,
        request_id: active.id,
        engine_id: ENGINE_ID,
        profile_id: active.profile_id,
        profile_version: active.profile_version,
        profile_spec_sha256: active.profile_spec_sha256,
        schema_id: active.schema_id,
        schema_version: active.schema_version,
        schema_spec_sha256: active.schema_spec_sha256,
        rendering_template_id: active.rendering_template_id,
        rendering_template_version: active.rendering_template_version,
        rendering_template_spec_sha256: active.rendering_template_spec_sha256,
        activated_at: at,
      });
      if (commandId) {
        await store.insertCommand({
          command_id: commandId,
          request_id: active.id,
          school_id: schoolId,
          action: "activate",
        });
      }
      return freezeRequest(active);
    });
  }

  async function getRequest({ actor, schoolId, requestId } = {}) {
    assertCanRead(actor, schoolId);
    return freezeRequest(await loadRequest(persistence, schoolId, requestId));
  }

  async function listRequests({ actor, schoolId } = {}) {
    assertCanRead(actor, schoolId);
    return (await persistence.listRequests(schoolId)).map(freezeRequest);
  }

  async function getActiveBinding({ actor, schoolId, modelKey } = {}) {
    assertCanRead(actor, schoolId);
    const key = requireModelKey(modelKey);
    const row = await persistence.getBinding(schoolId, key);
    if (!row) throw new ReportCardConfigurationError("REQUEST_NOT_FOUND");
    return clone(row);
  }

  async function listAudit({ actor, schoolId, requestId } = {}) {
    assertCanRead(actor, schoolId);
    await loadRequest(persistence, schoolId, requestId);
    return persistence.listAudit(schoolId, requestId);
  }

  async function getRenderingTemplateVersion({ actor, schoolId, templateId, version } = {}) {
    assertCanRead(actor, schoolId);
    const row = await persistence.getTemplateVersion(schoolId, templateId, version);
    if (!row) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
    return clone(row);
  }

  async function lookupRenderingTemplateSpec({ schoolId, templateId, version } = {}) {
    requireSchoolId(schoolId);
    if (templateId == null || templateId === "" || version == null) return null;
    const row = await persistence.getTemplateVersion(schoolId, templateId, Number(version));
    if (!row) return null;
    return { spec: clone(row.spec), spec_sha256: row.spec_sha256 };
  }

  function publicVersionRef(row, idKey) {
    if (!row) return null;
    return {
      id: row[idKey] || row.id,
      version: row.version,
      status: row.status,
      spec_sha256: row.spec_sha256,
    };
  }

  async function activeCatalogEntry(listFn, getActiveFn, keyName) {
    const listed = await Promise.resolve(listFn());
    const rows = [];
    for (const item of listed || []) {
      try {
        const active = await Promise.resolve(getActiveFn(item.id));
        rows.push({
          id: item.id,
          [keyName]: item[keyName],
          version: active.version,
          status: active.status,
          spec_sha256: active.spec_sha256,
        });
      } catch {
        // Versions DRAFT-only cannot be bound; omit from selectable catalog.
      }
    }
    return rows;
  }

  async function listCatalog({ actor, schoolId } = {}) {
    assertCanConfigure(actor, schoolId);
    const profiles = await activeCatalogEntry(
      () => profileStore.listProfiles(schoolId, schoolId),
      (profileId) => profileStore.getActive({ schoolId, actorSchoolId: schoolId, profileId }),
      "profile_key"
    );
    const schemas = await activeCatalogEntry(
      () => schemaStore.listSchemas(schoolId, schoolId),
      (schemaId) => schemaStore.getActive({ schoolId, actorSchoolId: schoolId, schemaId }),
      "schema_key"
    );
    return { profiles, schemas };
  }

  async function getBoundBundle({ actor, schoolId, requestId } = {}) {
    assertCanRead(actor, schoolId);
    const request = freezeRequest(await loadRequest(persistence, schoolId, requestId));
    let template = null;
    let profile = null;
    let schema = null;
    if (request.rendering_template_id != null && request.rendering_template_version != null) {
      template = await persistence.getTemplateVersion(
        schoolId,
        request.rendering_template_id,
        request.rendering_template_version
      );
      if (!template) throw new ReportCardConfigurationError("VERSION_NOT_FOUND");
    }
    if (request.profile_id != null && request.profile_version != null) {
      profile = publicVersionRef(
        await loadProfileVersion(schoolId, request.profile_id, request.profile_version),
        "profile_id"
      );
    }
    if (request.schema_id != null && request.schema_version != null) {
      schema = publicVersionRef(
        await loadSchemaVersion(schoolId, request.schema_id, request.schema_version),
        "schema_id"
      );
    }
    return {
      request,
      template: template ? clone(template) : null,
      profile,
      schema,
    };
  }

  async function updateRenderingTemplateSpec({ actor, schoolId, templateId, version, spec } = {}) {
    assertCanConfigure(actor, schoolId);
    let normalized;
    try {
      normalized = normalizeRenderingTemplate(spec);
    } catch (err) {
      throw wrapTemplateError(err);
    }
    const sha = specSha256(normalized);
    return persistence.updateDraftTemplateSpec(schoolId, templateId, version, normalized, sha);
  }

  return {
    submitModel,
    startReview,
    startConfiguring,
    resumeConfiguring,
    saveRenderingTemplate,
    bindBundle,
    markReadyForReview,
    requestChanges,
    approve,
    reject,
    activate,
    getRequest,
    listRequests,
    getActiveBinding,
    listAudit,
    getRenderingTemplateVersion,
    lookupRenderingTemplateSpec,
    updateRenderingTemplateSpec,
    listCatalog,
    getBoundBundle,
  };
}

module.exports = {
  createReportCardConfiguration,
  createInMemoryConfigurationPersistence,
  ReportCardConfigurationError,
};
