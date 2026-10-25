"use strict";

/**
 * SEC-AUTH-05 — état courant des rôles d'un compte (table user_roles).
 *
 * - au moins un rôle actif            → { keys: [...], revoked: false }
 * - aucun rôle actif, mais un historique (tous les rôles retirés)
 *                                      → { keys: [], revoked: true } : aucun droit
 * - aucun enregistrement user_roles (compte legacy jamais migré), dépôt sans
 *   lecture, ou erreur de lecture      → { keys: null, revoked: false } : l'appelant
 *   garde son repli existant (rôle de connexion).
 *
 * La lecture d'historique n'a lieu que lorsque la liste des rôles actifs est vide :
 * aucune requête supplémentaire sur le chemin courant.
 */
async function loadLiveRoleState(repo, userId) {
  const id = String(userId ?? "").trim();
  if (!id || typeof repo?.listActiveUserRoleKeys !== "function") return { keys: null, revoked: false };
  let active;
  try {
    active = await repo.listActiveUserRoleKeys(id);
  } catch {
    return { keys: null, revoked: false };
  }
  if (!Array.isArray(active)) return { keys: null, revoked: false };
  if (active.length) return { keys: active, revoked: false };
  if (typeof repo.userHasRoleHistory !== "function") return { keys: null, revoked: false };
  try {
    return (await repo.userHasRoleHistory(id)) ? { keys: [], revoked: true } : { keys: null, revoked: false };
  } catch {
    return { keys: null, revoked: false };
  }
}

module.exports = { loadLiveRoleState };
