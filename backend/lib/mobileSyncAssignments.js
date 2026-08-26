"use strict";

const { BusinessError } = require("../services/authService");
const { PERMISSION_DENIED } = require("../services/rbacService");
const {
  MOBILE_SYNC_ERROR,
  MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
  MOBILE_SYNC_DEFAULT_LIMIT,
  MOBILE_SYNC_MAX_LIMIT,
  SENTINEL_UPDATED_AT,
  SENTINEL_ID,
} = require("./mobileSyncErrors");
const {
  encodeMobileSyncCursor,
  decodeMobileSyncCursor,
  assertCursorBindings,
  principalSyncId,
} = require("./mobileSyncCursor");
const {
  resolveLiveAssignmentsSyncSnapshot,
  liveSnapshotHasAssignmentsRead,
} = require("./mobileSyncScope");

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function clampLimit(raw) {
  if (raw == null || raw === "") {
    return MOBILE_SYNC_DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return MOBILE_SYNC_DEFAULT_LIMIT;
  }
  return Math.min(parsed, MOBILE_SYNC_MAX_LIMIT);
}

function firstQueryValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const text = asTrimmed(value);
  if (!text) return SENTINEL_UPDATED_AT;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

function protocolErrorBody(httpStatus, code, message, extra = {}) {
  return {
    httpStatus,
    body: {
      resource: MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
      mode: extra.mode ?? "full_required",
      cursorStatus: extra.cursorStatus,
      scopeHash: extra.scopeHash,
      code,
      message,
    },
  };
}

function logMobileSync(payload) {
  console.info(
    JSON.stringify({
      event: "mobile_sync_l1",
      resource: MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
      mode: payload.mode ?? null,
      cursorStatus: payload.cursorStatus ?? null,
      itemCount: payload.itemCount ?? 0,
      schoolId: payload.schoolId ? String(payload.schoolId) : undefined,
      durationMs: payload.durationMs ?? 0,
    }),
  );
}

/**
 * Snapshot L1 Assignments : PostgreSQL canonique, curseur opaque, scopeHash, keyset.
 * teacherId = UUID PostgreSQL réel (pas teacher_code).
 *
 * @param {{
 *   principal: object,
 *   cursor?: unknown,
 *   limit?: unknown,
 *   tokenService: object,
 *   repository: object,
 *   tenantScopeService: { assertSchoolAccess: Function },
 * }} args
 */
