"use strict";

/**
 * L0c — politique RBAC des cours établissement.
 *
 * Le module Web canonique associe `courses` à la fonctionnalité `Matières`.
 * Les routes historiques PATCH/DELETE réutilisent encore la clé
 * `POST /api/courses` dans server.js. Tant que ces routes ne sont pas séparées,
 * l'accès écriture doit rester fail-closed :
 * - un privilège legacy global `Gérer cours` ou `ALL_PRIVILEGES` autorise l'écriture ;
 * - avec la matrice CRUD granulaire, les trois droits CREATE+UPDATE+DELETE sont
 *   requis ensemble afin qu'un simple CREATE ne puisse jamais autoriser DELETE.
 *
 * Ce verrou est volontairement plus restrictif qu'une route method-specific.
 * Le découpage futur des clés POST/PATCH/DELETE pourra ensuite déléguer chaque
 * opération à son droit `Matières:<ACTION>` sans rouvrir de fail-open.
 */

const COURSE_WRITE_ROUTE_KEY = "POST /api/courses";

const COURSE_ROUTE_PERMISSIONS = Object.freeze({
  "GET /api/courses": Object.freeze([
    "Matières:READ",
    "Affectations:READ",
    "Gérer cours",
    "Voir classes",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ]),
  [COURSE_WRITE_ROUTE_KEY]: Object.freeze([
    "Matières:CREATE",
    "Matières:UPDATE",
    "Matières:DELETE",
    "Gérer cours",
    "ALL_PRIVILEGES",
  ]),
});

const COURSE_GRANULAR_WRITE_PERMISSIONS = Object.freeze([
  "Matières:CREATE",
  "Matières:UPDATE",
  "Matières:DELETE",
]);

function canAccessCourseWrite(permissions = new Set()) {
  const values = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  if (values.has("ALL_PRIVILEGES") || values.has("Gérer cours")) {
    return true;
  }
  return COURSE_GRANULAR_WRITE_PERMISSIONS.every((permission) => values.has(permission));
}

module.exports = {
  COURSE_WRITE_ROUTE_KEY,
  COURSE_ROUTE_PERMISSIONS,
  COURSE_GRANULAR_WRITE_PERMISSIONS,
  canAccessCourseWrite,
};
