"use strict";

/**
 * Audit P0 — Préfet / Présences (PR #227) + régression après correctif live (#228).
 *
 * Gardes conservées :
 * - JWT sans overlay ≠ live (preuve de cause, miroir de l'ancien gate)
 * - module_key attendance → Présences:*
 * - DENY établissement, schoolCode non résolu, multi-rôle UNION
 *
 * Régression source (#228) : POST/GET présences passent par requirePermission.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveEffectivePermissionSet,
  flattenModulesToTokens,
} = require("./functionalRbacResolution");
const { resolveEffectivePermissionsForPrincipal, patchConfiguredPermissions } = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { routePermissions } = require("../services/rbacService");

const SCHOOL_A = "550e8400-e29b-41d4-a716-446655440001";
const COUNTRY_CD = "550e8400-e29b-41d4-a716-446655440000";
const SCHOOL_CODE_A = "CD-2026-TEST";

const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `bloc introuvable: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end >= 0 ? end : start + 2500);
}

/** Miroir du gate server.js assertCanManagePresences — ne pas diverger du source. */
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
  const error = new Error("Permission insuffisante pour enregistrer l'appel.");
  error.statusCode = 403;
  throw error;
}

function overlayLive(principal, live) {
  return { ...principal, permissions: live.permissions };
}

function buildPrefetRepo(grants = []) {
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async ({ schoolCode }) => {
      if (String(schoolCode ?? "").toUpperCase() !== SCHOOL_CODE_A) {
        return { country: null, school: null };
      }
      return {
        country: { id: COUNTRY_CD, code: "CD" },
        school: {
          id: SCHOOL_A,
          school_code: SCHOOL_CODE_A,
          country_id: COUNTRY_CD,
          country_code: "CD",
        },
      };
    },
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
    listActiveUserRoleKeys: async () => ["PREFET_ETUDES"],
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({}),
    }),
  };
  return { rbac, repo, seed: async () => {
    for (const grant of grants) {
      await rbac.upsertGrant(grant);
    }
  } };
}

test("régression #228 : POST /api/presences overlaye le live via requirePermission", () => {
  const postBlock = sliceFrom(
    serverSrc,
    'app.post("/api/presences"',
    'app.get("/api/students/:id/report"',
  );
  assert.match(postBlock, /requireAuth/);
  assert.match(postBlock, /requireSchoolSubscriptionFeature\("write_presence"\)/);
  assert.match(postBlock, /requirePermission\("POST \/api\/presences"\)/);
  assert.equal(postBlock.includes("assertCanManagePresences"), false);
});

test("régression #228 : GET /api/presences exige Présences:READ via requirePermission", () => {
  const getBlock = sliceFrom(
    serverSrc,
    'app.get("/api/presences"',
    'app.post("/api/notes"',
  );
  assert.match(getBlock, /requireAuth/);
  assert.match(getBlock, /requirePermission\("GET \/api\/presences"\)/);
});

test("contrat source : requirePermission overlaye resolveEffectivePermissions", () => {
  const fnBlock = sliceFrom(
    serverSrc,
    "function requirePermission(routeKey)",
    "function sendList(",
  );
  assert.match(fnBlock, /repository\.resolveEffectivePermissions/);
  assert.match(fnBlock, /req\.principal = \{ \.\.\.req\.principal, permissions: live\.permissions \}/);
});

test("contrat source : requireAuth n'overlaye pas les permissions live", () => {
  const fnBlock = sliceFrom(
    serverSrc,
    "function requireAuth(req, res, next)",
    "async function principalMustChangePassword",
  );
  assert.equal(fnBlock.includes("resolveEffectivePermissions"), false);
});

test("régression #228 : routePermissions GET/POST /api/presences sont canoniques", () => {
  assert.ok(routePermissions["GET /api/presences"]?.includes("Présences:READ"));
  assert.ok(routePermissions["POST /api/presences"]?.includes("Présences:CREATE"));
  assert.ok(routePermissions["POST /api/presences"]?.includes("Présences:UPDATE"));
  assert.ok(routePermissions["GET /api/students/:id/presences"]?.includes("Présences:READ"));
  assert.equal(routePermissions["POST /api/presences"].includes("Faire appel"), false);
});

test("module_key canonique attendance → jeton Présences:CREATE (pas attendances/presences)", () => {
  const tokens = flattenModulesToTokens({
    attendance: { canCreate: true, canRead: true, canUpdate: false, canDelete: false },
  });
  assert.ok(tokens.includes("Présences:CREATE"));
  assert.ok(tokens.includes("Présences:READ"));
  assert.equal(tokens.includes("Présences:UPDATE"), false);
  assert.equal(tokens.includes("Attendances:CREATE"), false);
  assert.equal(tokens.includes("presences:CREATE"), false);
});

