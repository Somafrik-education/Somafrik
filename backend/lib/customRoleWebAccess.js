"use strict";

/**
 * RBAC-LOGIN-01 — reconnaissance dynamique des rôles d'établissement (catalogue
 * `establishment_roles`) à la connexion Web, en complément de la liste statique
 * `canAccessWebPlatformRole()`.
 *
 * Un rôle hors liste statique n'ouvre l'accès Web que si TOUTES les conditions
 * sont réunies (fail-closed, chaque lecture en échec refuse) :
 *   1. l'établissement de connexion est résolu (identifiant canonique) ;
 *   2. le compte détient le rôle dans `user_roles`, actif, non révoqué, pour CET
 *      établissement (SEC-TENANT-02 : un rôle détenu ailleurs ne compte jamais) ;
 *   3. le rôle existe une seule fois dans le catalogue, `status = 'active'`,
 *      `scope = 'school'` (rôle archivé, plateforme ou pays : refusé) ;
 *   4. les permissions effectives (role_module_permissions, portée établissement)
 *      donnent au moins une lecture sur un module applicable au Web.
 *
 * Les rôles plateforme (SUPER_ADMIN, COUNTRY_ADMIN) ne passent jamais par ce
 * chemin : ils sont ignorés ici et restent régis par leurs contrôles dédiés.
 * Aucun identifiant, jeton ni secret n'est journalisé.
 */

