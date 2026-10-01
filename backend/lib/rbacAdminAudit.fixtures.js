"use strict";

/**
 * Fixtures partagées — audit Administration / Rôles et droits.
 * Aucune logique métier nouvelle : helpers de test uniquement.
 */

const {
  getConfiguredPermissions,
  getEffectivePermissionsConfigured,
  patchConfiguredPermissions,
  listRbacCatalog,
} = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");

const SUPER_ADMIN = { role: "Super Administrateur Somafrik", identifier: "superadmin", schoolCode: "*" };
const COUNTRY_ADMIN = { role: "Admin Pays", identifier: "pays", countryCode: "CD", schoolCode: "*" };
const SCHOOL_ADMIN = {
  role: "Admin School",
  identifier: "admin",
  schoolCode: "CD-2026-0001",
  permissions: ["Gérer utilisateurs", "Paramètres Établissement:READ"],
};

const COUNTRY_CD = { id: "country-cd", code: "CD" };
const COUNTRY_BI = { id: "country-bi", code: "BI" };
const SCHOOL_CD_A = {
  id: "school-nuru",
  school_code: "CD-2026-0001",
  country_id: "country-cd",
  country_code: "CD",
};
const SCHOOL_CD_B = {
  id: "school-goma",
  school_code: "CD-2026-0002",
  country_id: "country-cd",
  country_code: "CD",
};
const SCHOOL_BI = {
  id: "school-bujumbura",
  school_code: "BI-2026-0002",
  country_id: "country-bi",
  country_code: "BI",
};

const BUSINESS_ROLES = Object.freeze([
  { roleKey: "PRINCIPAL", roleName: "Directeur" },
  { roleKey: "SECRETARY", roleName: "Secrétaire" },
  { roleKey: "TEACHER", roleName: "Enseignant" },
  { roleKey: "ACCOUNTANT", roleName: "Comptable" },
  { roleKey: "PREFET_ETUDES", roleName: "Préfet des études" },
]);

const GLOBAL_STUDENTS_GRANT = Object.freeze({
  canCreate: false,
  canRead: true,
  canUpdate: true,
  canDelete: true,
});

function resolveCountryAndSchool({ countryCode, schoolCode, countryId, schoolId }) {
  const bySchool = {
    "CD-2026-0001": { country: COUNTRY_CD, school: SCHOOL_CD_A },
    "CD-2026-0002": { country: COUNTRY_CD, school: SCHOOL_CD_B },
    "BI-2026-0002": { country: COUNTRY_BI, school: SCHOOL_BI },
    [SCHOOL_CD_A.id]: { country: COUNTRY_CD, school: SCHOOL_CD_A },
    [SCHOOL_CD_B.id]: { country: COUNTRY_CD, school: SCHOOL_CD_B },
    [SCHOOL_BI.id]: { country: COUNTRY_BI, school: SCHOOL_BI },
  };
  if (schoolCode && bySchool[schoolCode]) return bySchool[schoolCode];
  if (schoolId && bySchool[schoolId]) return bySchool[schoolId];
  if (countryCode === "BI" || countryId === COUNTRY_BI.id) {
    return { country: COUNTRY_BI, school: null };
  }
  if (countryCode === "CD" || countryId === COUNTRY_CD.id) {
    return { country: COUNTRY_CD, school: null };
  }
  return { country: null, school: null };
}

function createAuditRepo() {
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async (query) => resolveCountryAndSchool(query),
    roles: [
      {
        id: "role-super",
        roleCode: "SUPER_ADMIN",
        roleName: "Super Administrateur Somafrik",
        scope: "platform",
        status: "active",
        systemProtected: true,
      },
      {
        id: "role-country",
        roleCode: "COUNTRY_ADMIN",
        roleName: "Admin Pays",
        scope: "country",
        status: "active",
        systemProtected: true,
      },
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        status: "active",
        systemProtected: true,
      },
      ...BUSINESS_ROLES.map((role, index) => ({
        id: `role-${role.roleKey.toLowerCase()}`,
        roleCode: role.roleKey,
        roleName: role.roleName,
        scope: "school",
        status: "active",
        schoolAssignable: true,
        displayOrder: index,
      })),
    ],
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
    listEstablishmentRoles: async () => rbac.listRolesWithUsage({ includeArchived: true }),
  };
  return { repo, rbac };
}

async function seedGlobalStudentsGrants(rbac, roleKeys = BUSINESS_ROLES.map((role) => role.roleKey)) {
  for (const roleKey of roleKeys) {
    await rbac.upsertGrant({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "students",
      ...GLOBAL_STUDENTS_GRANT,
      updatedBy: "bootstrap-audit",
    });
  }
}

function moduleFlags(matrix, moduleKey) {
  const row = (matrix?.modules || []).find((module) => module.moduleKey === moduleKey);
  return {
    canCreate: Boolean(row?.canCreate),
    canRead: Boolean(row?.canRead),
    canUpdate: Boolean(row?.canUpdate),
    canDelete: Boolean(row?.canDelete),
    configured: Boolean(row?.configured),
    locks: row?.locks || null,
  };
}

/** Reproduit le draft UI : flags GET configured + overlay mandatory, sans héritage. */
function uiDraftFromConfigured(configured, moduleKey) {
  return moduleFlags(configured, moduleKey);
}

async function loadSchoolPath(repo, roleKey, { countryCode = "CD", schoolCode = "CD-2026-0001" } = {}) {
  const query = { roleKey, countryCode, schoolCode };
  const [configured, effective] = await Promise.all([
    getConfiguredPermissions(repo, query, SUPER_ADMIN),
    getEffectivePermissionsConfigured(repo, query, SUPER_ADMIN),
  ]);
  return { configured, effective, query };
}

module.exports = {
  SUPER_ADMIN,
  COUNTRY_ADMIN,
  SCHOOL_ADMIN,
  COUNTRY_CD,
  COUNTRY_BI,
  SCHOOL_CD_A,
  SCHOOL_CD_B,
  SCHOOL_BI,
  BUSINESS_ROLES,
  GLOBAL_STUDENTS_GRANT,
  createAuditRepo,
  seedGlobalStudentsGrants,
  moduleFlags,
  uiDraftFromConfigured,
  loadSchoolPath,
  getConfiguredPermissions,
  getEffectivePermissionsConfigured,
  patchConfiguredPermissions,
  listRbacCatalog,
};