test("matrice école A : READ+CREATE live, JWT stale → POST 403 ; overlay → autorisé", async () => {
  const { repo, seed } = buildPrefetRepo([
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      schoolId: SCHOOL_A,
      countryId: COUNTRY_CD,
      moduleKey: "attendance",
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      updatedBy: "superadmin-audit",
    },
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      moduleKey: "students",
      canRead: true,
      updatedBy: "bootstrap",
    },
  ]);
  await seed();

  const jwtPrincipal = {
    sub: "prefet-user-id",
    role: "Préfet des études",
    roleKeys: ["PREFET_ETUDES"],
    schoolCode: SCHOOL_CODE_A,
    permissions: ["Présences:READ"],
  };

  const live = await resolveEffectivePermissionsForPrincipal(repo, jwtPrincipal);
  assert.equal(live.source, "role_module_permissions");
  assert.ok(live.permissions.includes("Présences:CREATE"), live.permissions.join(","));
  assert.ok(live.permissions.includes("Présences:READ"));
  assert.equal(live.permissions.includes("Présences:UPDATE"), false);
  assert.equal(live.permissions.includes("Présences:DELETE"), false);
  assert.equal(live.modules.attendance.canCreate, true);
  assert.equal(live.modules.attendance.canUpdate, false);

  assert.throws(
    () => assertCanManagePresences(jwtPrincipal),
    (error) => error.statusCode === 403 && error.message === "Permission insuffisante pour enregistrer l'appel.",
  );

  assert.doesNotThrow(() => assertCanManagePresences(overlayLive(jwtPrincipal, live)));
});

test("live-change #221 : grant CREATE sans nouveau JWT — effective live OK, gate JWT encore 403", async () => {
  const { rbac, repo } = buildPrefetRepo([
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      moduleKey: "students",
      canRead: true,
      updatedBy: "bootstrap",
    },
  ]);
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "bootstrap",
  });

  const jwtPrincipal = {
    sub: "prefet-user-id",
    role: "Préfet des études",
    schoolCode: SCHOOL_CODE_A,
    permissions: ["Présences:READ"],
  };

  const before = await resolveEffectivePermissionsForPrincipal(repo, jwtPrincipal);
  assert.equal(before.permissions.includes("Présences:CREATE"), false);
  assert.throws(() => assertCanManagePresences(jwtPrincipal), (error) => error.statusCode === 403);

  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [
        {
          moduleKey: "attendance",
          canCreate: true,
          canRead: true,
          canUpdate: false,
          canDelete: false,
        },
      ],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  const after = await resolveEffectivePermissionsForPrincipal(repo, jwtPrincipal);
  assert.ok(after.permissions.includes("Présences:CREATE"), "le live doit voir le grant immédiat");
  assert.throws(
    () => assertCanManagePresences(jwtPrincipal),
    (error) => error.statusCode === 403,
    "POST actuel lit encore le JWT — le contrat live #221 n'est pas honoré sur cette route",
  );
  assert.doesNotThrow(() => assertCanManagePresences(overlayLive(jwtPrincipal, after)));
});

test("CREATE seul (UPDATE=false) autorise l'upsert POST — ce n'est pas un mismatch verbe", () => {
  assert.doesNotThrow(() =>
    assertCanManagePresences({ permissions: ["Présences:CREATE"] }),
  );
  assert.doesNotThrow(() =>
    assertCanManagePresences({ permissions: ["Présences:UPDATE"] }),
  );
  assert.throws(
    () => assertCanManagePresences({ permissions: ["Présences:READ"] }),
    (error) => error.statusCode === 403,
  );
  assert.throws(
    () => assertCanManagePresences({ permissions: ["Présences:DELETE"] }),
    (error) => error.statusCode === 403,
  );
});

test("DENY établissement masque un grant pays/global (premier match, pas de fusion)", () => {
  const resolved = resolveEffectivePermissionSet(
    ["PREFET_ETUDES"],
    [
      {
        roleKey: "PREFET_ETUDES",
        scopeType: "global",
        moduleKey: "attendance",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
      {
        roleKey: "PREFET_ETUDES",
        scopeType: "country",
        countryId: COUNTRY_CD,
        moduleKey: "attendance",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
      {
        roleKey: "PREFET_ETUDES",
        scopeType: "school",
        schoolId: SCHOOL_A,
        countryId: COUNTRY_CD,
        moduleKey: "attendance",
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      },
    ],
    { schoolId: SCHOOL_A, countryId: COUNTRY_CD },
  );
  assert.equal(resolved.modules.attendance.canCreate, false);
  assert.equal(resolved.modules.attendance.canRead, true);
  assert.equal(resolved.permissions.includes("Présences:CREATE"), false);
});

test("schoolCode JWT non résolu → grant école ignoré (risque login_code vs school_code)", async () => {
  const { repo, seed } = buildPrefetRepo([
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      schoolId: SCHOOL_A,
      countryId: COUNTRY_CD,
      moduleKey: "attendance",
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      updatedBy: "superadmin-audit",
    },
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      moduleKey: "students",
      canRead: true,
      updatedBy: "bootstrap",
    },
  ]);
  await seed();

  const live = await resolveEffectivePermissionsForPrincipal(repo, {
    sub: "prefet-user-id",
    role: "Préfet des études",
    schoolCode: "NURU-LOGIN",
  });
  assert.equal(live.permissions.includes("Présences:CREATE"), false);
});

test("multi-rôle : UNION OR — un second rôle CREATE n'est pas écrasé par le Préfet READ", () => {
  const resolved = resolveEffectivePermissionSet(
    ["PREFET_ETUDES", "TEACHER"],
    [
      {
        roleKey: "PREFET_ETUDES",
        scopeType: "global",
        moduleKey: "attendance",
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      },
      {
        roleKey: "TEACHER",
        scopeType: "global",
        moduleKey: "attendance",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
    ],
    {},
  );
  assert.equal(resolved.modules.attendance.canCreate, true);
  assert.ok(resolved.permissions.includes("Présences:CREATE"));
});
