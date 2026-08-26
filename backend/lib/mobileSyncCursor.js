"use strict";

const { BusinessError } = require("../services/authService");
const {
  MOBILE_SYNC_ERROR,
  MOBILE_SYNC_RESOURCE_CLASSES,
  MOBILE_SYNC_SCHEMA_VERSION,
  MOBILE_SYNC_GENERATION,
  MOBILE_SYNC_CURSOR_TYP,
  SENTINEL_UPDATED_AT,
  SENTINEL_ID,
  resolveEncodeCursorTtlSeconds,
} = require("./mobileSyncErrors");

function invalidCursor(message = "Curseur de synchronisation invalide.") {
  const error = new BusinessError(400, message);
  error.code = MOBILE_SYNC_ERROR.CURSOR_INVALID;
  return error;
}

function forbiddenCursor(message = "Curseur de synchronisation hors périmètre.") {
  const error = new BusinessError(403, message);
  error.code = MOBILE_SYNC_ERROR.CURSOR_INVALID;
  return error;
}

function expiredCursor(message = "Curseur de synchronisation expiré. Réconciliation complète requise.") {
  const error = new BusinessError(409, message);
  error.code = MOBILE_SYNC_ERROR.CURSOR_EXPIRED;
  return error;
}

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeSchoolCode(value) {
  return asTrimmed(value).toUpperCase();
}

/**
 * Identité établissement portée par le principal (JWT + scope request).
 * @param {object} principal
 * @returns {Set<string>}
 */
function principalSchoolIdentities(principal = {}) {
  const identities = new Set();
  for (const value of [
    principal.schoolCode,
    principal.effectiveSchoolCode,
    principal.effectiveSchoolInternalCode,
  ]) {
    const normalized = normalizeSchoolCode(value);
    if (normalized && normalized !== "*") identities.add(normalized);
  }
  return identities;
}

/**
 * Identité principale stable (jamais fabriquée par le client).
 * @param {object} principal
 * @returns {string}
 */
function principalSyncId(principal = {}) {
  return asTrimmed(
    principal.sub ?? principal.userId ?? principal.publicId ?? principal.identifier,
  );
}

/**
 * @param {object} input
 * @param {import("../services/tokenService").TokenService} tokenService
 * @returns {string}
 */
function encodeMobileSyncCursor(input, tokenService, options = {}) {
  if (!tokenService || typeof tokenService.sign !== "function") {
    throw new Error("TokenService requis pour encoder un curseur mobile-sync.");
  }
  const ttlSeconds = resolveEncodeCursorTtlSeconds(options);
  const payload = {
    typ: MOBILE_SYNC_CURSOR_TYP,
    sv: Number(input.schemaVersion ?? MOBILE_SYNC_SCHEMA_VERSION),
    gen: Number(input.generation ?? MOBILE_SYNC_GENERATION),
    resource: asTrimmed(input.resource) || MOBILE_SYNC_RESOURCE_CLASSES,
    schoolCode: normalizeSchoolCode(input.schoolCode),
    schoolId: asTrimmed(input.schoolId),
    principalId: asTrimmed(input.principalId),
    scopeHash: asTrimmed(input.scopeHash),
    lastUpdatedAt: asTrimmed(input.lastUpdatedAt) || SENTINEL_UPDATED_AT,
    lastId: asTrimmed(input.lastId) || SENTINEL_ID,
  };
  if (!payload.schoolCode || !payload.principalId || !payload.scopeHash) {
    throw new Error("Curseur mobile-sync incomplet (schoolCode, principalId, scopeHash).");
  }
  return tokenService.sign(payload, ttlSeconds);
}

/**
 * Décodage fail-closed : signature, typ, schéma, génération, ressource.
 * Les mismatches tenant/principal sont validés ensuite avec le principal courant.
 *
 * @param {unknown} rawCursor
 * @param {import("../services/tokenService").TokenService} tokenService
 * @returns {object}
 */
function decodeMobileSyncCursor(rawCursor, tokenService) {
  const token = asTrimmed(rawCursor);
  if (!token) {
    throw invalidCursor();
  }
  if (!tokenService || typeof tokenService.verify !== "function") {
    throw invalidCursor();
  }

  let payload;
  try {
    payload = tokenService.verify(token, MOBILE_SYNC_CURSOR_TYP);
  } catch (error) {
    const message = String(error?.message ?? "");
    if (message.includes("expire")) {
      throw expiredCursor();
    }
    throw invalidCursor();
  }

  if (!payload || typeof payload !== "object") {
    throw invalidCursor();
  }
  if (Number(payload.sv) !== MOBILE_SYNC_SCHEMA_VERSION) {
    throw expiredCursor("Version de curseur non supportée. Réconciliation complète requise.");
  }
  if (Number(payload.gen) !== MOBILE_SYNC_GENERATION) {
    throw expiredCursor("Génération de synchronisation invalide. Réconciliation complète requise.");
  }
  if (asTrimmed(payload.resource) !== MOBILE_SYNC_RESOURCE_CLASSES) {
    throw invalidCursor("Curseur émis pour une autre ressource.");
  }
  if (!asTrimmed(payload.schoolCode) || !asTrimmed(payload.principalId) || !asTrimmed(payload.scopeHash)) {
    throw invalidCursor();
  }

  return {
    schemaVersion: Number(payload.sv),
    generation: Number(payload.gen),
    resource: asTrimmed(payload.resource),
    schoolCode: normalizeSchoolCode(payload.schoolCode),
    schoolId: asTrimmed(payload.schoolId),
    principalId: asTrimmed(payload.principalId),
    scopeHash: asTrimmed(payload.scopeHash),
    lastUpdatedAt: asTrimmed(payload.lastUpdatedAt) || SENTINEL_UPDATED_AT,
    lastId: asTrimmed(payload.lastId) || SENTINEL_ID,
    issuedAt: payload.iat ?? null,
    expiresAt: payload.exp ?? null,
  };
}

/**
 * Bindings fail-closed : tenant, principal, ressource (déjà filtrée au decode).
 * @param {object} cursor
 * @param {object} principal
 * @param {object} [school]
 */
function assertCursorBindings(cursor, principal, school = null) {
  const currentPrincipalId = principalSyncId(principal);
  if (!currentPrincipalId || currentPrincipalId !== cursor.principalId) {
    throw invalidCursor("Curseur émis pour un autre principal.");
  }

  const identities = principalSchoolIdentities(principal);
  if (!identities.has(cursor.schoolCode)) {
    throw forbiddenCursor();
  }

  const currentSchoolId = asTrimmed(principal.effectiveSchoolId ?? school?.id);
  if (cursor.schoolId && currentSchoolId && cursor.schoolId !== currentSchoolId) {
    throw forbiddenCursor();
  }
}

module.exports = {
  encodeMobileSyncCursor,
  decodeMobileSyncCursor,
  assertCursorBindings,
  principalSyncId,
  principalSchoolIdentities,
  invalidCursor,
  forbiddenCursor,
  expiredCursor,
};
