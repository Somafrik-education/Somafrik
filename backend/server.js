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
const { validatePasswordPolicy, validateAccountSecret, validateIntroducedAccountSecrets } = require("./lib/userAccountRules");
const { GradeBookService } = require("./services/gradeBookService");
const { MvpBusinessService } = require("./services/mvpBusinessService");
const { ReportPdfService } = require("./services/reportPdfService");
const { createPostgresRepository, initializeRepository } = require("./db/repositoryFactory");
const {
  assertDatabaseConfiguration,
  sanitizeDbErrorMessage,
  DbConfigError,
} = require("./db/connectionConfig");
const { TokenService } = require("./services/tokenService");
const { RbacService } = require("./services/rbacService");
const { PaginationService } = require("./services/paginationService");
const { CacheService } = require("./services/cacheService");
const { TenantScopeService } = require("./services/tenantScopeService");
const { RoleGovernanceService } = require("./services/roleGovernanceService");
const { PedagogyGovernanceService } = require("./services/pedagogyGovernanceService");
const { UserTeacherSyncService } = require("./services/userTeacherSyncService");
const { AuditService } = require("./services/auditService");
const { mergeAcademicConfigs } = require("./lib/bulletinDesignAccess");
const { resolveParentChildren } = require("./lib/parentChildren");
const { classNamesMatch, normalizePresenceDay } = require("./lib/dataIntegrityRules");
const { getCountryCodeFromScope, schoolMatchesCountryScope } = require("./lib/countryScope");
const { buildDesignPreviewReport } = require("./lib/bulletinDesignPreview");
const {
  applyBulletinDesignToReport,
  resolveBulletinDesignForStudent,
} = require("./lib/bulletinDesignResolver");
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
let repository = createPostgresRepository();
const tokenService = new TokenService();
const rbacService = new RbacService();
const paginationService = new PaginationService();
const cacheService = new CacheService();
const tenantScopeService = new TenantScopeService();
const roleGovernanceService = new RoleGovernanceService();
const pedagogyGovernanceService = new PedagogyGovernanceService();
const userTeacherSyncService = new UserTeacherSyncService();
let auditService = new AuditService(repository);
let idempotencyService = new IdempotencyService(repository);
app.locals.idempotencyService = idempotencyService;

app.disable("x-powered-by");
app.use(appSecurityHeaders);
app.use(cors(buildCorsOptions({ BusinessError })));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "1mb" }));
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
      "/api/schools",
      "/api/schools/:code",
      "/api/identify",
      "/api/login",
      "/api/auth/refresh",
      "/api/auth/logout",
      "/api/backoffice/login",
      "/api/school",
      "/api/classes",
      "/api/courses",
      "/api/academic-config",
      "/api/assignments",
      "/api/students",
      "/api/students/:id",
      "/api/students/:id/notes",
      "/api/notes",
      "/api/presences",
      "/api/students/:id/report",
      "/api/students/:id/report.pdf",
      "/api/students/:id/presences",
      "/api/presences",
      "/api/students/:id/payments",
      "/api/teachers",
      "/api/users",
      "/api/payments",
      "/api/announcements",
      "/api/backoffice/countries",
      "/api/backoffice/subscriptions",
      "/api/backoffice/notifications",
      "/api/audit",
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
  res.json({
    status: "ok",
    database: repository.engine ?? "postgresql",
    version: process.env.npm_package_version ?? "1.0.0",
    timestamp: new Date().toISOString(),
  });
}));

if (process.env.SOMAFRIK_E2E === "true" || process.env.SOMAFRIK_DISABLE_LOGIN_LOCKOUT === "true") {
  const { clearAllFailedLoginAttempts } = require("./lib/loginLockout");
  app.post("/api/backoffice/e2e/clear-login-lockout", asyncHandler(async (_req, res) => {
    clearAllFailedLoginAttempts();
    res.json({ ok: true, message: "Verrous de connexion E2E réinitialisés." });
  }));
}

app.get("/api/schools", asyncHandler(async (_req, res) => {
  const { platformSchools } = await getRuntime();
  res.json(platformSchools);
}));

app.get("/api/schools/:code", asyncHandler(async (req, res) => {
  const { platformSchools } = await getRuntime();
  const requestedCode = req.params.code.toUpperCase();
  const foundSchool = platformSchools.find((item) =>
    [item.code, item.publicId].some(
      (value) => String(value ?? "").trim().toUpperCase() === requestedCode
    )
  );

  if (!foundSchool) {
    return res.status(404).json({ message: "Code etablissement invalide" });
  }

  res.json(foundSchool);
}));

app.post("/api/backoffice/login", loginRateLimiter, asyncHandler(async (req, res) => {
  const { backOfficeAccessService } = await getRuntime();
  const response = handleBusinessAction(() => backOfficeAccessService.login(req.body));
  if (response?.user?.role === "Parent") {
    const state = await getAuthoritativeBackOfficeState();
    const schoolCode =
      response.schoolContext?.code ??
      response.schoolContext?.schoolCode ??
      response.user?.schoolCode ??
      req.body?.schoolCode;
    const children = sanitizeUsersForResponse(resolveParentChildren(response.user, state, schoolCode));
    response.user = { ...response.user, children };
  }
  await sendAuthenticatedResponse(req, res, response, "backoffice_login");
}));

app.post("/api/identify", loginRateLimiter, asyncHandler(async (req, res) => {
  const { authService } = await getRuntime();
  handleBusinessResponse(res, () => authService.identify(req.body));
}));

app.post("/api/login", loginRateLimiter, asyncHandler(async (req, res) => {
  const { authService } = await getRuntime();
  const response = handleBusinessAction(() => authService.login(req.body));
  if (response?.user?.role === "Parent") {
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
  const payload = tokenService.verify(refreshToken, "refresh");
  const session = await repository.findActiveSession(payload.sessionId, tokenService.hashToken(refreshToken));

  if (!session) {
    throw new BusinessError(401, "Session expirée ou révoquée");
  }

  const rolePermissionsMap = await getRolePermissionsMap();
  const permissions = mergeRolePermissions(
    session.role,
    [...new Set([...(payload.permissions ?? []), ...rbacService.permissionsFor(session.role)])],
    rolePermissionsMap,
  );
  const mustChangePassword = await principalMustChangePassword({
    sub: session.user_id,
    identifier: payload.identifier,
    publicId: payload.publicId,
  });
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
  });

  res.json({
    accessToken,
    tokenType: "Bearer",
    expiresIn: tokenService.accessTokenTtlSeconds,
    permissions,
  });
}));

app.get("/api/auth/effective-permissions", requireAuth, asyncHandler(async (req, res) => {
  const rolePermissionsMap = await getRolePermissionsMap();
  const permissions = mergeRolePermissions(
    req.principal.role,
    [...new Set([...(req.principal.permissions ?? []), ...rbacService.permissionsFor(req.principal.role)])],
    rolePermissionsMap,
  );
  res.json({ permissions });
}));

