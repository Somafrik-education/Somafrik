"use strict";

/**
 * Codes métier stables — sync mobile L1 (Classes, Students, Assignments, SchoolCourses).
 * HTTP + code, jamais un 500 pour un curseur illisible.
 */
const MOBILE_SYNC_ERROR = Object.freeze({
  CURSOR_INVALID: "MOBILE_SYNC_CURSOR_INVALID",
  CURSOR_EXPIRED: "MOBILE_SYNC_CURSOR_EXPIRED",
  SCOPE_CHANGED: "MOBILE_SYNC_SCOPE_CHANGED",
  POSTGRES_REQUIRED: "MOBILE_SYNC_POSTGRES_REQUIRED",
  LIVE_SCOPE_UNAVAILABLE: "MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE",
});

const MOBILE_SYNC_RESOURCE_CLASSES = "classes";
const MOBILE_SYNC_RESOURCE_STUDENTS = "students";
const MOBILE_SYNC_RESOURCE_ASSIGNMENTS = "assignments";
const MOBILE_SYNC_RESOURCE_SCHOOL_COURSES = "school-courses";
const MOBILE_SYNC_RESOURCE_COURSE_SCHEDULES = "course-schedules";
const MOBILE_SYNC_SCHEMA_VERSION = 1;
const MOBILE_SYNC_GENERATION = 1;
const MOBILE_SYNC_CURSOR_TYP = "mobile-sync-cursor";

const MOBILE_SYNC_DEFAULT_LIMIT = 200;
const MOBILE_SYNC_MAX_LIMIT = 500;

const MOBILE_SYNC_CURSOR_TTL_DEFAULT_SECONDS = 30 * 24 * 60 * 60;
const MOBILE_SYNC_CURSOR_TTL_MAX_SECONDS = 90 * 24 * 60 * 60;

function liveScopeError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE;
  return error;
}

function ttlConfigError(message) {
  const error = new Error(message);
  error.statusCode = 500;
  error.code = "MOBILE_SYNC_CURSOR_TTL_INVALID";
  return error;
}

/**
 * TTL curseur : nombre fini, strictement positif, borné à 90 jours.
 * Env absent → 30 jours. `"abc"` / NaN / ≤0 / hors borne → fail-closed (pas de curseur émis).
 * @param {unknown} [raw]
 * @returns {number}
 */
function resolveMobileSyncCursorTtlSeconds(raw = process.env.MOBILE_SYNC_CURSOR_TTL_SECONDS) {
  if (raw == null || String(raw).trim() === "") {
    return MOBILE_SYNC_CURSOR_TTL_DEFAULT_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MOBILE_SYNC_CURSOR_TTL_MAX_SECONDS) {
    throw ttlConfigError(
      "MOBILE_SYNC_CURSOR_TTL_SECONDS invalide: nombre fini, positif, au plus 90 jours.",
    );
  }
  return Math.floor(parsed);
}

/**
 * @param {{ ttlSeconds?: unknown }} [options]
 * @returns {number}
 */
function resolveEncodeCursorTtlSeconds(options = {}) {
  if (!Object.hasOwn(options, "ttlSeconds")) {
    return resolveMobileSyncCursorTtlSeconds();
  }
  const parsed = Number(options.ttlSeconds);
  if (!Number.isFinite(parsed)) {
    throw ttlConfigError("ttlSeconds de curseur invalide.");
  }
  return Math.trunc(parsed);
}

const SENTINEL_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const SENTINEL_ID = "00000000-0000-0000-0000-000000000000";

const CLASSES_SYNC_PERMISSIONS = Object.freeze([
  "Classes:READ",
  "Voir classes",
  "Gérer classes",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
]);

const STUDENTS_SYNC_PERMISSIONS = Object.freeze([
  "Élèves:READ",
  "Gérer élèves",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
]);

const ASSIGNMENTS_SYNC_PERMISSIONS = Object.freeze([
  "Affectations:READ",
  "Enseignants:READ",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
]);

/** Identique à GET /api/courses (`COURSE_READ_PERMISSIONS`). Pas d'invention. */
const SCHOOL_COURSES_SYNC_PERMISSIONS = Object.freeze([
  "Matières:READ",
  "Gérer cours",
  "Voir classes",
  "ALL_PRIVILEGES",
]);

/** Identique à GET /api/course-schedules. Pas d'invention. */
const COURSE_SCHEDULES_SYNC_PERMISSIONS = Object.freeze([
  "Planning de cours:READ",
  "ALL_PRIVILEGES",
]);

module.exports = {
  MOBILE_SYNC_ERROR,
  MOBILE_SYNC_RESOURCE_CLASSES,
  MOBILE_SYNC_RESOURCE_STUDENTS,
  MOBILE_SYNC_RESOURCE_ASSIGNMENTS,
  MOBILE_SYNC_RESOURCE_SCHOOL_COURSES,
  MOBILE_SYNC_RESOURCE_COURSE_SCHEDULES,
  MOBILE_SYNC_SCHEMA_VERSION,
  MOBILE_SYNC_GENERATION,
  MOBILE_SYNC_CURSOR_TYP,
  MOBILE_SYNC_DEFAULT_LIMIT,
  MOBILE_SYNC_MAX_LIMIT,
  MOBILE_SYNC_CURSOR_TTL_DEFAULT_SECONDS,
  MOBILE_SYNC_CURSOR_TTL_MAX_SECONDS,
  liveScopeError,
  resolveMobileSyncCursorTtlSeconds,
  resolveEncodeCursorTtlSeconds,
  SENTINEL_UPDATED_AT,
  SENTINEL_ID,
  CLASSES_SYNC_PERMISSIONS,
  STUDENTS_SYNC_PERMISSIONS,
  ASSIGNMENTS_SYNC_PERMISSIONS,
  SCHOOL_COURSES_SYNC_PERMISSIONS,
  COURSE_SCHEDULES_SYNC_PERMISSIONS,
};
