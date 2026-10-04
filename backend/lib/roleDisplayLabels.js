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

function uniqueRoleKeysInOrder(roleKeys = []) {
  const { toRoleKey } = require("./userRoleLifecycle");
  const seen = new Set();
  const ordered = [];
  for (const raw of roleKeys) {
    const key = toRoleKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

function contractForRoleKey(index, roleOrKey, fallbackDefaultLabel) {
  const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
  const roleKey = toRoleKey(roleOrKey);
  const contract = lookupRoleDisplayContract(index, roleKey) || lookupRoleDisplayContract(index, roleOrKey);
  const defaultLabel =
    contract?.defaultLabel || asTrimmed(fallbackDefaultLabel) || (roleKey ? toRoleLabel(roleKey) : "") || asTrimmed(roleOrKey);
  const displayLabel = contract?.displayLabel ?? null;
  return {
    roleKey: roleKey || asTrimmed(roleOrKey).toUpperCase(),
    defaultLabel,
    displayLabel,
    effectiveLabel: resolveEffectiveRoleLabel({ defaultLabel, displayLabel }),
  };
}

function buildEffectiveRoleLabels(roleKeys, index) {
  return uniqueRoleKeysInOrder(roleKeys).map((roleKey) => contractForRoleKey(index, roleKey));
}

function resolveVisibleRoleLabel(roleOrKey, index, fallbackDefaultLabel) {
  return contractForRoleKey(index, roleOrKey, fallbackDefaultLabel).effectiveLabel;
}

function decorateUserWithRoleDisplay(user, index) {
  if (!user || typeof user !== "object") return user;
  const { toRoleKey } = require("./userRoleLifecycle");
  const primaryKey = toRoleKey(user.roleKey || user.role);
  const roleKeys = uniqueRoleKeysInOrder(
    Array.isArray(user.roleKeys) && user.roleKeys.length ? user.roleKeys : [primaryKey, user.role].filter(Boolean),
  );
  const effectiveRoleLabels = buildEffectiveRoleLabels(roleKeys, index);
  const primary =
    effectiveRoleLabels.find((row) => row.roleKey === primaryKey) ||
    effectiveRoleLabels[0] ||
    contractForRoleKey(index, primaryKey, user.role);
  return {
    ...user,
    roleKey: primary.roleKey || user.roleKey || "",
    effectiveRoleLabel: resolveEffectiveRoleLabel({
      defaultLabel: primary.defaultLabel,
      displayLabel: user.displayLabel ?? primary.displayLabel,
    }),
    effectiveRoleLabels,
  };
}

function decorateIdentifyRole(managedRole, user, index) {
  if (!managedRole) return managedRole;
  const { toRoleKey } = require("./userRoleLifecycle");
  const roleKeys = uniqueRoleKeysInOrder(
    Array.isArray(user?.roleKeys) && user.roleKeys.length
      ? user.roleKeys
      : [user?.roleKey, user?.role].filter(Boolean),
  );
  const fallbackKey = roleKeys[0] || toRoleKey(user?.role) || toRoleKey(user?.roleKey);
  const effectiveRoleLabels = buildEffectiveRoleLabels(roleKeys.length ? roleKeys : [fallbackKey], index);
  const primary = effectiveRoleLabels[0] || contractForRoleKey(index, fallbackKey);
  return {
    role: managedRole.role,
    roleKey: primary.roleKey,
    roleKeys: effectiveRoleLabels.map((row) => row.roleKey),
    roleLabel: primary.effectiveLabel,
    defaultLabel: primary.defaultLabel,
    displayLabel: primary.displayLabel,
    effectiveRoleLabel: primary.effectiveLabel,
    effectiveRoleLabels,
  };
}

function pushUniqueSource(sources, seen, value) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  sources.push(value);
}

function collectRoleDisplaySources(repo) {
  const seen = new Set();
  const sources = [];
  pushUniqueSource(sources, seen, repo);
  if (!repo || typeof repo !== "object") return sources;
  pushUniqueSource(sources, seen, repo.rootRepository);
  pushUniqueSource(sources, seen, repo.repository);
  pushUniqueSource(sources, seen, repo._repository);
  pushUniqueSource(sources, seen, repo._repo);
  pushUniqueSource(sources, seen, repo.repo);
  if (typeof repo.getRepository === "function") {
    try {
      pushUniqueSource(sources, seen, repo.getRepository());
    } catch {
      /* ignore incapable repository accessor */
    }
  }
  return sources;
}

async function loadRoleDisplayContractsFromQueryable(queryable) {
  if (!queryable || typeof queryable.all !== "function") return null;
  const all = (...args) => queryable.all(...args);
  const probe = await all(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'establishment_roles'
         AND column_name = 'display_label'
     ) AS available`,
  );
  if (!probe?.[0]?.available) return [];
  return all(`SELECT role_code, role_name, display_label FROM establishment_roles`);
}

async function loadRoleDisplayIndexFromAuthority(source) {
  if (typeof source?.getEstablishmentRolesStore === "function") {
    const store = source.getEstablishmentRolesStore();
    if (store && typeof store.listRoleDisplayContracts === "function") {
      return indexRoleDisplayContracts(await store.listRoleDisplayContracts());
    }
  }
  if (typeof source?.listRoleDisplayContracts === "function") {
    return indexRoleDisplayContracts(await source.listRoleDisplayContracts());
  }
  return null;
}

/**
 * Index par requête, depuis establishment_roles. Pas de cache process.
 * Accepte le repository racine, un clients store / tx, ou un queryable PG.
 */
async function loadRoleDisplayIndexFromRepo(repo) {
  if (!repo) return new Map();
  const sources = collectRoleDisplaySources(repo);
  for (const source of sources) {
    try {
      const index = await loadRoleDisplayIndexFromAuthority(source);
      if (index) return index;
    } catch {
      /* essayer la source suivante plutôt que de masquer un store incapable */
    }
  }
  for (const source of sources) {
    if (typeof source.all !== "function") continue;
    try {
      const rows = await loadRoleDisplayContractsFromQueryable(source);
      if (rows) return indexRoleDisplayContracts(rows);
    } catch {
      /* queryable sans establishment_roles : source suivante */
    }
  }
  return new Map();
}

module.exports = {
  asTrimmed,
  normalizeDisplayLabel,
  resolveEffectiveRoleLabel,
  applyRoleDisplayContract,
  indexRoleDisplayContracts,
  lookupRoleDisplayContract,
  uniqueRoleKeysInOrder,
  contractForRoleKey,
  buildEffectiveRoleLabels,
  resolveVisibleRoleLabel,
  decorateUserWithRoleDisplay,
  decorateIdentifyRole,
  loadRoleDisplayIndexFromRepo,
};
