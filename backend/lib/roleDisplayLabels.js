"use strict";

/**
 * ADMIN-02B — résolution unique des libellés d'affichage.
 * DISPLAY ONLY. Ne jamais passer displayLabel / effectiveLabel à toRoleKey.
 */

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeDisplayLabel(value) {
  const trimmed = asTrimmed(value);
  return trimmed || null;
}

function resolveEffectiveRoleLabel({ defaultLabel, displayLabel, roleName } = {}) {
  const fallback = asTrimmed(defaultLabel ?? roleName);
  const display = normalizeDisplayLabel(displayLabel);
  return display || fallback;
}

function applyRoleDisplayContract(row = {}) {
  const roleKey = asTrimmed(row.role_code ?? row.roleCode ?? row.roleKey).toUpperCase();
  const defaultLabel = asTrimmed(row.role_name ?? row.roleName ?? row.defaultLabel);
  const displayLabel = normalizeDisplayLabel(row.display_label ?? row.displayLabel);
  return {
    roleKey,
    defaultLabel,
    displayLabel,
    effectiveLabel: resolveEffectiveRoleLabel({ defaultLabel, displayLabel }),
  };
}

function indexRoleDisplayContracts(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const contract = applyRoleDisplayContract(row);
    if (contract.roleKey) map.set(contract.roleKey, contract);
    if (contract.defaultLabel) map.set(contract.defaultLabel, contract);
  }
  return map;
}

function lookupRoleDisplayContract(index, roleOrKey) {
  const raw = asTrimmed(roleOrKey);
  if (!raw || !index) return null;
  return index.get(raw) || index.get(raw.toUpperCase()) || null;
}

function decorateUserWithRoleDisplay(user, index) {
  if (!user || typeof user !== "object") return user;
  const { toRoleKey } = require("./userRoleLifecycle");
  const roleKey = toRoleKey(user.roleKey || user.role);
  const contract = lookupRoleDisplayContract(index, roleKey) || lookupRoleDisplayContract(index, user.role);
  const defaultLabel = contract?.defaultLabel || asTrimmed(user.role);
  return {
    ...user,
    roleKey: roleKey || user.roleKey || "",
    effectiveRoleLabel: resolveEffectiveRoleLabel({
      defaultLabel,
      displayLabel: user.displayLabel ?? contract?.displayLabel,
    }),
  };
}

module.exports = {
  asTrimmed,
  normalizeDisplayLabel,
  resolveEffectiveRoleLabel,
  applyRoleDisplayContract,
  indexRoleDisplayContracts,
  lookupRoleDisplayContract,
  decorateUserWithRoleDisplay,
};
