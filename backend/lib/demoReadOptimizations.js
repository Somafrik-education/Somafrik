"use strict";

const { mapUserRow } = require("./clientsManagement");
const { sqlUsersScope } = require("./usersSchoolScope");

function isDemoRuntime(env = process.env) {
  return String(env.APP_ENV ?? env.SOMAFRIK_ENV ?? "").trim().toLowerCase() === "demo";
}

/**
 * Démo uniquement.
 *
 * Le catalogue Users canonique enrichit normalement chaque compte avec les
 * rôles secondaires et profils métier. Sur le bulk seed Démo (430 comptes),
 * cette projection est trop coûteuse pour l'UX publique alors que l'écran
 * Comptes utilisateurs a d'abord besoin de l'identité, du rôle primaire et du
 * tenant. Cette lecture garde exactement le SQL de scope fail-closed et ne
 * renvoie aucun secret credential.
 */
function attachDemoReadOptimizations(repository, env = process.env) {
  if (!repository || !isDemoRuntime(env) || (repository.engine ?? "postgresql") !== "postgresql") {
    return repository;
  }
  if (repository.__somafrikDemoReadOptimizationsAttached) return repository;

  const originalListClientsUsers =
    typeof repository.listClientsUsers === "function"
      ? repository.listClientsUsers.bind(repository)
      : null;

  repository.listClientsUsers = async function listDemoClientsUsers(scope) {
    // Le public Demo est mono-tenant. Conserver le chemin canonique pour tout
    // scope plateforme/pays afin de ne jamais élargir une autorité par erreur.
    if (!scope || scope.mode !== "school" || !String(scope.schoolId ?? "").trim()) {
      if (!originalListClientsUsers) return [];
      return originalListClientsUsers(scope);
    }

    const params = [];
    const predicate = sqlUsersScope(scope, params);
    const rows = await repository.all(
      `SELECT
         u.id, u.school_id, u.user_code, u.identity_code, u.login_code,
         u.first_name, u.last_name, u.email, u.phone, u.gender, u.birth_date,
         u.role, u.status, u.profile_payload, u.must_change_password,
         u.created_at, u.last_login_at,
         s.school_code, s.login_code AS school_login_code, s.name AS school_name,
         c.iso_code AS country_code, c.name AS country_name
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN countries c ON c.id = s.country_id
       WHERE ${predicate}
       ORDER BY u.created_at`,
      params,
    );

    return rows.map((row) => {
      const mapped = mapUserRow(row);
      const roleKey = String(row.role ?? "").trim();
      return {
        ...mapped,
        roles: mapped.role ? [mapped.role] : [],
        roleKeys: roleKey ? [roleKey] : [],
        secondaryRoles: [],
        assignmentStatus: "Actif",
        accountKind: "account",
        businessProfileLabel: "",
        linkedStudent: null,
        linkedTeacher: null,
        businessProfileConflict: false,
      };
    });
  };

  Object.defineProperty(repository, "__somafrikDemoReadOptimizationsAttached", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return repository;
}

module.exports = {
  isDemoRuntime,
  attachDemoReadOptimizations,
};
