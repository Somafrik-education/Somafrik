const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), override: true });
require("dotenv").config();
const { AuthService, BusinessError } = require("./services/authService");
const { BackOfficeAccessService } = require("./services/backOfficeAccessService");
const { hashSecret } = require("./services/credentialService");
const {
  validatePasswordPolicy,
  validateAccountSecret,
  validateIntroducedAccountSecrets,
  validateIntroducedCivilIdentityConflicts,
} = require("./lib/userAccountRules");
const { GradeBookService } = require("./services/gradeBookService");
const { toPublicSchool } = require("./lib/publicSchool");
const { MvpBusinessService } = require("./services/mvpBusinessService");
const { ReportPdfService } = require("./services/reportPdfService");
const { createPostgresRepository, initializeRepository } = require("./db/repositoryFactory");
const {
  assertDatabaseConfiguration,
  sanitizeDbErrorMessage,
  DbConfigError,
} = require("./db/connectionConfig");
const { TokenService } = require("./services/tokenService");
const { RbacService, PERMISSION_DENIED } = require("./services/rbacService");
const { isFinanceLiveRbacRouteKey } = require("./lib/financeRbacRouteMatrix");
const { mergeRolePermissions, normalizeBusinessPermission } = require("./lib/rolePermissionsResolution");
const { PaginationService } = require("./services/paginationService");
const { CacheService } = require("./services/cacheService");
const { TenantScopeService } = require("./services/tenantScopeService");
const { RoleGovernanceService } = require("./services/roleGovernanceService");
const { PedagogyGovernanceService } = require("./services/pedagogyGovernanceService");
const { AuditService } = require("./services/auditService");
const { auditMetaFromRequest } = require("./lib/teacherTransactionalAudit");
const { mergeAcademicConfigs } = require("./lib/bulletinDesignAccess");
const { resolveParentChildren } = require("./lib/parentChildren");
const { classNamesMatch, normalizePresenceDay } = require("./lib/dataIntegrityRules");
const { getCountryCodeFromScope, schoolMatchesCountryScope } = require("./lib/countryScope");
const { buildDesignPreviewReport } = require("./lib/bulletinDesignPreview");
const { applyBulletinDesignToReport } = require("./lib/bulletinDesignResolver");
const { renderReportCardPdf, renderReportCardPreviewHtml } = require("./services/bulletinPdfRenderer");
const { dedupeBackOfficeState } = require("./lib/backofficeDedupe");
const {
  detectIntroducedConflicts,
  changedScheduleIds,
} = require("./lib/planningConflicts");
const { repairOrphanSchools } = require("./lib/repairOrphanSchools");
const { ensureSubscriptionModuleState } = require("./services/subscriptionModuleService");
const { EstablishmentService } = require("./services/establishmentService");
const { UnpaidService } = require("./services/unpaidService");
const { IdempotencyService, withIdempotency } = require("./services/idempotencyService");
const internalNotificationsService = require("./lib/communicationsNotificationsService");
const {
  startCommunicationsNotificationsWorker,
  stopCommunicationsNotificationsWorker,
} = require("./lib/communicationsNotificationsWorker");
const schoolSubscriptionAccessService = require("./services/schoolSubscriptionAccessService");
const {
  assertProductionSecrets,
  warnIfUnsafeDevelopmentSecrets,
} = require("./lib/productionSecrets");
const { assertProductionCors, buildCorsOptions } = require("./lib/corsConfig");
const {
  sanitizeUserForResponse,
  sanitizeUsersForResponse,
  sanitizeCredentialBearingStateForResponse,
  sanitizeAuthPayloadForResponse,
  stripSensitiveFieldsDeep,
} = require("./lib/sanitizeUserForResponse");
const {
  evaluateBackOfficeWriteAccess,
  getEditableEntitiesForPrincipalRole,
} = require("./lib/backOfficeWritableEntities");
const {
  canAccessMvpRoutes,
  scopeMvpDatasetForPrincipal,
} = require("./lib/mvpAccess");
const { assertProductionSecurityConfiguration } = require("./lib/demoSeedPolicy");
const { createRateLimiter, loginRateLimitKey } = require("./lib/rateLimit");
const {
  assertPushSelfTestAllowed,
  skipPushSelfTestPermissionCheck,
} = require("./lib/mobilePushDevicesService");
const { startExpoPushReceiptsWorker } = require("./lib/expoPushReceiptsWorker");
const {
  isTeacherNotesPrincipal,
  evaluateTeacherNotesTouchedKeys,
  prepareTeacherNotesWritePayload,
  teacherHasNotesWritePermission,
} = require("./lib/teacherNotesWriteAccess");

const establishmentService = new EstablishmentService();
const unpaidService = new UnpaidService();

const app = express();

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

const loginRateLimiter = createRateLimiter({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60_000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 15),
  keyFn: loginRateLimitKey,
  message: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
});
const pushSelfTestRateLimiter = createRateLimiter({
  windowMs: Number(process.env.SOMAFRIK_PUSH_SELFTEST_WINDOW_MS ?? 60_000),
  max: Number(process.env.SOMAFRIK_PUSH_SELFTEST_RATE_MAX ?? 5),
  keyFn: (req) => `push-selftest:${String(req.principal?.sub || req.ip || "unknown")}`,
  message: "Trop de tests push. Réessayez dans une minute.",
});
function requirePushSelfTestEnvironment(_req, _res, next) {
  try {
    assertPushSelfTestAllowed();
    next();
  } catch (error) {
    next(error instanceof BusinessError ? error : new BusinessError(403, error.message));
  }
}
function requirePushSelfTestActor(req, res, next) {
  try {
    if (skipPushSelfTestPermissionCheck()) return next();
    return requirePermission("POST /api/mobile/push-devices/test")(req, res, next);
  } catch (error) {
    next(error instanceof BusinessError ? error : new BusinessError(403, error.message));
  }
}
let repository = createPostgresRepository();
const tokenService = new TokenService();
const rbacService = new RbacService();
const paginationService = new PaginationService();
const cacheService = new CacheService();
const tenantScopeService = new TenantScopeService();
const roleGovernanceService = new RoleGovernanceService();
const pedagogyGovernanceService = new PedagogyGovernanceService();
let auditService = new AuditService(repository);
let idempotencyService = new IdempotencyService(repository);
app.locals.idempotencyService = idempotencyService;

app.disable("x-powered-by");
app.use(appSecurityHeaders);
app.use(cors(buildCorsOptions({ BusinessError })));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "1mb" }));
app.use((error, req, res, next) => {
  if (
    error instanceof SyntaxError &&
    error.status === 400 &&
    req.method === "PUT" &&
    String(req.path ?? "").endsWith("/backoffice/state")
  ) {
    const {
      BACKOFFICE_STATE_WRITE_REMOVED_CODE,
      BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
      BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
    } = require("./lib/backofficeStateRemoval");
    return res.status(BACKOFFICE_STATE_WRITE_REMOVED_STATUS).json({
      code: BACKOFFICE_STATE_WRITE_REMOVED_CODE,
      message: BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
    });
  }
  return next(error);
});
// S2.1 — JWT uniquement via Authorization: Bearer (jamais ?token= / ?access_token=).
app.use("/api", rejectJwtInQueryString);
app.use(
  "/backoffice",
  express.static(path.join(__dirname, "..", "BackOffice"), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  }),
);

const webDistPath = process.env.WEB_DIST_PATH || path.join(__dirname, "..", "web", "dist");
const apiOnly = process.env.SOMAFRIK_API_ONLY === "true";

function sendWebAppShell(res, next) {
  const indexPath = path.join(webDistPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    return res.status(503).json({
      message:
        "Application web indisponible. Reconstruisez le backend Docker ou exécutez « npm run build » dans le dossier web.",
      webDistPath,
    });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(indexPath, (error) => {
    if (error) next(error);
  });
}

if (!apiOnly) {
app.get(/^\/web$/, (_req, res) => {
  res.redirect(302, "/web/");
});

app.get("/web/", (req, res, next) => {
  sendWebAppShell(res, next);
});

app.use(
  "/web",
  express.static(webDistPath, {
    fallthrough: true,
    redirect: false,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      } else if (/\.(js|css|woff2?|png|jpg|jpeg|gif|svg|ico)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

// SPA fallback: routes clientes /web/* (hors fichiers statiques) renvoient l'app React.
app.get(/^\/web(\/.*)?$/, (req, res, next) => {
  if (req.method !== "GET" || req.path.includes(".") || req.path === "/web/") {
    return next();
  }
  sendWebAppShell(res, next);
});
}

app.get("/", asyncHandler(async (req, res) => {
  if (!apiOnly && req.accepts("html")) {
    return res.redirect(302, "/web/");
  }

  const webEndpoints = apiOnly
    ? []
    : ["/web/", "/web/connexion", "/web/tableau-de-bord"];

  res.json({
    name: "Somafrik API",
    status: "ok",
    database: repository.engine ?? "postgresql",
    mode: apiOnly ? "api-only" : "integrated",
    endpoints: [
      "/api/health",
      "/api/schools/:code",
      "/api/identify",
      "/api/login",
      "/api/auth/refresh",
      "/api/auth/logout",
      "/api/auth/revoke-all",
      "/api/backoffice/login",
      "/api/classes",
      "/api/classes/:classCode/students",
      "/api/courses",
      "/api/academic-config",
      "/api/assignments",
      "/api/mobile-sync/l1/classes",
      "/api/mobile-sync/l1/students",
      "/api/mobile-sync/l1/assignments",
      "/api/students",
      "/api/students/:id",
      "/api/teachers",
      "/api/teachers/:teacherCode",
      "PATCH /api/teachers/:teacherCode",
      "DELETE /api/teachers/:teacherCode",
      "PATCH /api/students/:id",
      "/api/students/:id/notes",
      "/api/notes",
      "/api/presences",
      "/api/students/:id/report",
      "/api/students/:id/report.pdf",
      "/api/students/:id/presences",
      "/api/presences",
      "/api/students/:id/payments",
      "/api/teachers",
      "/api/payments",
      "/api/backoffice/countries",
      "/api/backoffice/subscriptions",
      "/api/backoffice/notifications",
      "/api/audit",
      "/api/data-export",
      "/api/mvp/readiness",
      "/api/mvp/snapshot",
      "/api/mvp/dashboard",
      "/api/v2/subjects",
      "/api/v2/academic-years",
      "/api/v2/exams",
      "/api/v2/documents",
      "/api/v2/reports/advanced",
      ...webEndpoints,
    ],
  });
}));

app.get("/api/health", asyncHandler(async (_req, res) => {
  await repository.init();
  const { probeCommunicationStorageWritable } = require("./lib/communicationsAttachments");
  const attachments = await probeCommunicationStorageWritable();
  const payload = {
    status: attachments.ready ? "ok" : "not_ready",
    database: repository.engine ?? "postgresql",
    version: process.env.npm_package_version ?? "1.0.0",
    timestamp: new Date().toISOString(),
    attachments,
  };
  if (!attachments.ready) {
    return res.status(503).json(payload);
  }
  res.json(payload);
}));

app.post(
  "/api/backoffice/e2e/clear-login-lockout",
  asyncHandler(async (_req, res) => {
    const { isE2eLoginLockoutEndpointEnabled, clearAllFailedLoginAttempts } = require("./lib/loginLockout");
    if (!isE2eLoginLockoutEndpointEnabled()) {
      return res.status(404).json({ message: "Not found" });
    }
    await clearAllFailedLoginAttempts();
    res.json({ ok: true, message: "Verrous de connexion E2E réinitialisés." });
  }),
);

// Audit causalité Pré-E1 — exposé uniquement si SOMAFRIK_AUTHZ_TRACE=1 (≠ validation CTO).
if (String(process.env.SOMAFRIK_AUTHZ_TRACE || "").trim() === "1") {
  app.get(
    "/api/debug/notes-authz-trace",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (
        !["Super Administrateur Somafrik", "Admin School", "Enseignant"].includes(
          req.principal?.role,
        )
      ) {
        throw new BusinessError(403, "Accès debug refusé.");
      }
      res.json({
        kind: "NOTES_AUTHZ_CAUSALITY_LAST",
        notACtoValidation: true,
        trace: repository.lastNotesAuthzTrace ?? null,
      });
    }),
  );
}


app.get("/api/schools/:code", asyncHandler(async (req, res) => {
  const { platformSchools } = await getRuntime();
  const { matchesSchoolLookup } = require("./lib/schoolCodeV2");
  const requestedCode = req.params.code.toUpperCase();
  // Lecture : login_code V2 canonique, plus alias interne school_code (legacy, lecture seule).
  const foundSchool = platformSchools.find((item) => matchesSchoolLookup(item, requestedCode));

  if (!foundSchool) {
    return res.status(404).json({ message: "Code etablissement invalide" });
  }

  res.json(toPublicSchool(foundSchool));
}));

app.post("/api/backoffice/login", loginRateLimiter, asyncHandler(async (req, res) => {
  const { backOfficeAccessService } = await getRuntime();
  const response = await handleBusinessAction(() => backOfficeAccessService.login(req.body));
  if (response?.role === "parent_student" || response?.user?.role === "Parent") {
    const state = await getAuthoritativeBackOfficeState();
    const schoolCode =
      response.schoolContext?.code ??
      response.schoolContext?.schoolCode ??
      response.user?.schoolCode ??
      req.body?.schoolCode;
    const children = sanitizeUsersForResponse(resolveParentChildren(response.user, state, schoolCode));
    response.user = { ...response.user, children };
  }
  // HOTFIX-PRE-E1-02 : enrichir la session enseignant avec affectations BO (IDs stables),
  // sans élargir les droits — affectations explicitement actives uniquement (fail-closed).
  if (response?.role === "teacher" || response?.user?.role === "Enseignant") {
    const state = await getAuthoritativeBackOfficeState();
    const { enrichTeacherUserWithActiveAssignments } = require("./lib/teacherSessionAssignments");
    response.user = enrichTeacherUserWithActiveAssignments(response.user, state);
  }
  await sendAuthenticatedResponse(req, res, response, "backoffice_login");
}));

app.post("/api/identify", loginRateLimiter, asyncHandler(async (req, res) => {
  const { authService } = await getRuntime();
  handleBusinessResponse(res, () => authService.identify(req.body));
}));

app.post("/api/login", loginRateLimiter, asyncHandler(async (req, res) => {
  const { authService } = await getRuntime();
  const response = await handleBusinessAction(() => authService.login(req.body));
  if (response?.role === "parent_student" || response?.user?.role === "Parent") {
    const state = await getAuthoritativeBackOfficeState();
    const schoolCode =
      response.school?.code ??
      response.schoolContext?.code ??
      response.user?.schoolCode ??
      req.body?.schoolCode;
    if (schoolCode && !response.user.schoolCode) {
      response.user = { ...response.user, schoolCode };
    }
    const children = sanitizeUsersForResponse(resolveParentChildren(response.user, state, schoolCode));
    response.user = { ...response.user, children };
  }
  await sendAuthenticatedResponse(req, res, response, "mobile_login");
}));

app.post("/api/auth/refresh", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body ?? {};
  const { rotateRefreshSession } = require("./lib/sessionRefreshService");
  const rotated = await rotateRefreshSession({
    repository,
    tokenService,
    refreshToken,
  });
  const { permissions, accessToken } = await issueRefreshedAccessToken(rotated.session, rotated.payload);
  res.json({
    accessToken,
    refreshToken: rotated.refreshToken,
    tokenType: "Bearer",
    expiresIn: tokenService.accessTokenTtlSeconds,
    permissions,
  });
}));

app.get("/api/auth/effective-permissions", requireAuth, asyncHandler(async (req, res) => {
  if (typeof repository.resolveEffectivePermissions === "function") {
    const live = await repository.resolveEffectivePermissions(req.principal);
    return res.json({
      permissions: live.permissions,
      modules: live.modules,
      roleKeys: live.roleKeys,
      source: live.source,
      resolvedAt: live.resolvedAt,
    });
  }
  const rolePermissionsMap = await getRolePermissionsMap();
  const permissions = mergeRolePermissions(req.principal.role, [], rolePermissionsMap);
  res.json({ permissions });
}));

app.post("/api/auth/logout", requireAuth, asyncHandler(async (req, res) => {
  await repository.revokeSession(req.principal.sessionId, "logout");
  await auditService.record(req, "logout", "session", req.principal.sessionId);
  res.json({ message: "Déconnexion sécurisée effectuée" });
}));

app.post("/api/auth/revoke-all", requireAuth, asyncHandler(async (req, res) => {
  const revoked = await repository.revokeAllSessionsForUser(req.principal.sub, "revoke_all");
  await auditService.record(req, "revoke_all_sessions", "user", req.principal.sub, { revoked });
  res.json({ message: "Toutes les sessions ont été révoquées.", revoked });
}));

app.post("/api/privacy/erasure-requests", loginRateLimiter, asyncHandler(async (req, res) => {
  const { createErasureRequest } = require("./lib/privacyErasure");
  let principal = null;
  const header = req.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) {
    try {
      principal = tokenService.verify(match[1], "access");
    } catch {
      principal = null;
    }
  }
  const created = await createErasureRequest(repository, req.body ?? {}, principal);
  await repository.recordAudit({
    schoolCode: created.schoolCode,
    userId: principal?.sub,
    action: "privacy_erasure_request",
    entityType: "privacy_request",
    entityId: created.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    newValue: { requestCode: created.requestCode, status: created.status },
  });
  res.status(201).json(created);
}));

app.get("/api/privacy/erasure-requests", requireAuth, requirePermission("GET /api/privacy/erasure-requests"), asyncHandler(async (req, res) => {
  const { sanitizePrivacyRequest } = require("./lib/privacyErasure");
  const schoolCode = String(req.principal.schoolCode ?? "").trim().toUpperCase();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(403, "Périmètre établissement insuffisant.");
  }
  const rows = await repository.listPrivacyRequests({ schoolCode });
  res.json(rows.map(sanitizePrivacyRequest));
}));

app.post("/api/privacy/erasure-requests/self/execute", requireAuth, asyncHandler(async (req, res) => {
  const { executeSelfErasure } = require("./lib/privacyErasure");
  const result = await executeSelfErasure(repository, req.principal);
  res.json(result);
}));

app.post("/api/privacy/erasure-requests/:requestId/execute", requireAuth, requirePermission("POST /api/privacy/erasure-requests/:requestId/execute"), asyncHandler(async (req, res) => {
  const { executeErasureRequest } = require("./lib/privacyErasure");
  const result = await executeErasureRequest(repository, req.params.requestId, req.principal);
  res.json(result);
}));

app.post("/api/mobile/push-devices", requireAuth, asyncHandler(async (req, res) => {
  const device = await repository.upsertMobilePushDevice(req.principal, req.body || {});
  await auditService.record(req, "mobile_push_device_upsert", "push_device", device.id, {
    platform: device.platform,
    backendEnvironment: device.backendEnvironment,
    appProfile: device.appProfile,
  });
  res.json(device);
}));

app.delete("/api/mobile/push-devices/current", requireAuth, asyncHandler(async (req, res) => {
  const result = await repository.revokeCurrentMobilePushDevice(req.principal, req.body || {});
  await auditService.record(req, "mobile_push_device_revoke", "push_device", result.id, {
    revoked: result.revoked,
  });
  res.json(result);
}));

app.post(
  "/api/mobile/push-devices/test",
  requireAuth,
  requirePushSelfTestEnvironment,
  requirePushSelfTestActor,
  pushSelfTestRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await repository.sendMobilePushSelfTest(req.principal, req.body || {});
    await auditService.record(req, "mobile_push_self_test", "push_device", req.principal.sub, {
      sent: result.sent,
      revoked: result.revoked,
    });
    res.json(result);
  }),
);

app.post("/api/auth/change-password", requireAuth, asyncHandler(async (req, res) => {
  const newPassword = String(req.body?.newPassword ?? "").trim();
  const passwordError = validateAccountSecret(newPassword);
  if (passwordError) {
    throw new BusinessError(400, passwordError);
  }

  const lookupKeys = await resolveUserPasswordLookupKeys(req.principal);
  if (!lookupKeys.length) {
    throw new BusinessError(404, "Utilisateur introuvable");
  }

  const updatedUser = await repository.changeUserPassword(lookupKeys, newPassword);
  await auditService.record(req, "change_own_password", "user", req.principal.sub, {
    oldTemporaryPasswordInvalidated: true,
  });
  const sanitizedUpdatedUser = sanitizeUserForResponse(updatedUser);
  let safeUser = {
    ...sanitizedUpdatedUser,
    schoolCode: sanitizedUpdatedUser?.schoolCode || req.principal.schoolCode || "",
    countryCode: sanitizedUpdatedUser?.countryCode || req.principal.countryCode || "",
    countryScope: sanitizedUpdatedUser?.countryScope || req.principal.countryScope || "",
    mustChangePassword: false,
  };
  if (typeof repository.listActiveUserRoleKeys === "function" && (safeUser.id || updatedUser?.id)) {
    try {
      const loaded = await repository.listActiveUserRoleKeys(safeUser.id || updatedUser.id);
      if (Array.isArray(loaded)) {
        safeUser = { ...safeUser, roleKeys: loaded };
      }
    } catch {
      /* fail-closed: keep updated user projection */
    }
  }
  // HOTFIX-PRE-E1-02 : ne pas perdre assignedClasses après change-password.
  if (safeUser.role === "Enseignant") {
    const state = await getAuthoritativeBackOfficeState();
    const { enrichTeacherUserWithActiveAssignments } = require("./lib/teacherSessionAssignments");
    safeUser = enrichTeacherUserWithActiveAssignments(safeUser, state);
  }
  const rolePermissionsMap = await getRolePermissionsMap();
  const principal = buildPrincipal(
    { user: safeUser },
    rolePermissionsMap,
  );
  if (typeof repository.resolveEffectivePermissions === "function") {
    const live = await repository.resolveEffectivePermissions(principal);
    if (Array.isArray(live?.permissions)) {
      principal.permissions = live.permissions;
    }
  }
  const accessToken = tokenService.createAccessToken({
    ...principal,
    authSource: req.principal.authSource ?? "mobile",
    sessionId: req.principal.sessionId,
    mustChangePassword: false,
  });
  res.json({
    message: "Mot de passe mis à jour.",
    user: {
      ...safeUser,
      role: principal.role,
      roles: principal.roles,
      roleKeys: principal.roleKeys,
      permissions: principal.permissions,
    },
    accessToken,
    tokenType: "Bearer",
    expiresIn: tokenService.accessTokenTtlSeconds,
  });
}));


app.get("/api/classes", requireAuth, requirePermission("GET /api/classes"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const rows = await repository.listSchoolClasses(schoolCode);
  const { scopeSchoolClassesForPrincipal } = require("./lib/classStudentsAuthz");
  res.json(scopeSchoolClassesForPrincipal(req.principal, rows));
}));

app.get(
  "/api/mobile-sync/l1/classes",
  requireAuth,
  requirePermission("GET /api/mobile-sync/l1/classes"),
  asyncHandler(async (req, res) => {
    const { handleMobileSyncL1Classes } = require("./lib/mobileSyncClasses");
    const result = await handleMobileSyncL1Classes({
      principal: req.principal,
      cursor: req.query?.cursor,
      limit: req.query?.limit,
      tokenService,
      repository,
      tenantScopeService,
    });
    res.status(result.httpStatus).json(result.body);
  }),
);

app.get(
  "/api/mobile-sync/l1/students",
  requireAuth,
  requirePermission("GET /api/mobile-sync/l1/students"),
  asyncHandler(async (req, res) => {
    const { handleMobileSyncL1Students } = require("./lib/mobileSyncStudents");
    const result = await handleMobileSyncL1Students({
      principal: req.principal,
      cursor: req.query?.cursor,
      limit: req.query?.limit,
      tokenService,
      repository,
      tenantScopeService,
    });
    res.status(result.httpStatus).json(result.body);
  }),
);

app.get(
  "/api/mobile-sync/l1/assignments",
  requireAuth,
  requirePermission("GET /api/mobile-sync/l1/assignments"),
  asyncHandler(async (req, res) => {
    const { handleMobileSyncL1Assignments } = require("./lib/mobileSyncAssignments");
    const result = await handleMobileSyncL1Assignments({
      principal: req.principal,
      cursor: req.query?.cursor,
      limit: req.query?.limit,
      tokenService,
      repository,
      tenantScopeService,
    });
    res.status(result.httpStatus).json(result.body);
  }),
);

app.get(
  "/api/mobile-sync/l1/school-courses",
  requireAuth,
  requirePermission("GET /api/mobile-sync/l1/school-courses"),
  asyncHandler(async (req, res) => {
    const { handleMobileSyncL1SchoolCourses } = require("./lib/mobileSyncSchoolCourses");
    const result = await handleMobileSyncL1SchoolCourses({
      principal: req.principal,
      cursor: req.query?.cursor,
      limit: req.query?.limit,
      tokenService,
      repository,
      tenantScopeService,
    });
    res.status(result.httpStatus).json(result.body);
  }),
);

app.get(
  "/api/mobile-sync/l1/course-schedules",
  requireAuth,
  requirePermission("GET /api/mobile-sync/l1/course-schedules"),
  asyncHandler(async (req, res) => {
    const { handleMobileSyncL1CourseSchedules } = require("./lib/mobileSyncCourseSchedules");
    const result = await handleMobileSyncL1CourseSchedules({
      principal: req.principal,
      cursor: req.query?.cursor,
      limit: req.query?.limit,
      tokenService,
      repository,
      tenantScopeService,
    });
    res.status(result.httpStatus).json(result.body);
  }),
);

app.post("/api/classes", requireAuth, requirePermission("POST /api/classes"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const { auditMetaFromRequest } = require("./lib/teacherTransactionalAudit");
  const created = await repository.createSchoolClass(
    req.body ?? {},
    schoolCode,
    req.principal,
    auditMetaFromRequest(req),
  );
  res.status(201).json(created);
}));

app.patch("/api/classes/:classCode", requireAuth, requirePermission("PATCH /api/classes/:classCode"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const { auditMetaFromRequest } = require("./lib/teacherTransactionalAudit");
  const updated = await repository.updateSchoolClass(
    req.params.classCode,
    schoolCode,
    req.body ?? {},
    req.principal,
    auditMetaFromRequest(req),
  );
  res.json(updated);
}));

async function enrollmentHttpPrincipal(req) {
  const {
    attachEnrollmentMembershipScope,
    attachEnrollmentFixtureScope,
  } = require("./lib/enrollmentSchoolScope");
  if (repository?.engine !== "memory" && typeof repository.one === "function") {
    return attachEnrollmentMembershipScope(req.principal, repository.one.bind(repository));
  }
  return attachEnrollmentFixtureScope(req.principal);
}

function requireEnrollmentLoginCode(principal) {
  const { assertEnrollmentSchoolCode } = require("./lib/enrollmentSchoolScope");
  return assertEnrollmentSchoolCode(principal);
}

function enrollmentAuthzPrincipal(reqPrincipal, loginCode) {
  return { ...reqPrincipal, schoolCode: loginCode };
}

function enrollmentApiStudent(row, loginCode) {
  const { projectEnrollmentApiStudent } = require("./lib/enrollmentSchoolScope");
  return sanitizeUserForResponse(projectEnrollmentApiStudent(row, loginCode));
}

function enrollmentApiStudents(rows, loginCode) {
  return sanitizeUsersForResponse(
    (Array.isArray(rows) ? rows : []).map((row) => {
      const { projectEnrollmentApiStudent } = require("./lib/enrollmentSchoolScope");
      return projectEnrollmentApiStudent(row, loginCode);
    }),
  );
}

app.get("/api/classes/:classCode/students", requireAuth, requirePermission("GET /api/classes/:classCode/students"), asyncHandler(async (req, res) => {
  const principal = await enrollmentHttpPrincipal(req);
  const schoolCode = requireEnrollmentLoginCode(principal);
  const rows = await repository.listClassStudents(req.params.classCode, schoolCode);
  const classes = await repository.listSchoolClasses(schoolCode);
  const match = (classes ?? []).find(
    (item) => String(item.classCode ?? "").trim() === String(req.params.classCode ?? "").trim(),
  );
  const classId = String(match?.classId ?? match?.id ?? rows[0]?.classId ?? "").trim();
  const className = String(match?.name ?? match?.className ?? rows[0]?.className ?? "").trim();
  const {
    scopeClassStudentsForPrincipal,
  } = require("./lib/classStudentsAuthz");
  const scoped = scopeClassStudentsForPrincipal(
    req.principal,
    {
      classCode: String(req.params.classCode ?? "").trim(),
      classId,
      className,
    },
    rows,
    resolveAuthorizedStudentForPrincipal,
  );
  res.json(enrollmentApiStudents(scoped, schoolCode));
}));

app.post("/api/classes/:classCode/students", requireAuth, requirePermission("POST /api/classes/:classCode/students"), asyncHandler(async (req, res) => {
  const { resolveEnrollmentWriteSchool } = require("./lib/enrollmentSchoolScope");
  const principal = await enrollmentHttpPrincipal(req);
  const writeSchool = await resolveEnrollmentWriteSchool(
    principal,
    req.body ?? {},
    repository?.engine !== "memory" && typeof repository.one === "function" ? repository.one.bind(repository) : null,
  );
  const schoolCode = writeSchool.loginCode;
  const created = await repository.enrollStudentInClass(req.params.classCode, schoolCode, req.body ?? {});
  const student = enrollmentApiStudent(created.student, schoolCode);
  const credentials = {
    login: String(created.credentials?.login ?? student?.studentCode ?? "").trim(),
    temporarySecret: String(created.credentials?.temporarySecret ?? "").trim(),
  };
  if (!student?.studentCode || !credentials.temporarySecret) {
    throw new BusinessError(500, "Le secret temporaire d'inscription n'a pas pu être remis.");
  }
  await auditService.record(req, "enroll_student", "student", student.studentCode, student, {
    schoolCode,
  });
  res.status(201).json({ student, credentials });
}));

app.get("/api/courses", requireAuth, requirePermission("GET /api/courses"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const scope = deriveSchoolScope(req.principal, state);
  res.json(tenantScopeService.filterRows(state.courses, req.principal, scope));
}));

