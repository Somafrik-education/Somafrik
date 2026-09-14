"use strict";

/**
 * LOT 7 — HTTP établissement / Superadmin / verify public.
 * Consomme LOT 6 (configuration) et LOT 4 (lookupPublic). Aucun mint, aucun recalcul.
 */

const { VERIFY_HEADERS } = require("../../contracts/reportCard/contract");

const PERM_CONFIGURE = "REPORT_CARD_CONFIGURE";
const PERM_APPROVE = "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE";
const PERM_READ = "REPORT_CARD_READ";
const PERM_REPRINT = "REPORT_CARD_REPRINT";
const PERM_CORRECT = "REPORT_CARD_CORRECT";
const PERM_REVOKE = "REPORT_CARD_REVOKE";
const VERIFICATION_ACTIVE = "ACTIVE";
const HISTORICAL_STATUSES = new Set(["ACTIVE", "SUPERSEDED", "REVOKED"]);

const HTTP_STATUS = Object.freeze({
  RBAC_DENIED: 403,
  PLATFORM_CONTEXT_REQUIRED: 403,
  TENANT_MISMATCH: 403,
  REQUEST_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  PUBLICATION_NOT_FOUND: 404,
  PDF_QR_SCOPE_MISMATCH: 403,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CONCURRENCY_CONFLICT: 409,
  REASON_REQUIRED: 400,
  FACTS_REQUIRED: 400,
});

function parseCapability(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([^.]+)\.(.+)$/);
  if (!match) return null;
  return { publicId: match[1], token: match[2] };
}

function applyVerifyHeaders(res) {
  res.setHeader("Cache-Control", VERIFY_HEADERS.cache_control);
  res.setHeader("Referrer-Policy", VERIFY_HEADERS.referrer_policy);
}

function hasPermission(actor, token) {
  return Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(token));
}

function requireToken(actor, token) {
  if (!hasPermission(actor, token)) throw coded("RBAC_DENIED");
}

function applyStudentScope(payload, actor) {
  if (!payload || typeof payload !== "object") return payload;
  if (!Array.isArray(actor.studentIds)) return payload;
  const allowed = new Set(actor.studentIds.map((id) => String(id)));
  const students = Array.isArray(payload.students)
    ? payload.students.filter((row) => {
        if (!row || typeof row !== "object") return false;
        const id = row.student_id != null ? row.student_id : row.studentId;
        return allowed.has(String(id));
      })
    : [];
  return { ...payload, students };
}

function assertScopedStudents(payload, actor) {
  if (!Array.isArray(actor.studentIds)) return payload;
  if (!payload || !Array.isArray(payload.students) || payload.students.length === 0) {
    throw coded("RBAC_DENIED");
  }
  return payload;
}

async function resolvePublishedTemplate(payload, schoolId, getTemplate) {
  const ref = payload && payload.provenance ? payload.provenance.template : null;
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return undefined;
  if (ref.id == null || ref.version == null) return undefined;
  if (typeof getTemplate !== "function") throw coded("VERSION_NOT_FOUND");
  const found = await Promise.resolve(
    getTemplate({
      tenant: { schoolId, actorSchoolId: schoolId },
      schoolId,
      templateId: ref.id,
      version: ref.version,
    })
  );
  if (!found) throw coded("VERSION_NOT_FOUND");
  const spec = found.spec != null ? found.spec : found;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw coded("VERSION_NOT_FOUND");
  if (ref.spec_sha256 && found.spec_sha256 && String(found.spec_sha256) !== String(ref.spec_sha256)) {
    throw coded("VERSION_NOT_FOUND");
  }
  return spec;
}

function assertPdfQrScopeSafe(unscopedPayload, actor) {
  if (!Array.isArray(actor.studentIds)) return;
  const allowed = new Set(actor.studentIds.map((id) => String(id)));
  const students = Array.isArray(unscopedPayload && unscopedPayload.students)
    ? unscopedPayload.students
    : [];
  const extras = students.filter((row) => {
    if (!row || typeof row !== "object") return true;
    const id = row.student_id != null ? row.student_id : row.studentId;
    return !allowed.has(String(id));
  });
  if (extras.length > 0) throw coded("PDF_QR_SCOPE_MISMATCH");
}