const { listFunctionalModules } = require("./functionalModulesCatalog");
const { normalizeRoleCode } = require("./establishmentRolesManagement");
const { PLATFORM_ROLE_KEYS, isKnownRoleKey, toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { loadLiveRoleState } = require("./liveRoleState");

const CUSTOM_ROLE_WEB_ACCESS_PROFILE = "school_custom_role";

const CATALOG_ROLE_STATE = Object.freeze({
  ACTIVE_SCHOOL: "active_school",
  ARCHIVED: "archived",
  OTHER_SCOPE: "other_scope",
  AMBIGUOUS: "ambiguous",
  UNKNOWN: "unknown",
});

function denied(reason) {
  return { allowed: false, reason };
}

/** Rôle hors catalogue système figé (ROLE_FROM_DB) : rôle personnalisé ou historique. */
function isCustomRoleKey(roleKey) {
  const key = toRoleKey(roleKey);
  return Boolean(key) && !isKnownRoleKey(key);
}

function catalogEntriesForRoleKey(catalog, roleKey) {
  const wanted = normalizeRoleCode(roleKey);
  if (!wanted) return [];
  return (catalog || []).filter(
    (entry) =>
      normalizeRoleCode(entry?.roleCode) === wanted || normalizeRoleCode(entry?.roleName) === wanted,
  );
}

function classifyCatalogRoleKey(catalog, roleKey) {
  const entries = catalogEntriesForRoleKey(catalog, roleKey);
  if (!entries.length) return CATALOG_ROLE_STATE.UNKNOWN;
  const active = entries.filter((entry) => entry.status === "active");
  if (!active.length) return CATALOG_ROLE_STATE.ARCHIVED;
  if (active.length > 1) return CATALOG_ROLE_STATE.AMBIGUOUS;
  return String(active[0].scope ?? "").trim().toLowerCase() === "school"
    ? CATALOG_ROLE_STATE.ACTIVE_SCHOOL
    : CATALOG_ROLE_STATE.OTHER_SCOPE;
}

/**
 * Catalogue minimal (actifs + archivés). `null` : le dépôt n'expose aucune
 * lecture du catalogue. Une lecture en échec lève (l'appelant décide du refus).
 */
async function loadRoleCatalogStates(repo) {
  const store = typeof repo?.getEstablishmentRolesStore === "function" ? repo.getEstablishmentRolesStore() : null;
  if (!store) return null;
  if (typeof store.listRoleCatalogStates === "function") {
    const rows = await store.listRoleCatalogStates();
    if (!Array.isArray(rows)) throw new Error("catalogue des rôles invalide");
    return rows;
  }
  if (typeof store.listRoles === "function") {
    const rows = await store.listRoles({ includeArchived: true });
    if (!Array.isArray(rows)) throw new Error("catalogue des rôles invalide");
    return rows;
  }
  return null;
}

function canonicalCatalogRoleKey(catalog, roleKey) {
  const active = catalogEntriesForRoleKey(catalog, roleKey).filter((entry) => entry.status === "active");
  return String(active[0]?.roleCode ?? "").trim().toUpperCase();
}

/**
 * Permissions effectives — rôles personnalisés relus contre le catalogue :
 *   - rôle archivé → retiré (aucun droit, même si des grants restent actifs) ;
 *   - rôle actif `scope = school` unique → clé canonique UPPER(role_code), celle
 *     des grants role_module_permissions (le libellé accentué stocké dans
 *     user_roles, ex. CONSEILLER_PÉDAGOGIQUE, ne correspond à aucun grant) ;
 *   - autre cas (hors catalogue, ambigu, autre portée) → inchangé.
 * Rôles système jamais touchés. Lecture du catalogue en échec → rôles
 * personnalisés retirés (fail-closed). Dépôt sans catalogue → inchangé.
 *
 * @returns {Promise<{ roleKeys: string[], activeCustomRoleKeys: Set<string> }>}
 */
async function canonicalizeCustomRoleKeys(repo, roleKeys = []) {
  const keys = Array.isArray(roleKeys) ? roleKeys : [];
  const activeCustomRoleKeys = new Set();
  if (!keys.some(isCustomRoleKey)) return { roleKeys: keys, activeCustomRoleKeys };
  let catalog;
  try {
    catalog = await loadRoleCatalogStates(repo);
  } catch {
    console.warn("[RBAC-LOGIN-01] catalogue des rôles indisponible : rôles personnalisés ignorés");
    return { roleKeys: keys.filter((key) => !isCustomRoleKey(key)), activeCustomRoleKeys };
  }
  if (!catalog) return { roleKeys: keys, activeCustomRoleKeys };
  const next = [];
  const seen = new Set();
  const push = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push(key);
  };
  for (const key of keys) {
    if (!isCustomRoleKey(key)) {
      push(key);
      continue;
    }
    const state = classifyCatalogRoleKey(catalog, key);
    if (state === CATALOG_ROLE_STATE.ARCHIVED) continue;
    if (state === CATALOG_ROLE_STATE.ACTIVE_SCHOOL) {
      const canonical = canonicalCatalogRoleKey(catalog, key) || key;
      activeCustomRoleKeys.add(canonical);
      push(canonical);
      continue;
    }
    push(key);
  }
  return { roleKeys: next, activeCustomRoleKeys };
}

function webReadableModules(modules) {
  if (!modules || typeof modules !== "object") return [];
  return listFunctionalModules()
    .filter((module) => module.appliesWeb && modules[module.moduleKey]?.canRead === true)
    .map((module) => module.moduleKey);
}

/**
 * @param {object} repo dépôt (lecture user_roles, catalogue, permissions effectives)
 * @param {{ userId: string, school: { id?: string, code?: string } | null, countryCode?: string }} input
 * @returns {Promise<{ allowed: boolean, reason?: string, roleKeys?: string[], webModules?: string[] }>}
 */