async function planningHttpPrincipal(req) {
  const { attachPlanningMembershipScope, attachPlanningFixtureScope } = require("./lib/planningSchoolScope");
  if (typeof repository.one === "function") {
    return attachPlanningMembershipScope(req.principal, repository.one.bind(repository));
  }
  return attachPlanningFixtureScope(req.principal);
}

async function presenceHttpPrincipal(req) {
  const { attachPresenceMembershipScope, attachPresenceFixtureScope } = require("./lib/presenceSchoolScope");
  if (repository?.engine !== "memory" && typeof repository.one === "function") {
    return attachPresenceMembershipScope(req.principal, repository.one.bind(repository));
  }
  return attachPresenceFixtureScope(req.principal);
}

app.get("/api/course-schedules", requireAuth, requirePermission("GET /api/course-schedules"), asyncHandler(async (req, res) => {
  const { assertPlanningReadable } = require("./lib/planningSchoolScope");
  const principal = await planningHttpPrincipal(req);
  assertPlanningReadable(principal);
  if (typeof repository.listCourseSchedules === "function") {
    const result = await repository.listCourseSchedules(principal, req.query ?? {});
    res.json(result);
    return;
  }
  const state = await getAuthoritativeBackOfficeState();
  const scope = deriveSchoolScope(principal, state);
  const rows = tenantScopeService.filterRows(state.courseSchedules ?? [], principal, scope);
  res.json(rows);
}));

app.post("/api/courses", requireAuth, requirePermission("POST /api/courses"), asyncHandler(async (req, res) => {
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const created = await repository.createSchoolCourse(req.body ?? {}, req.principal, pedagogyAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/courses/:courseId", requireAuth, requirePermission("PATCH /api/courses/:courseId"), asyncHandler(async (req, res) => {
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const updated = await repository.updateSchoolCourse(
    req.params.courseId,
    req.body ?? {},
    req.principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.delete("/api/courses/:courseId", requireAuth, requirePermission("DELETE /api/courses/:courseId"), asyncHandler(async (req, res) => {
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const deleted = await repository.deleteSchoolCourse(
    req.params.courseId,
    req.principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(deleted);
}));

app.post("/api/course-schedules", requireAuth, requirePermission("POST /api/course-schedules"), asyncHandler(async (req, res) => {
  const { assertPlanningReadable } = require("./lib/planningSchoolScope");
  const principal = await planningHttpPrincipal(req);
  assertPlanningReadable(principal);
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/course-schedules",
    principal,
    handler: async () => {
      const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
      const created = await repository.createCourseSchedule(
        req.body ?? {},
        principal,
        pedagogyAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: created };
    },
  });
}));

app.patch("/api/course-schedules/:scheduleId", requireAuth, requirePermission("PATCH /api/course-schedules/:scheduleId"), asyncHandler(async (req, res) => {
  const { assertPlanningReadable } = require("./lib/planningSchoolScope");
  const principal = await planningHttpPrincipal(req);
  assertPlanningReadable(principal);
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const updated = await repository.updateCourseSchedule(
    req.params.scheduleId,
    req.body ?? {},
    principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.delete("/api/course-schedules/:scheduleId", requireAuth, requirePermission("DELETE /api/course-schedules/:scheduleId"), asyncHandler(async (req, res) => {
  const { assertPlanningReadable } = require("./lib/planningSchoolScope");
  const principal = await planningHttpPrincipal(req);
  assertPlanningReadable(principal);
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const deleted = await repository.deleteCourseSchedule(
    req.params.scheduleId,
    principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(deleted);
}));

function requireCanonicalPg(res, methodName, label) {
  if (typeof repository[methodName] === "function") return true;
  res.status(501).json({ message: `${label} : PostgreSQL canonique requis.` });
  return false;
}

app.get("/api/school-rooms", requireAuth, requirePermission("GET /api/school-rooms"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "listSchoolRooms", "Salles")) return;
  const result = await repository.listSchoolRooms(req.principal, req.query ?? {});
  res.json(result);
}));

app.post("/api/school-rooms", requireAuth, requirePermission("POST /api/school-rooms"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "createSchoolRoom", "Salles")) return;
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const created = await repository.createSchoolRoom(req.body ?? {}, req.principal, pedagogyAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/school-rooms/:roomId", requireAuth, requirePermission("PATCH /api/school-rooms/:roomId"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "updateSchoolRoom", "Salles")) return;
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const updated = await repository.updateSchoolRoom(
    req.params.roomId,
    req.body ?? {},
    req.principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.delete("/api/school-rooms/:roomId", requireAuth, requirePermission("DELETE /api/school-rooms/:roomId"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "archiveSchoolRoom", "Salles")) return;
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const archived = await repository.archiveSchoolRoom(
    req.params.roomId,
    req.principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(archived);
}));

app.get("/api/course-schedule-replacements/options", requireAuth, requirePermission("GET /api/course-schedule-replacements/options"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "listReplacementTeacherOptions", "Remplacements")) return;
  const result = await repository.listReplacementTeacherOptions(req.principal, req.query ?? {});
  res.json(result);
}));

app.get("/api/course-schedule-replacements", requireAuth, requirePermission("GET /api/course-schedule-replacements"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "listCourseScheduleReplacements", "Remplacements")) return;
  const result = await repository.listCourseScheduleReplacements(req.principal, req.query ?? {});
  res.json(result);
}));

app.post("/api/course-schedule-replacements", requireAuth, requirePermission("POST /api/course-schedule-replacements"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "createCourseScheduleReplacement", "Remplacements")) return;
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/course-schedule-replacements",
    principal: req.principal,
    handler: async () => {
      const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
      const created = await repository.createCourseScheduleReplacement(
        req.body ?? {},
        req.principal,
        pedagogyAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: created };
    },
  });
}));

app.patch("/api/course-schedule-replacements/:replacementId", requireAuth, requirePermission("PATCH /api/course-schedule-replacements/:replacementId"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "updateCourseScheduleReplacement", "Remplacements")) return;
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const updated = await repository.updateCourseScheduleReplacement(
    req.params.replacementId,
    req.body ?? {},
    req.principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.delete("/api/course-schedule-replacements/:replacementId", requireAuth, requirePermission("DELETE /api/course-schedule-replacements/:replacementId"), asyncHandler(async (req, res) => {
  if (!requireCanonicalPg(res, "cancelCourseScheduleReplacement", "Remplacements")) return;
  const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
  const cancelled = await repository.cancelCourseScheduleReplacement(
    req.params.replacementId,
    req.principal,
    pedagogyAuditMetaFromRequest(req),
  );
  res.json(cancelled);
}));

app.get("/api/evaluations", requireAuth, requirePermission("GET /api/evaluations"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    sendList(res, [], req.query, ["title", "className", "subject", "period", "course"]);
    return;
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const rows = await repository.listSchoolEvaluations(schoolCode, req.principal);
  sendList(res, rows, req.query, ["title", "className", "subject", "period", "course"]);
}));

app.post("/api/evaluations", requireAuth, requireSchoolSubscriptionFeature("write_notes"), requirePermission("POST /api/evaluations"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/evaluations",
    principal: req.principal,
    handler: async () => {
      const { pedagogyAuditMetaFromRequest, ignoreClientScope } = require("./lib/pedagogyManagement");
      const saved = await repository.createSchoolEvaluation(
        ignoreClientScope(req.body ?? {}),
        req.principal,
        pedagogyAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: saved };
    },
  });
}));

app.patch("/api/evaluations/:evaluationId", requireAuth, requireSchoolSubscriptionFeature("write_notes"), requirePermission("PATCH /api/evaluations/:evaluationId"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: `PATCH /api/evaluations/${req.params.evaluationId}`,
    principal: req.principal,
    handler: async () => {
      const { pedagogyAuditMetaFromRequest } = require("./lib/pedagogyManagement");
      const saved = await repository.updateSchoolEvaluation(
        req.params.evaluationId,
        req.body ?? {},
        req.principal,
        pedagogyAuditMetaFromRequest(req),
      );
      return { statusCode: 200, body: saved };
    },
  });
}));

app.get("/api/assignments", requireAuth, requirePermission("GET /api/assignments"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);

  const {
    resolveLiveAssignmentsSyncSnapshot,
    liveSnapshotHasAssignmentsRead,
    logAssignmentsPrincipalIdentity,
    buildAssignmentsPrincipalIdentityLog,
  } = require("./lib/mobileSyncScope");
  const { MOBILE_SYNC_ERROR } = require("./lib/mobileSyncErrors");

  let school = null;
  if (typeof repository.getSchoolByCode === "function") {
    school = await repository.getSchoolByCode(schoolCode);
  }
  const schoolId = String(req.principal.effectiveSchoolId ?? school?.id ?? "").trim();
  let snapshot;
  try {
    snapshot = await resolveLiveAssignmentsSyncSnapshot(repository, req.principal, {
      schoolCode,
      schoolId,
    });
  } catch (error) {
    if (error?.code === MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE && error.statusCode) {
      throw error;
    }
    const unavailable = new Error("Impossible de résoudre le périmètre live des affectations.");
    unavailable.statusCode = 503;
    unavailable.code = MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE;
    throw unavailable;
  }

  if (snapshot.scope.scopeKind !== "none" && !liveSnapshotHasAssignmentsRead(snapshot.input)) {
    throw denyPermission();
  }

  let rows;
  if (snapshot.scope.scopeKind === "none") {
    rows = [];
  } else if (snapshot.scope.scopeKind === "assigned") {
    rows = await repository.listSchoolTeacherAssignments(schoolCode, {
      teacherId: snapshot.scope.teacherId,
    });
  } else {
    rows = await repository.listSchoolTeacherAssignments(schoolCode);
  }

  logAssignmentsPrincipalIdentity(
    buildAssignmentsPrincipalIdentityLog({
      principal: req.principal,
      schoolRef: { schoolCode, schoolId },
      snapshot,
      rawUserId: snapshot.principalTrace?.rawUserId,
      canonicalUserId: snapshot.principalTrace?.canonicalUserId,
      rowCount: Array.isArray(rows) ? rows.length : 0,
    }),
  );

  sendList(res, rows, req.query, ["className", "course", "teacherName", "teacherId"]);
}));

app.post("/api/assignments", requireAuth, requirePermission("POST /api/assignments"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const created = await repository.createSchoolTeacherAssignment(
    req.body ?? {},
    schoolCode,
    req.principal,
    auditMetaFromRequest(req),
  );
  res.status(201).json(created);
}));

app.patch("/api/assignments/:assignmentId", requireAuth, requirePermission("PATCH /api/assignments/:assignmentId"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const updated = await repository.updateSchoolTeacherAssignment(
    req.params.assignmentId,
    req.body ?? {},
    schoolCode,
    req.principal,
    auditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.delete("/api/assignments/:assignmentId", requireAuth, requirePermission("DELETE /api/assignments/:assignmentId"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const result = await repository.deleteSchoolTeacherAssignment(
    req.params.assignmentId,
    schoolCode,
    req.principal,
    auditMetaFromRequest(req),
  );
  res.json(result);
}));

app.get("/api/academic-config", requireAuth, requirePermission("GET /api/academic-config"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode } = require("./lib/principalSchoolScope");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const config = await repository.getAcademicConfig(schoolCode);
  res.json(config);
}));

app.get("/api/backoffice/establishments/:schoolCode/academic-config", requireAuth, requirePermission("GET /api/backoffice/establishments/:schoolCode/academic-config"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const config = await repository.getAcademicConfig(schoolCode);
  res.json(config);
}));

app.put("/api/backoffice/establishments/:schoolCode/academic-config", requireAuth, requirePermission("PUT /api/backoffice/establishments/:schoolCode/academic-config"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const { stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const payload = stripClientSchoolCode(req.body ?? {});
  const saved = await repository.withTransaction(async (tx) => {
    const scope = repository.createTxScope(tx);
    const result = await scope.saveAcademicConfig(schoolCode, payload, tx);
    await scope.recordAudit(
      {
        schoolCode,
        userId: req.principal?.sub,
        action: "save_academic_config",
        entityType: "academic_config",
        entityId: schoolCode,
        newValue: result,
        ipAddress: req.ip ?? "",
        userAgent: req.get("user-agent") ?? "",
      },
      tx,
    );
    if (typeof repository.invalidateCachedDataset === "function") {
      repository.invalidateCachedDataset();
    } else {
      repository.cachedDataset = null;
    }
    return result;
  });
  res.json(saved);
}));

app.put("/api/academic-config", requireAuth, requirePermission("PUT /api/academic-config"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode, stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const payload = stripClientSchoolCode(req.body ?? {});
  const saved = await repository.withTransaction(async (tx) => {
    const scope = repository.createTxScope(tx);
    const result = await scope.saveAcademicConfig(schoolCode, payload, tx);
    await scope.recordAudit(
      {
        schoolCode,
        userId: req.principal?.sub,
        action: "save_academic_config",
        entityType: "academic_config",
        entityId: schoolCode,
        newValue: result,
        ipAddress: req.ip ?? "",
        userAgent: req.get("user-agent") ?? "",
      },
      tx,
    );
    if (typeof repository.invalidateCachedDataset === "function") {
      repository.invalidateCachedDataset();
    } else {
      repository.cachedDataset = null;
    }
    return result;
  });
  res.json(saved);
}));

app.get("/api/data-export", requireAuth, requirePermission("GET /api/data-export"), asyncHandler(async (req, res) => {
  const { exportSchoolData } = require("./lib/dataExportService");
  const { dataExportAuditMetaFromRequest } = require("./lib/dataExportManagement");
  const payload = await exportSchoolData(
    repository,
    req.principal,
    req.query?.schoolCode,
    dataExportAuditMetaFromRequest(req),
  );
  res.json(payload);
}));

app.get("/api/school-settings", requireAuth, requirePermission("GET /api/school-settings"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode } = require("./lib/principalSchoolScope");
  const { assertSchoolSettingsRead } = require("./lib/schoolSettingsManagement");
  assertSchoolSettingsRead(req.principal);
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const settings = await repository.getSchoolSettings(req.principal, schoolCode);
  res.json(settings);
}));

app.patch("/api/school-settings", requireAuth, requirePermission("PATCH /api/school-settings"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode, stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { schoolSettingsAuditMetaFromRequest } = require("./lib/schoolSettingsManagement");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const saved = await repository.patchSchoolSettings(
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    schoolSettingsAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(saved);
}));

app.put("/api/academic-periods", requireAuth, requirePermission("PUT /api/academic-periods"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode, stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { schoolSettingsAuditMetaFromRequest } = require("./lib/schoolSettingsManagement");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const saved = await repository.replaceAcademicPeriods(
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    schoolSettingsAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(saved);
}));

app.get("/api/backoffice/establishments/:schoolCode/school-settings", requireAuth, requirePermission("GET /api/backoffice/establishments/:schoolCode/school-settings"), asyncHandler(async (req, res) => {
  const { assertSchoolSettingsRead } = require("./lib/schoolSettingsManagement");
  assertSchoolSettingsRead(req.principal);
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const settings = await repository.getSchoolSettings(req.principal, schoolCode);
  res.json(settings);
}));

app.patch("/api/backoffice/establishments/:schoolCode/school-settings", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:schoolCode/school-settings"), asyncHandler(async (req, res) => {
  const { stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { schoolSettingsAuditMetaFromRequest } = require("./lib/schoolSettingsManagement");
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const saved = await repository.patchSchoolSettings(
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    schoolSettingsAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(saved);
}));

app.put("/api/backoffice/establishments/:schoolCode/academic-periods", requireAuth, requirePermission("PUT /api/backoffice/establishments/:schoolCode/academic-periods"), asyncHandler(async (req, res) => {
  const { stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { schoolSettingsAuditMetaFromRequest } = require("./lib/schoolSettingsManagement");
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const saved = await repository.replaceAcademicPeriods(
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    schoolSettingsAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(saved);
}));

app.get("/api/evaluation-types", requireAuth, requirePermission("GET /api/evaluation-types"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode } = require("./lib/principalSchoolScope");
  const { assertEvaluationTypesRead } = require("./lib/evaluationTypesManagement");
  assertEvaluationTypesRead(req.principal);
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const types = await repository.listEvaluationTypes(schoolCode, {
    includeArchived: String(req.query.includeArchived ?? "") === "true",
  });
  res.json({ types });
}));

app.post("/api/evaluation-types", requireAuth, requirePermission("POST /api/evaluation-types"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode, stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { evaluationTypesAuditMetaFromRequest } = require("./lib/evaluationTypesManagement");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const created = await repository.createEvaluationType(
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    evaluationTypesAuditMetaFromRequest(req),
    schoolCode,
  );
  res.status(201).json(created);
}));

app.patch("/api/evaluation-types/:typeId", requireAuth, requirePermission("PATCH /api/evaluation-types/:typeId"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode, stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { evaluationTypesAuditMetaFromRequest } = require("./lib/evaluationTypesManagement");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const updated = await repository.updateEvaluationType(
    req.params.typeId,
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    evaluationTypesAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(updated);
}));

app.post("/api/evaluation-types/:typeId/archive", requireAuth, requirePermission("POST /api/evaluation-types/:typeId/archive"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode } = require("./lib/principalSchoolScope");
  const { evaluationTypesAuditMetaFromRequest } = require("./lib/evaluationTypesManagement");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const archived = await repository.archiveEvaluationType(
    req.params.typeId,
    req.principal,
    evaluationTypesAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(archived);
}));

app.get("/api/backoffice/establishments/:schoolCode/evaluation-types", requireAuth, requirePermission("GET /api/backoffice/establishments/:schoolCode/evaluation-types"), asyncHandler(async (req, res) => {
  const { assertEvaluationTypesRead } = require("./lib/evaluationTypesManagement");
  assertEvaluationTypesRead(req.principal);
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const types = await repository.listEvaluationTypes(schoolCode, {
    includeArchived: String(req.query.includeArchived ?? "") === "true",
  });
  res.json({ types });
}));