async function consultPublishedSnapshot({
  publication,
  actor,
  schoolId,
  reportCardId,
  version,
  getTemplate,
  requireActive = true,
} = {}) {
  if (!publication || typeof publication.lookup !== "function" || typeof publication.payloadForRender !== "function") {
    throw coded("REQUEST_NOT_FOUND");
  }
  const tenant = { schoolId, actorSchoolId: actor.actorSchoolId };
  const record = await Promise.resolve(publication.lookup({ tenant, reportCardId, version }));
  if (!record) throw coded("PUBLICATION_NOT_FOUND");
  if (requireActive && record.verification_status !== VERIFICATION_ACTIVE) {
    throw coded("PUBLICATION_NOT_FOUND");
  }
  if (!requireActive && !HISTORICAL_STATUSES.has(record.verification_status)) {
    throw coded("PUBLICATION_NOT_FOUND");
  }
  const unscopedPayload = await Promise.resolve(
    publication.payloadForRender({ tenant, reportCardId, version })
  );
  const payload = assertScopedStudents(applyStudentScope(unscopedPayload, actor), actor);
  const template = await resolvePublishedTemplate(payload, schoolId, getTemplate);
  return { payload, unscopedPayload, template, tenant, record };
}

function isPrivileged(actor) {
  return actor?.platform?.privileged === true;
}

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function requireActor(actor) {
  if (!actor) throw coded("RBAC_DENIED");
  return actor;
}

function schoolIdForSchoolActor(actor) {
  requireActor(actor);
  if (actor.actorSchoolId == null || actor.actorSchoolId === "") {
    throw coded("TENANT_REQUIRED");
  }
  return actor.actorSchoolId;
}

function schoolIdForAdmin(actor, requested) {
  requireActor(actor);
  if (!hasPermission(actor, PERM_CONFIGURE)) throw coded("RBAC_DENIED");
  if (!isPrivileged(actor)) throw coded("PLATFORM_CONTEXT_REQUIRED");
  if (requested == null || requested === "") throw coded("TENANT_REQUIRED");
  return requested;
}

function mapError(err) {
  if (err && (err.name === "IdempotencyConflict" || err.code === "IDEMPOTENCY_CONFLICT")) {
    return {
      status: HTTP_STATUS.IDEMPOTENCY_CONFLICT,
      body: { ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } },
    };
  }
  const code = err && err.code ? err.code : "INVALID_INPUT";
  return {
    status: HTTP_STATUS[code] || 400,
    body: { ok: false, error: { code } },
  };
}

function decorate(actor, request) {
  if (!request) return request;
  const privileged = isPrivileged(actor) && hasPermission(actor, PERM_CONFIGURE);
  const canApprove =
    hasPermission(actor, PERM_APPROVE) && actor.actorSchoolId === request.school_id;
  return {
    ...request,
    actions: {
      approve: Boolean(canApprove && request.status === "READY_FOR_REVIEW"),
      request_changes: Boolean(canApprove && request.status === "READY_FOR_REVIEW"),
      review: Boolean(privileged && request.status === "SUBMITTED"),
      configure: Boolean(
        privileged && (request.status === "UNDER_REVIEW" || request.status === "CHANGES_REQUESTED")
      ),
      save_template: Boolean(privileged && request.status === "CONFIGURING"),
      bind_bundle: Boolean(privileged && request.status === "CONFIGURING"),
      ready: Boolean(privileged && request.status === "CONFIGURING"),
      reject: Boolean(
        privileged &&
          ["SUBMITTED", "UNDER_REVIEW", "CONFIGURING", "READY_FOR_REVIEW", "CHANGES_REQUESTED"].includes(
            request.status
          )
      ),
      activate: Boolean(privileged && request.status === "APPROVED"),
    },
  };
}

function requestedSchoolId(req) {
  return req.body?.schoolId || req.query?.schoolId || req.query?.school_id || null;
}

