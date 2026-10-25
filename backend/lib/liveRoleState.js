"use strict";

/**
 * SEC-AUTH-05 — état courant des rôles d'un compte (table user_roles), fail-closed.
 *
 * - au moins un rôle actif                → { status: "active",  keys: [...] }
 * - aucun rôle actif, historique présent   → { status: "revoked", keys: [] } : aucun droit
 * - aucun rôle actif ET absence d'historique établie de façon fiable
 *   (userHasRoleHistory a répondu exactement false)
 *                                          → { status: "legacy",  keys: null } : seul cas où
 *   l'appelant garde le rôle de connexion (compte jamais migré dans user_roles)
 * - toute autre situation : erreur SQL, délai dépassé, dépôt sans lecture, résultat
 *   invalide, identifiant absent           → { status: "unavailable", keys: [] } : aucun droit,
 *   jamais un repli sur le jeton.
 *
 * L'historique n'est lu que si la liste des rôles actifs est vide.
 */

const ROLE_READ_TIMEOUT_MS = 5000;

const UNAVAILABLE = Object.freeze({ status: "unavailable", keys: [] });

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("SEC-AUTH-05 : lecture des rôles hors délai")), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function isRoleKeyList(value) {
  return Array.isArray(value) && value.every((key) => typeof key === "string" && key.trim() !== "");
}

function unavailable(reason, logger) {
  // Raison technique seulement : jamais d'identifiant, de jeton ni de secret.
  logger?.warn?.(`[SEC-AUTH-05] validation des rôles indisponible (${reason}) : accès refusé`);
  return UNAVAILABLE;
}

async function loadLiveRoleState(repo, userId, { timeoutMs = ROLE_READ_TIMEOUT_MS, logger = console } = {}) {
  const id = String(userId ?? "").trim();
  if (!id) return unavailable("identifiant absent", logger);
  if (typeof repo?.listActiveUserRoleKeys !== "function" || typeof repo?.userHasRoleHistory !== "function") {
    return unavailable("dépôt sans lecture des rôles", logger);
  }

  let active;
  try {
    active = await withTimeout(repo.listActiveUserRoleKeys(id), timeoutMs);
  } catch {
    return unavailable("lecture des rôles actifs en échec", logger);
  }
  if (!isRoleKeyList(active)) return unavailable("rôles actifs invalides", logger);
  if (active.length) return { status: "active", keys: active };

  let history;
  try {
    history = await withTimeout(repo.userHasRoleHistory(id), timeoutMs);
  } catch {
    return unavailable("lecture de l'historique en échec", logger);
  }
  if (history === true) return { status: "revoked", keys: [] };
  if (history === false) return { status: "legacy", keys: null };
  return unavailable("historique invalide", logger);
}

module.exports = { loadLiveRoleState, ROLE_READ_TIMEOUT_MS };