app.post("/api/backoffice/establishments/:schoolCode/evaluation-types", requireAuth, requirePermission("POST /api/backoffice/establishments/:schoolCode/evaluation-types"), asyncHandler(async (req, res) => {
  const { stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { evaluationTypesAuditMetaFromRequest } = require("./lib/evaluationTypesManagement");
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const created = await repository.createEvaluationType(
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    evaluationTypesAuditMetaFromRequest(req),
    schoolCode,
  );
  res.status(201).json(created);
}));

app.patch("/api/backoffice/establishments/:schoolCode/evaluation-types/:typeId", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:schoolCode/evaluation-types/:typeId"), asyncHandler(async (req, res) => {
  const { stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { evaluationTypesAuditMetaFromRequest } = require("./lib/evaluationTypesManagement");
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const updated = await repository.updateEvaluationType(
    req.params.typeId,
    stripClientSchoolCode(req.body ?? {}),
    req.principal,
    evaluationTypesAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(updated);
}));

app.post("/api/backoffice/establishments/:schoolCode/evaluation-types/:typeId/archive", requireAuth, requirePermission("POST /api/backoffice/establishments/:schoolCode/evaluation-types/:typeId/archive"), asyncHandler(async (req, res) => {
  const { evaluationTypesAuditMetaFromRequest } = require("./lib/evaluationTypesManagement");
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const archived = await repository.archiveEvaluationType(
    req.params.typeId,
    req.principal,
    evaluationTypesAuditMetaFromRequest(req),
    schoolCode,
  );
  res.json(archived);
}));

app.get("/api/exams", requireAuth, requirePermission("GET /api/exams"), asyncHandler(async (req, res) => {
  const exams = await repository.listExams(req.principal);
  res.json({ exams });
}));

app.post("/api/exams", requireAuth, requirePermission("POST /api/exams"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const created = await repository.createExam(req.body ?? {}, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.get("/api/exams/:examId", requireAuth, requirePermission("GET /api/exams/:examId"), asyncHandler(async (req, res) => {
  const exam = await repository.getExam(req.params.examId, req.principal);
  res.json(exam);
}));

app.patch("/api/exams/:examId", requireAuth, requirePermission("PATCH /api/exams/:examId"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const updated = await repository.patchExam(req.params.examId, req.body ?? {}, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/exams/:examId/validate", requireAuth, requirePermission("POST /api/exams/:examId/validate"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.validateExam(req.params.examId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/exams/:examId/cancel", requireAuth, requirePermission("POST /api/exams/:examId/cancel"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.cancelExam(req.params.examId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/exams/:examId/archive", requireAuth, requirePermission("POST /api/exams/:examId/archive"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.archiveExam(req.params.examId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/report-cards", requireAuth, requirePermission("GET /api/report-cards"), asyncHandler(async (req, res) => {
  const bulletins = await repository.listReportCards(req.principal);
  res.json({ bulletins });
}));

app.post("/api/report-cards/generate", requireAuth, requirePermission("POST /api/report-cards/generate"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.generateReportCard(req.body ?? {}, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.status(201).json(saved);
}));

app.post("/api/report-cards/:cardId/publish", requireAuth, requirePermission("POST /api/report-cards/:cardId/publish"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.publishReportCard(req.params.cardId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/report-cards/:cardId/archive", requireAuth, requirePermission("POST /api/report-cards/:cardId/archive"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.archiveReportCard(req.params.cardId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/report-card-templates", requireAuth, requirePermission("GET /api/report-card-templates"), asyncHandler(async (req, res) => {
  const templates = await repository.listReportCardTemplates(req.principal);
  res.json({ templates });
}));

app.put("/api/report-card-templates", requireAuth, requirePermission("PUT /api/report-card-templates"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.upsertReportCardTemplate(req.body ?? {}, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/report-card-templates/:templateId/archive", requireAuth, requirePermission("POST /api/report-card-templates/:templateId/archive"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.archiveReportCardTemplate(req.params.templateId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/school-documents", requireAuth, requirePermission("GET /api/school-documents"), asyncHandler(async (req, res) => {
  const documents = await repository.listSchoolDocuments(req.principal);
  res.json({ documents });
}));

app.post("/api/school-documents", requireAuth, requirePermission("POST /api/school-documents"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const created = await repository.createSchoolDocument(req.body ?? {}, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/school-documents/:documentId", requireAuth, requirePermission("PATCH /api/school-documents/:documentId"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.patchSchoolDocument(req.params.documentId, req.body ?? {}, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/school-documents/:documentId/archive", requireAuth, requirePermission("POST /api/school-documents/:documentId/archive"), asyncHandler(async (req, res) => {
  const { documentsExamsAuditMetaFromRequest } = require("./lib/documentsExamsManagement");
  const saved = await repository.archiveSchoolDocument(req.params.documentId, req.principal, documentsExamsAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/backoffice/education-levels", requireAuth, requirePermission("GET /api/backoffice/education-levels"), asyncHandler(async (req, res) => {
  const { assertEducationReferenceCountryRead } = require("./lib/educationReferenceManagement");
  const countryCode = String(req.query.countryCode ?? "").trim().toUpperCase();
  if (!countryCode) {
    return res.status(400).json({ message: "countryCode obligatoire." });
  }
  assertEducationReferenceCountryRead(req.principal, countryCode);
  const levels = await repository.listEducationLevelsByCountry(countryCode, {
    includeArchived: String(req.query.includeArchived ?? "") === "true",
  });
  res.json({ levels });
}));

app.post("/api/backoffice/education-levels", requireAuth, requirePermission("POST /api/backoffice/education-levels"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const created = await repository.createEducationLevel(req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/education-levels/:levelId", requireAuth, requirePermission("PATCH /api/backoffice/education-levels/:levelId"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const updated = await repository.updateEducationLevel(req.params.levelId, req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/education-levels/:levelId/archive", requireAuth, requirePermission("POST /api/backoffice/education-levels/:levelId/archive"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const archived = await repository.archiveEducationLevel(req.params.levelId, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(archived);
}));

app.get("/api/backoffice/education-streams", requireAuth, requirePermission("GET /api/backoffice/education-streams"), asyncHandler(async (req, res) => {
  const { assertEducationReferenceCountryRead } = require("./lib/educationReferenceManagement");
  const countryCode = String(req.query.countryCode ?? "").trim().toUpperCase();
  if (!countryCode) {
    return res.status(400).json({ message: "countryCode obligatoire." });
  }
  assertEducationReferenceCountryRead(req.principal, countryCode);
  const streams = await repository.listEducationStreamsByCountry(countryCode, {
    includeArchived: String(req.query.includeArchived ?? "") === "true",
    streamType: req.query.streamType ? String(req.query.streamType) : null,
    levelId: req.query.levelId ? String(req.query.levelId) : null,
  });
  res.json({ streams });
}));

app.post("/api/backoffice/education-streams", requireAuth, requirePermission("POST /api/backoffice/education-streams"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const created = await repository.createEducationStream(req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/education-streams/:streamId", requireAuth, requirePermission("PATCH /api/backoffice/education-streams/:streamId"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const updated = await repository.updateEducationStream(req.params.streamId, req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/education-streams/:streamId/archive", requireAuth, requirePermission("POST /api/backoffice/education-streams/:streamId/archive"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const archived = await repository.archiveEducationStream(req.params.streamId, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(archived);
}));

app.get("/api/backoffice/education-class-groups", requireAuth, requirePermission("GET /api/backoffice/education-class-groups"), asyncHandler(async (req, res) => {
  const { assertEducationReferenceCountryRead } = require("./lib/educationReferenceManagement");
  const countryCode = String(req.query.countryCode ?? "").trim().toUpperCase();
  if (!countryCode) {
    return res.status(400).json({ message: "countryCode obligatoire." });
  }
  assertEducationReferenceCountryRead(req.principal, countryCode);
  const groups = await repository.listEducationClassGroupsByCountry(countryCode, {
    includeArchived: String(req.query.includeArchived ?? "") === "true",
  });
  res.json({ groups });
}));

app.post("/api/backoffice/education-class-groups", requireAuth, requirePermission("POST /api/backoffice/education-class-groups"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const created = await repository.createEducationClassGroup(req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/education-class-groups/:groupId", requireAuth, requirePermission("PATCH /api/backoffice/education-class-groups/:groupId"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const updated = await repository.updateEducationClassGroup(req.params.groupId, req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/education-class-groups/:groupId/archive", requireAuth, requirePermission("POST /api/backoffice/education-class-groups/:groupId/archive"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const archived = await repository.archiveEducationClassGroup(req.params.groupId, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(archived);
}));

app.patch("/api/backoffice/education-reference/labels", requireAuth, requirePermission("PATCH /api/backoffice/education-reference/labels"), asyncHandler(async (req, res) => {
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const saved = await repository.updateCountryPedagogicalLabels(req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/education-reference/catalog", requireAuth, requirePermission("GET /api/education-reference/catalog"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode } = require("./lib/principalSchoolScope");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const catalog = await repository.getEducationSchoolCatalog(schoolCode);
  res.json(catalog);
}));

app.put("/api/education-reference/school-activation", requireAuth, requirePermission("PUT /api/education-reference/school-activation"), asyncHandler(async (req, res) => {
  const { resolvePrincipalSchoolCode } = require("./lib/principalSchoolScope");
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  const schoolCode = resolvePrincipalSchoolCode(req.principal);
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const saved = await repository.saveSchoolEducationActivation(schoolCode, req.body ?? {}, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/backoffice/establishments/:schoolCode/education-reference/catalog", requireAuth, requirePermission("GET /api/backoffice/establishments/:schoolCode/education-reference/catalog"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const catalog = await repository.getEducationSchoolCatalog(schoolCode);
  res.json(catalog);
}));

app.put("/api/backoffice/establishments/:schoolCode/education-reference/school-activation", requireAuth, requirePermission("PUT /api/backoffice/establishments/:schoolCode/education-reference/school-activation"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.params.schoolCode ?? "").trim().toUpperCase();
  const { stripClientSchoolCode } = require("./lib/principalSchoolScope");
  const { educationReferenceAuditMetaFromRequest } = require("./lib/educationReferenceManagement");
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const payload = stripClientSchoolCode(req.body ?? {});
  const saved = await repository.saveSchoolEducationActivation(schoolCode, payload, req.principal, educationReferenceAuditMetaFromRequest(req));
  res.json(saved);
}));

app.get("/api/backoffice/establishment-roles", requireAuth, requirePermission("GET /api/backoffice/establishment-roles"), asyncHandler(async (req, res) => {
  const roles = await repository.listEstablishmentRoles({
    includeArchived: String(req.query.includeArchived ?? "") === "true",
    schoolAssignableOnly: String(req.query.schoolAssignableOnly ?? "") === "true",
  });
  res.json({ roles });
}));

app.post("/api/backoffice/establishment-roles", requireAuth, requirePermission("POST /api/backoffice/establishment-roles"), asyncHandler(async (req, res) => {
  const { establishmentRolesAuditMetaFromRequest } = require("./lib/establishmentRolesManagement");
  const created = await repository.createEstablishmentRole(req.body ?? {}, req.principal, establishmentRolesAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/establishment-roles/:roleId", requireAuth, requirePermission("PATCH /api/backoffice/establishment-roles/:roleId"), asyncHandler(async (req, res) => {
  const { establishmentRolesAuditMetaFromRequest } = require("./lib/establishmentRolesManagement");
  const updated = await repository.updateEstablishmentRole(req.params.roleId, req.body ?? {}, req.principal, establishmentRolesAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/establishment-roles/:roleId/archive", requireAuth, requirePermission("POST /api/backoffice/establishment-roles/:roleId/archive"), asyncHandler(async (req, res) => {
  const { establishmentRolesAuditMetaFromRequest } = require("./lib/establishmentRolesManagement");
  const archived = await repository.archiveEstablishmentRole(req.params.roleId, req.principal, establishmentRolesAuditMetaFromRequest(req));
  res.json(archived);
}));

app.get("/api/establishment-roles/assignable", requireAuth, requirePermission("GET /api/establishment-roles/assignable"), asyncHandler(async (req, res) => {
  const roles = await repository.listEstablishmentRoles({ schoolAssignableOnly: true });
  res.json({ roles });
}));

app.get("/api/backoffice/planning-exams", requireAuth, requirePermission("GET /api/backoffice/planning-exams"), asyncHandler(async (req, res) => {
  const exams = await repository.listExams(req.principal);
  res.json({ exams });
}));

app.put("/api/backoffice/planning-exams", requireAuth, requirePermission("PUT /api/backoffice/planning-exams"), asyncHandler(async () => {
  const { assertLegacyResidualWriteForbidden } = require("./lib/documentsExamsManagement");
  assertLegacyResidualWriteForbidden("exam"); // LEGACY_EXAMS_WRITE_FORBIDDEN
}));

app.get("/api/backoffice/report-cards", requireAuth, requirePermission("GET /api/backoffice/report-cards"), asyncHandler(async (req, res) => {
  const bulletins = await repository.listReportCards(req.principal);
  res.json({ bulletins });
}));

app.put("/api/backoffice/report-cards", requireAuth, requirePermission("PUT /api/backoffice/report-cards"), asyncHandler(async () => {
  const { assertLegacyResidualWriteForbidden } = require("./lib/documentsExamsManagement");
  assertLegacyResidualWriteForbidden("bulletin"); // LEGACY_REPORT_CARDS_WRITE_FORBIDDEN
}));

app.get("/api/backoffice/establishment-documents", requireAuth, requirePermission("GET /api/backoffice/establishment-documents"), asyncHandler(async (req, res) => {
  const documents = await repository.listSchoolDocuments(req.principal);
  res.json({ documents });
}));

app.put("/api/backoffice/establishment-documents", requireAuth, requirePermission("PUT /api/backoffice/establishment-documents"), asyncHandler(async () => {
  const { assertLegacyResidualWriteForbidden } = require("./lib/documentsExamsManagement");
  assertLegacyResidualWriteForbidden("document"); // LEGACY_DOCUMENTS_WRITE_FORBIDDEN
}));

app.get("/api/students", requireAuth, requirePermission("GET /api/students"), asyncHandler(async (req, res) => {
  const principal = await enrollmentHttpPrincipal(req);
  const schoolCode = requireEnrollmentLoginCode(principal);

  if (typeof repository.listSchoolStudents !== "function") {
    throw new BusinessError(503, "Liste élèves PostgreSQL indisponible.");
  }

  const rows = await repository.listSchoolStudents(schoolCode);
  const { className } = req.query;
  const filtered = (rows ?? []).filter((student) => !className || student.className === className);
  const {
    scopeSchoolStudentsForPrincipal,
  } = require("./lib/classStudentsAuthz");
  const scoped = scopeSchoolStudentsForPrincipal(
    req.principal,
    filtered,
    resolveAuthorizedStudentForPrincipal,
  );
  const result = enrollmentApiStudents(scoped, schoolCode);
  sendList(res, result, req.query, ["name", "matricule", "studentCode", "className", "parentPhone"]);
}));

app.get("/api/students/:id", requireAuth, requirePermission("GET /api/students/:id"), asyncHandler(async (req, res) => {
  const { assertEnrollmentStudentAccess } = require("./lib/enrollmentSchoolScope");
  const principal = await enrollmentHttpPrincipal(req);
  const schoolCode = requireEnrollmentLoginCode(principal);

  if (typeof repository.getSchoolStudentByCode !== "function") {
    throw new BusinessError(503, "Fiche élève PostgreSQL indisponible.");
  }

  const pgStudent = enrollmentApiStudent(
    await repository.getSchoolStudentByCode(req.params.id, schoolCode),
    schoolCode,
  );
  assertEnrollmentStudentAccess(principal, pgStudent);
  const {
    authorizeStudentReadForPrincipal,
  } = require("./lib/classStudentsAuthz");
  const authorizedPg = authorizeStudentReadForPrincipal(
    pgStudent,
    enrollmentAuthzPrincipal(req.principal, schoolCode),
    req.params.id,
    resolveAuthorizedStudentForPrincipal,
  );
  if (!authorizedPg) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }
  return res.json(enrollmentApiStudent(authorizedPg, schoolCode));
}));

app.patch("/api/students/:id", requireAuth, requirePermission("PATCH /api/students/:id"), asyncHandler(async (req, res) => {
  const { assertEnrollmentStudentAccess } = require("./lib/enrollmentSchoolScope");
  const principal = await enrollmentHttpPrincipal(req);
  const schoolCode = requireEnrollmentLoginCode(principal);

  if (typeof repository.updateSchoolStudentByCode !== "function") {
    throw new BusinessError(503, "Modification élève PostgreSQL indisponible.");
  }

  const existing = enrollmentApiStudent(
    await repository.getSchoolStudentByCode(req.params.id, schoolCode),
    schoolCode,
  );
  assertEnrollmentStudentAccess(principal, existing);
  const {
    authorizeStudentReadForPrincipal,
  } = require("./lib/classStudentsAuthz");
  const authorized = authorizeStudentReadForPrincipal(
    existing,
    enrollmentAuthzPrincipal(req.principal, schoolCode),
    req.params.id,
    resolveAuthorizedStudentForPrincipal,
  );
  if (!authorized) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }

  const updated = await repository.updateSchoolStudentByCode(
    req.params.id,
    schoolCode,
    req.body ?? {},
  );
  await auditService.record(req, "update_student", "student", updated.studentCode, {
    studentCode: updated.studentCode,
  }, { schoolCode });
  res.json(enrollmentApiStudent(updated, schoolCode));
}));

app.delete("/api/students/:id", requireAuth, requirePermission("DELETE /api/students/:id"), asyncHandler(async (req, res) => {
  const { assertEnrollmentStudentAccess } = require("./lib/enrollmentSchoolScope");
  const principal = await enrollmentHttpPrincipal(req);
  const schoolCode = requireEnrollmentLoginCode(principal);
  if (typeof repository.getSchoolStudentByCode !== "function") {
    throw new BusinessError(503, "Suppression élève PostgreSQL indisponible.");
  }
  const existing = enrollmentApiStudent(
    await repository.getSchoolStudentByCode(req.params.id, schoolCode),
    schoolCode,
  );
  assertEnrollmentStudentAccess(principal, existing);
  const { authorizeStudentReadForPrincipal } = require("./lib/classStudentsAuthz");
  const authorized = authorizeStudentReadForPrincipal(
    existing,
    enrollmentAuthzPrincipal(req.principal, schoolCode),
    req.params.id,
    resolveAuthorizedStudentForPrincipal,
  );
  if (!authorized) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }
  if (typeof repository.archiveSchoolStudentByCode === "function") {
    const archived = await repository.archiveSchoolStudentByCode(req.params.id, schoolCode, req.principal);
    await auditService.record(req, "archive_student", "student", archived.studentCode || req.params.id, {
      studentCode: archived.studentCode || req.params.id,
    }, { schoolCode });
    return res.json(enrollmentApiStudent(archived, schoolCode));
  }
  res.status(204).end();
}));

/** Lecture notes : Notes:READ live (Parent/Élève : seed « Voir notes » + matrice Notes:R). */
app.get("/api/students/:id/notes", requireAuth, requirePermission("GET /api/students/:id/notes"), asyncHandler(async (req, res) => {
  const { notes, students, evaluations } = await loadCanonicalPedagogyForPrincipal(req.principal);
  const student = resolveAuthorizedStudentForPrincipal(students, req.principal, req.params.id);
  if (!student) {
    return res.json([]);
  }
  const studentIds = buildScopedStudentIdSet([student]);
  const scopedNotes = notes.filter((note) => studentIds.has(String(note.studentId ?? "")));
  res.json(filterNotesForPrincipal(scopedNotes, evaluations, req.principal));
}));

app.get("/api/notes", requireAuth, requirePermission("GET /api/notes"), asyncHandler(async (req, res) => {
  const { notes, students, evaluations } = await loadCanonicalPedagogyForPrincipal(req.principal);
  let scopedStudents = tenantScopeService.filterRows(students, req.principal);
  if (!scopedStudents.length && isParentOrStudentPrincipalRole(req.principal.role)) {
    const linkedIds = principalLinkedStudentIds(req.principal);
    scopedStudents = students.filter((student) => linkedIds.has(String(student.id ?? "").trim()));
  }
  const studentIds = buildScopedStudentIdSet(scopedStudents);
  const scopedNotes = notes.filter((note) => studentIds.has(String(note.studentId ?? "")));
  res.json(filterNotesForPrincipal(scopedNotes, evaluations, req.principal));
}));

/** Lecture présences : Présences:READ live (Parent/Élève : seed « Voir présences »). */
app.get("/api/presences", requireAuth, requirePermission("GET /api/presences"), asyncHandler(async (req, res) => {
  const {
    assertPresenceReadable,
    filterPresenceRows,
    presenceListStaysStudentScoped,
  } = require("./lib/presenceSchoolScope");
  const principal = await presenceHttpPrincipal(req);
  const scope = assertPresenceReadable(principal);
  const { presences, students } = await loadCanonicalPedagogyForPrincipal(principal);
  const { className, date } = req.query;
  let scopedPresences = filterPresenceRows(presences, scope);
  let scopedStudents = tenantScopeService.filterRows(students, principal)
    .filter((student) => !className || student.className === className);
  scopedStudents = filterPresenceRows(scopedStudents, scope)
    .filter((student) => !className || student.className === className);
  if (!scopedStudents.length && isParentOrStudentPrincipalRole(principal.role)) {
    const linkedIds = principalLinkedStudentIds(principal);
    scopedStudents = filterPresenceRows(students, scope)
      .filter((student) => linkedIds.has(String(student.id ?? "").trim()))
      .filter((student) => !className || student.className === className);
  }
  const studentIds = buildScopedStudentIdSet(scopedStudents);
  const byStudents = scopedPresences.filter((presence) =>
    studentIds.has(String(presence.studentId ?? "")) &&
    (!date || String(presence.date) === String(date))
  );
  if (studentIds.size) {
    res.json(byStudents);
    return;
  }
  if (presenceListStaysStudentScoped(principal)) {
    res.json([]);
    return;
  }
  res.json(scopedPresences.filter((presence) =>
    (!className || presence.className === className) &&
    (!date || String(presence.date) === String(date))
  ));
}));

app.post("/api/notes", requireAuth, requireSchoolSubscriptionFeature("write_notes"), requirePermission("POST /api/notes"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/notes",
    principal: req.principal,
    handler: async () => {
      const state = await loadCanonicalPedagogyForPrincipal(req.principal);
      const { pedagogyAuditMetaFromRequest, ignoreClientScope } = require("./lib/pedagogyManagement");
      const { assertNoteWrite } = require("./services/dataIntegrityService");
      const body = ignoreClientScope(req.body ?? {});
      const principalSchool = String(req.principal?.schoolCode ?? "").trim().toUpperCase();
      const scopedState =
        principalSchool && principalSchool !== "*"
          ? {
              ...state,
              evaluations: (state.evaluations ?? []).filter(
                (row) => String(row.schoolCode ?? "").trim().toUpperCase() === principalSchool,
              ),
            }
          : state;
      // Unicité portée par PG upsert (school+evaluation+student) — comme D3.5b présences.
      assertNoteWrite(scopedState, body, {
        skipDuplicateCheck: true,
      });
      let saved;
      const engine = String(repository.engine ?? "postgresql");
      if (engine === "postgresql" && typeof repository.upsertSchoolGrade === "function") {
        saved = await repository.upsertSchoolGrade(body, req.principal, pedagogyAuditMetaFromRequest(req));
      } else {
        saved = await repository.upsertGrade(body, req.principal);
        await auditService.record(req, "upsert_grade", "grade", saved.id, saved);
      }
      return { statusCode: 201, body: saved };
    },
  });
}));

app.post("/api/presences", requireAuth, requireSchoolSubscriptionFeature("write_presence"), requirePermission("POST /api/presences"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/presences",
    principal: req.principal,
    handler: async () => {
      const { assertPresenceReadable } = require("./lib/presenceSchoolScope");
      const principal = await presenceHttpPrincipal(req);
      assertPresenceReadable(principal);
      const state = await loadCanonicalPedagogyForPrincipal(principal);
      const { pedagogyAuditMetaFromRequest, ignoreClientScope } = require("./lib/pedagogyManagement");
      const rawBody = req.body ?? {};
      const body = Array.isArray(rawBody.items)
        ? { ...rawBody, items: rawBody.items.map((item) => ignoreClientScope(item)) }
        : ignoreClientScope(rawBody);
      const engine = String(repository.engine ?? "postgresql");
      const { mergeAttendanceClassIdentity } = require("./lib/presencesAttendanceAuthz");
      const items = Array.isArray(body.items) ? body.items : [body];
      const canonicalItems = items.map((item) => ({
        ...item,
        ...mergeAttendanceClassIdentity(item, body),
      }));
      if (engine !== "postgresql" || typeof repository.upsertSchoolAttendanceBatch !== "function") {
        const { assertPresenceWrite } = require("./services/dataIntegrityService");
        for (const item of canonicalItems) {
          assertPresenceWrite(state, item);
        }
      }
      let saved;
      if (engine === "postgresql" && typeof repository.upsertSchoolAttendanceBatch === "function") {
        saved = await repository.upsertSchoolAttendanceBatch(
          { ...body, items: canonicalItems },
          principal,
          pedagogyAuditMetaFromRequest(req),
        );
      } else {
        saved = await repository.upsertAttendanceBatch({ ...body, items: canonicalItems }, principal);
        await auditService.record(req, "upsert_attendance", "attendance", body?.classCode ?? body?.className ?? "batch", {
          count: saved.length,
        });
      }
      return { statusCode: 201, body: saved };
    },
  });
}));

app.get("/api/students/:id/report", requireAuth, requirePermission("GET /api/students/:id/report"), asyncHandler(async (req, res) => {
  const { gradeBookService } = await getRuntime();
  const { students } = await getAuthoritativeBackOfficeState();
  const student = findStudent(tenantScopeService.filterRows(students, req.principal), req.params.id);

  if (!student) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }

  res.json(stripSensitiveFieldsDeep(gradeBookService.generateReport(student.id)));
}));

app.get("/api/students/:id/report.pdf", requireAuth, requirePermission("GET /api/students/:id/report.pdf"), asyncHandler(async (req, res) => {
  const { gradeBookService, reportPdfService } = await getRuntime();
  const backOfficeState = await getAuthoritativeBackOfficeState();
  const { students } = backOfficeState;
  const student = findStudent(tenantScopeService.filterRows(students, req.principal), req.params.id);

  if (!student) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }

  const period = req.query.period ? String(req.query.period) : "Trimestre 1";
  const { resolveBulletinLayoutForStudent } = require("./lib/documentsExamsService");
  const design = await resolveBulletinLayoutForStudent(repository, student);
  const baseReport = gradeBookService.generateReport(student.id, period, "Publié");
  const report = applyBulletinDesignToReport(baseReport, design);
  const pdf = await reportPdfService.generateReportCardPdf(report);
  const filename = `bulletin-${student.matricule}-${period.replace(/\s+/g, "-").toLowerCase()}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Content-Length", pdf.length);
  res.send(pdf);
}));

/** Fiche élève : même jeton Présences:READ (parcours Parent E2E /students/:id/presences). */
app.get("/api/students/:id/presences", requireAuth, requirePermission("GET /api/students/:id/presences"), asyncHandler(async (req, res) => {
  const { assertPresenceReadable, filterPresenceRows } = require("./lib/presenceSchoolScope");
  const principal = await presenceHttpPrincipal(req);
  const scope = assertPresenceReadable(principal);
  const { presences, students } = await loadCanonicalPedagogyForPrincipal(principal);
  const student = resolveAuthorizedStudentForPrincipal(students, principal, req.params.id);
  if (!student) {
    return res.json([]);
  }
  const studentIds = buildScopedStudentIdSet([student]);
  res.json(
    filterPresenceRows(presences, scope).filter((presence) => studentIds.has(String(presence.studentId ?? ""))),
  );
}));

app.get("/api/students/:id/payments", requireAuth, requirePermission("GET /api/students/:id/payments"), asyncHandler(async (req, res) => {
  const { payments, students } = await loadCanonicalFinanceForPrincipal(req.principal);
  const student = resolveAuthorizedStudentForPrincipal(students, req.principal, req.params.id);
  if (!student) {
    return res.json([]);
  }
  const studentIds = buildScopedStudentIdSet([student]);
  res.json(payments.filter((payment) => studentIds.has(String(payment.studentId ?? ""))));
}));

app.get("/api/teachers", requireAuth, requirePermission("GET /api/teachers"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const rows = await repository.listSchoolTeachers(schoolCode);
  const result = rows.map((teacher) => {
    const safeTeacher = sanitizeUserForResponse(teacher);
    return {
      ...safeTeacher,
      assignedClasses: [
        ...new Set(
          (safeTeacher.assignedClasses?.length
            ? safeTeacher.assignedClasses
            : (safeTeacher.assignments ?? []).map((item) => item.className)
          ).filter(Boolean),
        ),
      ],
      courses: [
        ...new Set(
          (safeTeacher.courses?.length
            ? safeTeacher.courses
            : (safeTeacher.assignments ?? []).map((item) => item.course)
          ).filter(Boolean),
        ),
      ],
    };
  });
  sendList(res, result, req.query, ["name", "phone", "email", "mainSubject", "firstName", "lastName"]);
}));

app.get("/api/teachers/:teacherCode", requireAuth, requirePermission("GET /api/teachers/:teacherCode"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const teacher = await repository.getSchoolTeacherByCode(req.params.teacherCode, schoolCode);
  const safeTeacher = sanitizeUserForResponse(teacher);
  res.json({
    ...safeTeacher,
    assignedClasses: [
      ...new Set(
        (safeTeacher.assignedClasses?.length
          ? safeTeacher.assignedClasses
          : (safeTeacher.assignments ?? []).map((item) => item.className)
        ).filter(Boolean),
      ),
    ],
    courses: [
      ...new Set(
        (safeTeacher.courses?.length
          ? safeTeacher.courses
          : (safeTeacher.assignments ?? []).map((item) => item.course)
        ).filter(Boolean),
      ),
    ],
  });
}));

app.post("/api/teachers", requireAuth, requirePermission("POST /api/teachers"), asyncHandler(async (_req, res) => {
  res.status(403).json({
    error: "La création d'une identité utilisateur ne part plus du module Enseignants. Créez le compte dans Comptes utilisateurs puis attribuez le rôle Enseignant.",
    code: "TEACHER_IDENTITY_MUST_COME_FROM_USERS",
  });
}));

app.patch("/api/teachers/:teacherCode", requireAuth, requirePermission("PATCH /api/teachers/:teacherCode"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const updated = await repository.updateSchoolTeacher(
    req.params.teacherCode,
    req.body ?? {},
    schoolCode,
    req.principal,
    auditMetaFromRequest(req),
  );
  const safeTeacher = sanitizeUserForResponse(updated);
  res.json({
    ...safeTeacher,
    assignedClasses: [
      ...new Set(
        (safeTeacher.assignedClasses?.length
          ? safeTeacher.assignedClasses
          : (safeTeacher.assignments ?? []).map((item) => item.className)
        ).filter(Boolean),
      ),
    ],
    courses: [
      ...new Set(
        (safeTeacher.courses?.length
          ? safeTeacher.courses
          : (safeTeacher.assignments ?? []).map((item) => item.course)
        ).filter(Boolean),
      ),
    ],
  });
}));

app.delete("/api/teachers/:teacherCode", requireAuth, requirePermission("DELETE /api/teachers/:teacherCode"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const result = await repository.archiveSchoolTeacher(
    req.params.teacherCode,
    schoolCode,
    req.principal,
    auditMetaFromRequest(req),
  );
  res.json(result);
}));


function canResetUserPassword(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  return (
    permissions.has("ALL_PRIVILEGES") ||
    permissions.has("COUNTRY_PRIVILEGES") ||
    permissions.has("Utilisateurs:UPDATE") ||
    permissions.has("Gérer utilisateurs")
  );
}

async function usersHttpPrincipal(req) {
  const {
    attachUsersMembershipScope,
    attachUsersFixtureScope,
    attachUsersMemoryMembership,
  } = require("./lib/usersSchoolScope");
  if (repository?.engine !== "memory" && typeof repository.one === "function") {
    return attachUsersMembershipScope(req.principal, repository.one.bind(repository));
  }
  if (typeof repository.getClientsStore === "function") {
    return attachUsersMemoryMembership(req.principal, repository.getClientsStore());
  }
  return attachUsersFixtureScope(req.principal);
}

function usersApiUser(user) {
  const { projectUsersApiUser } = require("./lib/usersSchoolScope");
  return sanitizeUserForResponse(projectUsersApiUser(user));
}

function usersApiUsers(users) {
  const { projectUsersApiUser } = require("./lib/usersSchoolScope");
  return sanitizeUsersForResponse((Array.isArray(users) ? users : []).map(projectUsersApiUser));
}

app.post("/api/users/:id/reset-password", requireAuth, asyncHandler(async (req, res) => {
  if (!canResetUserPassword(req.principal)) {
    throw new BusinessError(403, "Permission insuffisante pour réinitialiser le mot de passe.");
  }

  const {
    assertUsersReadable,
    assertUsersTargetAccess,
    filterUsersRows,
  } = require("./lib/usersSchoolScope");
  const principal = await usersHttpPrincipal(req);
  const scope = assertUsersReadable(principal);
  const canonicalUsers = await repository.listClientsUsers(scope);
  const scopedUsers = filterUsersRows(canonicalUsers, scope);
  const requested = String(req.params.id);
  const target = scopedUsers.find((user) =>
    [user.id, user.publicId, user.identityCode, user.userCode, user.identifier].some(
      (value) => String(value ?? "") === requested,
    ),
  );

  if (!target) {
    throw new BusinessError(404, "Utilisateur introuvable dans votre établissement.");
  }
  assertUsersTargetAccess(principal, target);

  if (isPendingValidationUser(target) && !isSuperAdminPrincipal(req.principal)) {
    throw new BusinessError(
      409,
      "Compte en attente de validation par le Super Administrateur. Aucune action n'est possible avant validation.",
    );
  }

  const temporaryPassword = String(req.body?.temporaryPassword ?? "").trim();
  const passwordError = validateAccountSecret(temporaryPassword);
  if (passwordError) {
    throw new BusinessError(400, passwordError);
  }

  const lookupAliases = [
    target.id,
    target.publicId,
    target.identityCode,
    target.userCode,
    target.identifier,
  ].filter(Boolean);
  const lockoutAliases = [
    target.publicId,
    target.identityCode,
    target.userCode,
    target.identifier,
    target.email,
    target.phone,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  const schoolScopes = [...new Set([
    target.schoolCode,
    req.principal?.schoolCode,
    "*",
  ]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter(Boolean))];

  // Reset + révocation sessions (+ déverrouillage PG si transaction SQL).
  const updatedUser = await repository.withTransaction(async (tx) => {
    const txRepo = repository.createTxScope(tx);
    const updated = await txRepo.resetUserPassword(lookupAliases, temporaryPassword);
    if (!updated) {
      throw new BusinessError(404, "Utilisateur introuvable dans votre établissement.");
    }

    const revokeId = updated.id ?? updated.userId ?? target.id;
    if (typeof txRepo.revokeAllSessionsForUser === "function") {
      await txRepo.revokeAllSessionsForUser(revokeId, "password_reset");
    } else if (tx && typeof tx.query === "function") {
      await tx.query(
        `UPDATE sessions
         SET revoked_at = NOW(), revoke_reason = 'password_reset'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [revokeId],
      );
    }

    if (lockoutAliases.length && schoolScopes.length && tx && typeof tx.query === "function") {
      await tx.query(
        `DELETE FROM login_lockouts
         WHERE identifier_normalized = ANY($1::text[])
           AND school_scope = ANY($2::text[])`,
        [lockoutAliases, schoolScopes],
      );
    }
    return updated;
  });

  await auditService.record(req, "reset_user_password", "user", target.id, {
    user: target.identifier ?? target.publicId,
    oldPasswordInvalidated: true,
    sessionsRevoked: true,
    loginLockoutCleared: true,
  });
  res.json({
    temporaryPassword,
    user: {
      ...sanitizeUserForResponse(updatedUser),
      hasTemporaryPassword: true,
    },
  });
}));

app.get("/api/payments", requireAuth, requirePermission("GET /api/payments"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const { payments, students } = await loadCanonicalFinanceForPrincipal(principal);
  const scope = deriveSchoolScope(principal, { students });
  let scopedPayments = tenantScopeService.filterRows(payments, principal, scope);
  const result = scopedPayments.map((payment) => {
    const student = findStudent(students, payment.studentId);
    return {
      ...payment,
      studentName: student?.name || payment.studentName || "Eleve inconnu",
      className: student?.className || payment.className || "",
    };
  });

  sendList(res, result, req.query, ["studentName", "className", "status", "method"]);
}));

app.post("/api/payments", requireAuth, requirePermission("POST /api/payments"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/payments",
    principal: req.principal,
    handler: async () => {
      const body = req.body ?? {};
      const { financeAuditMetaFromRequest } = require("./lib/financeManagement");
      const payment = await repository.createSchoolPayment(body, req.principal, financeAuditMetaFromRequest(req));
      return { statusCode: 201, body: payment };
    },
  });
}));

app.get("/api/payments/:paymentId", requireAuth, requirePermission("GET /api/payments/:paymentId"), asyncHandler(async (req, res) => {
  const payment = await repository.getSchoolPayment(req.params.paymentId, req.principal);
  if (!payment) throw new BusinessError(404, "Paiement introuvable");
  res.json(payment);
}));

app.post("/api/payments/:paymentId/cancel", requireAuth, requirePermission("POST /api/payments/:paymentId/cancel"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: `POST /api/payments/${req.params.paymentId}/cancel`,
    principal: req.principal,
    handler: async () => {
      const { financeAuditMetaFromRequest } = require("./lib/financeManagement");
      const payment = await repository.cancelSchoolPayment(
        req.params.paymentId,
        req.body?.reason ?? req.body?.cancelReason,
        req.principal,
        financeAuditMetaFromRequest(req),
      );
      return { statusCode: 200, body: payment };
    },
  });
}));

app.get("/api/finance/payment-student-options", requireAuth, requirePermission("GET /api/finance/payment-student-options"), asyncHandler(async (req, res) => {
  const rows = await repository.listPaymentStudentOptions(req.principal);
  sendList(res, rows, req.query, ["studentCode", "firstName", "lastName", "className", "classCode"]);
}));

app.get("/api/finance/catalog", requireAuth, requirePermission("GET /api/finance/catalog"), asyncHandler(async (req, res) => {
  const catalog = await repository.getFinanceCatalog(req.principal);
  res.json(catalog);
}));

app.get("/api/finance/payment-methods", requireAuth, requirePermission("GET /api/finance/payment-methods"), asyncHandler(async (req, res) => {
  const rows = await repository.listSchoolPaymentMethods(req.principal);
  sendList(res, rows, req.query, ["methodCode", "label"]);
}));

app.put("/api/finance/payment-methods", requireAuth, requirePermission("PUT /api/finance/payment-methods"), asyncHandler(async (req, res) => {
  assertCanManagePaymentMethods(req.principal);
  const rows = await repository.replaceSchoolPaymentMethods(req.body?.methods ?? req.body ?? [], req.principal);
  res.json(rows);
}));

app.get("/api/finance/payment-statuses", requireAuth, requirePermission("GET /api/finance/payment-statuses"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const rows = await repository.listFinancePaymentStatuses(principal);
  sendList(res, tenantScopeService.filterRows(rows, principal), req.query, ["code", "label", "status"]);
}));

app.post("/api/finance/payment-statuses", requireAuth, requirePermission("POST /api/finance/payment-statuses"), asyncHandler(async (req, res) => {
  assertCanManagePaymentStatuses(req.principal);
  const row = await repository.upsertFinancePaymentStatus(req.body ?? {}, req.principal);
  res.status(201).json(row);
}));

app.patch("/api/finance/payment-statuses/:statusId", requireAuth, requirePermission("PATCH /api/finance/payment-statuses/:statusId"), asyncHandler(async (req, res) => {
  assertCanManagePaymentStatuses(req.principal);
  const row = await repository.upsertFinancePaymentStatus(
    { ...(req.body ?? {}), code: req.params.statusId, id: req.params.statusId },
    req.principal,
  );
  res.json(row);
}));

function assertCanManageFeeGrids(principal) {
  const { canManageFeeGrids } = require("./lib/financeManagement");
  if (canManageFeeGrids(principal)) return;
  throw new BusinessError(403, "Permission insuffisante pour gérer les grilles tarifaires.");
}

function assertCanManagePaymentMethods(principal) {
  const { canManagePaymentMethods } = require("./lib/financeManagement");
  if (canManagePaymentMethods(principal)) return;
  throw new BusinessError(403, "Permission insuffisante pour configurer les moyens de paiement.");
}

function assertCanManagePaymentStatuses(principal) {
  const { canManagePaymentStatuses } = require("./lib/financeManagement");
  if (canManagePaymentStatuses(principal)) return;
  throw new BusinessError(403, "Permission insuffisante pour gérer les statuts de paiement.");
}

function assertCanAdjustStudentFee(principal) {
  const { canAdjustStudentFee } = require("./lib/financeManagement");
  if (canAdjustStudentFee(principal)) return;
  throw new BusinessError(403, "Permission insuffisante pour ajuster une obligation.");
}

async function financeHttpPrincipal(req) {
  const { attachFinanceMembershipScope, attachFinanceFixtureScope } = require("./lib/financeSchoolScope");
  if (typeof repository.one === "function") {
    return attachFinanceMembershipScope(req.principal, repository.one.bind(repository));
  }
  return attachFinanceFixtureScope(req.principal);
}

app.get("/api/finance/fee-grids", requireAuth, requirePermission("GET /api/finance/fee-grids"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const rows = await repository.listFinanceFeeGrids(principal);
  sendList(res, tenantScopeService.filterRows(rows, principal, { countryField: "countryIso" }), req.query, ["className", "academicYear", "status"]);
}));

app.post("/api/finance/fee-grids", requireAuth, requirePermission("POST /api/finance/fee-grids"), asyncHandler(async (req, res) => {
  assertCanManageFeeGrids(req.principal);
  const grid = await repository.upsertFinanceFeeGrid(req.body ?? {}, req.principal);
  res.status(201).json(grid);
}));

app.get("/api/finance/fee-grids/:gridId", requireAuth, requirePermission("GET /api/finance/fee-grids"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const detail = await repository.getFinanceFeeGrid(req.params.gridId, principal);
  if (!detail) throw new BusinessError(404, "Grille introuvable");
  const { resolveFinanceSchoolScope, schoolRecordInFinanceScope } = require("./lib/financeSchoolScope");
  if (!schoolRecordInFinanceScope(detail.grid, resolveFinanceSchoolScope(principal))) {
    throw new BusinessError(404, "Grille introuvable");
  }
  res.json(detail);
}));

