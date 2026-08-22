"use strict";

const seedData = require("../data");

function normalizeRole(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isStudentSeedUser(user) {
  const role = normalizeRole(user?.role);
  return role === "STUDENT" || role === "ELEVE / ETUDIANT";
}

/**
 * Le trigger users permanent_identity refuse un rôle STUDENT tant que la ligne
 * students canonique correspondante n'existe pas. Or seedReferenceData() est
 * exécuté avant seedAcademicData(). On diffère donc uniquement les comptes
 * élèves pendant cette première phase ; ensureStudentUsers() les crée ensuite
 * depuis students, une fois les identifiants canoniques présents.
 *
 * La liste userAccounts est restaurée dans tous les cas afin de ne pas modifier
 * les fixtures mémoire ni les consommateurs suivants du seed.
 */
function attachDemoStudentSeedOrder(repository) {
  if (!repository || typeof repository.seedReferenceData !== "function") {
    return repository;
  }
  if (repository.__demoStudentSeedOrderAttached) {
    return repository;
  }

  const originalSeedReferenceData = repository.seedReferenceData;

  repository.seedReferenceData = async function seedReferenceDataWithoutPrematureStudents(client) {
    const accounts = seedData.userAccounts;
    if (!Array.isArray(accounts)) {
      return originalSeedReferenceData.call(this, client);
    }

    const snapshot = accounts.slice();
    const referenceAccounts = snapshot.filter((user) => !isStudentSeedUser(user));

    if (referenceAccounts.length === snapshot.length) {
      return originalSeedReferenceData.call(this, client);
    }

    accounts.splice(0, accounts.length, ...referenceAccounts);
    try {
      return await originalSeedReferenceData.call(this, client);
    } finally {
      accounts.splice(0, accounts.length, ...snapshot);
    }
  };

  Object.defineProperty(repository, "__demoStudentSeedOrderAttached", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return repository;
}

module.exports = {
  attachDemoStudentSeedOrder,
  isStudentSeedUser,
};