app.post("/api/auth/logout", requireAuth, asyncHandler(async (req, res) => {
  await repository.revokeSession(req.principal.sessionId, "logout");
  await auditService.record(req, "logout", "session", req.principal.sessionId);
  res.json({ message: "Déconnexion sécurisée effectuée" });
}));

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
  const safeUser = {
    ...sanitizeUserForResponse(updatedUser),
    mustChangePassword: false,
  };
  const rolePermissionsMap = await getRolePermissionsMap();
  const principal = buildPrincipal(
    { user: safeUser },
    rolePermissionsMap,
  );
  const accessToken = tokenService.createAccessToken({
    ...principal,
    authSource: req.principal.authSource ?? "mobile",
    sessionId: req.principal.sessionId,
    mustChangePassword: false,
  });
  res.json({
    message: "Mot de passe mis à jour.",
    user: safeUser,
    accessToken,
    tokenType: "Bearer",
    expiresIn: tokenService.accessTokenTtlSeconds,
  });
}));

app.get("/api/school", requireAuth, asyncHandler(async (_req, res) => {
  const { school } = await getRuntime();
  res.json(school);
}));

app.get("/api/classes", requireAuth, asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { classes, students, teachers, presences } = state;
  const scope = deriveSchoolScope(req.principal, state);
  const scopedClasses = tenantScopeService.filterRows(classes, req.principal, scope);
  const scopedStudents = tenantScopeService.filterRows(students, req.principal, scope);
  const result = scopedClasses.map((item) => {
    const classStudents = scopedStudents.filter((student) => student.className === item.name);
    const teacher = teachers.find((teacherItem) => teacherItem.id === item.teacherId);
    const classPresences = presences.filter((presence) =>
      classStudents.some((student) => student.id === presence.studentId)
    );
    const presentCount = classPresences.filter((presence) => presence.present || presence.status === "Retard").length;
    const presenceRate = classPresences.length
      ? Math.round((presentCount / classPresences.length) * 100)
      : 0;

    return {
      ...item,
      teacher: teacher?.name ?? "Non assigne",
      students: classStudents.length,
      presenceRate,
    };
  });

  res.json(result);
}));

app.get("/api/courses", requireAuth, asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const scope = deriveSchoolScope(req.principal, state);
  res.json(tenantScopeService.filterRows(state.courses, req.principal, scope));
}));

app.get("/api/course-schedules", requireAuth, asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const scope = deriveSchoolScope(req.principal, state);
  let rows = tenantScopeService.filterRows(state.courseSchedules ?? [], req.principal, scope);

  const normalizeKey = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  // Un enseignant ne voit que ses propres créneaux (par identifiant ou par nom).
  if (req.principal.role === "Enseignant") {
    const userId = String(req.principal.sub ?? "").trim();
    const nameKeys = new Set(
      [
        req.principal.name,
        req.principal.identifier,
        [req.principal.firstName, req.principal.lastName].filter(Boolean).join(" "),
        [req.principal.lastName, req.principal.firstName].filter(Boolean).join(" "),
      ]
        .map(normalizeKey)
        .filter(Boolean),
    );
    const classNames = new Set((req.principal.classNames ?? []).map(normalizeKey));
    rows = rows.filter((slot) => {
      if (userId && String(slot.teacherId ?? "") === userId) return true;
      if (nameKeys.size && nameKeys.has(normalizeKey(slot.teacherName))) return true;
      if (classNames.size && classNames.has(normalizeKey(slot.className))) return true;
      return false;
    });
  }

  res.json(rows);
}));

app.get("/api/assignments", requireAuth, requirePermission("GET /api/assignments"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const scope = deriveSchoolScope(req.principal, state);
  let rows = tenantScopeService.filterRows(state.assignments ?? [], req.principal, scope);

  if (req.principal.role === "Enseignant") {
    const { assignmentMatchesTeacher } = require("./services/authService");
    const normalizeTeacherKey = (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    const teacher = (state.teachers ?? []).find((item) => {
      const userId = String(req.principal.sub ?? "").trim();
      const identifier = normalizeTeacherKey(req.principal.identifier);
      if (userId && String(item.userId ?? "") === userId) return true;
      if (userId && String(item.id ?? "") === userId) return true;
      if (identifier && normalizeTeacherKey(item.identifier) === identifier) return true;
      return false;
    });

    if (teacher) {
      rows = rows.filter((assignment) =>
        assignmentMatchesTeacher(assignment, teacher, {
          id: req.principal.sub,
          firstName: req.principal.firstName,
          lastName: req.principal.lastName,
          name: req.principal.name,
        }),
      );
    } else if ((req.principal.classNames ?? []).length) {
      const classNames = new Set(req.principal.classNames);
      rows = rows.filter((assignment) => classNames.has(assignment.className));
    }
  }

  sendList(res, rows, req.query, ["className", "course", "teacherName", "teacherId"]);
}));

app.get("/api/academic-config", requireAuth, asyncHandler(async (req, res) => {
  const config = await repository.getAcademicConfig(req.principal.schoolCode);
  res.json(config);
}));

app.put("/api/academic-config", requireAuth, asyncHandler(async (req, res) => {
  if (!["Super Administrateur Somafrik", "Admin Pays", "Admin School"].includes(req.principal.role)) {
    throw new BusinessError(403, "Seuls les administrateurs peuvent configurer la gestion académique.");
  }
  const saved = await repository.saveAcademicConfig(req.principal.schoolCode, req.body ?? {});
  await auditService.record(req, "save_academic_config", "academic_config", saved.schoolCode, saved);
  res.json(saved);
}));

app.get("/api/students", requireAuth, asyncHandler(async (req, res) => {
  const { students } = await getAuthoritativeBackOfficeState();
  const { className } = req.query;
  const result = sanitizeUsersForResponse(
    tenantScopeService.filterRows(students, req.principal)
      .filter((student) => !className || student.className === className),
  );

  sendList(res, result, req.query, ["name", "matricule", "className", "parentPhone"]);
}));

app.get("/api/students/:id", requireAuth, asyncHandler(async (req, res) => {
  const { students } = await getAuthoritativeBackOfficeState();
  const student = resolveAuthorizedStudentForPrincipal(students, req.principal, req.params.id);

  if (!student) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }

  res.json(sanitizeUserForResponse(student));
}));

app.get("/api/students/:id/notes", requireAuth, asyncHandler(async (req, res) => {
  const { notes, students, evaluations } = await getAuthoritativeBackOfficeState();
  const student = resolveAuthorizedStudentForPrincipal(students, req.principal, req.params.id);
  if (!student) {
    return res.json([]);
  }
  const studentIds = buildScopedStudentIdSet([student]);
  const scopedNotes = notes.filter((note) => studentIds.has(String(note.studentId ?? "")));
  res.json(filterNotesForPrincipal(scopedNotes, evaluations, req.principal));
}));

