"use strict";

const { createClientsError } = require("./clientsManagement");

const TEACHER_ROLE_LABEL = "Enseignant";

function loginFromUser(user) {
  return String(user?.publicId || user?.identifier || user?.userCode || "").trim();
}

function temporarySecretFromUser(user) {
  return String(user?.temporaryPassword || user?.temporarySecret || "").trim();
}

function resolveTransactionalClientsStore(repository, tx) {
  if (typeof repository.createTransactionalClientsStore === "function") {
    return repository.createTransactionalClientsStore(tx);
  }

  const scoped =
    tx && typeof repository.createTxScope === "function" ? repository.createTxScope(tx) : repository;
  if (scoped && typeof scoped.query === "function") {
    const { createClientsPgStore } = require("../db/clientsPgStore");
    return createClientsPgStore(scoped);
  }

  if (typeof repository.getClientsStore === "function") {
    return repository.getClientsStore();
  }

  throw createClientsError(500, "Store clients transactionnel indisponible.");
}

async function createTeacherIdentityOnStore(store, payload, principal, auditMeta) {
  const created = await store.createUser(payload ?? {}, principal, auditMeta);
  const granted = await store.grantUserRole(
    created.id,
    { role: TEACHER_ROLE_LABEL },
    principal,
    auditMeta,
  );

  const login = loginFromUser(granted) || loginFromUser(created);
  const temporarySecret = temporarySecretFromUser(created);
  if (!login || !temporarySecret) {
    throw createClientsError(500, "Le secret temporaire du compte enseignant n'a pas pu être remis.");
  }

  return {
    user: granted,
    credentials: { login, temporarySecret },
  };
}

/**
 * Orchestration atomique : identité Utilisateurs + GRANT Enseignant + profil teachers + audits.
 * Un seul COMMIT. Toute erreur rollback users / user_roles / teachers / audit_logs.
 * Distinct de la mutation de la matrice RBAC (GRANT/REVOKE de permissions d'un rôle).
 *
 * Ne pas appeler repository.createClientsUser puis grantClientsUserRole hors de ce scope :
 * chaque méthode ouvre sa propre transaction store.
 */
async function createTeacherIdentityFromUsers(repository, payload, principal, auditMeta) {
  if (typeof repository.withTransaction !== "function") {
    throw createClientsError(500, "Transaction indisponible pour la création enseignant.");
  }

  try {
    return await repository.withTransaction(async (tx) => {
      const store = resolveTransactionalClientsStore(repository, tx);
      return createTeacherIdentityOnStore(store, payload, principal, auditMeta);
    });
  } finally {
    if (repository && "cachedDataset" in repository) {
      repository.cachedDataset = null;
    }
  }
}

module.exports = {
  TEACHER_ROLE_LABEL,
  createTeacherIdentityFromUsers,
  createTeacherIdentityOnStore,
  loginFromUser,
  temporarySecretFromUser,
};
