"use strict";

/**
 * L0c — politique RBAC des cours établissement (`/api/courses`).
 *
 * Le module Web canonique associe `courses` à la fonctionnalité `Matières`.
 * Chaque verbe HTTP a sa propre clé `routePermissions` : une route protégée
 * sans mapping n'est jamais autorisée (fail-closed global de RbacService).
 *
 * Alias existants uniquement :
 * - `Gérer cours` : composite historique (équivalent « gérer le catalogue »),
 *   déjà utilisé par `/api/v2/subjects`. Ce n'est PAS un jeton granulaire
 *   CREATE qui ouvrirait UPDATE/DELETE.
 * - `Affectations:READ` / `Voir classes` : lecture du catalogue déjà utilisée
 *   par GET `/api/v2/subjects`. L'enseignant sans `Matières:READ` lit le
 *   planning via `GET /api/course-schedules?projection=course-options`.
 *
 * Aucun fallback BackOffice legacy. Aucune permission locale inventée.
 */

const COURSE_GET_ROUTE_KEY = "GET /api/courses";
const COURSE_POST_ROUTE_KEY = "POST /api/courses";
const COURSE_PATCH_ROUTE_KEY = "PATCH /api/courses/:courseId";
const COURSE_DELETE_ROUTE_KEY = "DELETE /api/courses/:courseId";

const COURSE_READ_PERMISSIONS = Object.freeze([
  "Matières:READ",
  "Affectations:READ",
  "Gérer cours",
  "Voir classes",
  "ALL_PRIVILEGES",
]);

const COURSE_CREATE_PERMISSIONS = Object.freeze(["Matières:CREATE", "Gérer cours", "ALL_PRIVILEGES"]);
const COURSE_UPDATE_PERMISSIONS = Object.freeze(["Matières:UPDATE", "Gérer cours", "ALL_PRIVILEGES"]);
const COURSE_DELETE_PERMISSIONS = Object.freeze(["Matières:DELETE", "Gérer cours", "ALL_PRIVILEGES"]);

const COURSE_ROUTE_PERMISSIONS = Object.freeze({
  [COURSE_GET_ROUTE_KEY]: COURSE_READ_PERMISSIONS,
  [COURSE_POST_ROUTE_KEY]: COURSE_CREATE_PERMISSIONS,
  [COURSE_PATCH_ROUTE_KEY]: COURSE_UPDATE_PERMISSIONS,
  [COURSE_DELETE_ROUTE_KEY]: COURSE_DELETE_PERMISSIONS,
});

const COURSE_WRITE_ROUTE_KEYS = Object.freeze([
  COURSE_POST_ROUTE_KEY,
  COURSE_PATCH_ROUTE_KEY,
  COURSE_DELETE_ROUTE_KEY,
]);

module.exports = {
  COURSE_GET_ROUTE_KEY,
  COURSE_POST_ROUTE_KEY,
  COURSE_PATCH_ROUTE_KEY,
  COURSE_DELETE_ROUTE_KEY,
  COURSE_WRITE_ROUTE_KEYS,
  COURSE_ROUTE_PERMISSIONS,
  COURSE_READ_PERMISSIONS,
  COURSE_CREATE_PERMISSIONS,
  COURSE_UPDATE_PERMISSIONS,
  COURSE_DELETE_PERMISSIONS,
};
