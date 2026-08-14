"use strict";

/**
 * Résolution fail-closed des permissions JWT depuis la matrice PostgreSQL canonique.
 * Un rôle présent dans la map avec permissions=[] reste explicitement sans droit.
 * Un rôle absent de la map canonique non vide ne reçoit aucun fallback seed/UI.
 */

function normalizeBusinessPermission(permission) {
  return String(permission ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function resolveRolePermissionsKey(role, rolePermissionsMap) {
  if (!rolePermissionsMap || typeof rolePermissionsMap !== "object") return role;
  if (Object.prototype.hasOwnProperty.call(rolePermissionsMap, role)) return role;
  if (
    role === "Super Administrateur Somafrik" &&
    Object.prototype.hasOwnProperty.call(rolePermissionsMap, "Super Administrateur OKAFRIK")
  ) {
    return "Super Administrateur OKAFRIK";
  }
  return role;
}

function mergeRolePermissions(role, basePermissions = [], rolePermissionsMap = null) {
  if (!rolePermissionsMap || typeof rolePermissionsMap !== "object") {
    return enforceBusinessRolePermissions(role, basePermissions ?? []);
  }

  const resolvedKey = resolveRolePermissionsKey(role, rolePermissionsMap);
  if (Object.prototype.hasOwnProperty.call(rolePermissionsMap, resolvedKey)) {
    const configured = Array.isArray(rolePermissionsMap[resolvedKey]) ? rolePermissionsMap[resolvedKey] : [];
    return enforceBusinessRolePermissions(role, configured);
  }

  if (Object.keys(rolePermissionsMap).length > 0) {
    return enforceBusinessRolePermissions(role, []);
  }

  return enforceBusinessRolePermissions(role, basePermissions ?? []);
}

module.exports = {
  normalizeBusinessPermission,
  enforceBusinessRolePermissions,
  resolveRolePermissionsKey,
  mergeRolePermissions,
};