app.patch("/api/finance/fee-grids/:gridId", requireAuth, requirePermission("PATCH /api/finance/fee-grids/:gridId"), asyncHandler(async (req, res) => {
  assertCanManageFeeGrids(req.principal);
  const grid = await repository.upsertFinanceFeeGrid({ ...(req.body ?? {}), id: req.params.gridId }, req.principal);
  res.json(grid);
}));

app.post("/api/finance/fee-grids/:gridId/activate", requireAuth, requirePermission("POST /api/finance/fee-grids/:gridId/activate"), asyncHandler(async (req, res) => {
  assertCanManageFeeGrids(req.principal);
  const grid = await repository.setFinanceFeeGridStatus(req.params.gridId, "Active", req.principal);
  res.json(grid);
}));

app.post("/api/finance/fee-grids/:gridId/deactivate", requireAuth, requirePermission("POST /api/finance/fee-grids/:gridId/deactivate"), asyncHandler(async (req, res) => {
  assertCanManageFeeGrids(req.principal);
  const grid = await repository.setFinanceFeeGridStatus(req.params.gridId, "Désactivée", req.principal);
  res.json(grid);
}));

app.post("/api/finance/fee-grids/:gridId/apply", requireAuth, requirePermission("POST /api/finance/fee-grids/:gridId/apply"), asyncHandler(async (req, res) => {
  assertCanManageFeeGrids(req.principal);
  await withIdempotency({
    req,
    res,
    routeKey: `POST /api/finance/fee-grids/${req.params.gridId}/apply`,
    principal: req.principal,
    handler: async () => {
      const result = await repository.applyFinanceFeeGrid(req.params.gridId, req.principal, req.body ?? {});
      return { statusCode: 200, body: result };
    },
  });
}));

app.get("/api/finance/student-fees", requireAuth, requirePermission("GET /api/finance/student-fees"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const rows = await repository.listFinanceStudentFees(principal);
  sendList(res, tenantScopeService.filterRows(rows, principal, { countryField: "countryIso" }), req.query, ["studentName", "label", "status"]);
}));

app.post("/api/finance/reconcile-payment-allocations", requireAuth, requirePermission("POST /api/finance/reconcile-payment-allocations"), asyncHandler(async (req, res) => {
  const { financeAuditMetaFromRequest } = require("./lib/financeManagement");
  const result = await repository.reconcileFinancePaymentAllocations(
    req.principal,
    req.body ?? {},
    financeAuditMetaFromRequest(req),
  );
  res.json(result);
}));

app.get("/api/finance/student-fees/:obligationId", requireAuth, requirePermission("GET /api/finance/student-fees"), asyncHandler(async (req, res) => {
  const row = await repository.getFinanceStudentFee(req.params.obligationId, req.principal);
  if (!row) throw new BusinessError(404, "Obligation introuvable");
  res.json(row);
}));

app.post("/api/finance/student-fees/:obligationId/adjust", requireAuth, requirePermission("POST /api/finance/student-fees/:obligationId/adjust"), asyncHandler(async (req, res) => {
  assertCanAdjustStudentFee(req.principal);
  const row = await repository.adjustFinanceStudentFee(req.params.obligationId, req.body ?? {}, req.principal);
  res.json(row);
}));


app.get("/api/backoffice/countries", requireAuth, requirePermission("GET /api/backoffice/countries"), asyncHandler(async (req, res) => {
  const platform = await repository.listPlatformProjection();
  res.json(tenantScopeService.filterRows(platform.countries ?? [], req.principal, { countryField: "code" }));
}));

app.get("/api/backoffice/subscriptions", requireAuth, requirePermission("GET /api/backoffice/subscriptions"), asyncHandler(async (req, res) => {
  const platform = await repository.listPlatformProjection();
  sendList(res, tenantScopeService.filterRows(platform.subscriptions ?? [], req.principal), req.query, ["schoolCode", "country", "plan", "status"]);
}));

app.get("/api/backoffice/notifications", requireAuth, requirePermission("GET /api/backoffice/notifications"), asyncHandler(async (req, res) => {
  const platform = await repository.listPlatformProjection();
  sendList(res, tenantScopeService.filterRows(platform.notifications ?? [], req.principal), req.query, ["title", "message", "type", "status"]);
}));

app.post("/api/backoffice/countries", requireAuth, requirePermission("POST /api/backoffice/countries"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const created = await repository.createPlatformCountry(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/countries/:code", requireAuth, requirePermission("PATCH /api/backoffice/countries/:code"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const updated = await repository.updatePlatformCountry(req.params.code, req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/subscriptions", requireAuth, requirePermission("POST /api/backoffice/subscriptions"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const saved = await repository.upsertPlatformSubscription(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.status(201).json(saved);
}));

app.patch("/api/backoffice/subscriptions/:subscriptionId", requireAuth, requirePermission("PATCH /api/backoffice/subscriptions/:subscriptionId"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const saved = await repository.upsertPlatformSubscription({ ...req.body, id: req.params.subscriptionId }, req.principal, platformAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/backoffice/notifications", requireAuth, requirePermission("POST /api/backoffice/notifications"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const created = await repository.createPlatformNotification(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/notifications/:notificationId", requireAuth, requirePermission("PATCH /api/backoffice/notifications/:notificationId"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const updated = await repository.updatePlatformNotification(req.params.notificationId, req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.json(updated);
}));

app.get("/api/backoffice/role-permissions", requireAuth, requirePermission("GET /api/backoffice/role-permissions"), asyncHandler(async (req, res) => {
  const map = (await repository.getRolePermissionsMap()) ?? {};
  res.json(map);
}));

app.put("/api/backoffice/role-permissions", requireAuth, requirePermission("PUT /api/backoffice/role-permissions"), asyncHandler(async () => {
  const { throwLegacyRolePermissionsWrite } = require("./lib/functionalRbacService");
  throwLegacyRolePermissionsWrite();
}));

app.get("/api/backoffice/rbac/catalog", requireAuth, requirePermission("GET /api/backoffice/rbac/catalog"), asyncHandler(async (req, res) => {
  const catalog = await repository.listRbacCatalog(req.principal);
  res.json(catalog);
}));

app.get("/api/backoffice/rbac/permissions", requireAuth, requirePermission("GET /api/backoffice/rbac/permissions"), asyncHandler(async (req, res) => {
  const configured = await repository.getConfiguredRolePermissions(req.query ?? {}, req.principal);
  res.json(configured);
}));

app.get("/api/backoffice/rbac/permissions/effective", requireAuth, requirePermission("GET /api/backoffice/rbac/permissions/effective"), asyncHandler(async (req, res) => {
  const effective = await repository.getEffectiveRolePermissions(req.query ?? {}, req.principal);
  res.json(effective);
}));

app.patch("/api/backoffice/rbac/permissions", requireAuth, requirePermission("PATCH /api/backoffice/rbac/permissions"), asyncHandler(async (req, res) => {
  const { functionalRbacAuditMetaFromRequest } = require("./lib/functionalRbacService");
  const saved = await repository.patchConfiguredRolePermissions(
    req.body ?? {},
    req.principal,
    functionalRbacAuditMetaFromRequest(req),
  );
  res.json(saved);
}));

app.post("/api/backoffice/rbac/roles", requireAuth, requirePermission("POST /api/backoffice/rbac/roles"), asyncHandler(async (req, res) => {
  const { establishmentRolesAuditMetaFromRequest } = require("./lib/establishmentRolesManagement");
  const created = await repository.createEstablishmentRole(
    req.body ?? {},
    req.principal,
    establishmentRolesAuditMetaFromRequest(req),
  );
  res.status(201).json(created);
}));

app.patch("/api/backoffice/rbac/roles/:roleId", requireAuth, requirePermission("PATCH /api/backoffice/rbac/roles/:roleId"), asyncHandler(async (req, res) => {
  const { establishmentRolesAuditMetaFromRequest } = require("./lib/establishmentRolesManagement");
  const updated = await repository.updateEstablishmentRole(
    req.params.roleId,
    req.body ?? {},
    req.principal,
    establishmentRolesAuditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.post("/api/backoffice/rbac/roles/:roleId/archive", requireAuth, requirePermission("POST /api/backoffice/rbac/roles/:roleId/archive"), asyncHandler(async (req, res) => {
  const { archiveRbacRole, functionalRbacAuditMetaFromRequest } = require("./lib/functionalRbacService");
  const archived = await archiveRbacRole(
    repository,
    req.params.roleId,
    req.principal,
    functionalRbacAuditMetaFromRequest(req),
  );
  res.json(archived);
}));

app.get("/api/backoffice/dashboard-chart-config", requireAuth, requirePermission("GET /api/backoffice/dashboard-chart-config"), asyncHandler(async (req, res) => {
  const platform = await repository.listPlatformProjection();
  res.json(sanitizeDashboardChartConfig(platform.dashboardChartConfig));
}));

app.put("/api/backoffice/dashboard-chart-config", requireAuth, requirePermission("PUT /api/backoffice/dashboard-chart-config"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const saved = await repository.savePlatformDashboardChartConfig(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/backoffice/subscription-offers", requireAuth, requirePermission("POST /api/backoffice/subscription-offers"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const saved = await repository.upsertPlatformSubscriptionOffer(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.status(201).json(saved);
}));

app.patch("/api/backoffice/subscription-offers/:offerId", requireAuth, requirePermission("PATCH /api/backoffice/subscription-offers/:offerId"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const saved = await repository.upsertPlatformSubscriptionOffer({ ...req.body, id: req.params.offerId }, req.principal, platformAuditMetaFromRequest(req));
  res.json(saved);
}));

app.post("/api/backoffice/subscription-payments", requireAuth, requirePermission("POST /api/backoffice/subscription-payments"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const created = await repository.createPlatformSubscriptionPayment(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/subscription-payments/:paymentId", requireAuth, requirePermission("PATCH /api/backoffice/subscription-payments/:paymentId"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const updated = await repository.updatePlatformSubscriptionPayment(req.params.paymentId, req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/subscription-discounts", requireAuth, requirePermission("POST /api/backoffice/subscription-discounts"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const created = await repository.createPlatformSubscriptionDiscount(req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/subscription-discounts/:discountId", requireAuth, requirePermission("PATCH /api/backoffice/subscription-discounts/:discountId"), asyncHandler(async (req, res) => {
  const { platformAuditMetaFromRequest } = require("./lib/platformManagement");
  const updated = await repository.updatePlatformSubscriptionDiscount(req.params.discountId, req.body ?? {}, req.principal, platformAuditMetaFromRequest(req));
  res.json(updated);
}));

const { clientsAuditMetaFromRequest } = require("./lib/clientsManagement");

app.get("/api/backoffice/users", requireAuth, requirePermission("GET /api/backoffice/users"), asyncHandler(async (req, res) => {
  const { assertUsersReadable, filterUsersRows } = require("./lib/usersSchoolScope");
  const principal = await usersHttpPrincipal(req);
  const scope = assertUsersReadable(principal);
  const users = await repository.listClientsUsers(scope);
  sendList(res, usersApiUsers(filterUsersRows(users, scope)), req.query, ["firstName", "lastName", "identifier", "role", "schoolCode"]);
}));

app.get("/api/backoffice/users/assignable-roles", requireAuth, requirePermission("GET /api/backoffice/users/assignable-roles"), asyncHandler(async (req, res) => {
  const roles = await repository.listAssignableClientsUserRoles(req.principal);
  res.json({ roles });
}));

app.post("/api/backoffice/users", requireAuth, requirePermission("POST /api/backoffice/users"), asyncHandler(async (req, res) => {
  const principal = await usersHttpPrincipal(req);
  const created = await repository.createClientsUser(req.body ?? {}, principal, clientsAuditMetaFromRequest(req));
  res.status(201).json(usersApiUser(created));
}));

app.post("/api/backoffice/users/provision", requireAuth, requirePermission("POST /api/backoffice/users/provision"), asyncHandler(async (req, res) => {
  const principal = await usersHttpPrincipal(req);
  const created = await repository.provisionClientsUser(req.body ?? {}, principal, clientsAuditMetaFromRequest(req));
  res.status(201).json(usersApiUser(created));
}));

app.post("/api/backoffice/users/create-teacher", requireAuth, requirePermission("POST /api/backoffice/users/create-teacher"), asyncHandler(async (req, res) => {
  if (!rbacService.canAccess(req.principal, "POST /api/backoffice/users/:userId/roles/grant")) {
    throw denyPermission("Utilisateurs:UPDATE requis pour attribuer le rôle Enseignant.");
  }
  const { createTeacherIdentityFromUsers } = require("./lib/createTeacherIdentityFromUsers");
  const principal = await usersHttpPrincipal(req);
  const created = await createTeacherIdentityFromUsers(
    repository,
    req.body ?? {},
    principal,
    clientsAuditMetaFromRequest(req),
  );
  res.status(201).json({
    user: usersApiUser(created.user),
    credentials: created.credentials,
  });
}));

app.patch("/api/backoffice/users/:userId", requireAuth, requirePermission("PATCH /api/backoffice/users/:userId"), asyncHandler(async (req, res) => {
  const principal = await usersHttpPrincipal(req);
  const updated = await repository.updateClientsUser(req.params.userId, req.body ?? {}, principal, clientsAuditMetaFromRequest(req));
  res.json(usersApiUser(updated));
}));

app.post("/api/backoffice/users/:userId/reassign-school", requireAuth, requirePermission("POST /api/backoffice/users/:userId/reassign-school"), asyncHandler(async (req, res) => {
  const principal = await usersHttpPrincipal(req);
  const updated = await repository.reassignClientsUserSchool(
    req.params.userId,
    req.body ?? {},
    principal,
    clientsAuditMetaFromRequest(req),
  );
  res.json(usersApiUser(updated));
}));

app.post("/api/backoffice/users/:userId/roles/grant", requireAuth, requirePermission("POST /api/backoffice/users/:userId/roles/grant"), asyncHandler(async (req, res) => {
  const principal = await usersHttpPrincipal(req);
  const updated = await repository.grantClientsUserRole(req.params.userId, req.body ?? {}, principal, clientsAuditMetaFromRequest(req));
  res.json(usersApiUser(updated));
}));

app.post("/api/backoffice/users/:userId/roles/revoke", requireAuth, requirePermission("POST /api/backoffice/users/:userId/roles/revoke"), asyncHandler(async (req, res) => {
  const principal = await usersHttpPrincipal(req);
  const updated = await repository.revokeClientsUserRole(req.params.userId, req.body ?? {}, principal, clientsAuditMetaFromRequest(req));
  res.json(usersApiUser(updated));
}));

app.get("/api/backoffice/contacts", requireAuth, requirePermission("GET /api/backoffice/contacts"), asyncHandler(async (req, res) => {
  const clients = await repository.listClientsProjection();
  sendList(res, tenantScopeService.filterRows(clients.contacts ?? [], req.principal), req.query, ["firstName", "lastName", "contactType", "phone", "email"]);
}));

app.post("/api/backoffice/contacts", requireAuth, requirePermission("POST /api/backoffice/contacts"), asyncHandler(async (req, res) => {
  const created = await repository.createClientsContact(req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
  res.status(201).json(created);
}));

app.patch("/api/backoffice/contacts/:contactId", requireAuth, requirePermission("PATCH /api/backoffice/contacts/:contactId"), asyncHandler(async (req, res) => {
  const updated = await repository.updateClientsContact(req.params.contactId, req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/contacts/:contactId/provision-account", requireAuth, requirePermission("POST /api/backoffice/contacts/:contactId/provision-account"), asyncHandler(async (req, res) => {
  const result = await repository.provisionClientsContactAccount(req.params.contactId, req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
  res.status(result.created ? 201 : 200).json({
    ...result,
    user: sanitizeUserForResponse(result.user),
  });
}));

app.get("/api/backoffice/relations", requireAuth, requirePermission("GET /api/backoffice/relations"), asyncHandler(async (req, res) => {
  const clients = await repository.listClientsProjection();
  sendList(res, tenantScopeService.filterRows(clients.relations ?? [], req.principal), req.query, ["relationType", "fromContactName", "toStudentName"]);
}));

app.post("/api/backoffice/relations", requireAuth, requirePermission("POST /api/backoffice/relations"), asyncHandler(async (req, res) => {
  const result = await repository.createClientsRelation(req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
  const created = Boolean(result?.created);
  const body = result?.relation ?? result;
  res.status(created ? 201 : 200).json(body);
}));

app.get("/api/parents/identity", requireAuth, requirePermission("GET /api/parents/identity"), asyncHandler(async (req, res) => {
  const result = await repository.lookupParentIdentity(req.query ?? {}, req.principal);
  res.json({
    ...result,
    user: result.user ? sanitizeUserForResponse(result.user) : null,
  });
}));

app.post("/api/parents/link", requireAuth, requirePermission("POST /api/parents/link"), asyncHandler(async (req, res) => {
  const result = await repository.linkParent(req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
  res.status(result.created ? 201 : 200).json({
    ...result,
    user: sanitizeUserForResponse(result.user),
  });
}));

app.patch("/api/parents/relations/:relationId", requireAuth, requirePermission("PATCH /api/parents/relations/:relationId"), asyncHandler(async (req, res) => {
  const result = await repository.archiveParentRelation(
    req.params.relationId,
    req.body ?? {},
    req.principal,
    clientsAuditMetaFromRequest(req),
  );
  res.json(result);
}));

app.get("/api/backoffice/messages/unread-count", requireAuth, requirePermission("GET /api/backoffice/messages/unread-count"), asyncHandler(async (req, res) => {
  const result = await repository.getClientMessagesUnreadCount(req.principal, req.query);
  res.json(result);
}));

app.get("/api/backoffice/messages/recipients", requireAuth, requirePermission("GET /api/backoffice/messages/recipients"), asyncHandler(async (req, res) => {
  const result = await repository.listClientMessageRecipients(req.principal, req.query);
  res.json(result);
}));

app.get("/api/backoffice/messages/:messageId", requireAuth, requirePermission("GET /api/backoffice/messages/:messageId"), asyncHandler(async (req, res) => {
  const row = await repository.getClientMessage(req.params.messageId, req.principal, req.query);
  res.json(row);
}));

app.get("/api/backoffice/messages", requireAuth, requirePermission("GET /api/backoffice/messages"), asyncHandler(async (req, res) => {
  const rows = await repository.listClientsMessages(req.principal, req.query);
  sendList(res, rows, req.query, ["theme", "message", "status", "direction", "senderName"]);
}));

app.post("/api/backoffice/messages", requireAuth, requirePermission("POST /api/backoffice/messages"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/backoffice/messages",
    principal: req.principal,
    handler: async () => {
      const created = await repository.sendClientsMessage(
        req.body ?? {},
        req.principal,
        clientsAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: created };
    },
  });
}));

app.patch("/api/backoffice/messages/:messageId/read", requireAuth, requirePermission("PATCH /api/backoffice/messages/:messageId/read"), asyncHandler(async (req, res) => {
  const updated = await repository.markClientsMessageRead(
    req.params.messageId,
    req.principal,
    clientsAuditMetaFromRequest(req),
    req.query,
  );
  res.json(updated);
}));

app.get("/api/backoffice/conversations", requireAuth, requirePermission("GET /api/backoffice/conversations"), asyncHandler(async (req, res) => {
  const result = await repository.listClientConversations(req.principal, req.query);
  res.json(result);
}));

app.post("/api/backoffice/conversations", requireAuth, requirePermission("POST /api/backoffice/conversations"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/backoffice/conversations",
    principal: req.principal,
    handler: async () => {
      const created = await repository.createClientConversation(
        req.body ?? {},
        req.principal,
        clientsAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: created };
    },
  });
}));

app.get("/api/backoffice/conversations/:conversationId", requireAuth, requirePermission("GET /api/backoffice/conversations/:conversationId"), asyncHandler(async (req, res) => {
  const row = await repository.getClientConversation(req.params.conversationId, req.principal, req.query);
  res.json(row);
}));

app.get("/api/backoffice/conversations/:conversationId/messages", requireAuth, requirePermission("GET /api/backoffice/conversations/:conversationId/messages"), asyncHandler(async (req, res) => {
  const result = await repository.listClientConversationMessages(req.params.conversationId, req.principal, req.query);
  res.json(result);
}));

app.post("/api/backoffice/conversations/:conversationId/messages", requireAuth, requirePermission("POST /api/backoffice/conversations/:conversationId/messages"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/backoffice/conversations/:conversationId/messages",
    principal: req.principal,
    handler: async () => {
      const created = await repository.replyClientConversationMessage(
        req.params.conversationId,
        req.body ?? {},
        req.principal,
        clientsAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: created };
    },
  });
}));

app.post(
  "/api/backoffice/communications/attachments",
  requireAuth,
  requirePermission("POST /api/backoffice/communications/attachments"),
  express.raw({ type: () => true, limit: "11mb" }),
  asyncHandler(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    const fileName = req.get("x-filename") || req.get("x-file-name") || "fichier";
    const mimeType = req.get("x-mime-type") || req.get("content-type") || "";
    const created = await repository.uploadCommunicationAttachment(req.principal, {
      buffer,
      fileName,
      mimeType,
    }, req.query);
    res.status(201).json(created);
  }),
);

app.get("/api/backoffice/communications/attachments/:attachmentId", requireAuth, requirePermission("GET /api/backoffice/communications/attachments/:attachmentId"), asyncHandler(async (req, res) => {
  const file = await repository.downloadCommunicationAttachment(req.params.attachmentId, req.principal, req.query);
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${String(file.fileName).replace(/"/g, "")}"`);
  res.send(file.bytes);
}));

app.get("/api/backoffice/announcements/unread-count", requireAuth, requirePermission("GET /api/backoffice/announcements/unread-count"), asyncHandler(async (req, res) => {
  const result = await repository.getClientsAnnouncementsUnreadCount(req.principal, req.query);
  res.json(result);
}));

app.get("/api/backoffice/announcements/audience-options", requireAuth, requirePermission("GET /api/backoffice/announcements/audience-options"), asyncHandler(async (req, res) => {
  const result = await repository.listAnnouncementAudienceOptions(req.principal, req.query);
  res.json(result);
}));

app.get("/api/backoffice/announcements", requireAuth, requirePermission("GET /api/backoffice/announcements"), asyncHandler(async (req, res) => {
  const result = await repository.listClientsAnnouncements(req.principal, req.query);
  res.json(result);
}));

app.post("/api/backoffice/announcements", requireAuth, requirePermission("POST /api/backoffice/announcements"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/backoffice/announcements",
    principal: req.principal,
    handler: async () => {
      const created = await repository.createClientsAnnouncement(req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
      return { statusCode: 201, body: created };
    },
  });
}));

app.post(
  "/api/backoffice/announcements/attachments",
  requireAuth,
  requirePermission("POST /api/backoffice/announcements/attachments"),
  express.raw({ type: () => true, limit: "11mb" }),
  asyncHandler(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    const fileName = req.get("x-filename") || req.get("x-file-name") || "fichier";
    const mimeType = req.get("x-mime-type") || req.get("content-type") || "";
    const created = await repository.uploadAnnouncementAttachment(req.principal, {
      buffer,
      fileName,
      mimeType,
    }, req.query);
    res.status(201).json(created);
  }),
);

app.get("/api/backoffice/announcements/:announcementId", requireAuth, requirePermission("GET /api/backoffice/announcements/:announcementId"), asyncHandler(async (req, res) => {
  const row = await repository.getClientsAnnouncement(req.params.announcementId, req.principal, req.query);
  res.json(row);
}));

app.patch("/api/backoffice/announcements/:announcementId/read", requireAuth, requirePermission("PATCH /api/backoffice/announcements/:announcementId/read"), asyncHandler(async (req, res) => {
  const updated = await repository.markClientsAnnouncementRead(
    req.params.announcementId,
    req.principal,
    clientsAuditMetaFromRequest(req),
    req.query,
  );
  res.json(updated);
}));

app.patch("/api/backoffice/announcements/:announcementId", requireAuth, requirePermission("PATCH /api/backoffice/announcements/:announcementId"), asyncHandler(async (req, res) => {
  const updated = await repository.updateClientsAnnouncement(req.params.announcementId, req.body ?? {}, req.principal, clientsAuditMetaFromRequest(req));
  res.json(updated);
}));

app.post("/api/backoffice/announcements/:announcementId/archive", requireAuth, requirePermission("POST /api/backoffice/announcements/:announcementId/archive"), asyncHandler(async (req, res) => {
  const archived = await repository.archiveClientsAnnouncement(
    req.params.announcementId,
    req.principal,
    clientsAuditMetaFromRequest(req),
    { ...(req.body ?? {}), ...(req.query ?? {}) },
  );
  res.json(archived);
}));

app.get("/api/backoffice/platform-announcements/unread-count", requireAuth, requirePermission("GET /api/backoffice/platform-announcements/unread-count"), asyncHandler(async (req, res) => {
  const result = await repository.getPlatformAnnouncementsUnreadCount(req.principal);
  res.json(result);
}));

app.get("/api/backoffice/platform-announcements", requireAuth, requirePermission("GET /api/backoffice/platform-announcements"), asyncHandler(async (req, res) => {
  const result = await repository.listPlatformAnnouncements(req.principal, req.query);
  res.json(result);
}));

app.post("/api/backoffice/platform-announcements", requireAuth, requirePermission("POST /api/backoffice/platform-announcements"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/backoffice/platform-announcements",
    principal: req.principal,
    handler: async () => {
      const created = await repository.createPlatformAnnouncement(
        req.body ?? {},
        req.principal,
        clientsAuditMetaFromRequest(req),
      );
      return { statusCode: 201, body: created };
    },
  });
}));

app.post(
  "/api/backoffice/platform-announcements/attachments",
  requireAuth,
  requirePermission("POST /api/backoffice/platform-announcements/attachments"),
  express.raw({ type: () => true, limit: "11mb" }),
  asyncHandler(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    const fileName = req.get("x-filename") || req.get("x-file-name") || "fichier";
    const mimeType = req.get("x-mime-type") || req.get("content-type") || "";
    const created = await repository.uploadPlatformAnnouncementAttachment(req.principal, {
      buffer,
      fileName,
      mimeType,
    });
    res.status(201).json(created);
  }),
);

app.get("/api/backoffice/platform-announcements/attachments/:attachmentId", requireAuth, requirePermission("GET /api/backoffice/platform-announcements/attachments/:attachmentId"), asyncHandler(async (req, res) => {
  const file = await repository.downloadPlatformAnnouncementAttachment(req.params.attachmentId, req.principal);
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${String(file.fileName).replace(/"/g, "")}"`);
  res.send(file.bytes);
}));

app.get("/api/backoffice/platform-announcements/:announcementId", requireAuth, requirePermission("GET /api/backoffice/platform-announcements/:announcementId"), asyncHandler(async (req, res) => {
  const row = await repository.getPlatformAnnouncement(req.params.announcementId, req.principal);
  res.json(row);
}));

app.patch("/api/backoffice/platform-announcements/:announcementId/read", requireAuth, requirePermission("PATCH /api/backoffice/platform-announcements/:announcementId/read"), asyncHandler(async (req, res) => {
  const updated = await repository.markPlatformAnnouncementRead(
    req.params.announcementId,
    req.principal,
    clientsAuditMetaFromRequest(req),
  );
  res.json(updated);
}));

app.post("/api/backoffice/platform-announcements/:announcementId/archive", requireAuth, requirePermission("POST /api/backoffice/platform-announcements/:announcementId/archive"), asyncHandler(async (req, res) => {
  const archived = await repository.archivePlatformAnnouncement(
    req.params.announcementId,
    req.principal,
    clientsAuditMetaFromRequest(req),
  );
  res.json(archived);
}));

app.get("/api/backoffice/internal-notifications/unread-count", requireAuth, requirePermission("GET /api/backoffice/internal-notifications/unread-count"), asyncHandler(async (req, res) => {
  const result = await internalNotificationsService.unreadCount(repository.getClientsStore(), req.principal, req.query);
  res.json(result);
}));

app.get("/api/backoffice/internal-notifications", requireAuth, requirePermission("GET /api/backoffice/internal-notifications"), asyncHandler(async (req, res) => {
  const result = await internalNotificationsService.list(repository.getClientsStore(), req.principal, req.query);
  res.json(result);
}));

app.post("/api/backoffice/internal-notifications", requireAuth, requirePermission("POST /api/backoffice/internal-notifications"), asyncHandler(async (req, res) => {
  const created = await internalNotificationsService.createManual(
    repository.getClientsStore(),
    req.body ?? {},
    req.principal,
    clientsAuditMetaFromRequest(req),
    req.get("idempotency-key"),
  );
  res.status(201).json(created);
}));

app.post(
  "/api/backoffice/internal-notifications/attachments",
  requireAuth,
  requirePermission("POST /api/backoffice/internal-notifications/attachments"),
  express.raw({ type: () => true, limit: "11mb" }),
  asyncHandler(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    const fileName = req.get("x-filename") || req.get("x-file-name") || "fichier";
    const mimeType = req.get("x-mime-type") || req.get("content-type") || "";
    const created = await internalNotificationsService.uploadAttachment(
      repository.getClientsStore(),
      req.principal,
      { buffer, fileName, mimeType },
      req.query,
    );
    res.status(201).json(created);
  }),
);

app.get("/api/backoffice/internal-notifications/attachments/:attachmentId", requireAuth, requirePermission("GET /api/backoffice/internal-notifications/attachments/:attachmentId"), asyncHandler(async (req, res) => {
  const file = await internalNotificationsService.downloadAttachment(
    repository.getClientsStore(),
    req.params.attachmentId,
    req.principal,
    req.query,
  );
  const safeName = String(file.fileName || "fichier").replace(/["\\r\\n]/g, "_");
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Content-Length", file.bytes.length);
  res.send(file.bytes);
}));

app.get("/api/backoffice/internal-notifications/:notificationId", requireAuth, requirePermission("GET /api/backoffice/internal-notifications/:notificationId"), asyncHandler(async (req, res) => {
  const row = await internalNotificationsService.get(
    repository.getClientsStore(), req.params.notificationId, req.principal, req.query,
  );
  res.json(row);
}));

app.patch("/api/backoffice/internal-notifications/:notificationId/read", requireAuth, requirePermission("PATCH /api/backoffice/internal-notifications/:notificationId/read"), asyncHandler(async (req, res) => {
  const row = await internalNotificationsService.markRead(
    repository.getClientsStore(), req.params.notificationId, req.principal, clientsAuditMetaFromRequest(req), req.query,
  );
  res.json(row);
}));

app.patch("/api/backoffice/internal-notifications/:notificationId/archive", requireAuth, requirePermission("PATCH /api/backoffice/internal-notifications/:notificationId/archive"), asyncHandler(async (req, res) => {
  const row = await internalNotificationsService.archive(
    repository.getClientsStore(), req.params.notificationId, req.principal, clientsAuditMetaFromRequest(req), req.query,
  );
  res.json(row);
}));

app.get("/api/backoffice/subscription-access", requireAuth, requirePermission("GET /api/backoffice/subscription-access"), asyncHandler(async (req, res) => {
  const { asTrimmed } = require("./lib/platformManagement");
  const { assertSubscriptionAccessForPrincipal } = require("./lib/subscriptionAccessScope");
  const requestedSchoolCode = asTrimmed(req.query.schoolCode).toUpperCase();
  const principalSchoolCode = asTrimmed(req.principal?.schoolCode).toUpperCase();
  const schoolCode = requestedSchoolCode || principalSchoolCode;

  if (!schoolCode || schoolCode === "*") {
    return res.json({ level: "full", message: "" });
  }

  const school = await repository.getPlatformSchoolByCode(schoolCode);
  assertSubscriptionAccessForPrincipal(req.principal, schoolCode, school);

  const state = await getAuthoritativeBackOfficeState();
  res.json(schoolSubscriptionAccessService.resolveSchoolAccess(schoolCode, state));
}));

app.get("/api/backoffice/establishments", requireAuth, requirePermission("GET /api/backoffice/establishments"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const rows = establishmentService.list(state, req.principal);
  sendList(res, rows, req.query, ["name", "code", "country", "city", "type", "status", "principalName"]);
}));

app.get("/api/backoffice/establishments/:code/subscription", requireAuth, requirePermission("GET /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  res.json(establishmentService.getSubscription(req.params.code, state, req.principal));
}));

app.get("/api/backoffice/establishments/:code", requireAuth, requirePermission("GET /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  res.json(establishmentService.get(req.params.code, state, req.principal));
}));

app.post("/api/backoffice/establishments", requireAuth, requirePermission("POST /api/backoffice/establishments"), asyncHandler(async (req, res) => {
  const persisted = await repository.listEstablishments();
  const state = await getAuthoritativeBackOfficeState();
  const schools = persisted.length ? persisted : state.schools;
  const { school } = establishmentService.create(req.body ?? {}, { ...state, schools }, req.principal, {
    force: Boolean(req.body?.force),
  });
  const savedSchool = await repository.persistEstablishment(school);
  await auditService.record(req, "create_establishment", "school", savedSchool.code, { name: savedSchool.name });
  const nextState = await getAuthoritativeBackOfficeState();
  res.status(201).json({ school: savedSchool, state: scopedBackOfficeStateForResponse(nextState, req.principal) });
}));

app.post("/api/backoffice/establishments/import", requireAuth, requirePermission("POST /api/backoffice/establishments/import"), asyncHandler(async (req, res) => {
  const persisted = await repository.listEstablishments();
  const state = await getAuthoritativeBackOfficeState();
  const schools = persisted.length ? persisted : state.schools;
  const { created, errors } = establishmentService.importRows(
    req.body?.rows ?? [],
    { ...state, schools },
    req.principal,
    { force: Boolean(req.body?.force) },
  );
  const savedCreated = [];
  for (const school of created) {
    savedCreated.push(await repository.persistEstablishment(school));
  }
  await auditService.record(req, "import_establishments", "school", "bulk", {
    created: savedCreated.length,
    errors: errors.length,
  });
  res.status(201).json({ created: savedCreated, errors, count: savedCreated.length });
}));

app.post("/api/backoffice/import/students/validate", requireAuth, requirePermission("POST /api/backoffice/import/students/validate"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { validateStudentImportRows } = require("./services/importValidationService");
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const report = validateStudentImportRows(rows, state);
  res.json(report);
}));

app.patch("/api/backoffice/establishments/:code", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const persisted = await repository.listEstablishments();
  const state = await getAuthoritativeBackOfficeState();
  const schools = persisted.length ? persisted : state.schools;
  const { school } = establishmentService.update(req.params.code, req.body ?? {}, { ...state, schools }, req.principal);
  const savedSchool = await repository.persistEstablishment(school);
  await auditService.record(req, "update_establishment", "school", savedSchool.code);
  const nextState = await getAuthoritativeBackOfficeState();
  res.json({ school: savedSchool, state: scopedBackOfficeStateForResponse(nextState, req.principal) });
}));