async function handleMobileSyncL1Assignments(args) {
  const started = Date.now();
  const principal = args.principal;
  const tokenService = args.tokenService;
  const repository = args.repository;
  const tenantScopeService = args.tenantScopeService;

  const schoolCode = asTrimmed(principal?.schoolCode);
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  tenantScopeService.assertSchoolAccess(principal, schoolCode);

  if (typeof repository.listSchoolTeacherAssignmentsForMobileSync !== "function") {
    return protocolErrorBody(
      503,
      MOBILE_SYNC_ERROR.POSTGRES_REQUIRED,
      "Synchronisation mobile L1 disponible uniquement sur PostgreSQL canonique.",
      { mode: "unavailable", cursorStatus: "invalid" },
    );
  }

  let school = null;
  if (typeof repository.getSchoolByCode === "function") {
    school = await repository.getSchoolByCode(schoolCode);
  }
  const schoolId = asTrimmed(principal.effectiveSchoolId ?? school?.id);
  const schoolRef = { schoolCode, schoolId };

  let scopeHash;
  let scope;
  let input;
  try {
    ({ scopeHash, scope, input } = await resolveLiveAssignmentsSyncSnapshot(
      repository,
      principal,
      schoolRef,
    ));
  } catch (error) {
    if (error?.code === MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE) {
      const result = protocolErrorBody(
        503,
        MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE,
        error.message,
        { mode: "unavailable", cursorStatus: "invalid" },
      );
      logMobileSync({
        mode: "unavailable",
        cursorStatus: "invalid",
        itemCount: 0,
        schoolId,
        durationMs: Date.now() - started,
      });
      return result;
    }
    throw error;
  }

  if (scope.scopeKind !== "none" && !liveSnapshotHasAssignmentsRead(input)) {
    const result = protocolErrorBody(
      403,
      PERMISSION_DENIED,
      "Permission insuffisante pour cette fonctionnalité.",
      { mode: "unavailable", cursorStatus: "invalid" },
    );
    logMobileSync({
      mode: "unavailable",
      cursorStatus: "invalid",
      itemCount: 0,
      schoolId,
      durationMs: Date.now() - started,
    });
    return result;
  }

  const principalId = principalSyncId(principal);
  if (!principalId) {
    throw new BusinessError(400, "Identité principal requise.");
  }

  const rawCursor = firstQueryValue(args.cursor);
  const pageLimit = clampLimit(firstQueryValue(args.limit));
  let mode = "full";
  let cursorStatus = "ok";
  let afterUpdatedAt = null;
  let afterId = null;

  if (rawCursor != null && asTrimmed(rawCursor) !== "") {
    let decoded;
    try {
      decoded = decodeMobileSyncCursor(rawCursor, tokenService, {
        resource: MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
      });
      assertCursorBindings(decoded, principal, school);
    } catch (error) {
      if (error?.code === MOBILE_SYNC_ERROR.CURSOR_EXPIRED) {
        const result = protocolErrorBody(
          409,
          MOBILE_SYNC_ERROR.CURSOR_EXPIRED,
          error.message,
          { cursorStatus: "expired", scopeHash, mode: "full_required" },
        );
        logMobileSync({
          mode: "full_required",
          cursorStatus: "expired",
          itemCount: 0,
          schoolId,
          durationMs: Date.now() - started,
        });
        return result;
      }
      throw error;
    }

    if (decoded.scopeHash !== scopeHash) {
      const result = protocolErrorBody(
        409,
        MOBILE_SYNC_ERROR.SCOPE_CHANGED,
        "Le périmètre d'autorisation a changé. Réconciliation complète requise.",
        { cursorStatus: "scope_changed", scopeHash, mode: "full_required" },
      );
      logMobileSync({
        mode: "full_required",
        cursorStatus: "scope_changed",
        itemCount: 0,
        schoolId,
        durationMs: Date.now() - started,
      });
      return result;
    }

    mode = "delta";
    afterUpdatedAt = decoded.lastUpdatedAt;
    afterId = decoded.lastId;
  }

  const queryOptions = {
    limit: pageLimit + 1,
    afterUpdatedAt,
    afterId,
  };
  if (scope.scopeKind === "none") {
    queryOptions.teacherIds = [];
    queryOptions.activeOnly = true;
  } else if (scope.scopeKind === "assigned") {
    queryOptions.teacherIds = scope.teacherId ? [scope.teacherId] : [];
    queryOptions.activeOnly = true;
  }

  const rows = await repository.listSchoolTeacherAssignmentsForMobileSync(schoolCode, queryOptions);
  const hasMore = rows.length > pageLimit;
  const items = hasMore ? rows.slice(0, pageLimit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = encodeMobileSyncCursor(
    {
      resource: MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
      schoolCode,
      schoolId,
      principalId,
      scopeHash,
      lastUpdatedAt: lastItem
        ? toIsoTimestamp(lastItem.updatedAt)
        : afterUpdatedAt || SENTINEL_UPDATED_AT,
      lastId: lastItem ? String(lastItem.id) : afterId || SENTINEL_ID,
    },
    tokenService,
  );

  logMobileSync({
    mode,
    cursorStatus,
    itemCount: items.length,
    schoolId,
    durationMs: Date.now() - started,
  });

  return {
    httpStatus: 200,
    body: {
      resource: MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
      mode,
      cursorStatus,
      scopeHash,
      items,
      nextCursor,
      hasMore,
    },
  };
}

module.exports = {
  handleMobileSyncL1Assignments,
  clampLimit,
  toIsoTimestamp,
};