async function resolveCustomRoleWebAccess(repo, { userId, school, countryCode } = {}) {
  const uid = String(userId ?? "").trim();
  const schoolId = String(school?.id ?? "").trim();
  if (!uid) return denied("identifiant absent");
  if (!schoolId) return denied("établissement non résolu");
  if (typeof repo?.resolveEffectivePermissions !== "function") return denied("permissions indisponibles");

  const live = await loadLiveRoleState(repo, uid, { schoolId });
  if (live.status !== "active") return denied("aucun rôle actif dans l'établissement");

  const platformKeys = new Set(PLATFORM_ROLE_KEYS);
  const schoolKeys = [...new Set(live.keys.map(toRoleKey).filter((key) => key && !platformKeys.has(key)))];
  if (!schoolKeys.length) return denied("aucun rôle d'établissement");

  let catalog;
  try {
    catalog = await loadRoleCatalogStates(repo);
  } catch {
    return denied("catalogue des rôles indisponible");
  }
  if (!catalog) return denied("catalogue des rôles indisponible");

  const eligible = schoolKeys.filter(
    (key) => classifyCatalogRoleKey(catalog, key) === CATALOG_ROLE_STATE.ACTIVE_SCHOOL,
  );
  if (!eligible.length) return denied("aucun rôle actif au catalogue de l'établissement");

  let resolved;
  try {
    resolved = await repo.resolveEffectivePermissions({
      sub: uid,
      id: uid,
      role: toRoleLabel(eligible[0]),
      roleKeys: eligible,
      roles: eligible.map(toRoleLabel),
      schoolId,
      schoolCode: String(school?.code ?? "").trim(),
      countryCode: String(countryCode ?? "").trim(),
    });
  } catch {
    return denied("permissions indisponibles");
  }
  if (!resolved || !Array.isArray(resolved.permissions)) return denied("permissions indisponibles");

  const webModules = webReadableModules(resolved.modules);
  if (!webModules.length) return denied("aucune permission Web");

  return { allowed: true, roleKeys: eligible, webModules };
}

const NO_CUSTOM_ROLE_READ_SCOPE = Object.freeze({ classes: false, students: false });

/**
 * RBAC-LOGIN-01 — portée de lecture des rôles personnalisés sur les listes scolaires
 * (classes, élèves), calculée côté serveur à chaque requête :
 *   rôles actifs relus dans user_roles pour l'établissement du jeton, rôles
 *   personnalisés seuls (jamais l'union avec un rôle Enseignant / Parent), lecture
 *   du module accordée par leurs grants. Toute erreur → aucune portée (fail-closed).
 * Ne sort jamais dans un jeton : uniquement attaché à `req.principal`.
 */
async function resolveCustomRoleReadScope(repo, principal) {
  try {
    const uid = String(principal?.sub ?? "").trim();
    const schoolId = String(principal?.schoolId ?? "").trim();
    const schoolCode = String(principal?.schoolCode ?? "").trim();
    if (!uid || !schoolId || !schoolCode || schoolCode === "*") return NO_CUSTOM_ROLE_READ_SCOPE;
    if (typeof repo?.resolveEffectivePermissions !== "function") return NO_CUSTOM_ROLE_READ_SCOPE;
    const live = await loadLiveRoleState(repo, uid, { schoolId, logger: null });
    if (live.status !== "active") return NO_CUSTOM_ROLE_READ_SCOPE;
    const platformKeys = new Set(PLATFORM_ROLE_KEYS);
    const customKeys = live.keys.map(toRoleKey).filter((key) => isCustomRoleKey(key) && !platformKeys.has(key));
    if (!customKeys.length) return NO_CUSTOM_ROLE_READ_SCOPE;
    // Sans `sub` : évaluation interne du seul jeu de rôles personnalisés relus ci-dessus.
    const resolved = await repo.resolveEffectivePermissions({
      roleKeys: customKeys,
      schoolId,
      schoolCode,
      countryCode: String(principal?.countryCode ?? "").trim(),
    });
    return Object.freeze({
      classes: resolved?.modules?.classes?.canRead === true,
      students: resolved?.modules?.students?.canRead === true,
    });
  } catch {
    return NO_CUSTOM_ROLE_READ_SCOPE;
  }
}

module.exports = {
  NO_CUSTOM_ROLE_READ_SCOPE,
  resolveCustomRoleReadScope,
  CUSTOM_ROLE_WEB_ACCESS_PROFILE,
  CATALOG_ROLE_STATE,
  isCustomRoleKey,
  classifyCatalogRoleKey,
  loadRoleCatalogStates,
  canonicalizeCustomRoleKeys,
  resolveCustomRoleWebAccess,
  webReadableModules,
};