app.patch("/api/backoffice/establishments/:code/activate", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const persisted = await repository.listEstablishments();
  const state = await getAuthoritativeBackOfficeState();
  const schools = persisted.length ? persisted : state.schools;
  const { school } = establishmentService.activate(req.params.code, { ...state, schools }, req.principal);
  const savedSchool = await repository.persistEstablishment(school);
  await auditService.record(req, "activate_establishment", "school", savedSchool.code);
  res.json({ school: savedSchool });
}));

app.patch("/api/backoffice/establishments/:code/suspend", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const persisted = await repository.listEstablishments();
  const state = await getAuthoritativeBackOfficeState();
  const schools = persisted.length ? persisted : state.schools;
  const { school } = establishmentService.suspend(req.params.code, { ...state, schools }, req.principal);
  const savedSchool = await repository.persistEstablishment(school);
  await auditService.record(req, "suspend_establishment", "school", savedSchool.code);
  res.json({ school: savedSchool });
}));

app.delete("/api/backoffice/establishments/:code", requireAuth, requirePermission("DELETE /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const persisted = await repository.listEstablishments();
  const state = await getAuthoritativeBackOfficeState();
  const schools = persisted.length ? persisted : state.schools;
  const { school } = establishmentService.softDelete(req.params.code, { ...state, schools }, req.principal);
  const savedSchool = await repository.persistEstablishment(school);
  await auditService.record(req, "delete_establishment", "school", savedSchool.code);
  const nextState = await getAuthoritativeBackOfficeState();
  res.json({ school: savedSchool, state: scopedBackOfficeStateForResponse(nextState, req.principal) });
}));

app.get("/api/backoffice/finance/unpaid", requireAuth, requirePermission("GET /api/backoffice/finance/unpaid"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const state = await getAuthoritativeBackOfficeState();
  res.json(
    unpaidService.list(state, principal, {
      search: req.query.search,
      className: req.query.className,
      period: req.query.period,
    }),
  );
}));

app.get("/api/backoffice/finance/unpaid/:studentId", requireAuth, requirePermission("GET /api/backoffice/finance/unpaid"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const state = await getAuthoritativeBackOfficeState();
  res.json(unpaidService.detail(state, principal, req.params.studentId));
}));

app.get("/api/backoffice/finance/unpaid/:studentId/reminders", requireAuth, requirePermission("GET /api/backoffice/finance/unpaid"), asyncHandler(async (req, res) => {
  const principal = await financeHttpPrincipal(req);
  const state = await getAuthoritativeBackOfficeState();
  const detail = unpaidService.detail(state, principal, req.params.studentId);
  res.json(detail.reminders);
}));

app.post("/api/backoffice/finance/unpaid/:studentId/reminders", requireAuth, requirePermission("POST /api/backoffice/finance/unpaid/reminders"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: `POST /api/backoffice/finance/unpaid/${req.params.studentId}/reminders`,
    principal: req.principal,
    handler: async () => {
      const reminder = await repository.createFinanceReminder(
        req.params.studentId,
        req.body ?? {},
        req.principal,
        { force: Boolean(req.body?.force) },
      );
      await auditService.record(req, "send_payment_reminder", "student_fee", req.params.studentId, {
        channel: reminder.channel,
        summary: reminder.summary,
      });
      const nextState = await getAuthoritativeBackOfficeState();
      return {
        statusCode: 201,
        body: { reminder, state: scopedBackOfficeStateForResponse(nextState, req.principal) },
      };
    },
  });
}));

app.get("/api/backoffice/state", requireAuth, asyncHandler(async (_req, res) => {
  const { sendBackOfficeStateReadRemoved } = require("./lib/backofficeStateRemoval");
  sendBackOfficeStateReadRemoved(res);
}));

app.put("/api/backoffice/state", requireAuth, asyncHandler(async (_req, res) => {
  const { sendBackOfficeStateWriteRemoved } = require("./lib/backofficeStateRemoval");
  sendBackOfficeStateWriteRemoved(res);
}));

app.post("/api/backoffice/bulletin-design/preview", requireAuth, asyncHandler(async (req, res) => {
  if (!isSuperAdminPrincipal(req.principal)) {
    throw new BusinessError(403, "Seul le Super Administrateur peut prévisualiser une conception de bulletin.");
  }
  const { schoolCode, className, design } = req.body ?? {};
  if (!schoolCode || !className) {
    throw new BusinessError(400, "schoolCode et className sont requis.");
  }
  const { platformSchools } = await getRuntime();
  const school = (platformSchools ?? []).find(
    (item) => String(item.code ?? "").trim().toLowerCase() === String(schoolCode).trim().toLowerCase(),
  );
  if (!school) {
    throw new BusinessError(404, "Établissement introuvable.");
  }
  const report = buildDesignPreviewReport({ school, className, design });
  const format = String(req.query.format ?? "html").trim().toLowerCase();
  if (format === "pdf") {
    const pdf = await renderReportCardPdf(report, school);
    const safeClass = String(className).replace(/[^\w\-]+/g, "-").toLowerCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="bulletin-apercu-${safeClass}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    return res.send(pdf);
  }

  const html = await renderReportCardPreviewHtml(report, school);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
}));

app.get("/api/audit", requireAuth, requirePermission("GET /api/audit"), asyncHandler(async (req, res) => {
  // P0-2 : Superadmin / Admin Pays sont déjà 403 dans requireAuth (données perso établissement).
  // Ce filtre refuse les autres profils : GET /api/audit n'est pas un journal plateforme.
  if (!["Super Administrateur Somafrik", "Admin Pays"].includes(req.principal.role)) {
    throw new BusinessError(403, "Seuls les administrateurs habilités peuvent consulter l'audit.");
  }
  if (req.query.schoolCode) {
    tenantScopeService.assertSchoolAccess(req.principal, req.query.schoolCode);
  }
  const rows = await repository.getAuditLogs({
    schoolCode: req.query.schoolCode,
    userId: req.query.userId,
    action: req.query.action,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  });
  sendList(res, tenantScopeService.filterRows(rows, req.principal), req.query, ["actor", "action", "entityType", "entityId", "schoolCode"]);
}));

