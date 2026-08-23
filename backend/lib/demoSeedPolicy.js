/** Désactive le rechargement automatique des données de démonstration (backend/data.js). */

const { reconcileDemoSubscriptions } = require("./demoSeedSubscriptions");

function isProductionEnvironment(env = process.env) {
  return env.NODE_ENV === "production";
}

function prepareDemoSeedData(seedData = require("../data")) {
  const reconciledSubscriptions = reconcileDemoSubscriptions({
    platformSchools: seedData.platformSchools,
    countries: seedData.countries,
    subscriptions: seedData.subscriptions,
  });

  seedData.subscriptions.splice(
    0,
    seedData.subscriptions.length,
    ...reconciledSubscriptions,
  );
  return seedData;
}

function shouldSeedDemoData(env = process.env) {
  if (env.SOMAFRIK_SKIP_DEMO_SEED === "true") {
    return false;
  }
  if (isProductionEnvironment(env)) {
    return false;
  }

  prepareDemoSeedData();
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

  if (env.SOMAFRIK_DB_REQUIRED === "false") {
    throw new Error(
      "Configuration de production invalide : SOMAFRIK_DB_REQUIRED=false est interdit (PostgreSQL obligatoire, aucun fallback mémoire).",
    );
  }
}

module.exports = {
  isProductionEnvironment,
  prepareDemoSeedData,
  shouldSeedDemoData,
  assertProductionSecurityConfiguration,
};