app.get("/api/notes", requireAuth, asyncHandler(async (req, res) => {
  const { notes, students, evaluations } = await getAuthoritativeBackOfficeState();
  let scopedStudents = tenantScopeService.filterRows(students, req.principal);
  if (!scopedStudents.length && isParentOrStudentPrincipalRole(req.principal.role)) {
    const linkedIds = principalLinkedStudentIds(req.principal);
    scopedStudents = students.filter((student) => linkedIds.has(String(student.id ?? "").trim()));
  }
  const studentIds = buildScopedStudentIdSet(scopedStudents);
  const scopedNotes = notes.filter((note) => studentIds.has(String(note.studentId ?? "")));
  res.json(filterNotesForPrincipal(scopedNotes, evaluations, req.principal));
}));

app.get("/api/presences", requireAuth, asyncHandler(async (req, res) => {
  const { presences, students } = await getAuthoritativeBackOfficeState();
  const { className, date } = req.query;
  let scopedStudents = tenantScopeService.filterRows(students, req.principal)
    .filter((student) => !className || student.className === className);
  if (!scopedStudents.length && isParentOrStudentPrincipalRole(req.principal.role)) {
    const linkedIds = principalLinkedStudentIds(req.principal);
    scopedStudents = students
      .filter((student) => linkedIds.has(String(student.id ?? "").trim()))
      .filter((student) => !className || student.className === className);
  }
  const studentIds = buildScopedStudentIdSet(scopedStudents);
  res.json(
    presences.filter((presence) =>
      studentIds.has(String(presence.studentId ?? "")) &&
      (!date || String(presence.date) === String(date))
    )
  );
}));

app.post("/api/notes", requireAuth, requireSchoolSubscriptionFeature("write_notes"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/notes",
    principal: req.principal,
    handler: async () => {
      assertCanManageNotes(req.principal);
      const state = await getAuthoritativeBackOfficeState();
      const body = req.body ?? {};
      const { assertNoteWrite } = require("./services/dataIntegrityService");
      // Unicité portée par PG upsert (school+evaluation+student) — comme D3.5b présences.
      assertNoteWrite(state, body, {
        enforceLockedEvaluation: false,
        skipDuplicateCheck: true,
      });
      let saved;
      // D3.6b : PostgreSQL = autorité canonique. JSON BO seulement en moteur mémoire.
      const engine = String(repository.engine ?? "postgresql");
      try {
        await ensureRepositoryBackOfficeSnapshot(state);
        saved = await repository.upsertGrade(body, req.principal);
      } catch (error) {
        const message = String(error?.message ?? "");
        const status = error?.statusCode ?? error?.status;
        const canUseTransientBoFallback =
          engine === "memory" &&
          (status === 404 || status === 400 || status === 403) &&
          (message.includes("introuvable") ||
            message.includes("Eleve") ||
            message.includes("Matiere") ||
            message.includes("Enseignant") ||
            message.includes("Evaluation") ||
            message.includes("évaluation") ||
            message.includes("trimestre") ||
            message.includes("Accès"));
        if (canUseTransientBoFallback) {
          saved = await saveNotesViaBackOfficeState(state, body, req.principal);
        } else {
          throw error;
        }
      }
      await auditService.record(req, "upsert_grade", "grade", saved.id, saved);
      return { statusCode: 201, body: saved };
    },
  });
}));

app.post("/api/presences", requireAuth, requireSchoolSubscriptionFeature("write_presence"), asyncHandler(async (req, res) => {
  await withIdempotency({
    req,
    res,
    routeKey: "POST /api/presences",
    principal: req.principal,
    handler: async () => {
      assertCanManagePresences(req.principal);
      const state = await getAuthoritativeBackOfficeState();
      const body = req.body ?? {};
      const batchClassName = String(body.className ?? "").trim();
      const items = (Array.isArray(body.items) ? body.items : []).map((item) => {
        const student = findStudent(state.students ?? [], item.studentId);
        return {
          ...item,
          studentId: student?.matricule ?? student?.publicId ?? student?.id ?? item.studentId,
          className: String(item.className ?? batchClassName ?? student?.className ?? "").trim(),
          schoolCode: String(item.schoolCode ?? student?.schoolCode ?? req.principal.schoolCode ?? "")
            .trim()
            .toUpperCase(),
        };
      });

      const { assertPresenceWrite } = require("./services/dataIntegrityService");
      const normalizedItems = [];
      for (const item of items) {
        const student = findStudent(state.students ?? [], item.studentId);
        const studentKeys = student ? buildScopedStudentIdSet([student]) : new Set();
        // D3.5b : clé = établissement + élève + jour
        const itemSchool = String(item.schoolCode ?? "").trim().toUpperCase();
        const duplicate = (state.presences ?? []).find((row) => {
          const rowSchool = String(row.schoolCode ?? "").trim().toUpperCase();
          if (itemSchool && rowSchool && itemSchool !== rowSchool) return false;
          return (
            studentKeys.has(String(row.studentId ?? "")) &&
            normalizePresenceDay(row.date) === normalizePresenceDay(item.date)
          );
        });
        const nextItem = duplicate ? { ...duplicate, ...item, id: duplicate.id } : item;
        assertPresenceWrite(state, nextItem, { skipDuplicateCheck: true });
        normalizedItems.push(nextItem);
      }

      await ensureRepositoryBackOfficeSnapshot(state);

      // D3.5b : PostgreSQL = autorité canonique. Le JSON BO n'est autorisé
      // qu'en moteur mémoire (secours démo), jamais comme 2ᵉ source durable.
      let saved;
      const engine = String(repository.engine ?? "postgresql");
      try {
        saved = await repository.upsertAttendanceBatch({ ...body, items: normalizedItems }, req.principal);
      } catch (error) {
        const message = String(error?.message ?? "");
        const status = error?.statusCode ?? error?.status;
        const canUseTransientBoFallback =
          engine === "memory" &&
          (status === 404 || status === 400) &&
          (message.includes("introuvable") || message.includes("Eleve") || message.includes("présence"));
        if (canUseTransientBoFallback) {
          saved = await savePresencesViaBackOfficeState(state, normalizedItems);
        } else {
          throw error;
        }
      }

      await auditService.record(req, "upsert_attendance", "attendance", req.body?.className ?? "batch", {
        count: saved.length,
        className: req.body?.className,
        date: req.body?.date,
      });
      return { statusCode: 201, body: saved };
    },
  });
}));