app.get("/api/v2/subjects", requireAuth, requirePermission("GET /api/v2/subjects"), asyncHandler(async (req, res) => {
  const schoolCode = String(req.principal?.schoolCode ?? "").trim();
  const isPlatform =
    req.principal?.role === "Super Administrateur Somafrik" ||
    req.principal?.role === "Super Administrateur OKAFRIK" ||
    req.principal?.role === "Admin Pays";
  if (!isPlatform && (!schoolCode || schoolCode === "*")) {
    console.error(JSON.stringify({
      kind: "subjects_catalog_load_failure",
      reason: "missing_school_scope",
      role: req.principal?.role ?? null,
    }));
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  const query = isPlatform && (!schoolCode || schoolCode === "*") ? {} : { schoolCode };
  const cacheKey = query.schoolCode ? `v2:subjects:${String(query.schoolCode).toUpperCase()}` : "v2:subjects";
  try {
    const rows = await cacheService.remember(cacheKey, () => repository.getSubjectsV2(query));
    sendList(res, tenantScopeService.filterRows(rows, req.principal), req.query, ["name", "code", "level", "status"]);
  } catch (error) {
    console.error(JSON.stringify({
      kind: "subjects_catalog_load_failure",
      schoolCode: query.schoolCode || null,
      message: error instanceof Error ? error.message : "unknown",
    }));
    throw error;
  }
}));

app.post("/api/v2/subjects", requireAuth, requirePermission("POST /api/v2/subjects"), asyncHandler(async (req, res) => {
  const schoolCode = req.principal.schoolCode;
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
  const created = await repository.createSubject({ ...req.body, schoolCode });
  cacheService.invalidate("v2:");
  await auditService.record(req, "create_subject", "subject", req.body.code, req.body);
  res.status(201).json(created);
}));

app.delete("/api/v2/subjects/:code", requireAuth, requirePermission("DELETE /api/v2/subjects/:code"), asyncHandler(async (req, res) => {
  const deleted = await repository.deleteSubject(req.params.code);
  cacheService.invalidate("v2:");
  await auditService.record(req, "delete_subject", "subject", req.params.code);
  res.json(deleted);
}));

async function academicYearHttpPrincipal(req) {
  const { attachAcademicYearMembershipScope, attachAcademicYearFixtureScope } = require("./lib/academicYearSchoolScope");
  if (typeof repository.one === "function") {
    return attachAcademicYearMembershipScope(req.principal, repository.one.bind(repository));
  }
  return attachAcademicYearFixtureScope(req.principal);
}

app.get("/api/v2/academic-years", requireAuth, requirePermission("GET /api/v2/academic-years"), asyncHandler(async (req, res) => {
  const {
    assertAcademicYearReadable,
    academicYearCacheKey,
    filterAcademicYearRows,
  } = require("./lib/academicYearSchoolScope");
  const principal = await academicYearHttpPrincipal(req);
  const scope = assertAcademicYearReadable(principal);
  const rows = await cacheService.remember(academicYearCacheKey(scope), () => repository.getAcademicYearsV2(scope));
  sendList(res, filterAcademicYearRows(rows, scope), req.query, ["name", "status"]);
}));

app.post("/api/v2/academic-years", requireAuth, requirePermission("POST /api/v2/academic-years"), asyncHandler(async (req, res) => {
  const { resolveAcademicYearWriteSchool } = require("./lib/academicYearSchoolScope");
  const principal = await academicYearHttpPrincipal(req);
  const writeSchool = await resolveAcademicYearWriteSchool(
    principal,
    req.body ?? {},
    typeof repository.one === "function" ? repository.one.bind(repository) : null,
  );
  const created = await repository.createAcademicYearV2({
    ...(req.body ?? {}),
    schoolId: writeSchool.schoolId,
    schoolCode: writeSchool.loginCode,
  });
  cacheService.invalidate("v2:academic-years");
  await auditService.record(req, "academic_year_create", "academic_year", created.id, {
    schoolCode: created.schoolCode,
    name: created.name,
    isCurrent: created.isCurrent,
  });
  res.status(201).json(created);
}));

app.patch("/api/v2/academic-years/:id", requireAuth, requirePermission("PATCH /api/v2/academic-years/:id"), asyncHandler(async (req, res) => {
  const { assertAcademicYearPatchAccess } = require("./lib/academicYearSchoolScope");
  const principal = await academicYearHttpPrincipal(req);
  const current = await repository.getAcademicYearV2ById(req.params.id);
  if (!current) {
    throw new BusinessError(404, "Année scolaire introuvable.");
  }
  assertAcademicYearPatchAccess(principal, current);
  const updated = await repository.updateAcademicYearV2(req.params.id, req.body ?? {});
  cacheService.invalidate("v2:academic-years");
  await auditService.record(req, "academic_year_update", "academic_year", updated.id, {
    schoolCode: updated.schoolCode,
    name: updated.name,
    isCurrent: updated.isCurrent,
  });
  res.json(updated);
}));

app.get("/api/v2/exams", requireAuth, requirePermission("GET /api/v2/exams"), asyncHandler(async (req, res) => {
  const rows = await cacheService.remember("v2:exams", () => repository.getExamsV2());
  const scope = deriveSchoolScope(req.principal, await getAuthoritativeBackOfficeState());
  sendList(res, tenantScopeService.filterRows(rows, req.principal, scope), req.query, ["code", "name", "type", "className", "subject"]);
}));

app.get("/api/v2/documents", requireAuth, requirePermission("GET /api/v2/documents"), asyncHandler(async (req, res) => {
  const rows = await cacheService.remember("v2:documents", () => repository.getDocumentsV2());
  sendList(res, tenantScopeService.filterRows(rows, req.principal), req.query, ["code", "type", "title", "studentCode", "studentName"]);
}));

app.get("/api/v2/reports/advanced", requireAuth, requirePermission("GET /api/v2/reports/advanced"), asyncHandler(async (_req, res) => {
  res.json(await cacheService.remember("v2:reports:advanced", () => repository.getAdvancedReportsV2()));
}));

app.get("/api/mvp/readiness", requireAuth, asyncHandler(async (req, res) => {
  assertMvpAccess(req.principal);
  const mvpBusinessService = await getScopedMvpBusinessService(req.principal);
  res.json(stripSensitiveFieldsDeep(mvpBusinessService.getReadiness()));
}));

app.get("/api/mvp/snapshot", requireAuth, asyncHandler(async (req, res) => {
  assertMvpAccess(req.principal);
  const mvpBusinessService = await getScopedMvpBusinessService(req.principal);
  res.json(stripSensitiveFieldsDeep(mvpBusinessService.getSnapshot()));
}));

app.get("/api/mvp/dashboard", requireAuth, asyncHandler(async (req, res) => {
  assertMvpAccess(req.principal);
  const mvpBusinessService = await getScopedMvpBusinessService(req.principal);
  res.json(stripSensitiveFieldsDeep(mvpBusinessService.getEstablishmentDashboard()));
}));

async function getRuntime() {
  const dataset = await repository.getDataset();
  // LOT 7 / PR-A — projection canonique clients (PG / mémoire), pas d'overlay backoffice_state.users JSON.
  await applyClientsAuthOverlay(dataset);
  // LOT 2 — aucune identité élève ne provient plus du snapshot JSON.
  const mergedStudents = dataset.students ?? [];
  const mergedRelations = [];
  // LOT 3 — enseignants et affectations sont des projections PostgreSQL uniquement.
  const mergedTeachers = dataset.teachers ?? [];
  const authService = new AuthService({
    school: dataset.school,
    schools: dataset.platformSchools,
    // HOTFIX-PRE-E1-02 : enseignants BO + PG pour résoudre assignedClasses à la connexion mobile.
    teachers: mergedTeachers,
    students: mergedStudents,
    relations: mergedRelations,
    userAccounts: dataset.userAccounts,
    countries: dataset.countries,
    subscriptions: dataset.subscriptions ?? [],
    assignments: dataset.teacherAssignments ?? [],
  });
  const gradeBookService = new GradeBookService({
    students: dataset.students,
    notes: dataset.notes,
    courses: dataset.courses,
  });
  const reportPdfService = new ReportPdfService({ school: dataset.school });
  const mvpBusinessService = new MvpBusinessService({
    school: dataset.school,
    students: mergedStudents,
    classes: dataset.classes,
    courses: dataset.courses,
    notes: dataset.notes,
    payments: dataset.payments,
  });
  const backOfficeAccessService = new BackOfficeAccessService({
    school: dataset.school,
    schools: dataset.platformSchools,
    userAccounts: dataset.userAccounts,
    students: mergedStudents,
    relations: mergedRelations,
    countries: dataset.countries,
    subscriptions: dataset.subscriptions,
    notifications: dataset.platformNotifications,
  });

  return {
    ...dataset,
    authService,
    gradeBookService,
    reportPdfService,
    mvpBusinessService,
    backOfficeAccessService,
  };
}

// Superpose le statut (Actif/Suspendu) du state BackOffice persistant (JSON) sur le
// dataset issu des tables, afin que la connexion reflète les suspensions pays/établissement
// effectuées dans le BackOffice (pays suspendu => admin pays et établissements bloqués).
function normalizeSchoolRuntimeKey(row = {}) {
  const code = String(row.code ?? row.publicId ?? row.schoolCode ?? "").trim().toUpperCase();
  return code || String(row.id ?? row.publicId ?? "");
}

function applyStoredSchoolOverlay(dataset, storedState) {
  if (!dataset || !isPlainObject(storedState) || !Array.isArray(storedState.schools)) {
    return;
  }

  const byCode = new Map();
  for (const school of dataset.platformSchools ?? []) {
    const key = normalizeSchoolRuntimeKey(school);
    if (key) {
      byCode.set(key, { ...school });
    }
  }

  for (const stored of storedState.schools) {
    const key = normalizeSchoolRuntimeKey(stored);
    if (!key) {
      continue;
    }
    const existing = byCode.get(key);
    byCode.set(key, existing ? { ...existing, ...stored } : { ...stored });
  }

  dataset.platformSchools = [...byCode.values()];
  if (dataset.school) {
    const key = normalizeSchoolRuntimeKey(dataset.school);
    if (key && byCode.has(key)) {
      dataset.school = byCode.get(key);
    }
  }
}

function applyStoredStatusOverlay(dataset, storedState) {
  if (!dataset || !isPlainObject(storedState)) {
    return;
  }

  // LOT 6 — le statut pays provient exclusivement de la projection plateforme PostgreSQL.
  // Ne plus superposer l'ancien snapshot JSON sur dataset.countries.
}

function applyStoredUserCredentials(base = {}, stored = {}, merged = {}) {
  const storedHash = Boolean(stored.passwordHash || stored.pinHash);
  const baseHash = Boolean(base.passwordHash || base.pinHash);

  if (stored.passwordHash) {
    merged.passwordHash = stored.passwordHash;
  } else if (base.passwordHash) {
    merged.passwordHash = base.passwordHash;
  }

  if (stored.pinHash) {
    merged.pinHash = stored.pinHash;
  } else if (base.pinHash) {
    merged.pinHash = base.pinHash;
  }

  if (storedHash || String(stored.temporaryPassword ?? "").trim()) {
    merged.mustChangePassword =
      stored.mustChangePassword != null
        ? Boolean(stored.mustChangePassword)
        : Boolean(String(stored.temporaryPassword ?? "").trim());
    if (String(stored.temporaryPassword ?? "").trim()) {
      merged.temporaryPassword = stored.temporaryPassword;
      merged.hasTemporaryPassword = stored.hasTemporaryPassword ?? true;
    } else if (!merged.mustChangePassword) {
      merged.temporaryPassword = "";
      delete merged.password;
      delete merged.pin;
    }
  } else if (baseHash) {
    merged.mustChangePassword = Boolean(base.mustChangePassword);
    if (!merged.mustChangePassword) {
      merged.temporaryPassword = "";
      delete merged.password;
      delete merged.pin;
    }
  } else if (String(merged.temporaryPassword ?? "").trim()) {
    merged.password = merged.temporaryPassword;
    merged.mustChangePassword = merged.mustChangePassword ?? true;
    merged.hasTemporaryPassword = merged.hasTemporaryPassword ?? true;
  }

  return merged;
}

function normalizeBackOfficeUserCredentials(user = {}) {
  const next = { ...user };
  const temporaryPassword = String(next.temporaryPassword ?? "").trim();

  if (temporaryPassword && !next.passwordHash && !next.pinHash) {
    const secretHash = hashSecret(temporaryPassword);
    next.passwordHash = secretHash;
    next.pinHash = secretHash;
    next.mustChangePassword = next.mustChangePassword ?? true;
    next.hasTemporaryPassword = true;
  }

  return next;
}

function isDbUserUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function userOverlayKeys(user) {
  const keys = [];
  if (user?.id) keys.push(`id:${String(user.id)}`);
  if (user?.publicId) keys.push(`public:${String(user.publicId).trim().toUpperCase()}`);
  if (user?.identifier) {
    const login = String(user.identifier).trim().toLowerCase();
    const schoolCode = String(user.schoolCode ?? "").trim().toUpperCase();
    if (schoolCode && schoolCode !== "*") {
      keys.push(`login:${login}@${schoolCode}`);
    } else {
      keys.push(`login:${login}`);
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

function resolveUserOverlayPrimaryKey(user, aliasToPrimaryKey) {
  const keys = userOverlayKeys(user);
  for (const alias of keys) {
    const match = aliasToPrimaryKey.get(alias);
    if (match) {
      return match;
    }
  }

  const schoolScopedLogin = keys.find((alias) => alias.startsWith("login:") && alias.includes("@"));
  return schoolScopedLogin ?? keys[0] ?? null;
}

async function applyClientsAuthOverlay(dataset) {
  if (!dataset || typeof repository.listClientsAuthAccounts !== "function") {
    return;
  }

  const authAccounts = await repository.listClientsAuthAccounts();
  if (!Array.isArray(authAccounts) || authAccounts.length === 0) {
    return;
  }

  const byPrimaryKey = new Map();
  const aliasToPrimaryKey = new Map();

  const registerUser = (user, primaryKey) => {
    if (!primaryKey || !user) {
      return;
    }
    byPrimaryKey.set(primaryKey, user);
    for (const alias of userOverlayKeys(user)) {
      aliasToPrimaryKey.set(alias, primaryKey);
    }
  };

  for (const user of dataset.userAccounts ?? []) {
    registerUser(user, resolveUserOverlayPrimaryKey(user, aliasToPrimaryKey));
  }

  for (const stored of authAccounts) {
    const primaryKey = resolveUserOverlayPrimaryKey(stored, aliasToPrimaryKey);
    if (!primaryKey) {
      continue;
    }
    const base = byPrimaryKey.get(primaryKey) ?? {};
    const merged = normalizeBackOfficeUserCredentials({ ...base, ...stored });
    registerUser(merged, primaryKey);
  }

  dataset.userAccounts = [...byPrimaryKey.values()];
}

function handleBusinessResponse(res, action) {
  try {
    return res.json(action());
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.statusCode).json({
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    throw error;
  }
}

async function handleBusinessAction(action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof BusinessError) {
      throw error;
    }

    throw error;
  }
}

function assertBackOfficeReader(principal) {
  const { canAccessBackOfficeRole, canAccessWebPlatformRole } = require("./lib/establishmentRoles");
  if (!principal) {
    throw new BusinessError(403, "Accès plateforme non autorisé");
  }

  if (canAccessBackOfficeRole(principal.role)) {
    return;
  }

  if (principal.authSource === "backoffice" && canAccessWebPlatformRole(principal.role)) {
    return;
  }

  throw new BusinessError(403, "Accès plateforme non autorisé");
}

function assertBackOfficeManager(principal) {
  const { canAccessBackOfficeRole } = require("./lib/establishmentRoles");
  if (!principal || !canAccessBackOfficeRole(principal.role)) {
    throw new BusinessError(403, "Accès plateforme non autorisé");
  }
}

function getWebPlatformWritableEntities(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  // auditLog exclu : journal enrichi uniquement côté serveur.
  const allowed = new Set();

  if (permissions.has("ALL_PRIVILEGES") || permissions.has("COUNTRY_PRIVILEGES")) {
    backOfficeDeletableEntities.forEach((entity) => {
      if (
        entity !== "countries" &&
        entity !== "subscriptions" &&
        entity !== "subscriptionOffers" &&
        entity !== "subscriptionPayments" &&
        entity !== "subscriptionInvoices" &&
        entity !== "subscriptionDiscounts" &&
        entity !== "subscriptionAuditLog" &&
        entity !== "notifications" &&
        entity !== "rolePermissions" &&
        entity !== "dashboardChartConfig"
      ) {
        allowed.add(entity);
      }
    });
    allowed.add("academicConfigs");
    return allowed;
  }

  if (
    permissions.has("Notes:CREATE") ||
    permissions.has("Notes:UPDATE") ||
    permissions.has("Notes:CRUD") ||
    permissions.has("Evaluations:CRUD") ||
    permissions.has("Modifier notes")
  ) {
    allowed.add("notes");
    allowed.add("evaluations");
  }

  if (
    permissions.has("Présences:CREATE") ||
    permissions.has("Présences:UPDATE") ||
    permissions.has("Faire appel") ||
    permissions.has("Gérer appels")
  ) {
    allowed.add("presences");
  }

  if (permissions.has("Messages:CREATE") || permissions.has("Messages:UPDATE")) {
    allowed.add("messages");
  }

  return allowed;
}

function assertBackOfficeWriter(principal, touchedKeys = []) {
  const { canAccessBackOfficeRole, canAccessWebPlatformRole } = require("./lib/establishmentRoles");
  if (!principal) {
    throw new BusinessError(403, "Accès plateforme non autorisé");
  }

  // HOTFIX-SYNC-03 — Enseignant : uniquement evaluations + notes (pas d'élargissement BO).
  if (isTeacherNotesPrincipal(principal)) {
    const decision = evaluateTeacherNotesTouchedKeys(touchedKeys);
    if (!decision.ok) {
      throw new BusinessError(403, "Permission insuffisante pour modifier ces données.");
    }
    if (!teacherHasNotesWritePermission(principal)) {
      throw new BusinessError(403, "Permission insuffisante pour modifier les notes.");
    }
    return;
  }

  if (canAccessBackOfficeRole(principal.role)) {
    const decision = evaluateBackOfficeWriteAccess(
      principal,
      touchedKeys,
      backOfficeDeletableEntities,
    );
    if (!decision.ok) {
      throw new BusinessError(403, "Permission insuffisante pour modifier ces données.");
    }
    return;
  }

  if (principal.authSource === "backoffice" && canAccessWebPlatformRole(principal.role)) {
    const allowedEntities = getWebPlatformWritableEntities(principal);
    const forbidden = touchedKeys.filter((key) => !allowedEntities.has(key));
    if (forbidden.length) {
      throw new BusinessError(403, "Permission insuffisante pour modifier ces données.");
    }
    return;
  }

  throw new BusinessError(403, "Accès plateforme non autorisé");
}

function assertMvpAccess(principal) {
  if (!canAccessMvpRoutes(principal)) {
    throw new BusinessError(403, "Accès MVP non autorisé pour ce rôle.");
  }
}

async function getScopedMvpBusinessService(principal) {
  const runtime = await getRuntime();
  const state = await getAuthoritativeBackOfficeState();
  const scoped = scopeMvpDatasetForPrincipal(
    {
      school: runtime.school,
      platformSchools: runtime.platformSchools ?? state.schools ?? [],
      students: state.students ?? runtime.students ?? [],
      classes: state.classes ?? runtime.classes ?? [],
      courses: state.courses ?? runtime.courses ?? [],
      notes: state.notes ?? runtime.notes ?? [],
      payments: state.payments ?? [],
    },
    principal,
    tenantScopeService,
  );
  return new MvpBusinessService(scoped);
}

function denyPermission(message = "Permission insuffisante pour cette fonctionnalité.") {
  const error = new BusinessError(403, message);
  error.code = PERMISSION_DENIED;
  return error;
}

async function saveEstablishmentState() {
  const { createBackOfficeStateWriteRemovedError } = require("./lib/backofficeStateRemoval");
  throw createBackOfficeStateWriteRemovedError();
}

async function touchUserLastLogin(principal) {
  if (!principal?.sub && !principal?.identifier) return;
  const lookupKeys = [principal.sub, principal.identifier, principal.publicId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!lookupKeys.length) return;
  if (typeof repository.touchUserLastLogin === "function") {
    await repository.touchUserLastLogin(lookupKeys);
  }
}

function requireSchoolSubscriptionFeature(feature) {
  return asyncHandler(async (req, _res, next) => {
    if (isSuperAdminPrincipal(req.principal) || req.principal?.role === "Admin Pays") {
      return next();
    }
    const schoolCode = req.principal?.schoolCode;
    if (!schoolCode || schoolCode === "*") {
      return next();
    }
    const state = await getAuthoritativeBackOfficeState();
    schoolSubscriptionAccessService.assertSchoolFeature(schoolCode, state, feature);
    return next();
  });
}

function sanitizeDashboardChartConfig(config) {
  if (!isPlainObject(config)) {
    return { platform: {}, establishment: {} };
  }

  return {
    platform: isPlainObject(config.platform) ? config.platform : {},
    establishment: isPlainObject(config.establishment) ? config.establishment : {},
  };
}

function sanitizeBackOfficeState(payload = {}) {
  const state = {
    schools: Array.isArray(payload.schools) ? payload.schools : [],
    users: Array.isArray(payload.users)
      ? payload.users.map((user) => normalizeBackOfficeUserCredentials(user))
      : [],
    countries: Array.isArray(payload.countries) ? payload.countries : [],
    contacts: Array.isArray(payload.contacts) ? payload.contacts : [],
    relations: Array.isArray(payload.relations) ? payload.relations : [],
    subscriptions: Array.isArray(payload.subscriptions) ? payload.subscriptions : [],
    subscriptionOffers: Array.isArray(payload.subscriptionOffers) ? payload.subscriptionOffers : [],
    subscriptionPayments: Array.isArray(payload.subscriptionPayments) ? payload.subscriptionPayments : [],
    subscriptionInvoices: Array.isArray(payload.subscriptionInvoices) ? payload.subscriptionInvoices : [],
    subscriptionDiscounts: Array.isArray(payload.subscriptionDiscounts) ? payload.subscriptionDiscounts : [],
    subscriptionAuditLog: Array.isArray(payload.subscriptionAuditLog)
      ? payload.subscriptionAuditLog.slice(0, 200)
      : [],
    notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
    students: Array.isArray(payload.students) ? payload.students : [],
    teachers: Array.isArray(payload.teachers) ? payload.teachers : [],
    classes: Array.isArray(payload.classes) ? payload.classes : [],
    courses: Array.isArray(payload.courses) ? payload.courses : [],
    assignments: Array.isArray(payload.assignments) ? payload.assignments : [],
    courseSchedules: Array.isArray(payload.courseSchedules) ? payload.courseSchedules : [],
    payments: Array.isArray(payload.payments) ? payload.payments : [],
    paymentStatuses: Array.isArray(payload.paymentStatuses) ? payload.paymentStatuses : [],
    feeGrids: Array.isArray(payload.feeGrids) ? payload.feeGrids : [],
    schoolFeeItems: Array.isArray(payload.schoolFeeItems) ? payload.schoolFeeItems : [],
    studentFees: Array.isArray(payload.studentFees) ? payload.studentFees : [],
    feeTariffHistory: Array.isArray(payload.feeTariffHistory) ? payload.feeTariffHistory.slice(0, 500) : [],
    paymentReminders: Array.isArray(payload.paymentReminders) ? payload.paymentReminders.slice(0, 500) : [],
    presences: Array.isArray(payload.presences) ? payload.presences : [],
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    evaluations: Array.isArray(payload.evaluations) ? payload.evaluations : [],
    exams: Array.isArray(payload.exams) ? payload.exams : [],
    bulletins: Array.isArray(payload.bulletins) ? payload.bulletins : [],
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    academicConfigs: isPlainObject(payload.academicConfigs) ? payload.academicConfigs : {},
    announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    auditLog: Array.isArray(payload.auditLog) ? payload.auditLog.slice(0, 200) : [],
    rolePermissions: isPlainObject(payload.rolePermissions) ? payload.rolePermissions : {},
    dashboardChartConfig: sanitizeDashboardChartConfig(payload.dashboardChartConfig),
    deletedRows: sanitizeDeletedRows(payload.deletedRows),
    updatedAt: new Date().toISOString(),
  };
  const reconciledDeletedRows = reconcileStaleDeletedRowsWithStoredEntities(
    state.deletedRows,
    state,
  );
  const { state: deduped } = dedupeBackOfficeState({
    ...state,
    deletedRows: reconciledDeletedRows,
  });
  return applyDeletedRows(deduped, deduped.deletedRows);
}

const backOfficeDeletableEntities = [
  "schools",
  "users",
  "countries",
  "contacts",
  "relations",
  "subscriptions",
  "notifications",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "schoolFeeItems",
  "studentFees",
  "feeTariffHistory",
  "presences",
  "notes",
  "evaluations",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
];

async function listCanonicalStudentsForPrincipal(principal) {
  const schoolCode = String(principal?.schoolCode ?? "").trim();
  if (schoolCode && schoolCode !== "*" && typeof repository.listSchoolStudents === "function") {
    return repository.listSchoolStudents(schoolCode);
  }
  const runtime = await getRuntime();
  return runtime.students ?? [];
}

async function loadCanonicalPedagogyForPrincipal(principal) {
  const pedagogy =
    typeof repository.listPedagogyProjection === "function"
      ? await repository.listPedagogyProjection()
      : { notes: [], presences: [], evaluations: [] };
  const students = await listCanonicalStudentsForPrincipal(principal);
  return {
    notes: pedagogy.notes ?? [],
    presences: pedagogy.presences ?? [],
    evaluations: pedagogy.evaluations ?? [],
    students,
  };
}

async function loadCanonicalFinanceForPrincipal(principal) {
  const finance =
    typeof repository.listFinanceProjection === "function"
      ? await repository.listFinanceProjection()
      : { payments: [] };
  const students = await listCanonicalStudentsForPrincipal(principal);
  return {
    payments: finance.payments ?? [],
    students,
  };
}

async function getAuthoritativeBackOfficeState() {
  const runtime = await getRuntime();
  const runtimeState = buildInitialBackOfficeState(runtime);
  const base = sanitizeBackOfficeState(runtimeState);
  const nextState = {
    ...base,
    courses: pedagogyGovernanceService.hydrateCoursesFromAssignments(
      base.courses ?? [],
      base.assignments ?? [],
    ),
    deletedRows: {},
  };
  return overlayResidualProjection(
    await overlayClientsProjection(
      await overlayPlatformProjection(
        await overlayPedagogyProjection(await overlayFinanceProjection(nextState)),
      ),
    ),
  );
}

async function listResidualDomainForPrincipal(principal, domain) {
  if (typeof repository.listResidualProjection !== "function") {
    return [];
  }
  const residual = await repository.listResidualProjection();
  const rows = residual[domain] ?? [];
  return tenantScopeService.filterRows(rows, principal);
}

async function overlayResidualProjection(state) {
  const residual =
    typeof repository.listResidualProjection === "function"
      ? await repository.listResidualProjection()
      : { academicConfigs: {} };
  const canonical =
    typeof repository.listDocumentsExamsProjection === "function"
      ? await repository.listDocumentsExamsProjection()
      : { exams: [], bulletins: [], documents: [] };
  return {
    ...state,
    academicConfigs: {
      ...(state.academicConfigs ?? {}),
      ...(residual.academicConfigs ?? {}),
    },
    exams: canonical.exams ?? [],
    bulletins: canonical.bulletins ?? [],
    documents: canonical.documents ?? [],
  };
}

async function overlayClientsProjection(state) {
  const clients = await repository.listClientsProjection();
  return {
    ...state,
    users: clients.users ?? [],
    contacts: clients.contacts ?? [],
    relations: clients.relations ?? [],
    messages: clients.messages ?? [],
    announcements: clients.announcements ?? [],
  };
}

async function overlayPlatformProjection(state) {
  const platform = await repository.listPlatformProjection();
  return {
    ...state,
    countries: platform.countries ?? [],
    subscriptions: platform.subscriptions ?? [],
    notifications: platform.notifications ?? [],
    subscriptionOffers: platform.subscriptionOffers ?? [],
    subscriptionPayments: platform.subscriptionPayments ?? [],
    subscriptionInvoices: platform.subscriptionInvoices ?? [],
    subscriptionDiscounts: platform.subscriptionDiscounts ?? [],
    subscriptionAuditLog: platform.subscriptionAuditLog ?? [],
    rolePermissions: platform.rolePermissions ?? {},
    dashboardChartConfig: platform.dashboardChartConfig ?? { platform: {}, establishment: {} },
  };
}

async function overlayPedagogyProjection(state) {
  const pedagogy = await repository.listPedagogyProjection();
  return {
    ...state,
    courses: pedagogy.courses ?? [],
    courseSchedules: pedagogy.courseSchedules ?? [],
    evaluations: pedagogy.evaluations ?? [],
    notes: pedagogy.notes ?? [],
    presences: pedagogy.presences ?? [],
  };
}

async function overlayFinanceProjection(state) {
  const finance = await repository.listFinanceProjection();
  return {
    ...state,
    payments: finance.payments ?? [],
    paymentStatuses: finance.paymentStatuses ?? [],
    feeGrids: finance.feeGrids ?? [],
    schoolFeeItems: finance.schoolFeeItems ?? [],
    studentFees: finance.studentFees ?? [],
    feeTariffHistory: finance.feeTariffHistory ?? [],
    paymentReminders: finance.paymentReminders ?? [],
  };
}

function stripLegacyOrganizationFields(state = {}) {
  const countries = (state.countries ?? []).map(({ organizationCode: _ignored, ...country }) => country);
  const { organizations: _organizations, ...rest } = state;
  return { ...rest, countries };
}

function hasUserBackOfficeState(state) {
  if (!isPlainObject(state)) {
    return false;
  }

  return backOfficeDeletableEntities.some((entity) => Array.isArray(state[entity]));
}

function buildInitialBackOfficeState(runtime = {}) {
  return {
    schools: runtime.platformSchools ?? [],
    users: runtime.userAccounts ?? [],
    countries: runtime.countries ?? [],
    contacts: [],
    relations: [],
    subscriptions: runtime.subscriptions ?? [],
    notifications: runtime.platformNotifications ?? [],
    students: runtime.students ?? [],
    teachers: runtime.teachers ?? [],
    classes: runtime.classes ?? [],
    courses: runtime.courses ?? [],
    assignments: runtime.teacherAssignments ?? [],
    courseSchedules: runtime.courseSchedules ?? [],
    payments: [],
    paymentStatuses: [],
    feeGrids: [],
    schoolFeeItems: [],
    studentFees: [],
    feeTariffHistory: [],
    paymentReminders: [],
    presences: runtime.presences ?? [],
    notes: runtime.notes ?? [],
    evaluations: runtime.evaluations ?? [],
    exams: runtime.exams ?? [],
    bulletins: runtime.bulletins ?? [],
    documents: runtime.documents ?? [],
    academicConfigs: runtime.academicConfigs ?? {},
    announcements: runtime.announcements ?? [],
    messages: [],
    auditLog: [],
    rolePermissions: {},
    deletedRows: {},
  };
}

function mergeBackOfficeRuntimeState(runtime = {}, storedState = {}) {
  const storedDeletedRows = sanitizeDeletedRows(storedState.deletedRows);
  const runtimeState = {
    schools: runtime.platformSchools ?? [],
    users: runtime.userAccounts ?? [],
    countries: runtime.countries ?? [],
    contacts: storedState.contacts ?? [],
    relations: storedState.relations ?? [],
    subscriptions: runtime.subscriptions ?? [],
    notifications: runtime.platformNotifications ?? [],
    students: runtime.students ?? [],
    teachers: runtime.teachers ?? [],
    classes: runtime.classes ?? [],
    courses: runtime.courses ?? [],
    assignments: runtime.teacherAssignments ?? [],
    courseSchedules: storedState.courseSchedules ?? runtime.courseSchedules ?? [],
    payments: [],
    paymentStatuses: [],
    feeGrids: [],
    schoolFeeItems: [],
    studentFees: [],
    feeTariffHistory: [],
    paymentReminders: [],
    presences: runtime.presences ?? [],
    notes: runtime.notes ?? [],
    evaluations: runtime.evaluations ?? [],
    exams: runtime.exams ?? [],
    bulletins: runtime.bulletins ?? [],
    documents: runtime.documents ?? [],
    academicConfigs: storedState.academicConfigs ?? runtime.academicConfigs ?? {},
    announcements: runtime.announcements ?? [],
    messages: storedState.messages ?? [],
    auditLog: storedState.auditLog ?? [],
    rolePermissions: storedState.rolePermissions ?? {},
    dashboardChartConfig: sanitizeDashboardChartConfig(storedState.dashboardChartConfig),
    deletedRows: storedDeletedRows,
  };
  // Ne pas inférer des suppressions depuis un instantané JSON incomplet : PostgreSQL
  // reste la source de vérité pour les entités relationnelles. On purge seulement les
  // deletedRows obsolètes lorsque la ligne existe encore en base.
  const deletedRows = reconcileStaleDeletedRowsWithRuntime(storedDeletedRows, runtimeState);
  const mergedDeletedRows = reconcileStaleDeletedRowsWithStoredEntities(deletedRows, {
    ...runtimeState,
    ...storedState,
  });

  const merged = {
    ...runtimeState,
    ...storedState,
    schools: mergeSchoolRows(runtimeState.schools, storedState.schools),
    users: mergeUserRows(runtimeState.users, storedState.users),
    countries: mergeRowsByIdentity(runtimeState.countries, storedState.countries),
    contacts: mergeRowsByIdentity(runtimeState.contacts, storedState.contacts),
    relations: mergeRowsByIdentity(runtimeState.relations, storedState.relations),
    subscriptions: mergeRowsByIdentity(runtimeState.subscriptions, storedState.subscriptions),
    notifications: mergeRowsByIdentity(runtimeState.notifications, storedState.notifications),
    // LOT 2 — projection lecture exclusivement PostgreSQL/runtime.
    // Les éventuelles lignes students historiques du JSON sont ignorées.
    students: runtimeState.students ?? [],
    // LOT 3 — projections lecture exclusivement PostgreSQL/runtime.
    teachers: runtimeState.teachers ?? [],
    // Projection lecture Classes / Établissements : PostgreSQL / runtime (plus de mutation JSON).
    classes: runtimeState.classes ?? [],
    courses: mergeRowsByIdentity(runtimeState.courses, storedState.courses),
    assignments: runtimeState.assignments ?? [],
    courseSchedules: mergeRowsByIdentity(runtimeState.courseSchedules ?? [], storedState.courseSchedules ?? []),
    payments: [],
    paymentStatuses: [],
    feeGrids: runtimeState.feeGrids ?? [],
    schoolFeeItems: runtimeState.schoolFeeItems ?? [],
    studentFees: runtimeState.studentFees ?? [],
    feeTariffHistory: runtimeState.feeTariffHistory ?? [],
    paymentReminders: runtimeState.paymentReminders ?? [],
    presences: mergeRowsByIdentity(runtimeState.presences, storedState.presences),
    notes: mergeRowsByIdentity(runtimeState.notes, storedState.notes),
    evaluations: mergeRowsByIdentity(runtimeState.evaluations ?? [], storedState.evaluations ?? []),
    exams: mergeRowsByIdentity(runtimeState.exams ?? [], storedState.exams ?? []),
    bulletins: mergeRowsByIdentity(runtimeState.bulletins ?? [], storedState.bulletins ?? []),
    documents: mergeRowsByIdentity(runtimeState.documents ?? [], storedState.documents ?? []),
    announcements: mergeRowsByIdentity(runtimeState.announcements, storedState.announcements),
    rolePermissions: {
      ...runtimeState.rolePermissions,
      ...(storedState.rolePermissions ?? {}),
    },
    academicConfigs: {
      ...runtimeState.academicConfigs,
      ...(storedState.academicConfigs ?? {}),
    },
    dashboardChartConfig: sanitizeDashboardChartConfig(
      storedState.dashboardChartConfig ?? runtimeState.dashboardChartConfig,
    ),
    deletedRows: mergedDeletedRows,
  };

  return ensureSubscriptionModuleState(
    hydrateSubscriptionsFromSchools(applyDeletedRows(merged, mergedDeletedRows)),
  );
}

function normalizeSchoolCodeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function hydrateSubscriptionsFromSchools(state = {}) {
  const schools = Array.isArray(state.schools) ? state.schools : [];
  const subscriptions = Array.isArray(state.subscriptions) ? [...state.subscriptions] : [];
  const schoolByCode = new Map(
    schools.map((school) => [normalizeSchoolCodeKey(school.code ?? school.publicId), school]),
  );
  const subscriptionBySchool = new Map(
    subscriptions.map((subscription) => [
      normalizeSchoolCodeKey(subscription.schoolCode),
      subscription,
    ]),
  );

  for (const school of schools) {
    const schoolCode = normalizeSchoolCodeKey(school.code ?? school.publicId);
    if (!schoolCode) continue;

    const existing = subscriptionBySchool.get(schoolCode);
    if (existing) {
      if (String(school.subscriptionPlan ?? "").trim()) {
        existing.plan = school.subscriptionPlan;
      }
      if (
        !String(existing.paymentStatus ?? "").trim() &&
        String(school.subscriptionStatus ?? "").trim()
      ) {
        existing.paymentStatus = school.subscriptionStatus;
      }
      continue;
    }

    if (!String(school.subscriptionPlan ?? "").trim() && !String(school.subscriptionStatus ?? "").trim()) {
      continue;
    }

    const created = {
      id: `SUB-${school.code ?? school.publicId ?? schoolCode}`,
      schoolCode: school.code ?? school.publicId ?? schoolCode,
      country: school.country ?? "",
      countryCode: school.countryCode ?? "",
      plan: school.subscriptionPlan ?? "Standard",
      paymentStatus: school.subscriptionStatus ?? "À jour",
      status: "Actif",
    };
    subscriptions.push(created);
    subscriptionBySchool.set(schoolCode, created);
  }

  return applySubscriptionPolicyToState({ ...state, subscriptions });
}

const GLOBAL_SUBSCRIPTION_PLAN_PRICING = {
  Essentiel: { monthlyPrice: 60, annualPrice: 600 },
  Standard: { monthlyPrice: 90, annualPrice: 900 },
  Premium: { monthlyPrice: 120, annualPrice: 1200 },
};

function normalizeSubscriptionPlanName(plan) {
  const value = String(plan ?? "").trim();
  if (value === "Premium") return "Premium";
  if (value === "Essentiel") return "Essentiel";
  if (value === "Essai gratuit") return "Essai gratuit";
  return "Standard";
}

function isTrialSubscriptionPlan(plan) {
  return normalizeSubscriptionPlanName(plan) === "Essai gratuit";
}

function resolveSchoolCountryCodeFromRow(school = {}) {
  const explicit = String(school.countryCode ?? "").trim().toUpperCase();
  if (explicit) return explicit;
  const fromCode = String(school.code ?? "").match(/^([A-Z]{2})-/i)?.[1];
  return fromCode ? fromCode.toUpperCase() : "";
}

function resolveCountrySubscriptionPolicy(country = {}) {
  const custom = country.subscriptionPolicy ?? {};
  const currency =
    String(custom.currency ?? country.currency ?? "USD").trim() || "USD";
  const plans = { ...GLOBAL_SUBSCRIPTION_PLAN_PRICING };

  for (const planName of Object.keys(GLOBAL_SUBSCRIPTION_PLAN_PRICING)) {
    const override = custom.plans?.[planName];
    if (!override) continue;
    plans[planName] = {
      monthlyPrice: Number(override.monthlyPrice ?? plans[planName].monthlyPrice),
      annualPrice: Number(override.annualPrice ?? plans[planName].annualPrice),
    };
  }

  return { currency, plans };
}

function findCountryForSubscription(countries = [], school = {}, subscription = {}) {
  const code =
    String(subscription.countryCode ?? "").trim().toUpperCase() ||
    resolveSchoolCountryCodeFromRow(school);
  if (code) {
    const match = countries.find(
      (country) => String(country.code ?? "").trim().toUpperCase() === code,
    );
    if (match) return match;
  }
  const countryName = String(school.country ?? subscription.country ?? "").trim();
  if (!countryName) return undefined;
  return countries.find(
    (country) =>
      String(country.name ?? "").trim().toLowerCase() === countryName.toLowerCase() ||
      String(country.code ?? "").trim().toUpperCase() === countryName.toUpperCase(),
  );
}

function applySubscriptionPolicyToState(state = {}) {
  const countries = Array.isArray(state.countries) ? state.countries : [];
  const schools = Array.isArray(state.schools) ? state.schools : [];
  const schoolByCode = new Map(
    schools.map((school) => [normalizeSchoolCodeKey(school.code ?? school.publicId), school]),
  );

  const subscriptions = (Array.isArray(state.subscriptions) ? state.subscriptions : []).map(
    (subscription) => {
      const school = schoolByCode.get(normalizeSchoolCodeKey(subscription.schoolCode));
      const country = findCountryForSubscription(countries, school, subscription);
      const policy = resolveCountrySubscriptionPolicy(country);
      const plan = normalizeSubscriptionPlanName(subscription.plan ?? school?.subscriptionPlan);
      const pricing = isTrialSubscriptionPlan(plan)
        ? { monthlyPrice: 0, annualPrice: 0 }
        : policy.plans[plan] ?? policy.plans.Standard;

      return {
        ...subscription,
        plan,
        monthlyPrice: pricing.monthlyPrice,
        annualPrice: pricing.annualPrice,
        currency: policy.currency,
        country: subscription.country || school?.country || country?.name || subscription.country,
        countryCode:
          subscription.countryCode || country?.code || resolveSchoolCountryCodeFromRow(school),
      };
    },
  );

  return { ...state, subscriptions };
}

function mergeRowsByIdentity(primaryRows = [], secondaryRows = []) {
  const rows = new Map();
  [...primaryRows, ...secondaryRows].forEach((row, index) => {
    const key = row?.id ?? row?.publicId ?? row?.code ?? row?.studentId ?? `row-${index}`;
    rows.set(String(key), row);
  });
  return [...rows.values()];
}

function userRowKey(row = {}) {
  return String(row.id ?? row.identifier ?? row.publicId ?? "").trim();
}

/** Fusionne les comptes en préservant passwordHash / temporaryPassword existants. */
function mergeUserRows(primaryRows = [], secondaryRows = []) {
  const rows = new Map();

  primaryRows.forEach((row, index) => {
    const key = userRowKey(row) || `primary-${index}`;
    rows.set(key, { ...row });
  });

  secondaryRows.forEach((row, index) => {
    const key = userRowKey(row) || `secondary-${index}`;
    const existing = rows.get(key) ?? {};
    const merged = { ...existing, ...row };
    applyStoredUserCredentials(existing, row, merged);
    rows.set(key, normalizeBackOfficeUserCredentials(merged));
  });

  return [...rows.values()];
}

function schoolRowKey(row = {}) {
  const code = String(row.code ?? row.publicId ?? row.schoolCode ?? "").trim().toUpperCase();
  return code || String(row.id ?? row.publicId ?? "");
}

function mergeSchoolRows(dbSchools = [], storedSchools = []) {
  const rows = new Map();

  storedSchools.forEach((school) => {
    const key = schoolRowKey(school);
    if (key) rows.set(key, { ...school });
  });

  dbSchools.forEach((school) => {
    const key = schoolRowKey(school);
    if (!key) return;
    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, { ...school });
      return;
    }
    const merged = { ...existing, ...school };
    for (const [field, value] of Object.entries(existing)) {
      const next = merged[field];
      if ((next === undefined || next === null || next === "") && value !== undefined && value !== null && value !== "") {
        merged[field] = value;
      }
    }
    rows.set(key, merged);
  });

  return [...rows.values()];
}

function isSuperAdminPrincipal(principal) {
  return principal?.role === "Super Administrateur Somafrik" || principal?.role === "Super Administrateur OKAFRIK";
}

/**
 * Vue backoffice destinée au client HTTP : scoping métier + sanitization des secrets.
 * Ne pas utiliser pour les merges internes (qui doivent conserver passwordHash, etc.).
 */
function scopedBackOfficeStateForResponse(payload = {}, principal) {
  return sanitizeCredentialBearingStateForResponse(scopeBackOfficeState(payload, principal));
}

function scopeBackOfficeState(payload = {}, principal) {
  const state = sanitizeBackOfficeState(payload);
  if (!principal || isSuperAdminPrincipal(principal)) {
    return state;
  }

  if (principal.role === "Admin Pays") {
    const countryScope = principal.countryScope ?? principal.countryCode ?? "";
    const countryCode = principal.countryCode || getCountryCodeFromScope(countryScope);
    if (!countryCode) {
      return scopeStateWithSchools(state, new Set(), { countries: [] });
    }
    const schools = state.schools.filter((item) => schoolMatchesCountryScope(item, countryScope || countryCode));
    const schoolCodes = new Set(
      schools.map((item) => normalizeSchoolCodeKey(item.code ?? item.publicId)).filter(Boolean),
    );
    const countries = state.countries.filter((item) => item.code === countryCode);
    const scopedState = scopeStateWithSchools(state, schoolCodes, {
      countries,
    });
    return {
      ...scopedState,
      users: scopedState.users.filter((item) => item.role === "Admin School"),
    };
  }

  const schoolCodes = new Set(
    [principal.schoolCode].filter(Boolean).map((code) => normalizeSchoolCodeKey(code)),
  );
  return scopeStateWithSchools(state, schoolCodes, {
    principalClassNames: principal.classNames ?? [],
  });
}

function scopeStateWithSchools(state, schoolCodes, overrides = {}) {
  const students = state.students.filter((item) => hasSchoolScope(item, schoolCodes));
  const studentIds = new Set(students.map((item) => item.id));
  const classNames = new Set([
    ...students.map((item) => item.className).filter(Boolean),
    ...(overrides.principalClassNames ?? []).filter(Boolean),
  ]);
  const teachers = state.teachers.filter((item) =>
    hasSchoolScope(item, schoolCodes) ||
    (item.assignedClasses ?? []).some((className) => classNames.has(className)) ||
    (item.assignments ?? []).some((assignment) => classNames.has(assignment.className))
  );
  const teacherRefs = new Set();
  for (const teacher of teachers) {
    for (const ref of [teacher.id, teacher.publicId, teacher.identifier, teacher.userId, teacher.contactId]) {
      const value = String(ref ?? "").trim();
      if (value) teacherRefs.add(value);
    }
  }
  const classes = state.classes.filter((item) => hasSchoolScope(item, schoolCodes) || classNames.has(item.name));
  classes.forEach((item) => {
    if (item.name) classNames.add(item.name);
  });

  const courses = state.courses.filter((item) => hasSchoolScope(item, schoolCodes) || classNames.has(item.className));
  const assignments = state.assignments.filter((item) =>
    hasSchoolScope(item, schoolCodes) ||
    classNames.has(item.className) ||
    teacherRefs.has(String(item.teacherId ?? "").trim()),
  );
  const courseSchedules = (state.courseSchedules ?? []).filter((item) =>
    hasSchoolScope(item, schoolCodes) || classNames.has(item.className),
  );
  const users = state.users.filter((item) => hasSchoolScope(item, schoolCodes));
  const contacts = (state.contacts ?? []).filter((item) => hasSchoolScope(item, schoolCodes));
  const relations = (state.relations ?? []).filter((item) => hasSchoolScope(item, schoolCodes));
  const schools = state.schools.filter((item) =>
    schoolCodes.has(normalizeSchoolCodeKey(item.code ?? item.publicId)),
  );
  const subscriptions = state.subscriptions.filter((item) => hasSchoolScope(item, schoolCodes));
  const payments = state.payments.filter((item) => belongsToScopedStudentOrSchool(item, schoolCodes, studentIds));
  const paymentStatuses = state.paymentStatuses.filter((item) => hasSchoolScope(item, schoolCodes));
  const feeGrids = (state.feeGrids ?? []).filter((item) => hasSchoolScope(item, schoolCodes));
  const schoolFeeItems = (state.schoolFeeItems ?? []).filter((item) => hasSchoolScope(item, schoolCodes));
  const studentFees = (state.studentFees ?? []).filter((item) =>
    belongsToScopedStudentOrSchool(item, schoolCodes, studentIds),
  );
  const feeTariffHistory = (state.feeTariffHistory ?? []).filter((item) => hasSchoolScope(item, schoolCodes));
  const presences = state.presences.filter((item) => belongsToScopedStudentOrSchool(item, schoolCodes, studentIds));
  const notes = state.notes.filter((item) => belongsToScopedStudentOrSchool(item, schoolCodes, studentIds));
  const evaluations = (state.evaluations ?? []).filter((item) =>
    hasSchoolScope(item, schoolCodes) || classNames.has(item.className),
  );
  const exams = state.exams.filter((item) =>
    hasSchoolScope(item, schoolCodes) || classNames.has(item.className),
  );
  const bulletins = state.bulletins.filter((item) => belongsToScopedStudentOrSchool(item, schoolCodes, studentIds));
  const documents = state.documents.filter((item) => belongsToScopedStudentOrSchool(item, schoolCodes, studentIds));
  const announcements = state.announcements.filter(
    (item) => isSystemBroadcastRow(item) || hasSchoolScope(item, schoolCodes),
  );
  const messages = state.messages.filter((item) =>
    isSystemBroadcastRow(item)
      ? true
      : !item.studentId
        ? hasSchoolScope(item, schoolCodes)
        : belongsToScopedStudentOrSchool(item, schoolCodes, studentIds),
  );
  const academicConfigs = Object.fromEntries(
    Object.entries(state.academicConfigs).filter(([schoolCode]) => schoolCodes.has(schoolCode))
  );

  return {
    ...state,
    schools,
    users,
    contacts,
    relations,
    students,
    teachers,
    classes,
    courses,
    assignments,
    courseSchedules,
    payments,
    paymentStatuses,
    feeGrids,
    schoolFeeItems,
    studentFees,
    feeTariffHistory,
    subscriptions: overrides.subscriptions ?? subscriptions,
    presences,
    notes,
    evaluations,
    exams,
    bulletins,
    documents,
    announcements,
    messages,
    academicConfigs,
    countries: overrides.countries ?? state.countries,
  };
}

const MANAGED_PENDING_VALIDATION_STATUS = "En attente de validation";
const MANAGED_VALIDATED_STATUS = "Validé";
const SCHOOL_ADMIN_ROLE_LABEL = "Admin School";

function isPendingValidationSchool(school) {
  const status = school?.validationStatus;
  return status === MANAGED_PENDING_VALIDATION_STATUS || status === "En attente";
}

/**
 * Règle métier : un établissement créé par un Admin Pays doit être validé par le
 * Super Admin. L'Admin Pays ne peut ni le créer validé, ni l'activer lui-même.
 */
function applyCountryAdminSchoolValidation(mergedSchools, currentSchools, principal) {
  const currentByKey = new Map(currentSchools.map((school) => [rowKey(school), school]));
  const requestedAt = new Date().toISOString();
  const requestedBy = principal?.sub ?? principal?.identifier ?? "Admin Pays";

  return mergedSchools.map((school) => {
    const prior = currentByKey.get(rowKey(school));

    if (!prior) {
      return {
        ...school,
        validationStatus: MANAGED_PENDING_VALIDATION_STATUS,
        validationRequestedBy: requestedBy,
        validationRequestedAt: school.validationRequestedAt ?? requestedAt,
        validatedBy: null,
        validatedAt: null,
      };
    }

    if (isPendingValidationSchool(prior)) {
      return {
        ...school,
        validationStatus: prior.validationStatus ?? MANAGED_PENDING_VALIDATION_STATUS,
        validationRequestedBy: prior.validationRequestedBy ?? requestedBy,
        validationRequestedAt: prior.validationRequestedAt ?? requestedAt,
        validatedBy: prior.validatedBy ?? null,
        validatedAt: prior.validatedAt ?? null,
      };
    }

    return school;
  });
}

function finalizeSuperAdminSchoolValidation(schools = [], currentSchools = [], principal) {
  const currentByKey = new Map(currentSchools.map((school) => [rowKey(school), school]));
  const validatedAt = new Date().toISOString();
  const validatedBy = principal?.sub ?? principal?.identifier ?? "Super Admin";

  return schools.map((school) => {
    const prior = currentByKey.get(rowKey(school));
    const wasPending = prior ? isPendingValidationSchool(prior) : isPendingValidationSchool(school);

    if (wasPending && school.validationStatus === MANAGED_VALIDATED_STATUS) {
      return {
        ...school,
        validatedBy: school.validatedBy ?? validatedBy,
        validatedAt: school.validatedAt ?? validatedAt,
      };
    }

    return school;
  });
}

function isPendingValidationUser(user) {
  return (
    user?.validationStatus === MANAGED_PENDING_VALIDATION_STATUS ||
    user?.status === MANAGED_PENDING_VALIDATION_STATUS
  );
}

/**
 * Règle métier : un Admin École créé par un Admin Pays est autorisé, mais doit
 * être validé par le Super Admin pour devenir utilisable. L'Admin Pays ne peut
 * donc ni le créer actif, ni l'activer lui-même.
 */
function applyCountryAdminUserValidation(mergedUsers, currentUsers, principal) {
  const currentByKey = new Map(currentUsers.map((user) => [rowKey(user), user]));
  const requestedAt = new Date().toISOString();
  const requestedBy = principal?.sub ?? principal?.identifier ?? "Admin Pays";

  return mergedUsers.map((user) => {
    if (user?.role !== SCHOOL_ADMIN_ROLE_LABEL) {
      return user;
    }

    const prior = currentByKey.get(rowKey(user));

    if (!prior) {
      return {
        ...user,
        status: MANAGED_PENDING_VALIDATION_STATUS,
        validationStatus: MANAGED_PENDING_VALIDATION_STATUS,
        validationRequestedBy: requestedBy,
        validationRequestedAt: user.validationRequestedAt ?? requestedAt,
        validatedBy: null,
        validatedAt: null,
      };
    }

    if (isPendingValidationUser(prior)) {
      return {
        ...user,
        status: MANAGED_PENDING_VALIDATION_STATUS,
        validationStatus: MANAGED_PENDING_VALIDATION_STATUS,
        validationRequestedBy: prior.validationRequestedBy ?? requestedBy,
        validationRequestedAt: prior.validationRequestedAt ?? requestedAt,
        validatedBy: prior.validatedBy ?? null,
        validatedAt: prior.validatedAt ?? null,
      };
    }

    return user;
  });
}

/**
 * Quand le Super Admin active un compte Admin École précédemment en attente, on
 * horodate la validation pour la traçabilité (la validation reste son privilège).
 */
function finalizeSuperAdminUserValidation(users = [], currentUsers = [], principal) {
  const currentByKey = new Map(currentUsers.map((user) => [rowKey(user), user]));
  const validatedAt = new Date().toISOString();
  const validatedBy = principal?.sub ?? principal?.identifier ?? "Super Admin";

  return users.map((user) => {
    if (user?.role !== SCHOOL_ADMIN_ROLE_LABEL) {
      return user;
    }

    const prior = currentByKey.get(rowKey(user));
    const wasPending = prior ? isPendingValidationUser(prior) : isPendingValidationUser(user);

    if (wasPending && user.status === "Actif") {
      return {
        ...user,
        validationStatus: MANAGED_VALIDATED_STATUS,
        validatedBy: user.validatedBy ?? validatedBy,
        validatedAt: user.validatedAt ?? validatedAt,
      };
    }

    return user;
  });
}

function resolveTouchedBackOfficeKeys(rawBody = {}) {
  const optionalKeys = ["rolePermissions", "academicConfigs", "dashboardChartConfig", "auditLog"];
  return [
    ...backOfficeDeletableEntities.filter((entity) =>
      Object.prototype.hasOwnProperty.call(rawBody, entity),
    ),
    ...optionalKeys.filter((key) => Object.prototype.hasOwnProperty.call(rawBody, key)),
  ];
}

function mergeScopedBackOfficeState(
  currentPayload = {},
  requestedPayload = {},
  principal,
  touchedKeys = backOfficeDeletableEntities,
) {
  const current = sanitizeBackOfficeState(currentPayload);
  const requested = sanitizeBackOfficeState(requestedPayload);
  const deletionScope = touchedKeys;

  if (!principal || isSuperAdminPrincipal(principal)) {
    const mergeEntity = (entity, finalize) => {
      if (!deletionScope.includes(entity)) {
        return current[entity] ?? [];
      }
      const mergedRows =
        entity === "users"
          ? mergeUserRows(current[entity] ?? [], requested[entity] ?? [])
          : mergeRowsByIdentity(current[entity] ?? [], requested[entity] ?? []);
      return finalize ? finalize(mergedRows, current[entity] ?? [], principal) : mergedRows;
    };

    return {
      ...applyDeletedRows({
        ...current,
        ...requested,
        schools: mergeEntity("schools", finalizeSuperAdminSchoolValidation),
        users: mergeEntity("users", finalizeSuperAdminUserValidation),
        countries: mergeEntity("countries"),
        contacts: mergeEntity("contacts"),
        relations: mergeEntity("relations"),
        subscriptions: mergeEntity("subscriptions"),
        notifications: mergeEntity("notifications"),
        students: mergeEntity("students"),
        teachers: mergeEntity("teachers"),
        // Lecture seule — jamais fusionnée depuis le client.
        classes: current.classes ?? [],
        courses: mergeEntity("courses"),
        assignments: mergeEntity("assignments"),
        courseSchedules: mergeEntity("courseSchedules"),
        payments: mergeEntity("payments"),
        paymentStatuses: mergeEntity("paymentStatuses"),
        feeGrids: mergeEntity("feeGrids"),
        schoolFeeItems: mergeEntity("schoolFeeItems"),
        studentFees: mergeEntity("studentFees"),
        feeTariffHistory: mergeEntity("feeTariffHistory"),
        presences: mergeEntity("presences"),
        notes: mergeEntity("notes"),
        evaluations: mergeEntity("evaluations"),
        exams: mergeEntity("exams"),
        bulletins: mergeEntity("bulletins"),
        documents: mergeEntity("documents"),
        announcements: mergeEntity("announcements"),
        messages: mergeEntity("messages"),
        rolePermissions: {
          ...current.rolePermissions,
          ...(requested.rolePermissions ?? {}),
        },
        academicConfigs: mergeAcademicConfigs(
          current.academicConfigs,
          requested.academicConfigs ?? {},
          true,
        ),
        dashboardChartConfig: sanitizeDashboardChartConfig(
          requested.dashboardChartConfig ?? current.dashboardChartConfig,
        ),
        deletedRows: mergeDeletedRows(
          current.deletedRows,
          detectDeletedRows(current, requested, deletionScope),
        ),
        updatedAt: new Date().toISOString(),
      }),
      // Lot 2 / T1 — ephemeral (non persisté par sanitizeBackOfficeState)
      identitySyncAck: { skips: [] },
    };
  }

  if (principal.role === "Admin Pays") {
    const scopedCurrent = scopeBackOfficeState(current, principal);
    const scopedRequested = scopeBackOfficeState(requested, principal);
    const countryDeletionScope = roleGovernanceService
      .editableEntitiesForCountryAdmin()
      .filter((entity) => touchedKeys.includes(entity));
    const deletedRows = mergeDeletedRows(
      current.deletedRows,
      detectDeletedRows(scopedCurrent, scopedRequested, countryDeletionScope),
    );

    return {
      ...applyDeletedRows({
      ...current,
      schools: applyCountryAdminSchoolValidation(
        mergeScopedEntityIfTouched("schools", current, scopedRequested, scopedCurrent, touchedKeys),
        current.schools,
        principal,
      ),
      users: applyCountryAdminUserValidation(
        mergeScopedEntityIfTouched("users", current, scopedRequested, scopedCurrent, touchedKeys),
        current.users,
        principal,
      ),
      countries: mergeCountryAdminCountries(
        current.countries,
        scopedRequested,
        scopedCurrent,
        touchedKeys,
      ),
      contacts: mergeScopedEntityIfTouched(
        "contacts",
        current,
        scopedRequested,
        scopedCurrent,
        touchedKeys,
      ),
      relations: mergeScopedEntityIfTouched(
        "relations",
        current,
        scopedRequested,
        scopedCurrent,
        touchedKeys,
      ),
      subscriptions: mergeScopedEntityIfTouched(
        "subscriptions",
        current,
        scopedRequested,
        scopedCurrent,
        touchedKeys,
      ),
      notifications: mergeGlobalEntityIfTouched("notifications", current, requested, touchedKeys),
      rolePermissions: current.rolePermissions,
      deletedRows,
      updatedAt: new Date().toISOString(),
    }),
      // Lot 2 / T1 — ephemeral
      identitySyncAck: { skips: [] },
    };
  }

  const scopedCurrent = scopeBackOfficeState(current, principal);
  const scopedRequested = scopeBackOfficeState(requested, principal);
  const schoolDeletionScope = getEditableEntitiesForPrincipal(principal).filter((entity) =>
    touchedKeys.includes(entity),
  );
  const deletedRows = pedagogyGovernanceService.filterSchoolAdminDeletedRows(
    mergeDeletedRows(
      current.deletedRows,
      detectDeletedRows(scopedCurrent, scopedRequested, schoolDeletionScope),
    ),
    principal,
  );

  const usersTouched = touchedKeys.includes("users");
  const teachersTouched = touchedKeys.includes("teachers");
  const mergedUsers = mergeScopedEntityIfTouched(
    "users",
    current,
    scopedRequested,
    scopedCurrent,
    touchedKeys,
  );
  const mergedTeachers = mergeScopedEntityIfTouched(
    "teachers",
    current,
    scopedRequested,
    scopedCurrent,
    touchedKeys,
  );
  const mergedContacts = mergeScopedEntityIfTouched(
    "contacts",
    current,
    scopedRequested,
    scopedCurrent,
    touchedKeys,
  );
  const mergedAssignmentsForSync = mergeScopedEntityIfTouched(
    "assignments",
    current,
    scopedRequested,
    scopedCurrent,
    touchedKeys,
  );
  const syncedTeachers = mergedTeachers;
  const syncedContacts = mergedContacts;
  const mergedCourses = mergeScopedEntityIfTouched(
    "courses",
    current,
    scopedRequested,
    scopedCurrent,
    touchedKeys,
  );

  return {
    ...applyDeletedRows({
    ...current,
    schools: mergeScopedEntityIfTouched("schools", current, scopedRequested, scopedCurrent, touchedKeys),
    users: mergedUsers,
    countries: principal.role === "Admin Pays"
      ? mergeScopedEntityIfTouched("countries", current, scopedRequested, scopedCurrent, touchedKeys)
      : current.countries,
    subscriptions: principal.role === "Admin School"
      ? current.subscriptions
      : mergeScopedEntityIfTouched("subscriptions", current, scopedRequested, scopedCurrent, touchedKeys),
    contacts: syncedContacts,
    relations: mergeScopedEntityIfTouched(
      "relations",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    notifications: mergeGlobalEntityIfTouched("notifications", current, requested, touchedKeys),
    students: mergeScopedEntityIfTouched(
      "students",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    teachers:
      principal.role === "Admin School"
        ? usersTouched || teachersTouched
          ? pedagogyGovernanceService.enforceSchoolAdminTeachers(
              current.teachers,
              syncedTeachers,
              scopedCurrent.teachers,
              principal,
            )
          : current.teachers
        : syncedTeachers,
    // Lecture seule — jamais fusionnée depuis le client (CRUD via /api/classes).
    classes: current.classes ?? [],
    courses: teachersTouched || touchedKeys.includes("courses")
      ? pedagogyGovernanceService.enforceCourseTeacherUniqueness(
          current.courses,
          mergedCourses,
          scopedCurrent.courses,
        )
      : current.courses,
    assignments: mergedAssignmentsForSync,
    courseSchedules: mergeScopedEntityIfTouched(
      "courseSchedules",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
    ),
    payments: mergeScopedEntityIfTouched(
      "payments",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    paymentStatuses: mergeScopedEntityIfTouched(
      "paymentStatuses",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
    ),
    feeGrids: mergeScopedEntityIfTouched("feeGrids", current, scopedRequested, scopedCurrent, touchedKeys),
    schoolFeeItems: mergeScopedEntityIfTouched(
      "schoolFeeItems",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
    ),
    studentFees: mergeScopedEntityIfTouched("studentFees", current, scopedRequested, scopedCurrent, touchedKeys),
    feeTariffHistory: mergeScopedEntityIfTouched(
      "feeTariffHistory",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
    ),
    presences: mergeScopedEntityIfTouched(
      "presences",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    notes: mergeScopedEntityIfTouched(
      "notes",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    evaluations: mergeScopedEntityIfTouched(
      "evaluations",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    exams: mergeScopedEntityIfTouched("exams", current, scopedRequested, scopedCurrent, touchedKeys),
    bulletins: mergeScopedEntityIfTouched("bulletins", current, scopedRequested, scopedCurrent, touchedKeys),
    documents: mergeScopedEntityIfTouched("documents", current, scopedRequested, scopedCurrent, touchedKeys),
    announcements: mergeScopedEntityIfTouched(
      "announcements",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
      requested,
      principal,
    ),
    messages: mergeScopedEntityIfTouched("messages", current, scopedRequested, scopedCurrent, touchedKeys),
    rolePermissions: touchedKeys.includes("rolePermissions")
      ? mergeScopedRolePermissions(current.rolePermissions, requested.rolePermissions, principal)
      : current.rolePermissions,
    academicConfigs: touchedKeys.includes("academicConfigs")
      ? mergeAcademicConfigs(
          current.academicConfigs,
          scopedRequested.academicConfigs ?? {},
          isSuperAdminPrincipal(principal),
        )
      : current.academicConfigs,
    auditLog: touchedKeys.includes("auditLog")
      ? mergeAuditLog(current.auditLog, requested.auditLog)
      : current.auditLog,
    deletedRows,
    updatedAt: new Date().toISOString(),
  }),
  };
}

/** Fusionne le journal d'audit (SEC-004) client + serveur, dédupliqué par id, plafonné à 200. */
function mergeAuditLog(currentLog, requestedLog) {
  const currentRows = Array.isArray(currentLog) ? currentLog : [];
  const requestedRows = Array.isArray(requestedLog) ? requestedLog : [];
  const seen = new Set();
  const merged = [];
  for (const entry of [...requestedRows, ...currentRows]) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(entry);
  }
  return merged.slice(0, 200);
}

function mergeScopedRows(currentRows, requestedScopedRows, currentScopedRows) {
  const scopedKeys = new Set(currentScopedRows.map(rowKey));
  const requestedKeys = new Set(requestedScopedRows.map(rowKey));
  return [
    ...requestedScopedRows,
    ...currentRows.filter((row) => !scopedKeys.has(rowKey(row)) && !requestedKeys.has(rowKey(row))),
  ];
}

/** Entités globales (non scopées établissement) : notifications plateforme, etc. */
function mergeGlobalEntityIfTouched(entity, current, requested, touchedKeys) {
  if (!touchedKeys.includes(entity)) {
    return Array.isArray(current[entity]) ? current[entity] : [];
  }
  return mergeRowsByIdentity(current[entity] ?? [], requested[entity] ?? []);
}

/** Ne fusionne une entité scopée que si le client l'a incluse dans le PUT (évite d'effacer des données). */
/** Admin Pays : mise à jour uniquement des pays déjà dans son périmètre (pas de création). */
function mergeCountryAdminCountries(currentCountries = [], scopedRequested = {}, scopedCurrent = {}, touchedKeys = []) {
  if (!touchedKeys.includes("countries")) {
    return currentCountries;
  }
  const scopedKeys = new Set((scopedCurrent.countries ?? []).map(rowKey));
  const requestedByKey = new Map(
    (scopedRequested.countries ?? []).map((row) => [rowKey(row), row]),
  );
  return currentCountries.map((country) => {
    const key = rowKey(country);
    if (scopedKeys.has(key) && requestedByKey.has(key)) {
      return { ...country, ...requestedByKey.get(key) };
    }
    return country;
  });
}

function resolvePrincipalSchoolCodes(principal = {}) {
  const schoolCode = normalizeSchoolCodeKey(principal.schoolCode);
  return schoolCode ? new Set([schoolCode]) : new Set();
}

function mergeScopedEntityIfTouched(
  entity,
  current,
  scopedRequested,
  scopedCurrent,
  touchedKeys,
  requestedPayload = null,
  principal = null,
) {
  if (!touchedKeys.includes(entity)) {
    return Array.isArray(current[entity]) ? current[entity] : [];
  }
  let requestedScopedRows = scopedRequested[entity] ?? [];
  const rawRows = Array.isArray(requestedPayload?.[entity]) ? requestedPayload[entity] : [];
  if (!requestedScopedRows.length && rawRows.length && principal) {
    const principalSchoolCodes = resolvePrincipalSchoolCodes(principal);
    const writableRows = principalSchoolCodes.size
      ? rawRows.filter((row) => hasSchoolScope(row, principalSchoolCodes))
      : rawRows;
    if (writableRows.length) {
      return mergeRowsByIdentity(current[entity] ?? [], writableRows);
    }
  }
  const currentScopedRows = scopedCurrent[entity] ?? [];
  if (!requestedScopedRows.length && !(current[entity] ?? []).length) {
    return [];
  }
  if (entity === "users" && requestedScopedRows.length) {
    const currentAllByKey = new Map(
      (current.users ?? []).map((row) => [userRowKey(row), row]).filter(([key]) => key),
    );
    requestedScopedRows = requestedScopedRows.map((row) => {
      const key = userRowKey(row);
      const existing = key ? (currentAllByKey.get(key) ?? {}) : {};
      const merged = { ...existing, ...row };
      applyStoredUserCredentials(existing, row, merged);
      return normalizeBackOfficeUserCredentials(merged);
    });
  }
  return mergeScopedRows(current[entity] ?? [], requestedScopedRows, currentScopedRows);
}

const SUPERADMIN_MANAGED_ROLES = roleGovernanceService.superadminManagedRoles;

function mergeScopedRolePermissions(currentRolePermissions = {}, requestedRolePermissions = {}, principal = {}) {
  if (!principal || isSuperAdminPrincipal(principal)) {
    const next = { ...currentRolePermissions };
    for (const role of SUPERADMIN_MANAGED_ROLES) {
      if (Array.isArray(requestedRolePermissions?.[role])) {
        next[role] = roleGovernanceService.normalizeManagedRolePermissions(
          role,
          requestedRolePermissions[role],
        );
      }
    }
    return next;
  }

  if (principal.role !== "Admin School") {
    return currentRolePermissions;
  }

  const nextRolePermissions = { ...currentRolePermissions };
  Object.entries(requestedRolePermissions ?? {}).forEach(([role, permissions]) => {
    if (isPlatformBackOfficeRole(role) || !Array.isArray(permissions)) {
      return;
    }

    nextRolePermissions[role] = [...new Set(permissions.filter((permission) =>
      roleGovernanceService.isSchoolRolePermissionAllowed(permission),
    ))].sort((left, right) => String(left).localeCompare(String(right), "fr"));
  });

  return nextRolePermissions;
}

function isPlatformBackOfficeRole(role) {
  return [
    "super administrateur okafrik",
    "admin pays",
    "admin school",
  ].includes(normalizeBusinessPermission(role));
}

function isSchoolRolePermissionAllowed(permission) {
  return roleGovernanceService.isSchoolRolePermissionAllowed(permission);
}

const CRITICAL_AUDIT_COLLECTIONS = [
  { key: "users", entityType: "user", label: (row) => `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.identifier },
  { key: "payments", entityType: "payment", label: (row) => row.publicId ?? row.id },
  { key: "bulletins", entityType: "bulletin", label: (row) => row.studentName ?? row.id },
  { key: "rolePermissions", entityType: "role_permissions", label: (row) => row.role ?? row.id },
  // Classes : plus d'audit via state — mutations via /api/classes uniquement.
  {
    key: "teachers",
    entityType: "teacher",
    label: (row) =>
      `${row.lastName ?? ""} ${row.firstName ?? ""}`.trim() || row.name || row.publicId || row.id,
  },
  {
    key: "assignments",
    entityType: "assignment",
    label: (row) =>
      [row.teacherName, row.subject ?? row.course, row.className].filter(Boolean).join(" · ") ||
      row.id,
  },
];

async function auditCriticalStateChanges(req, beforeState = {}, afterState = {}) {
  for (const collection of CRITICAL_AUDIT_COLLECTIONS) {
    if (collection.key === "rolePermissions") {
      const beforeRoles = beforeState.rolePermissions ?? {};
      const afterRoles = afterState.rolePermissions ?? {};
      for (const role of new Set([...Object.keys(beforeRoles), ...Object.keys(afterRoles)])) {
        const beforePermissions = JSON.stringify(beforeRoles[role] ?? []);
        const afterPermissions = JSON.stringify(afterRoles[role] ?? []);
        if (beforePermissions !== afterPermissions) {
          await auditService.record(req, "update_role_permissions", "role_permissions", role, {
            role,
            permissions: afterRoles[role] ?? [],
          });
        }
      }
      continue;
    }

    const beforeRows = Array.isArray(beforeState[collection.key]) ? beforeState[collection.key] : [];
    const afterRows = Array.isArray(afterState[collection.key]) ? afterState[collection.key] : [];
    const beforeMap = new Map(beforeRows.map((row) => [rowKey(row), row]));
    const afterMap = new Map(afterRows.map((row) => [rowKey(row), row]));

    for (const [key, row] of afterMap.entries()) {
      if (!beforeMap.has(key)) {
        await auditService.record(req, `create_${collection.entityType}`, collection.entityType, key, {
          label: collection.label(row),
          snapshot: row,
        });
      } else if (JSON.stringify(beforeMap.get(key)) !== JSON.stringify(row)) {
        await auditService.record(req, `update_${collection.entityType}`, collection.entityType, key, {
          label: collection.label(row),
          before: beforeMap.get(key),
          after: row,
        });
      }
    }

    for (const [key, row] of beforeMap.entries()) {
      if (!afterMap.has(key)) {
        await auditService.record(req, `delete_${collection.entityType}`, collection.entityType, key, {
          label: collection.label(row),
          snapshot: row,
        });
      }
    }
  }
}

function rowKey(row = {}) {
  return String(row.id ?? row.publicId ?? row.code ?? row.schoolCode ?? row.value ?? JSON.stringify(row));
}

function getEditableEntitiesForPrincipal(principal) {
  const countryEntities = [
    ...new Set([
      ...roleGovernanceService.editableEntitiesForCountryAdmin(),
      "notifications",
    ]),
  ];
  return getEditableEntitiesForPrincipalRole(
    principal,
    backOfficeDeletableEntities,
    countryEntities,
  );
}

const SCHOOL_SCOPED_DELETABLE_ENTITIES = new Set([
  "contacts",
  "relations",
  "students",
  "teachers",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "schoolFeeItems",
  "studentFees",
  "feeTariffHistory",
  "presences",
  "notes",
  "evaluations",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
]);

function schoolCodesFromRows(rows = []) {
  return new Set(
    rows
      .map((row) => String(row?.schoolCode ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
}

function repairMassEntityDeletion(state = {}, entity) {
  const rows = Array.isArray(state[entity]) ? state[entity] : [];
  const deleted = state.deletedRows?.[entity];
  if (!Array.isArray(deleted) || deleted.length <= rows.length || deleted.length < 20) {
    return state;
  }

  const nextDeletedRows = { ...(state.deletedRows ?? {}) };
  delete nextDeletedRows[entity];
  return { ...state, deletedRows: nextDeletedRows };
}

function repairCorruptedBackOfficeState(state = {}) {
  let next = state;
  for (const entity of SCHOOL_SCOPED_DELETABLE_ENTITIES) {
    next = repairMassEntityDeletion(next, entity);
  }
  return next;
}

function detectDeletedRows(currentState = {}, requestedState = {}, entities = []) {
  return entities.reduce((deletedRows, entity) => {
    const currentRows = Array.isArray(currentState[entity]) ? currentState[entity] : [];
    const requestedRows = Array.isArray(requestedState[entity]) ? requestedState[entity] : [];
    if (!requestedRows.length) {
      return deletedRows;
    }
    const requestedKeys = new Set(requestedRows.map(rowKey));

    let rowsToCheck = currentRows;
    if (SCHOOL_SCOPED_DELETABLE_ENTITIES.has(entity)) {
      const touchedSchools = schoolCodesFromRows(requestedRows);
      if (touchedSchools.size) {
        rowsToCheck = currentRows.filter((row) => {
          const code = String(row?.schoolCode ?? "").trim().toUpperCase();
          return code && touchedSchools.has(code);
        });
      }
    }

    const deletedKeys = rowsToCheck
      .map(rowKey)
      .filter((key) => key && !requestedKeys.has(key));

    if (deletedKeys.length) {
      deletedRows[entity] = deletedKeys;
    }

    return deletedRows;
  }, {});
}

function mergeDeletedRows(...sources) {
  const merged = {};
  sources.forEach((source) => {
    const normalized = sanitizeDeletedRows(source);
    Object.entries(normalized).forEach(([entity, keys]) => {
      merged[entity] = [...new Set([...(merged[entity] ?? []), ...keys])];
    });
  });
  return merged;
}

function reconcileStaleDeletedRowsWithStoredEntities(deletedRows = {}, state = {}) {
  const normalized = sanitizeDeletedRows(deletedRows);
  const next = {};
  let changed = false;

  backOfficeDeletableEntities.forEach((entity) => {
    const keys = normalized[entity];
    if (!Array.isArray(keys) || !keys.length) {
      return;
    }
    const liveKeys = new Set((state[entity] ?? []).map(rowKey));
    const kept = keys.filter((key) => !liveKeys.has(String(key)));
    if (kept.length !== keys.length) {
      changed = true;
    }
    if (kept.length) {
      next[entity] = kept;
    }
  });

  return changed ? next : normalized;
}

function reconcileStaleDeletedRowsWithRuntime(deletedRows = {}, runtimeState = {}) {
  const normalized = sanitizeDeletedRows(deletedRows);
  const next = {};
  let changed = false;

  backOfficeDeletableEntities.forEach((entity) => {
    const keys = normalized[entity];
    if (!Array.isArray(keys) || !keys.length) {
      return;
    }
    const runtimeKeys = new Set((runtimeState[entity] ?? []).map(rowKey));
    const kept = keys.filter((key) => !runtimeKeys.has(String(key)));
    if (kept.length !== keys.length) {
      changed = true;
    }
    if (kept.length) {
      next[entity] = kept;
    }
  });

  return changed ? next : normalized;
}

function inferDeletedRowsFromStoredSnapshot(runtimeState = {}, storedState = {}) {
  return backOfficeDeletableEntities.reduce((deletedRows, entity) => {
    if (!Object.prototype.hasOwnProperty.call(storedState, entity) || !Array.isArray(storedState[entity])) {
      return deletedRows;
    }

    const runtimeRows = Array.isArray(runtimeState[entity]) ? runtimeState[entity] : [];
    const storedKeys = new Set(storedState[entity].map(rowKey));
    const missingKeys = runtimeRows
      .map(rowKey)
      .filter((key) => key && !storedKeys.has(key));

    if (missingKeys.length) {
      deletedRows[entity] = missingKeys;
    }

    return deletedRows;
  }, {});
}

function sanitizeDeletedRows(value = {}) {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([entity, keys]) => backOfficeDeletableEntities.includes(entity) && Array.isArray(keys))
      .map(([entity, keys]) => [entity, [...new Set(keys.map((key) => String(key)).filter(Boolean))]])
  );
}

function applyDeletedRows(state = {}, deletedRows = state.deletedRows ?? {}) {
  const normalizedDeletedRows = sanitizeDeletedRows(deletedRows);
  const nextState = { ...state, deletedRows: normalizedDeletedRows };

  backOfficeDeletableEntities.forEach((entity) => {
    const rows = Array.isArray(nextState[entity]) ? nextState[entity] : [];
    const deletedKeys = new Set(normalizedDeletedRows[entity] ?? []);
    if (deletedKeys.size) {
      nextState[entity] = rows.filter((row) => !deletedKeys.has(rowKey(row)));
    }
  });

  return nextState;
}

/** Diffusion système (Super Admin) : annonce/message visible par tous les établissements. */
function isSystemBroadcastRow(row = {}) {
  return row.systemBroadcast === true || String(row.scope ?? "").trim().toLowerCase() === "system";
}

function hasSchoolScope(row = {}, schoolCodes) {
  const rowCode = normalizeSchoolCodeKey(row.schoolCode ?? row.code ?? row.publicId);
  if (!rowCode) return false;
  for (const code of schoolCodes) {
    const normalized = normalizeSchoolCodeKey(code);
    if (normalized && normalized === rowCode) return true;
  }
  return false;
}

// Contexte d'isolation établissement : identifiants d'élèves et noms de classes
// rattachés à l'établissement du principal. Sert à scoper les entités qui ne portent
// pas de code établissement (classes, cours, enseignants, paiements...).
function deriveSchoolScope(principal, state = {}) {
  const schoolCode = principal?.schoolCode;
  if (!schoolCode || schoolCode === "*") {
    return { schoolStudentIds: [], schoolClassNames: [] };
  }
  const students = (state.students ?? []).filter((student) => student.schoolCode === schoolCode);
  const schoolStudentIds = students.map((student) => student.id).filter(Boolean);
  const schoolClassNames = [
    ...new Set([
      ...students.map((student) => student.className).filter(Boolean),
      ...(state.classes ?? [])
        .filter((item) => item.schoolCode === schoolCode)
        .map((item) => item.name)
        .filter(Boolean),
    ]),
  ];
  return { schoolStudentIds, schoolClassNames };
}

function belongsToScopedStudentOrSchool(row = {}, schoolCodes, studentIds) {
  if (row.studentId && studentIds.has(row.studentId)) {
    return true;
  }

  return hasSchoolScope(row, schoolCodes);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function issueRefreshedAccessToken(session, payload) {
  const rolePermissionsMap = await getRolePermissionsMap();
  const { mergePermissionsForRoles, principalHasRole, toRoleKey } = require("./lib/userRoleLifecycle");
  let roleKeys = session.role ? [toRoleKey(session.role)].filter(Boolean) : [];
  if (typeof repository.listActiveUserRoleKeys === "function" && session.user_id) {
    try {
      const loaded = await repository.listActiveUserRoleKeys(session.user_id);
      if (Array.isArray(loaded) && loaded.length) {
        roleKeys = loaded;
      } else if (Array.isArray(loaded) && (!session.role || session.role === "Sans affectation")) {
        roleKeys = [];
      }
    } catch {
      /* fail-closed: keep session.role */
    }
  }
  let permissions = mergePermissionsForRoles(roleKeys, rolePermissionsMap);
  if (typeof repository.resolveEffectivePermissions === "function") {
    const live = await repository.resolveEffectivePermissions({
      sub: session.user_id,
      role: session.role,
      roleKeys,
      schoolCode: session.school_code ?? payload.schoolCode,
      countryCode: session.country_code ?? payload.countryCode,
    });
    if (Array.isArray(live?.permissions)) permissions = live.permissions;
  }
  const mustChangePassword = await principalMustChangePassword({
    sub: session.user_id,
    identifier: payload.identifier,
    publicId: payload.publicId,
  });

  let assignmentFields = {};
  if (principalHasRole({ role: session.role, roleKeys }, "Enseignant")) {
    const state = await getAuthoritativeBackOfficeState();
    const { teacherPrincipalAssignmentFields } = require("./lib/teacherSessionAssignments");
    assignmentFields = teacherPrincipalAssignmentFields(
      {
        id: session.user_code ?? payload.sub ?? session.user_id,
        sub: payload.sub ?? session.user_id,
        identifier: payload.identifier,
        publicId: payload.publicId,
        schoolCode: session.school_code ?? payload.schoolCode,
        role: "Enseignant",
      },
      state,
    );
  }

  const accessToken = tokenService.createAccessToken({
    sub: session.user_id,
    role: session.role,
    schoolCode: session.school_code ?? "*",
    countryCode: session.country_code ?? payload.countryCode ?? "",
    authSource: payload.authSource ?? "mobile",
    sessionId: payload.sessionId,
    permissions,
    identifier: payload.identifier,
    publicId: payload.publicId,
    mustChangePassword,
    ...assignmentFields,
  });
  return { accessToken, permissions };
}

async function sendAuthenticatedResponse(req, res, response, action) {
  const rolePermissionsMap = await getRolePermissionsMap();
  const userId = response.user?.id ?? response.user?.userId;
  if (typeof repository.listActiveUserRoleKeys === "function" && userId) {
    try {
      const loaded = await repository.listActiveUserRoleKeys(userId);
      if (Array.isArray(loaded)) {
        response.user = { ...response.user, roleKeys: loaded };
      }
    } catch {
      /* fail-closed: keep the login projection */
    }
  }
  const principal = buildPrincipal(response, rolePermissionsMap);
  if (typeof repository.resolveEffectivePermissions === "function") {
    const live = await repository.resolveEffectivePermissions(principal);
    if (Array.isArray(live?.permissions)) {
      principal.permissions = live.permissions;
    }
  }
  if (principal.role === "Parent" && (!principal.studentIds?.length) && Array.isArray(response.user?.children)) {
    principal.studentIds = response.user.children
      .flatMap((child) => [child.id, child.publicId, child.matricule])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }
  // P0-2 : ne pas embarquer le journal d'audit établissement dans le login Superadmin / Admin Pays.
  const refreshSession = tokenService.createRefreshToken({
    ...principal,
    authSource: action === "backoffice_login" ? "backoffice" : "mobile",
  });
  const accessToken = tokenService.createAccessToken({
    ...principal,
    authSource: action === "backoffice_login" ? "backoffice" : "mobile",
    sessionId: refreshSession.sessionId,
    mustChangePassword: principal.mustChangePassword,
  });

  await repository.createSession({
    sessionId: refreshSession.sessionId,
    refreshTokenHash: tokenService.hashToken(refreshSession.token),
    userId: principal.sub,
    schoolCode: principal.schoolCode,
    role: principal.role,
    expiresAt: refreshSession.expiresAt,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
  await repository.recordAudit({
    schoolCode: principal.schoolCode,
    userId: principal.sub,
    action,
    entityType: "session",
    entityId: refreshSession.sessionId,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    newValue: { role: principal.role, schoolCode: principal.schoolCode },
  });
  await touchUserLastLogin(principal);

  const safePayload = sanitizeAuthPayloadForResponse({
    ...response,
    user: response.user
      ? {
          ...response.user,
          role: principal.role,
          roles: principal.roles,
          roleKeys: principal.roleKeys,
          permissions: principal.permissions,
        }
      : response.user,
  });

  res.json({
    ...safePayload,
    accessToken,
    // Jeton de session top-level (contrat auth) — jamais embarqué dans `user`.
    refreshToken: refreshSession.token,
    tokenType: "Bearer",
    expiresIn: tokenService.accessTokenTtlSeconds,
    permissions: principal.permissions,
  });
}

function buildPrincipal(response, rolePermissionsMap = null) {
  const { displayRoles, mergePermissionsForRoles, toRoleKey } = require("./lib/userRoleLifecycle");
  const { resolvePrincipalSub } = require("./lib/principalIdentity");
  const user = response.user ?? {};
  const school = response.schoolContext ?? response.school ?? {};
  const rawRole = user.role ?? roleLabelFromMobileRole(response.role);
  const loadedKeys = Array.isArray(user.roleKeys)
    ? user.roleKeys.map(toRoleKey).filter(Boolean)
    : null;
  const roleKeys = loadedKeys?.length
    ? loadedKeys
    : loadedKeys && (!rawRole || rawRole === "Sans affectation")
      ? []
      : Array.isArray(user.roles) && user.roles.length
        ? user.roles.map(toRoleKey)
        : rawRole && rawRole !== "Sans affectation"
          ? [toRoleKey(rawRole)].filter(Boolean)
          : [];
  const display = displayRoles(roleKeys);
  const requestedLabel = roleLabelFromMobileRole(response.role);
  const requestedKey = toRoleKey(requestedLabel);
  const sessionMatchesGrant = requestedKey && roleKeys.includes(requestedKey);
  const role =
    sessionMatchesGrant
      ? requestedLabel
      : display.role === "Super Administrateur OKAFRIK"
        ? "Super Administrateur Somafrik"
        : display.role;
  const schoolCode = role === "Admin Pays" ? "*" : user.schoolCode ?? school.code ?? "*";
  const countryCode = user.countryCode || countryCodeFromScope(user.countryScope) || school.countryCode || countryCodeFromSchoolOrCountry(schoolCode, school.country);
  const permissions = mergePermissionsForRoles(roleKeys, rolePermissionsMap);

  const {
    filterActiveTeacherAssignments,
  } = require("./lib/classStudentsAuthz");
  const activeAssignments = filterActiveTeacherAssignments(
    Array.isArray(user.assignments) ? user.assignments : [],
  );

  const principalSub = resolvePrincipalSub(user);
  return {
    sub: principalSub,
    userId: principalSub,
    identifier: user.identifier,
    publicId: user.publicId,
    contactId: user.contactId,
    role,
    roles: display.roles,
    roleKeys: display.roleKeys,
    schoolCode,
    countryCode,
    countryScope: user.countryScope ?? "",
    permissions,
    mustChangePassword:
      user.mustChangePassword === false
        ? false
        : Boolean(user.mustChangePassword) || Boolean(String(user.temporaryPassword ?? "").trim()),
    studentIds: getPrincipalStudentIds(response),
    guardianStudentIds: getPrincipalGuardianStudentIds(response),
    // Uniquement dérivé des affectations explicitement actives (fail-closed).
    classNames: [
      ...new Set(activeAssignments.map((item) => item.className).filter(Boolean)),
    ],
    classCodes: [
      ...new Set(
        activeAssignments
          .map((item) => item.classCode ?? item.class_code)
          .filter(Boolean),
      ),
    ],
    classIds: [
      ...new Set(
        activeAssignments
          .map((item) => item.classId ?? item.class_id)
          .filter(Boolean),
      ),
    ],
    assignments: activeAssignments,
  };
}

/** Résout toutes les clés possibles d'un compte (id, publicId, identifiant de connexion). */
async function resolveUserPasswordLookupKeys(principal) {
  const keys = new Set();
  const add = (value) => {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      keys.add(normalized);
    }
  };

  add(principal?.sub);
  add(principal?.identifier);
  add(principal?.publicId);

  const collectAliases = (user) => {
    add(user?.id);
    add(user?.publicId);
    add(user?.identifier);
  };

  const matchesAny = (user) =>
    [user?.id, user?.publicId, user?.identifier].some((value) => {
      const alias = String(value ?? "").trim();
      return alias && keys.has(alias);
    });

  const { users: stateUsers } = await getAuthoritativeBackOfficeState();
  const runtime = await getRuntime();
  const users = Array.isArray(stateUsers) ? stateUsers : [];
  const runtimeAccounts = Array.isArray(runtime.userAccounts) ? runtime.userAccounts : [];
  const allAccounts = [...users, ...runtimeAccounts];

  let changed = true;
  while (changed) {
    changed = false;
    for (const user of allAccounts) {
      if (!matchesAny(user)) {
        continue;
      }
      const before = keys.size;
      collectAliases(user);
      if (keys.size > before) {
        changed = true;
      }
    }
  }

  return [...keys];
}

// Récupère la matrice de droits par rôle (configurée par le Super Admin dans le BackOffice).
async function getRolePermissionsMap() {
  return repository.getRolePermissionsMap();
}

function getPrincipalGuardianStudentIds(response) {
  const user = response.user ?? {};
  const fromChildren = (user.children ?? [])
    .flatMap((student) => [student.id, student.publicId, student.matricule])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const fromRelations = Array.isArray(user.guardianStudentIds) ? user.guardianStudentIds.map(String) : [];
  return [...new Set([...fromChildren, ...fromRelations])];
}

function getPrincipalStudentIds(response) {
  const user = response.user ?? {};
  const sessionLabel = roleLabelFromMobileRole(response.role);
  const role = sessionLabel === "Parent" || sessionLabel === "Élève / Étudiant"
    ? sessionLabel
    : user.role ?? sessionLabel;

  if (role === "Parent") {
    return (user.children ?? [])
      .flatMap((student) => [student.id, student.publicId, student.matricule])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }

  if (role === "Élève / Étudiant") {
    return [user.id].filter(Boolean);
  }

  return [];
}

function roleLabelFromMobileRole(role) {
  if (role === "super_admin") return "Super Administrateur Somafrik";
  if (role === "country_admin") return "Admin Pays";
  if (role === "school_admin") return "Admin School";
  if (role === "principal") return "Proviseur";
  if (role === "prefet") return "Préfet des études";
  if (role === "secretary") return "Secrétaire";
  if (role === "teacher") return "Enseignant";
  if (role === "student") return "Élève / Étudiant";
  if (role === "parent_student") return "Parent";
  return role;
}

function countryCodeFromSchoolOrCountry(schoolCode, country) {
  const fromScope = countryCodeFromScope(country);
  if (fromScope) return fromScope;
  return String(schoolCode ?? "").slice(0, 2).toUpperCase();
}

function countryCodeFromScope(countryScope) {
  const normalized = String(countryScope ?? "").trim().toUpperCase();
  const codes = {
    RDC: "CD",
    "RÉPUBLIQUE DÉMOCRATIQUE DU CONGO": "CD",
    "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CD",
    BURUNDI: "BI",
    BI: "BI",
    CONGO: "CG",
    CG: "CG",
    SENEGAL: "SN",
    "SÉNÉGAL": "SN",
    SN: "SN",
  };
  return codes[normalized] ?? (/^[A-Z]{2}$/.test(normalized) ? normalized : "");
}

async function hydrateParentPrincipal(principal) {
  if (!principal || principal.role !== "Parent") {
    return principal;
  }
  const state = await getAuthoritativeBackOfficeState();
  const principalKeys = new Set(
    [principal.sub, principal.identifier, principal.publicId, principal.contactId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const parentUser = (state.users ?? []).find((user) =>
    [user.id, user.publicId, user.identifier, user.contactId].some((value) =>
      principalKeys.has(String(value ?? "").trim()),
    ),
  );
  const schoolCode = String(
    principal.schoolCode ?? parentUser?.schoolCode ?? "",
  ).trim();
  let children = resolveParentChildren(
    parentUser ?? {
      contactId: principal.contactId,
      identifier: principal.identifier,
      phone: principal.phone ?? principal.identifier,
      schoolCode,
    },
    state,
    schoolCode,
  );
  if (!children.length && (principal.studentIds ?? []).length) {
    const linkedIds = new Set(
      principal.studentIds.map((value) => String(value ?? "").trim()).filter(Boolean),
    );
    children = (state.students ?? []).filter((row) =>
      linkedIds.has(String(row.id ?? "").trim()),
    );
  }
  if (!children.length) {
    return principal;
  }
  const studentIds = children
    .flatMap((child) => [child.id, child.publicId, child.matricule])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return {
    ...principal,
    schoolCode: schoolCode || principal.schoolCode,
    contactId: principal.contactId ?? parentUser?.contactId,
    studentIds,
  };
}

async function lookupSchoolForEffectiveScope(code) {
  const { matchesSchoolLookup } = require("./lib/schoolCodeV2");
  const requested = String(code ?? "").trim().toUpperCase();
  if (!requested) return null;

  if (typeof repository.getSchoolsRepository === "function") {
    const schoolsRepo = repository.getSchoolsRepository();
    if (schoolsRepo && typeof schoolsRepo.getByCode === "function") {
      const mapped = await schoolsRepo.getByCode(requested);
      if (mapped) return mapped;
    }
  }

  if (typeof repository.listEstablishments === "function") {
    const list = await repository.listEstablishments();
    const found = (list ?? []).find((row) => matchesSchoolLookup(row, requested));
    if (found) return found;
  }

  if (typeof repository.getSchoolByCode === "function") {
    return repository.getSchoolByCode(requested);
  }
  return null;
}

function rejectJwtInQueryString(req, res, next) {
  const query = req.query ?? {};
  if (query.token != null || query.access_token != null) {
    return next(
      new BusinessError(
        401,
        "JWT dans l'URL interdit. Utilisez Authorization: Bearer <token>.",
      ),
    );
  }
  return next();
}

function requireAuth(req, res, next) {
  (async () => {
    // S2.1 — auth exclusivement via header Bearer (plus de fallback query).
    if (req.query?.token != null || req.query?.access_token != null) {
      throw new BusinessError(
        401,
        "JWT dans l'URL interdit. Utilisez Authorization: Bearer <token>.",
      );
    }

    const header = req.get("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];

    if (!token) {
      throw new BusinessError(401, "Authentification JWT requise");
    }

    try {
      req.principal = await hydrateParentPrincipal(tokenService.verify(token, "access"));
    } catch (error) {
      if (error.statusCode) throw error;
      throw new BusinessError(401, "Authentification JWT requise");
    }

    const sessionId = String(req.principal?.sessionId ?? "").trim();
    if (sessionId && typeof repository.findActiveAccessSession === "function") {
      const activeSession = await repository.findActiveAccessSession(sessionId);
      if (!activeSession) {
        throw new BusinessError(401, "Session révoquée.");
      }
    }

    const {
      isPlatformPersonalDataForbiddenHttp,
      PLATFORM_PERSONAL_DATA_DENY,
    } = require("./lib/platformPersonalDataGuard");
    if (
      isPlatformPersonalDataForbiddenHttp(
        req.principal,
        req.method,
        req.originalUrl || req.path,
      )
    ) {
      const denied = new BusinessError(
        403,
        "Accès aux données personnelles établissement interdit pour un administrateur plateforme.",
      );
      denied.code = PLATFORM_PERSONAL_DATA_DENY;
      throw denied;
    }

    const { applyEffectiveSchoolScope } = require("./lib/principalSchoolScope");
    await applyEffectiveSchoolScope(req, lookupSchoolForEffectiveScope);

    const passwordChangeExemptPaths = new Set([
      "/api/auth/change-password",
      "/api/auth/logout",
      "/api/auth/revoke-all",
      "/api/auth/effective-permissions",
      "/api/privacy/erasure-requests/self/execute",
    ]);
    if (!passwordChangeExemptPaths.has(req.path) && await principalMustChangePassword(req.principal)) {
      throw new BusinessError(
        403,
        "Changement de mot de passe obligatoire avant d'accéder à cette ressource.",
      );
    }

    next();
  })().catch((error) => {
    next(error instanceof BusinessError ? error : new BusinessError(401, error.message));
  });
}

async function principalMustChangePassword(principal = {}) {
  if (principal.mustChangePassword === false) {
    return false;
  }
  if (principal.mustChangePassword === true) {
    return true;
  }

  const keys = new Set(
    [principal.sub, principal.identifier, principal.publicId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  if (!keys.size) {
    return false;
  }

  const state = await getAuthoritativeBackOfficeState();
  const user = (state.users ?? []).find((account) =>
    [account.id, account.publicId, account.identifier].some((value) => keys.has(String(value ?? "").trim())),
  );
  if (!user) {
    return false;
  }

  return Boolean(user.mustChangePassword) || Boolean(String(user.temporaryPassword ?? "").trim());
}

function requirePermission(routeKey) {
  return async (req, _res, next) => {
    try {
      if (req.principal) {
        if (isFinanceLiveRbacRouteKey(routeKey) && typeof repository.resolveFinanceLivePermissions === "function") {
          const live = await repository.resolveFinanceLivePermissions(req.principal);
          req.principal = {
            ...req.principal,
            permissions: Array.isArray(live?.permissions) ? live.permissions : [],
          };
        } else if (typeof repository.resolveEffectivePermissions === "function") {
          const live = await repository.resolveEffectivePermissions(req.principal);
          if (Array.isArray(live?.permissions)) {
            req.principal = { ...req.principal, permissions: live.permissions };
          }
        }
      }
      if (!rbacService.canAccess(req.principal, routeKey)) {
        return next(denyPermission());
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function sendList(res, rows, query, searchableFields) {
  const wantsPagination = ["page", "limit", "sort", "search"].some((key) => query[key] !== undefined);

  if (!wantsPagination) {
    return res.json(rows);
  }

  return res.json(paginationService.paginate(rows, query, searchableFields));
}

function findStudent(students, studentId) {
  const key = String(studentId ?? "").trim();
  const direct = students.find((item) =>
    [item.id, item.publicId, item.matricule].some((value) => String(value ?? "").trim() === key),
  );

  if (direct) {
    return direct;
  }

  if (/^\d+$/.test(key)) {
    return students[Number(key) - 1];
  }

  return undefined;
}

function principalLinkedStudentIds(principal = {}) {
  return new Set(
    (principal.studentIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean),
  );
}

function resolveAuthorizedStudentForPrincipal(students, principal, studentRef) {
  const scopedStudents = tenantScopeService.filterRows(students, principal);
  const scopedMatch = findStudent(scopedStudents, studentRef);
  if (scopedMatch) {
    return scopedMatch;
  }
  if (!isParentOrStudentPrincipalRole(principal.role)) {
    return undefined;
  }
  const linkedIds = principalLinkedStudentIds(principal);
  const rawStudent = findStudent(students, studentRef);
  if (!rawStudent) {
    return undefined;
  }
  for (const value of [rawStudent.id, rawStudent.publicId, rawStudent.matricule]) {
    const key = String(value ?? "").trim();
    if (key && linkedIds.has(key)) {
      return rawStudent;
    }
  }
  return undefined;
}

function samePresenceDay(left, right) {
  const normalize = (value) => {
    const text = String(value ?? "").trim();
    const localMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return text;
  };
  return normalize(left) === normalize(right);
}

async function ensureRepositoryBackOfficeSnapshot(state) {
  const storedState = await repository.getBackOfficeState();
  if (!hasUserBackOfficeState(storedState)) {
    await repository.saveBackOfficeState(sanitizeBackOfficeState(state));
  }
}

async function savePresencesViaBackOfficeState(state, items = []) {
  const { assertPresenceWrite } = require("./services/dataIntegrityService");
  const currentPresences = Array.isArray(state.presences) ? state.presences : [];
  const nextPresences = [...currentPresences];

  for (const item of items) {
    assertPresenceWrite({ ...state, presences: nextPresences }, item, { skipDuplicateCheck: true });
  }

  for (const item of items) {
    const student = findStudent(state.students ?? [], item.studentId);
    const studentKeys = student ? buildScopedStudentIdSet([student]) : new Set([String(item.studentId ?? "").trim()]);
    // D3.5b : même clé logique que PG — établissement + élève + jour
    const itemSchool = String(item.schoolCode ?? student?.schoolCode ?? "")
      .trim()
      .toUpperCase();
    const existingIndex = nextPresences.findIndex((presence) => {
      const rowSchool = String(presence.schoolCode ?? "")
        .trim()
        .toUpperCase();
      if (itemSchool && rowSchool && itemSchool !== rowSchool) return false;
      return (
        studentKeys.has(String(presence.studentId ?? "")) && samePresenceDay(presence.date, item.date)
      );
    });
    const status = item.status;
    const reason =
      item.reason ??
      (String(status ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("justifi")
        ? "Absence justifiée"
        : undefined);
    const entry = {
      id: item.id ?? item.publicId ?? `PRE-${item.date}-${String(item.studentId ?? "")}`,
      publicId: item.publicId ?? item.id ?? `PRE-${item.date}-${String(item.studentId ?? "")}`,
      schoolCode: itemSchool || item.schoolCode,
      studentId: student?.id ?? item.studentId,
      className: item.className,
      date: item.date,
      present: item.present,
      status,
      reason,
      savedAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      nextPresences[existingIndex] = { ...nextPresences[existingIndex], ...entry };
    } else {
      nextPresences.unshift(entry);
    }
  }

  await repository.saveBackOfficeState({ ...state, presences: nextPresences });
  return items.map((item) => ({
    id: item.id ?? item.publicId ?? `PRE-${item.date}-${item.studentId}`,
    publicId: item.publicId ?? item.id,
    schoolCode: item.schoolCode,
    studentId: item.studentId,
    className: item.className,
    date: item.date,
    present: item.present,
    status: item.status,
  }));
}

function buildScopedStudentIdSet(students = []) {
  const ids = new Set();
  for (const student of students) {
    for (const value of [student.id, student.publicId, student.matricule]) {
      const key = String(value ?? "").trim();
      if (key) ids.add(key);
    }
  }
  return ids;
}

function isParentOrStudentPrincipalRole(role = "") {
  const key = String(role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return key.includes("parent") || key.includes("eleve") || key.includes("etudiant");
}

/** Parent / élève : uniquement les notes liées à une évaluation publiée. */
function filterNotesForPrincipal(notes = [], evaluations = [], principal = {}) {
  if (!isParentOrStudentPrincipalRole(principal.role)) {
    return notes;
  }
  const { isPublishedEvaluationStatus } = require("./lib/gradesCanonical");
  const publishedEvalIds = new Set(
    (evaluations ?? [])
      .filter((row) => row.active !== false && isPublishedEvaluationStatus(row.status))
      .map((row) => String(row.id)),
  );
  return (notes ?? []).filter((note) => {
    const evaluationId = String(note.evaluationId ?? "");
    return evaluationId && publishedEvalIds.has(evaluationId);
  });
}

async function saveNotesViaBackOfficeState(state, payload = {}, principal = {}) {
  const { assertNoteWrite } = require("./services/dataIntegrityService");
  const { assertNoteOptimisticLock, bumpNoteVersion } = require("./lib/noteConcurrency");
  assertNoteWrite(state, payload);

  const value = Number(payload.value);
  const scale = Number(payload.scale ?? 20);
  if (!payload.studentId || !payload.subject || Number.isNaN(value) || value < 0 || value > scale) {
    throw new BusinessError(400, "Note invalide");
  }

  const student = findStudent(state.students ?? [], payload.studentId);
  if (!student) {
    throw new BusinessError(404, "Eleve introuvable");
  }

  const studentKeys = buildScopedStudentIdSet([student]);
  const evaluationId = String(payload.evaluationId ?? "").trim();
  const currentNotes = Array.isArray(state.notes) ? state.notes : [];
  const existingIndex = currentNotes.findIndex(
    (note) =>
      String(note.evaluationId ?? "") === evaluationId &&
      studentKeys.has(String(note.studentId ?? "")),
  );
  const existingNote = existingIndex >= 0 ? currentNotes[existingIndex] : null;
  assertNoteOptimisticLock(existingNote, payload.version);

  const now = new Date().toISOString();
  let entry = {
    id: existingIndex >= 0 ? currentNotes[existingIndex].id : payload.id ?? `NOTE-${Date.now()}`,
    schoolCode: String(payload.schoolCode ?? student.schoolCode ?? principal.schoolCode ?? "").trim(),
    studentId: String(student.id ?? student.matricule ?? payload.studentId),
    studentName: `${student.firstName ?? ""} ${student.lastName ?? student.name ?? ""}`.trim(),
    subject: String(payload.subject),
    className: String(payload.className ?? student.className ?? ""),
    period: String(payload.period ?? ""),
    value,
    scale,
    coefficient: Number(payload.coefficient ?? payload.evaluationCoefficient ?? 1),
    evaluationCoefficient: Number(payload.evaluationCoefficient ?? payload.coefficient ?? 1),
    evaluationId: evaluationId || undefined,
    gradeStatus: payload.gradeStatus ?? "Saisie",
    authorId: principal.sub ?? payload.authorId,
    enteredAt: now,
    date: payload.date ?? now.slice(0, 10),
    audit: existingIndex >= 0 ? currentNotes[existingIndex].audit ?? [] : [],
    version: 1,
  };

  if (existingIndex >= 0) {
    entry = bumpNoteVersion({ ...currentNotes[existingIndex], ...entry }, principal);
  }

  const nextNotes = [...currentNotes];
  if (existingIndex >= 0) {
    nextNotes[existingIndex] = entry;
  } else {
    nextNotes.unshift(entry);
  }

  await repository.saveBackOfficeState({ ...state, notes: nextNotes });
  return entry;
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function appSecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");

  if (process.env.NODE_ENV === "production" && req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

app.use((error, _req, res, _next) => {
  if (error.statusCode) {
    if (error.statusCode >= 500) {
      console.error(error);
    }
    return res.status(error.statusCode).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {}),
    });
  }

  console.error(error);
  res.status(500).json({
    message: "Erreur interne Somafrik",
    detail: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
});

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

initRepository()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Serveur lancé sur http://${HOST}:${PORT}`);
      console.log(`Base active: ${repository.engine ?? "postgresql"}`);
      console.log(`Web SPA: http://localhost:${PORT}/web/ (connexion: /web/connexion)`);
      if (!fs.existsSync(path.join(webDistPath, "index.html"))) {
        console.warn(`Attention: build web introuvable dans ${webDistPath}`);
      }
    });
  })
  .catch((error) => {
    // S2.2 — ne jamais journaliser URI/mots de passe complets.
    const safeMessage =
      error instanceof DbConfigError
        ? error.message
        : sanitizeDbErrorMessage(error);
    console.error("Impossible d'initialiser le stockage Somafrik");
    console.error(safeMessage);
    if (error?.domainCode) {
      console.error(`Code domaine: ${error.domainCode}`);
    }
    process.exit(1);
  });

async function initRepository() {
  warnIfUnsafeConfiguration();

  const { repository: active } = await initializeRepository({ repository });
  repository = active;
  if (process.env.NODE_ENV === "production" && (repository.engine ?? "") === "memory") {
    throw new DbConfigError("Base mémoire interdite en production.");
  }
  auditService = new AuditService(repository);
  idempotencyService = new IdempotencyService(repository);
  app.locals.idempotencyService = idempotencyService;
  startCommunicationsNotificationsWorker(repository);
  startExpoPushReceiptsWorker(repository);
}

function warnIfUnsafeConfiguration() {
  assertDatabaseConfiguration();
  assertProductionSecrets();
  assertProductionSecurityConfiguration();
  const { assertLoginLockoutProductionGuards } = require("./lib/loginLockout");
  assertLoginLockoutProductionGuards();
  assertProductionCors();
  warnIfUnsafeDevelopmentSecrets();
}
