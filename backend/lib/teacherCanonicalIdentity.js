"use strict";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function display(value) {
  return String(value ?? "").trim();
}

function isBusinessTeacherIdentity(value) {
  return /^ENS-\d+$/i.test(display(value));
}

function canonicalError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function buildUserIndex(users = []) {
  const index = new Map();
  for (const user of users) {
    const id = normalize(user?.id);
    if (!id) continue;
    const rows = index.get(id) ?? [];
    rows.push(user);
    index.set(id, rows);
  }
  return index;
}

/**
 * Résout une chaîne d'aliases techniques jusqu'à l'identifiant métier ENS-*.
 *
 * Exemple: UUID-D -> UUID-C -> UUID-B -> UUID-A -> ENS-0001.
 * La résolution est volontairement stricte: cycle, alias absent ou ID ambigu
 * produisent une erreur auditée au lieu d'inventer une identité.
 *
 * @param {object|string} user utilisateur de départ ou son ID
 * @param {object[]|Map<string, object[]>} usersOrIndex utilisateurs portant id/userCode
 * @returns {string} identité canonique normalisée en majuscules (ex. ENS-0001)
 */
function resolveCanonicalIdentity(user, usersOrIndex = []) {
  const index = usersOrIndex instanceof Map ? usersOrIndex : buildUserIndex(usersOrIndex);
  let current = typeof user === "object" && user !== null ? display(user.id) : display(user);
  if (!current) {
    throw canonicalError("CANONICAL_IDENTITY_START_MISSING", "Identifiant utilisateur de départ absent");
  }

  const path = [];
  const seen = new Set();
  while (current) {
    const key = normalize(current);
    if (isBusinessTeacherIdentity(current)) return current.toUpperCase();
    if (seen.has(key)) {
      throw canonicalError("CANONICAL_IDENTITY_CYCLE", "Cycle détecté dans la chaîne d'identité enseignant", { path: [...path, current] });
    }
    seen.add(key);
    path.push(current);

    const initialUser = path.length === 1 && typeof user === "object" ? user : null;
    const candidates = index.get(key) ?? (initialUser ? [initialUser] : []);
    if (candidates.length > 1) {
      throw canonicalError("CANONICAL_IDENTITY_AMBIGUOUS", "Plusieurs utilisateurs portent le même identifiant technique", { path, userId: current });
    }
    const row = candidates[0];
    const next = display(row?.userCode ?? row?.user_code);
    if (!row || !next) {
      throw canonicalError("CANONICAL_IDENTITY_UNRESOLVED", "La chaîne d'identité n'aboutit pas à un identifiant ENS-*", { path });
    }
    current = next;
  }
  throw canonicalError("CANONICAL_IDENTITY_UNRESOLVED", "Identité enseignant canonique introuvable", { path });
}

module.exports = {
  buildUserIndex,
  isBusinessTeacherIdentity,
  resolveCanonicalIdentity,
};
