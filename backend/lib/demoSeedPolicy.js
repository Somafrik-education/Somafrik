/** Désactive le rechargement automatique des données de démonstration (backend/data.js). */

let demoSeedIntegrityPrepared = false;

function isProductionEnvironment(env = process.env) {
  return env.NODE_ENV === "production";
}

function prepareDemoSeedIntegrity() {
  if (demoSeedIntegrityPrepared) return;

  // Chargement paresseux : aucune fixture démo n'est chargée lorsque le seed est désactivé
  // ou en production. Le tableau est muté en place car postgresRepository conserve la
  // même référence de module `backend/data.js` pendant tout le bootstrap.
  const seedData = require("../data");
  const { buildDemoSubscriptions } = require("./demoSeedSubscriptions");
  const normalizedSubscriptions = buildDemoSubscriptions({
    subscriptions: seedData.subscriptions,
    platformSchools: seedData.platformSchools,
    countries: seedData.countries,
  });

  seedData.subscriptions.splice(
    0,
    seedData.subscriptions.length,
    ...normalizedSubscriptions,
  );
  demoSeedIntegrityPrepared = true;
}

function shouldSeedDemoData(env = process.env) {
  if (env.SOMAFRIK_SKIP_DEMO_SEED === "true") {
    return false;
  }
  if (isProductionEnvironment(env)) {
    return false;
  }
  prepareDemoSeedIntegrity();
  return true;
}

function assertProductionSecurityConfiguration(env = process.env) {
  if (!isProductionEnvironment(env)) {
    return;
  }

  if (env.SOMAFRIK_SKIP_DEMO_SEED !== "true") {
    throw new Error(
      "Configuration de production invalide : SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire pour empêcher la création des comptes de démonstration.",
    );
  }

  // S2.2 — aucun fallback mémoire / seed « best effort » en production.
  if (env.SOMAFRIK_DB_REQUIRED === "false") {
    throw new Error(
      "Configuration de production invalide : SOMAFRIK_DB_REQUIRED=false est interdit (PostgreSQL obligatoire, aucun fallback mémoire).",
    );
  }
}

module.exports = {
  isProductionEnvironment,
  shouldSeedDemoData,
  assertProductionSecurityConfiguration,
};