async function handleVerify(req, res, { publication, logger }) {
  applyVerifyHeaders(res);
  const raw =
    typeof req.body?.capability === "string"
      ? req.body.capability
      : req.body?.publicId != null && req.body?.token != null
        ? `${req.body.publicId}.${req.body.token}`
        : "";
  const parsed = parseCapability(raw);
  if (!parsed || !publication || typeof publication.lookupPublic !== "function") {
    return res.status(404).json({ ok: false, reason: "not_found" });
  }
  if (logger && typeof logger.info === "function") {
    logger.info(`verify public_id=${parsed.publicId}`);
  }
  try {
    const result = await Promise.resolve(publication.lookupPublic(parsed));
    if (!result || result.ok !== true) {
      if (!result || result.reason === "not_found") {
        return res.status(404).json({ ok: false, reason: "not_found" });
      }
      return res.status(409).json({ ok: false, reason: result.reason || "not_verifiable" });
    }
    const rawStatus = result.verification_status;
    const verification_status =
      rawStatus === "SUPERSEDED"
        ? "superseded"
        : rawStatus === "REVOKED"
          ? "revoked"
          : rawStatus === "ACTIVE" || !rawStatus
            ? "authentic"
            : null;
    if (!verification_status) {
      return res.status(409).json({ ok: false, reason: "not_verifiable" });
    }
    return res.status(200).json({
      ok: true,
      payload: result.payload,
      verification_status,
    });
  } catch (err) {
    return res.status(409).json({ ok: false, reason: err.code || "not_verifiable" });
  }
}