app.get("/api/students/:id/report", requireAuth, asyncHandler(async (req, res) => {
  const { gradeBookService } = await getRuntime();
  const { students } = await getAuthoritativeBackOfficeState();
  const student = findStudent(tenantScopeService.filterRows(students, req.principal), req.params.id);

  if (!student) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }

  res.json(stripSensitiveFieldsDeep(gradeBookService.generateReport(student.id)));
}));

app.get("/api/students/:id/report.pdf", requireAuth, asyncHandler(async (req, res) => {
  const { gradeBookService, reportPdfService } = await getRuntime();
  const backOfficeState = await getAuthoritativeBackOfficeState();
  const { students } = backOfficeState;
  const student = findStudent(tenantScopeService.filterRows(students, req.principal), req.params.id);

  if (!student) {
    return res.status(404).json({ message: "Eleve introuvable" });
  }

  const period = req.query.period ? String(req.query.period) : "Trimestre 1";
  const design = resolveBulletinDesignForStudent(backOfficeState, student);
  const baseReport = gradeBookService.generateReport(student.id, period, "Publié");
  const report = applyBulletinDesignToReport(baseReport, design);
  const pdf = await reportPdfService.generateReportCardPdf(report);
  const filename = `bulletin-${student.matricule}-${period.replace(/\s+/g, "-").toLowerCase()}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Content-Length", pdf.length);
  res.send(pdf);
}));

app.get("/api/students/:id/presences", requireAuth, asyncHandler(async (req, res) => {
  const { presences, students } = await getAuthoritativeBackOfficeState();
  const student = resolveAuthorizedStudentForPrincipal(students, req.principal, req.params.id);
  if (!student) {
    return res.json([]);
  }
  const studentIds = buildScopedStudentIdSet([student]);
  res.json(presences.filter((presence) => studentIds.has(String(presence.studentId ?? ""))));
}));

app.get("/api/students/:id/payments", requireAuth, asyncHandler(async (req, res) => {
  const { payments, students } = await getAuthoritativeBackOfficeState();
  const student = resolveAuthorizedStudentForPrincipal(students, req.principal, req.params.id);
  if (!student) {
    return res.json([]);
  }
  const studentIds = buildScopedStudentIdSet([student]);
  res.json(payments.filter((payment) => studentIds.has(String(payment.studentId ?? ""))));
}));

app.get("/api/teachers", requireAuth, requirePermission("GET /api/teachers"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const scope = deriveSchoolScope(req.principal, state);
  const result = tenantScopeService.filterRows(state.teachers, req.principal, scope).map((teacher) => {
    const safeTeacher = sanitizeUserForResponse(teacher);
    return {
      ...safeTeacher,
      assignedClasses: [...new Set((safeTeacher.assignments ?? []).map((item) => item.className))],
      courses: [...new Set((safeTeacher.assignments ?? []).map((item) => item.course))],
    };
  });
  sendList(res, result, req.query, ["name", "phone", "email", "mainSubject"]);
}));

app.get("/api/users", requireAuth, requirePermission("GET /api/users"), asyncHandler(async (req, res) => {
  const { users } = await getAuthoritativeBackOfficeState();
  const result = sanitizeUsersForResponse(tenantScopeService.filterRows(users, req.principal));
  sendList(res, result, req.query, ["firstName", "lastName", "identifier", "role", "schoolCode"]);
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

app.post("/api/users/:id/reset-password", requireAuth, asyncHandler(async (req, res) => {
  if (!canResetUserPassword(req.principal)) {
    throw new BusinessError(403, "Permission insuffisante pour réinitialiser le mot de passe.");
  }

  const { users } = await getAuthoritativeBackOfficeState();
  const scopedUsers = tenantScopeService.filterRows(users, req.principal);
  const target = scopedUsers.find((user) =>
    [user.id, user.publicId, user.identifier].some((value) => String(value ?? "") === String(req.params.id))
  );

  if (!target) {
    throw new BusinessError(404, "Utilisateur introuvable dans votre établissement.");
  }

  if (isPendingValidationUser(target) && !isSuperAdminPrincipal(req.principal)) {
    throw new BusinessError(
      409,
      "Compte en attente de validation par le Super Administrateur. Aucune action n'est possible avant validation."
    );
  }

  const temporaryPassword = String(req.body?.temporaryPassword ?? "").trim();
  const passwordError = validateAccountSecret(temporaryPassword);
  if (passwordError) {
    throw new BusinessError(400, passwordError);
  }

  const updatedUser = await repository.resetUserPassword(
    [target.id, target.publicId, target.identifier].filter(Boolean),
    temporaryPassword,
  );
  await auditService.record(req, "reset_user_password", "user", target.id, {
    user: target.identifier,
    oldPasswordInvalidated: true,
  });
  res.json({
    // Mot de passe provisoire renvoyé uniquement au top-level (handoff admin).
    temporaryPassword,
    user: {
      ...sanitizeUserForResponse(updatedUser),
      hasTemporaryPassword: true,
    },
  });
}));

app.get("/api/payments", requireAuth, requirePermission("GET /api/payments"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { payments, students } = state;
  const scope = deriveSchoolScope(req.principal, state);
  let scopedPayments = tenantScopeService.filterRows(payments, req.principal, scope);
  const result = scopedPayments.map((payment) => {
    const student = students.find((item) => item.id === payment.studentId);
    return {
      ...payment,
      studentName: student?.name ?? "Eleve inconnu",
      className: student?.className ?? "",
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
      const required = ["studentId", "feeType", "amount", "method", "date"];
      const missing = required.filter((field) => !String(body[field] ?? "").trim() && body[field] !== 0);
      if (missing.length) {
        throw new BusinessError(400, `Champs obligatoires manquants : ${missing.join(", ")}`);
      }
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BusinessError(400, "Le montant doit être strictement positif.");
      }

      const state = await getAuthoritativeBackOfficeState();
      const { applyAtomicPayment } = require("./services/paymentTransactionService");
      const { payment, nextState } = applyAtomicPayment(state, body, req.principal);
      await ensureRepositoryBackOfficeSnapshot(state);
      await repository.saveBackOfficeState(nextState);
      await auditService.record(req, "create_payment", "payment", payment.id, payment);
      return { statusCode: 201, body: payment };
    },
  });
}));

app.get("/api/announcements", requireAuth, asyncHandler(async (req, res) => {
  const { announcements } = await getAuthoritativeBackOfficeState();
  let result = tenantScopeService.filterRows(announcements, req.principal);
  if (!result.length && req.principal?.role === "Parent" && req.principal?.schoolCode) {
    const schoolCode = normalizeSchoolCodeKey(req.principal.schoolCode);
    result = announcements.filter(
      (row) => normalizeSchoolCodeKey(row.schoolCode) === schoolCode || tenantScopeService.isSystemBroadcast(row),
    );
  }
  res.json(result);
}));

app.get("/api/backoffice/countries", requireAuth, requirePermission("GET /api/backoffice/countries"), asyncHandler(async (req, res) => {
  const { countries } = await getRuntime();
  res.json(tenantScopeService.filterRows(countries, req.principal, { countryField: "code" }));
}));

app.get("/api/backoffice/subscriptions", requireAuth, requirePermission("GET /api/backoffice/subscriptions"), asyncHandler(async (req, res) => {
  const { subscriptions } = await getRuntime();
  sendList(res, tenantScopeService.filterRows(subscriptions, req.principal), req.query, ["schoolCode", "country", "plan", "status"]);
}));

app.get("/api/backoffice/notifications", requireAuth, requirePermission("GET /api/backoffice/notifications"), asyncHandler(async (req, res) => {
  const { platformNotifications } = await getRuntime();
  sendList(res, tenantScopeService.filterRows(platformNotifications, req.principal), req.query, ["title", "message", "type", "status"]);
}));

app.get("/api/backoffice/subscription-access", requireAuth, asyncHandler(async (req, res) => {
  const schoolCode = req.query.schoolCode || req.principal?.schoolCode;
  if (!schoolCode || schoolCode === "*") {
    return res.json({ level: "full", message: "" });
  }
  const state = await getAuthoritativeBackOfficeState();
  res.json(schoolSubscriptionAccessService.resolveSchoolAccess(schoolCode, state));
}));

app.get("/api/backoffice/establishments", requireAuth, requirePermission("GET /api/backoffice/establishments"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const rows = establishmentService.list(state, req.principal);
  sendList(res, rows, req.query, ["name", "code", "country", "city", "type", "status", "principalName"]);
}));

app.get("/api/backoffice/establishments/:code/users", requireAuth, requirePermission("GET /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  res.json(sanitizeUsersForResponse(establishmentService.getUsers(req.params.code, state, req.principal)));
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
  const state = await getAuthoritativeBackOfficeState();
  const { school, state: nextState } = establishmentService.create(req.body ?? {}, state, req.principal, {
    force: Boolean(req.body?.force),
  });
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "create_establishment", "school", school.code, { name: school.name });
  res.status(201).json({ school, state: scopedBackOfficeStateForResponse(saved, req.principal) });
}));

app.post("/api/backoffice/establishments/import", requireAuth, requirePermission("POST /api/backoffice/establishments/import"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { created, errors, state: nextState } = establishmentService.importRows(
    req.body?.rows ?? [],
    state,
    req.principal,
    { force: Boolean(req.body?.force) },
  );
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "import_establishments", "school", "bulk", {
    created: created.length,
    errors: errors.length,
  });
  res.status(201).json({ created, errors, count: created.length });
}));

app.post("/api/backoffice/import/students/validate", requireAuth, requirePermission("POST /api/backoffice/import/students/validate"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { validateStudentImportRows } = require("./services/importValidationService");
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const report = validateStudentImportRows(rows, state);
  res.json(report);
}));

app.patch("/api/backoffice/establishments/:code", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { school, state: nextState } = establishmentService.update(req.params.code, req.body ?? {}, state, req.principal);
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "update_establishment", "school", school.code);
  res.json({ school, state: scopedBackOfficeStateForResponse(saved, req.principal) });
}));

app.patch("/api/backoffice/establishments/:code/activate", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { school, state: nextState } = establishmentService.activate(req.params.code, state, req.principal);
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "activate_establishment", "school", school.code);
  res.json({ school });
}));

app.patch("/api/backoffice/establishments/:code/suspend", requireAuth, requirePermission("PATCH /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { school, state: nextState } = establishmentService.suspend(req.params.code, state, req.principal);
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "suspend_establishment", "school", school.code);
  res.json({ school });
}));

app.delete("/api/backoffice/establishments/:code", requireAuth, requirePermission("DELETE /api/backoffice/establishments/:code"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { school, state: nextState } = establishmentService.softDelete(req.params.code, state, req.principal);
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "delete_establishment", "school", school.code);
  res.json({ school, state: scopedBackOfficeStateForResponse(saved, req.principal) });
}));

app.get("/api/backoffice/finance/unpaid", requireAuth, requirePermission("GET /api/backoffice/finance/unpaid"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  res.json(
    unpaidService.list(state, req.principal, {
      search: req.query.search,
      className: req.query.className,
      period: req.query.period,
    }),
  );
}));

app.get("/api/backoffice/finance/unpaid/:studentId", requireAuth, requirePermission("GET /api/backoffice/finance/unpaid"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  res.json(unpaidService.detail(state, req.principal, req.params.studentId));
}));

app.get("/api/backoffice/finance/unpaid/:studentId/reminders", requireAuth, requirePermission("GET /api/backoffice/finance/unpaid"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const detail = unpaidService.detail(state, req.principal, req.params.studentId);
  res.json(detail.reminders);
}));

app.post("/api/backoffice/finance/unpaid/:studentId/reminders", requireAuth, requirePermission("POST /api/backoffice/finance/unpaid/reminders"), asyncHandler(async (req, res) => {
  const state = await getAuthoritativeBackOfficeState();
  const { reminder, state: nextState } = unpaidService.sendReminder(
    state,
    req.principal,
    req.params.studentId,
    req.body ?? {},
    { force: Boolean(req.body?.force) },
  );
  const saved = await saveEstablishmentState(nextState, state, req.principal);
  await auditService.record(req, "send_payment_reminder", "student_fee", req.params.studentId, {
    channel: reminder.channel,
    summary: reminder.summary,
  });
  res.status(201).json({ reminder, state: scopedBackOfficeStateForResponse(saved, req.principal) });
}));

app.get("/api/backoffice/state", requireAuth, asyncHandler(async (req, res) => {
  assertBackOfficeReader(req.principal);
  const state = await getAuthoritativeBackOfficeState();
  res.json(scopedBackOfficeStateForResponse(state, req.principal));
}));

app.put("/api/backoffice/state", requireAuth, asyncHandler(async (req, res) => {
  const rawBody = req.body ?? {};
  const touchedKeys = resolveTouchedBackOfficeKeys(rawBody);
  assertBackOfficeWriter(req.principal, touchedKeys);
  const currentState = await getAuthoritativeBackOfficeState();

  // HOTFIX-SYNC-03 — Enseignant : evaluations/notes uniquement, teacherId session, affectation.
  let effectiveBody = rawBody;
  let effectiveTouchedKeys = touchedKeys;
  if (isTeacherNotesPrincipal(req.principal)) {
    const prepared = prepareTeacherNotesWritePayload(rawBody, req.principal, currentState);
    if (!prepared.ok) {
      throw new BusinessError(403, prepared.message ?? "Permission insuffisante pour modifier ces données.");
    }
    effectiveBody = prepared.payload;
    effectiveTouchedKeys = Object.keys(prepared.payload);
  }

  const requestedState = sanitizeBackOfficeState(effectiveBody);
  const { validateWritePayload } = require("./services/dataIntegrityService");
  const integrityCheck = validateWritePayload(currentState, requestedState, effectiveTouchedKeys);
  if (!integrityCheck.ok) {
    throw new BusinessError(400, integrityCheck.errors[0]?.message ?? "Données incohérentes.");
  }
  const credentialErrors = validateIntroducedAccountSecrets(
    currentState,
    requestedState,
    effectiveTouchedKeys,
  );
  if (credentialErrors.length) {
    const first = credentialErrors[0];
    throw new BusinessError(400, first.message);
  }

  let nextState;
  if (isTeacherNotesPrincipal(req.principal)) {
    // Fusion métier déjà réalisée (préserve les lignes des autres enseignants).
    nextState = {
      ...currentState,
      ...(effectiveBody.evaluations ? { evaluations: effectiveBody.evaluations } : {}),
      ...(effectiveBody.notes ? { notes: effectiveBody.notes } : {}),
    };
  } else {
    nextState = mergeScopedBackOfficeState(
      currentState,
      requestedState,
      req.principal,
      effectiveTouchedKeys,
    );
  }
  const hydratedCourses = pedagogyGovernanceService.hydrateCoursesFromAssignments(
    nextState.courses ?? [],
    nextState.assignments ?? [],
  );
  const nextStateWithCourses = { ...nextState, courses: hydratedCourses };
  const changedCourses = pedagogyGovernanceService.listChangedCourses(
    currentState.courses ?? [],
    hydratedCourses,
  );
  const courseValidationError = changedCourses.length
    ? pedagogyGovernanceService.validateCoursesCollection(
        changedCourses,
        nextStateWithCourses.assignments ?? [],
      )
    : null;
  if (courseValidationError) {
    throw new BusinessError(400, courseValidationError);
  }

  // Filet de sécurité serveur : refuser toute double réservation (enseignant /
  // classe) introduite par cette requête sur les créneaux de planning.
  const introducedScheduleConflicts = detectIntroducedConflicts(
    nextStateWithCourses.courseSchedules ?? [],
    changedScheduleIds(
      currentState.courseSchedules ?? [],
      nextStateWithCourses.courseSchedules ?? [],
    ),
  );
  if (introducedScheduleConflicts.length) {
    throw new BusinessError(409, introducedScheduleConflicts[0].message);
  }

  const saved = await saveEstablishmentState(nextStateWithCourses, currentState, req.principal);
  await auditCriticalStateChanges(req, currentState, saved);
  await auditService.record(req, "sync_backoffice_state", "backoffice_state", "default", {
    schools: saved.schools?.length ?? 0,
    users: saved.users?.length ?? 0,
    countries: saved.countries?.length ?? 0,
    subscriptions: saved.subscriptions?.length ?? 0,
    notifications: saved.notifications?.length ?? 0,
    students: saved.students?.length ?? 0,
    teachers: saved.teachers?.length ?? 0,
    classes: saved.classes?.length ?? 0,
    roles: Object.keys(saved.rolePermissions ?? {}).length,
  });
  res.json(scopedBackOfficeStateForResponse(saved, req.principal));
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

app.get("/api/audit", requireAuth, asyncHandler(async (req, res) => {
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
  const rows = await cacheService.remember("v2:subjects", () => repository.getSubjectsV2());
  sendList(res, tenantScopeService.filterRows(rows, req.principal), req.query, ["name", "code", "level", "status"]);
}));

app.post("/api/v2/subjects", requireAuth, requirePermission("POST /api/v2/subjects"), asyncHandler(async (req, res) => {
  tenantScopeService.assertSchoolAccess(req.principal, req.body.schoolCode ?? req.principal.schoolCode);
  const created = await repository.createSubject({ ...req.body, schoolCode: req.body.schoolCode ?? req.principal.schoolCode });
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

app.get("/api/v2/academic-years", requireAuth, requirePermission("GET /api/v2/academic-years"), asyncHandler(async (req, res) => {
  const rows = await cacheService.remember("v2:academic-years", () => repository.getAcademicYearsV2());
  sendList(res, tenantScopeService.filterRows(rows, req.principal), req.query, ["name", "status"]);
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
  const storedState = await repository.getBackOfficeState();
  applyStoredStatusOverlay(dataset, storedState);
  applyStoredSchoolOverlay(dataset, storedState);
  applyStoredUserOverlay(dataset, storedState);
  const mergedStudents = mergeRowsByIdentity(dataset.students ?? [], storedState?.students ?? []);
  const mergedRelations = mergeRowsByIdentity([], storedState?.relations ?? []);
  const authService = new AuthService({
    school: dataset.school,
    schools: dataset.platformSchools,
    teachers: dataset.teachers,
    students: mergedStudents,
    relations: mergedRelations,
    userAccounts: dataset.userAccounts,
    countries: dataset.countries,
    subscriptions: dataset.subscriptions ?? [],
    assignments: storedState?.assignments?.length
      ? storedState.assignments
      : (dataset.teacherAssignments ?? []),
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

  if (Array.isArray(storedState.countries)) {
    const statusByCode = new Map(
      storedState.countries
        .filter((country) => country && country.code)
        .map((country) => [String(country.code).trim().toUpperCase(), country.status])
    );
    dataset.countries = (dataset.countries ?? []).map((country) => {
      const status = statusByCode.get(String(country.code ?? "").trim().toUpperCase());
      return status ? { ...country, status } : country;
    });
  }
}

// Superpose les comptes gérés depuis le state BackOffice persistant sur le dataset
// de connexion : un Admin École créé/validé dans le BackOffice devient ainsi
// authentifiable, et son statut (Actif / Suspendu / En attente de validation)
// reflété au login. Le mot de passe temporaire sert de secret tant qu'aucun
// hash n'est défini.
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

function applyStoredUserOverlay(dataset, storedState) {
  if (!dataset || !isPlainObject(storedState) || !Array.isArray(storedState.users)) {
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

  for (const stored of storedState.users) {
    const primaryKey = resolveUserOverlayPrimaryKey(stored, aliasToPrimaryKey);
    if (!primaryKey) {
      continue;
    }

    const base = byPrimaryKey.get(primaryKey) ?? {};
    const merged = { ...base, ...stored };

    const baseLoginId = String(base.identifier ?? "").trim();
    const storedLoginId = String(stored.identifier ?? "").trim();
    if (
      baseLoginId &&
      storedLoginId &&
      baseLoginId !== storedLoginId &&
      /^(ENS-\d+|ELE-\d+)$/i.test(baseLoginId) &&
      /^USR-/i.test(storedLoginId)
    ) {
      merged.identifier = baseLoginId;
    } else if (
      baseLoginId &&
      storedLoginId &&
      baseLoginId !== storedLoginId &&
      storedLoginId.toUpperCase() === String(stored.publicId ?? base.publicId ?? "").trim().toUpperCase()
    ) {
      // Instantané BackOffice : l'identifiant de connexion démo (admin, prefet…) prime sur le code technique.
      merged.identifier = baseLoginId;
    }

    if (isDbUserUuid(base.id)) {
      merged.id = base.id;
    }
    if (base.publicId) {
      merged.publicId = base.publicId;
    }

    applyStoredUserCredentials(base, stored, merged);

    if (!merged.passwordHash && !merged.pinHash && String(merged.password ?? "").trim()) {
      const legacyHash = hashSecret(String(merged.password).trim());
      merged.passwordHash = legacyHash;
      merged.pinHash = legacyHash;
      delete merged.password;
    }

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

function handleBusinessAction(action) {
  try {
    return action();
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
    backOfficeDeletableEntities.forEach((entity) => allowed.add(entity));
    allowed.add("rolePermissions");
    allowed.add("academicConfigs");
    allowed.add("dashboardChartConfig");
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
      payments: state.payments ?? runtime.payments ?? [],
    },
    principal,
    tenantScopeService,
  );
  return new MvpBusinessService(scoped);
}

function assertCanManageNotes(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  if (
    permissions.has("ALL_PRIVILEGES") ||
    permissions.has("COUNTRY_PRIVILEGES") ||
    permissions.has("Modifier notes") ||
    permissions.has("Modifier notes") ||
    permissions.has("Notes:CREATE") ||
    permissions.has("Notes:UPDATE") ||
    permissions.has("Notes:CRUD") ||
    permissions.has("Evaluations:CRUD")
  ) {
    return;
  }

  throw new BusinessError(403, "Permission insuffisante pour modifier les notes.");
}

function assertCanManagePresences(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  if (
    permissions.has("ALL_PRIVILEGES") ||
    permissions.has("COUNTRY_PRIVILEGES") ||
    permissions.has("Faire appel") ||
    permissions.has("Gérer appels") ||
    permissions.has("Présences:CREATE") ||
    permissions.has("Présences:UPDATE")
  ) {
    return;
  }

  throw new BusinessError(403, "Permission insuffisante pour enregistrer l'appel.");
}

async function saveEstablishmentState(nextState, currentState = null, principal = null) {
  const current = currentState ?? (await getAuthoritativeBackOfficeState());
  const { enrichStateWithValidationAlerts } = require("./lib/validationNotifications");
  const enriched = enrichStateWithValidationAlerts(current, nextState, principal);
  const sanitized = sanitizeBackOfficeState(enriched);
  const hydrated = ensureSubscriptionModuleState(hydrateSubscriptionsFromSchools(sanitized));
  return repository.saveBackOfficeState(hydrated);
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

async function getAuthoritativeBackOfficeState() {
  const runtime = await getRuntime();
  const runtimeState = buildInitialBackOfficeState(runtime);
  const storedState = await repository.getBackOfficeState();

  if (!hasUserBackOfficeState(storedState)) {
    return sanitizeBackOfficeState(runtimeState);
  }

  const merged = mergeBackOfficeRuntimeState(runtime, storedState);
  const { state: withSchools, repaired: repairedSchools } = repairOrphanSchools(merged);
  if (repairedSchools.length) {
    await repository.saveBackOfficeState(withSchools);
    console.info(`[backoffice] Établissements rétablis depuis références orphelines : ${repairedSchools.join(", ")}`);
  }
  const sanitized = sanitizeBackOfficeState(stripLegacyOrganizationFields(withSchools));
  return {
    ...sanitized,
    courses: pedagogyGovernanceService.hydrateCoursesFromAssignments(
      sanitized.courses ?? [],
      sanitized.assignments ?? [],
    ),
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
    payments: runtime.payments ?? [],
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
    payments: runtime.payments ?? [],
    feeGrids: storedState.feeGrids ?? [],
    schoolFeeItems: storedState.schoolFeeItems ?? [],
    studentFees: storedState.studentFees ?? [],
    feeTariffHistory: storedState.feeTariffHistory ?? [],
    paymentReminders: storedState.paymentReminders ?? [],
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
    students: mergeRowsByIdentity(runtimeState.students, storedState.students),
    teachers: mergeRowsByIdentity(runtimeState.teachers, storedState.teachers),
    classes: mergeRowsByIdentity(runtimeState.classes, storedState.classes),
    courses: mergeRowsByIdentity(runtimeState.courses, storedState.courses),
    assignments: mergeRowsByIdentity(runtimeState.assignments ?? [], storedState.assignments ?? []),
    courseSchedules: mergeRowsByIdentity(runtimeState.courseSchedules ?? [], storedState.courseSchedules ?? []),
    payments: mergeRowsByIdentity(runtimeState.payments, storedState.payments),
    feeGrids: mergeRowsByIdentity(runtimeState.feeGrids ?? [], storedState.feeGrids ?? []),
    schoolFeeItems: mergeRowsByIdentity(runtimeState.schoolFeeItems ?? [], storedState.schoolFeeItems ?? []),
    studentFees: mergeRowsByIdentity(runtimeState.studentFees ?? [], storedState.studentFees ?? []),
    feeTariffHistory: mergeRowsByIdentity(
      runtimeState.feeTariffHistory ?? [],
      storedState.feeTariffHistory ?? [],
    ),
    paymentReminders: mergeRowsByIdentity(
      runtimeState.paymentReminders ?? [],
      storedState.paymentReminders ?? [],
    ),
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

  dbSchools.forEach((school) => {
    const key = schoolRowKey(school);
    if (key) rows.set(key, { ...school });
  });

  storedSchools.forEach((school) => {
    const key = schoolRowKey(school);
    if (!key) return;
    const existing = rows.get(key);
    rows.set(key, existing ? { ...existing, ...school } : { ...school });
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

    return applyDeletedRows({
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
      classes: mergeEntity("classes"),
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
    });
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

    return applyDeletedRows({
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
    });
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
  const teacherSync =
    usersTouched || teachersTouched
      ? userTeacherSyncService.syncTeachersFromUserAccounts({
          ...current,
          users: mergedUsers,
          teachers: mergedTeachers,
          contacts: mergedContacts,
        })
      : null;
  const syncedTeachers = teacherSync?.teachers ?? current.teachers;
  const syncedContacts = teacherSync?.contacts ?? mergedContacts;
  const mergedCourses = mergeScopedEntityIfTouched(
    "courses",
    current,
    scopedRequested,
    scopedCurrent,
    touchedKeys,
  );

  return applyDeletedRows({
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
    classes: mergeScopedEntityIfTouched("classes", current, scopedRequested, scopedCurrent, touchedKeys),
    courses: teachersTouched || touchedKeys.includes("courses")
      ? pedagogyGovernanceService.enforceCourseTeacherUniqueness(
          current.courses,
          mergedCourses,
          scopedCurrent.courses,
        )
      : current.courses,
    assignments: mergeScopedEntityIfTouched(
      "assignments",
      current,
      scopedRequested,
      scopedCurrent,
      touchedKeys,
    ),
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
  });
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

async function touchUserLastLogin(principal) {
  if (!principal?.sub && !principal?.identifier) return;
  const state = await getAuthoritativeBackOfficeState();
  const now = new Date().toISOString();
  let touched = false;
  const users = (state.users ?? []).map((user) => {
    const aliases = [user.id, user.publicId, user.identifier].map((value) => String(value ?? "").trim());
    const principalKeys = [principal.sub, principal.identifier, principal.publicId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (!principalKeys.some((key) => aliases.includes(key))) return user;
    touched = true;
    return {
      ...user,
      lastLoginAt: now,
      history: [
        ...(Array.isArray(user.history) ? user.history : []),
        `Connexion réussie le ${now.slice(0, 10)}`,
      ],
    };
  });
  if (!touched) return;
  await saveEstablishmentState({ ...state, users, updatedAt: now });
}

async function sendAuthenticatedResponse(req, res, response, action) {
  const rolePermissionsMap = await getRolePermissionsMap();
  const principal = buildPrincipal(response, rolePermissionsMap);
  if (principal.role === "Parent" && (!principal.studentIds?.length) && Array.isArray(response.user?.children)) {
    principal.studentIds = response.user.children
      .flatMap((child) => [child.id, child.publicId, child.matricule])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }
  if (action === "backoffice_login" && ["Super Administrateur Somafrik", "Admin Pays"].includes(principal.role)) {
    const auditRows = await repository.getAuditLogs({ limit: 100 });
    response.auditLog = tenantScopeService.filterRows(auditRows, principal);
  }
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
      ? { ...response.user, role: principal.role, permissions: principal.permissions }
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
  const user = response.user ?? {};
  const school = response.schoolContext ?? response.school ?? {};
  const rawRole = user.role ?? roleLabelFromMobileRole(response.role);
  const role =
    rawRole === "Super Administrateur OKAFRIK" ? "Super Administrateur Somafrik" : rawRole;
  const schoolCode = role === "Admin Pays" ? "*" : user.schoolCode ?? school.code ?? "*";
  const countryCode = user.countryCode ?? countryCodeFromScope(user.countryScope) ?? school.countryCode ?? countryCodeFromSchoolOrCountry(schoolCode, school.country);
  const permissions = mergeRolePermissions(
    role,
    [...new Set([...(user.permissions ?? []), ...rbacService.permissionsFor(role)])],
    rolePermissionsMap
  );

  return {
    sub: user.id ?? user.publicId ?? user.matricule ?? "anonymous",
    identifier: user.identifier,
    publicId: user.publicId,
    contactId: user.contactId,
    role,
    schoolCode,
    countryCode,
    countryScope: user.countryScope ?? "",
    permissions,
    mustChangePassword:
      user.mustChangePassword === false
        ? false
        : Boolean(user.mustChangePassword) || Boolean(String(user.temporaryPassword ?? "").trim()),
    studentIds: getPrincipalStudentIds(response),
    classNames: [
      ...new Set([
        ...(user.assignedClasses ?? []),
        ...((user.assignments ?? []).map((item) => item.className).filter(Boolean)),
      ]),
    ],
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

  const { users } = await getAuthoritativeBackOfficeState();
  const runtime = await getRuntime();
  const allAccounts = [...users, ...(runtime.userAccounts ?? [])];

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
  const storedState = await repository.getBackOfficeState();
  return isPlainObject(storedState) && isPlainObject(storedState.rolePermissions)
    ? storedState.rolePermissions
    : null;
}

// Fusionne les droits de base (compte / RBAC) avec les droits accordés au rôle par le Super Admin.
// Logique métier : un module accordé à un rôle devient visible (dashboard, onglets, menu) pour
// tous les utilisateurs de ce rôle, sans jamais retirer un privilège déjà détenu par le compte.
function mergeRolePermissions(role, basePermissions = [], rolePermissionsMap = null) {
  const configured =
    rolePermissionsMap && Array.isArray(rolePermissionsMap[role])
      ? rolePermissionsMap[role]
      : role === "Super Administrateur Somafrik" &&
          Array.isArray(rolePermissionsMap?.["Super Administrateur OKAFRIK"])
        ? rolePermissionsMap["Super Administrateur OKAFRIK"]
        : null;

  if (!configured || !configured.length) {
    return enforceBusinessRolePermissions(role, basePermissions ?? []);
  }

  const merged = [...new Set([...(basePermissions ?? []), ...configured])];
  return enforceBusinessRolePermissions(role, merged);
}

function enforceBusinessRolePermissions(role, permissions = []) {
  let next = [...permissions];

  if (role === "Admin Pays") {
    next = next.filter((permission) => permission !== "Pays:CREATE" && permission !== "Pays:DELETE");
  }

  if (role !== "Admin School") {
    return next;
  }

  const forbiddenFeatures = ["Établissements", "Abonnements"];
  const forbiddenKeywords = ["abonnement", "etablissement", "établissement", "inscription", "tarif"];
  return next.filter((permission) => {
    if (String(permission).startsWith("Paramètres Établissement:")) {
      return true;
    }
    if (String(permission).startsWith("Frais & tarifs:")) {
      return true;
    }

    const normalizedPermission = normalizeBusinessPermission(permission);
    if (normalizedPermission.startsWith("frais & tarifs")) return true;
    return (
      !forbiddenFeatures.some((feature) => String(permission).startsWith(feature)) &&
      !forbiddenKeywords.some((keyword) => normalizedPermission.includes(keyword))
    );
  });
}

function normalizeBusinessPermission(permission) {
  return String(permission ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getPrincipalStudentIds(response) {
  const user = response.user ?? {};
  const role = user.role ?? roleLabelFromMobileRole(response.role);

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

    req.principal = await hydrateParentPrincipal(tokenService.verify(token, "access"));

    const passwordChangeExemptPaths = new Set([
      "/api/auth/change-password",
      "/api/auth/logout",
      "/api/auth/effective-permissions",
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
  return (req, _res, next) => {
    if (!rbacService.canAccess(req.principal, routeKey)) {
      return next(new BusinessError(403, "Permission insuffisante pour cette fonctionnalité."));
    }

    next();
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
    return res.status(error.statusCode).json({ message: error.message });
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
}

function warnIfUnsafeConfiguration() {
  assertDatabaseConfiguration();
  assertProductionSecrets();
  assertProductionSecurityConfiguration();
  assertProductionCors();
  warnIfUnsafeDevelopmentSecrets();
}
