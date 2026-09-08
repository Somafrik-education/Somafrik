"use strict";

/**
 * Lot K — diagnostic deliveries PUSH/EMAIL sans PII.
 * Superadmin / Admin Pays : vue globale. Admin School : school_id de session.
 */

const { uuidOrNull } = require("./principalIdentity");
const {
  createSqlDeliveryAdapter,
} = require("./communicationChannelFanout");

function principalRoleKeys(principal) {
  return Array.isArray(principal?.roleKeys) ? principal.roleKeys.map((item) => String(item)) : [];
}

function isPlatformOperator(principal) {
  const role = String(principal?.role || "");
  const keys = principalRoleKeys(principal);
  return (
    role === "Super Administrateur Somafrik" ||
    role === "Super Administrateur OKAFRIK" ||
    role === "Admin Pays" ||
    keys.includes("SUPER_ADMIN") ||
    keys.includes("COUNTRY_ADMIN")
  );
}

function isSchoolAdminPrincipal(principal) {
  const role = String(principal?.role || "");
  const keys = principalRoleKeys(principal);
  return role === "Admin School" || keys.includes("SCHOOL_ADMIN");
}

function canReadDeliveryHealth(principal) {
  return isPlatformOperator(principal) || isSchoolAdminPrincipal(principal);
}

function deliveryHealthSchoolScope(principal) {
  if (isPlatformOperator(principal)) return null;
  return uuidOrNull(principal?.schoolId || principal?.school_id);
}

async function readDeliveryHealth(store, principal) {
  if (!canReadDeliveryHealth(principal)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
  const schoolId = deliveryHealthSchoolScope(principal);
  if (!isPlatformOperator(principal) && !schoolId) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
  if (store && typeof store.listDeliveryHealth === "function") {
    return store.listDeliveryHealth({ schoolId });
  }
  const adapter = createSqlDeliveryAdapter(store);
  return adapter.listDeliveryHealth({ schoolId });
}

module.exports = {
  canReadDeliveryHealth,
  deliveryHealthSchoolScope,
  isPlatformOperator,
  readDeliveryHealth,
};