function registerReportCardHttp(app, deps = {}) {
  const resolveActor = typeof deps.resolveActor === "function" ? deps.resolveActor : () => null;
  const resolveSchoolId =
    typeof deps.resolveSchoolId === "function" ? deps.resolveSchoolId : async (value) => value;
  const logger = deps.logger;
  const auth = typeof deps.internalAuth === "function" ? deps.internalAuth : (_req, _res, next) => next();

  let cachedCorrection = null;
  let cachedCorrectionPublication = null;

  function services() {
    const publication = deps.publication || (typeof deps.getPublication === "function" ? deps.getPublication() : null);
    return {
      configuration: deps.configuration || (typeof deps.getConfiguration === "function" ? deps.getConfiguration() : null),
      publication,
      pdf: deps.pdf || (typeof deps.getPdf === "function" ? deps.getPdf() : null),
      getTemplate: typeof deps.getTemplate === "function" ? deps.getTemplate : null,
      correction:
        deps.correction ||
        (typeof deps.getCorrection === "function" ? deps.getCorrection() : null) ||
        (publication ? getOrCreateCorrection(publication) : null),
    };
  }

  function getOrCreateCorrection(publication) {
    if (cachedCorrection && cachedCorrectionPublication === publication) return cachedCorrection;
    const { createReportCardCorrection } = require("./reportCardCorrection");
    cachedCorrection = createReportCardCorrection({
      publication,
      getFacts: typeof deps.getFacts === "function" ? deps.getFacts : null,
      getProfile: typeof deps.getProfile === "function" ? deps.getProfile : null,
      getSchema: typeof deps.getSchema === "function" ? deps.getSchema : null,
    });
    cachedCorrectionPublication = publication;
    return cachedCorrection;
  }

  function route(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        const mapped = mapError(err);
        res.status(mapped.status).json(mapped.body);
      }
    };
  }

  async function actorFrom(req) {
    return requireActor(await Promise.resolve(resolveActor(req)));
  }

  async function adminSchoolId(actor, req) {
    const requested = requestedSchoolId(req);
    schoolIdForAdmin(actor, requested);
    const resolved = await Promise.resolve(resolveSchoolId(requested));
    if (resolved == null || resolved === "") throw coded("TENANT_REQUIRED");
    return resolved;
  }

  app.post("/api/public/report-cards/verify", (req, res) => {
    const { publication } = services();
    return handleVerify(req, res, { publication, logger });
  });

  app.get(
    "/api/report-card/requests",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const requests = await configuration.listRequests({ actor, schoolId });
      res.json({ ok: true, requests: requests.map((row) => decorate(actor, row)) });
    })
  );

  app.post(
    "/api/report-card/requests",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const request = await configuration.submitModel({
        actor,
        schoolId,
        modelKey: req.body?.modelKey,
        description: req.body?.description,
      });
      res.status(201).json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.get(
    "/api/report-card/requests/:requestId",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const request = await configuration.getRequest({ actor, schoolId, requestId: req.params.requestId });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/requests/:requestId/approve",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const request = await configuration.approve({ actor, schoolId, requestId: req.params.requestId });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/requests/:requestId/request-changes",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const request = await configuration.requestChanges({
        actor,
        schoolId,
        requestId: req.params.requestId,
        comment: req.body?.comment,
      });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.get(
    "/api/report-card/requests/:requestId/audit",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const audit = await configuration.listAudit({ actor, schoolId, requestId: req.params.requestId });
      res.json({ ok: true, audit });
    })
  );

  app.get(
    "/api/report-card/bindings/:modelKey",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const binding = await configuration.getActiveBinding({
        actor,
        schoolId,
        modelKey: req.params.modelKey,
      });
      res.json({ ok: true, binding });
    })
  );

  app.get(
    "/api/report-card/requests/:requestId/bundle",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      const { configuration } = services();
      const bundle = await configuration.getBoundBundle({
        actor,
        schoolId,
        requestId: req.params.requestId,
      });
      res.json({ ok: true, ...bundle, request: decorate(actor, bundle.request) });
    })
  );

  app.get(
    "/api/report-card/publications",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_READ);
      const { publication } = services();
      if (!publication || typeof publication.listCurrent !== "function") {
        throw coded("REQUEST_NOT_FOUND");
      }
      const tenant = { schoolId, actorSchoolId: actor.actorSchoolId };
      const rows = await Promise.resolve(publication.listCurrent({ tenant }));
      const publications = [];
      for (const row of rows || []) {
        if (!Array.isArray(actor.studentIds)) {
          publications.push(row);
          continue;
        }
        try {
          const payload = applyStudentScope(
            await Promise.resolve(
              publication.payloadForRender({
                tenant,
                reportCardId: row.report_card_id,
                version: row.published_snapshot_version,
              })
            ),
            actor
          );
          if (payload && Array.isArray(payload.students) && payload.students.length > 0) {
            publications.push(row);
          }
        } catch {
          // Skip rows the scoped actor cannot consult.
        }
      }
      res.json({ ok: true, publications });
    })
  );

  app.get(
    "/api/report-card/publications/:reportCardId/pdf",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_REPRINT);
      const { pdf, publication, getTemplate } = services();
      if (!pdf || typeof pdf.render !== "function") {
        throw coded("REQUEST_NOT_FOUND");
      }
      const version = Number(req.query.version);
      const { payload, unscopedPayload, template, tenant } = await consultPublishedSnapshot({
        publication,
        actor,
        schoolId,
        reportCardId: req.params.reportCardId,
        version,
        getTemplate,
        requireActive: false,
      });
      assertPdfQrScopeSafe(unscopedPayload, actor);
      const rendered = await pdf.render({
        tenant,
        reportCardId: req.params.reportCardId,
        version,
        renderingTemplate: template,
        payload,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.send(rendered.pdf);
    })
  );

  app.get(
    "/api/report-card/publications/:reportCardId/snapshot",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_READ);
      const { publication, getTemplate } = services();
      const version = Number(req.query.version);
      const { payload, template } = await consultPublishedSnapshot({
        publication,
        actor,
        schoolId,
        reportCardId: req.params.reportCardId,
        version,
        getTemplate,
      });
      res.json({ ok: true, payload, template });
    })
  );

  app.get(
    "/api/report-card/publications/:reportCardId/history",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_READ);
      const { publication } = services();
      if (!publication || typeof publication.listHistory !== "function") {
        throw coded("REQUEST_NOT_FOUND");
      }
      const tenant = { schoolId, actorSchoolId: actor.actorSchoolId };
      const rows = await Promise.resolve(
        publication.listHistory({ tenant, reportCardId: req.params.reportCardId })
      );
      const versions = [];
      for (const row of rows || []) {
        if (!Array.isArray(actor.studentIds)) {
          versions.push(row);
          continue;
        }
        try {
          const payload = applyStudentScope(
            await Promise.resolve(
              publication.payloadForRender({
                tenant,
                reportCardId: row.report_card_id,
                version: row.published_snapshot_version,
              })
            ),
            actor
          );
          if (payload && Array.isArray(payload.students) && payload.students.length > 0) {
            versions.push(row);
          }
        } catch {
          // Skip versions the scoped actor cannot consult.
        }
      }
      if (!Array.isArray(actor.studentIds) && versions.length === 0) {
        throw coded("PUBLICATION_NOT_FOUND");
      }
      res.json({ ok: true, versions });
    })
  );

  app.get(
    "/api/report-card/publications/:reportCardId/versions/:version",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_READ);
      const { publication, getTemplate } = services();
      const version = Number(req.params.version);
      const { payload, template } = await consultPublishedSnapshot({
        publication,
        actor,
        schoolId,
        reportCardId: req.params.reportCardId,
        version,
        getTemplate,
        requireActive: false,
      });
      res.json({ ok: true, payload, template });
    })
  );

  app.post(
    "/api/report-card/publications/:reportCardId/corrections",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_CORRECT);
      const { correction } = services();
      if (!correction || typeof correction.correct !== "function") {
        throw coded("REQUEST_NOT_FOUND");
      }
      const publication = await correction.correct({
        tenant: { schoolId, actorSchoolId: actor.actorSchoolId },
        actor,
        reportCardId: req.params.reportCardId,
        sourceVersion: req.body?.sourceVersion,
        reason: req.body?.reason,
        commandId: req.body?.commandId,
      });
      res.status(201).json({ ok: true, publication });
    })
  );

  app.post(
    "/api/report-card/publications/:reportCardId/versions/:version/revoke",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = schoolIdForSchoolActor(actor);
      requireToken(actor, PERM_REVOKE);
      const { publication } = services();
      if (!publication || typeof publication.revoke !== "function") {
        throw coded("REQUEST_NOT_FOUND");
      }
      const revoked = await Promise.resolve(
        publication.revoke({
          tenant: { schoolId, actorSchoolId: actor.actorSchoolId },
          reportCardId: req.params.reportCardId,
          version: Number(req.params.version),
          reason: req.body?.reason,
          actorId: actor.actorId,
        })
      );
      res.json({ ok: true, publication: revoked });
    })
  );

  app.get(
    "/api/report-card/admin/queue",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      let requests = await configuration.listRequests({ actor, schoolId });
      const state = req.query?.state;
      if (state) requests = requests.filter((row) => row.status === state);
      res.json({ ok: true, requests: requests.map((row) => decorate(actor, row)) });
    })
  );

  app.get(
    "/api/report-card/admin/requests/:requestId",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.getRequest({ actor, schoolId, requestId: req.params.requestId });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.get(
    "/api/report-card/admin/catalog",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const catalog = await configuration.listCatalog({ actor, schoolId });
      res.json({ ok: true, ...catalog });
    })
  );

  app.get(
    "/api/report-card/admin/requests/:requestId/bundle",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const bundle = await configuration.getBoundBundle({
        actor,
        schoolId,
        requestId: req.params.requestId,
      });
      res.json({ ok: true, ...bundle, request: decorate(actor, bundle.request) });
    })
  );

  app.get(
    "/api/report-card/admin/bindings/:modelKey",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const binding = await configuration.getActiveBinding({
        actor,
        schoolId,
        modelKey: req.params.modelKey,
      });
      res.json({ ok: true, binding });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/review",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.startReview({ actor, schoolId, requestId: req.params.requestId });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/configure",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.startConfiguring({ actor, schoolId, requestId: req.params.requestId });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/save-template",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const template = await configuration.saveRenderingTemplate({
        actor,
        schoolId,
        requestId: req.params.requestId,
        spec: req.body?.spec,
      });
      res.json({ ok: true, template });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/bind-bundle",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.bindBundle({
        actor,
        schoolId,
        requestId: req.params.requestId,
        profile: req.body?.profile,
        schema: req.body?.schema,
        template: req.body?.template,
      });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/ready-for-review",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.markReadyForReview({
        actor,
        schoolId,
        requestId: req.params.requestId,
      });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/reject",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.reject({
        actor,
        schoolId,
        requestId: req.params.requestId,
        reason: req.body?.reason,
      });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );

  app.post(
    "/api/report-card/admin/requests/:requestId/activate",
    auth,
    route(async (req, res) => {
      const actor = await actorFrom(req);
      const schoolId = await adminSchoolId(actor, req);
      const { configuration } = services();
      const request = await configuration.activate({
        actor,
        schoolId,
        requestId: req.params.requestId,
        commandId: req.body?.commandId,
      });
      res.json({ ok: true, request: decorate(actor, request) });
    })
  );
}

module.exports = {
  registerReportCardHttp,
  parseCapability,
};
