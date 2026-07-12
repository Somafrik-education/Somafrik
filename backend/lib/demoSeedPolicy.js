/** Désactive le rechargement automatique des données de démonstration (backend/data.js). */

function isProductionEnvironment(env = process.env) {
  return env.NODE_ENV === "production";
}

function shouldSeedDemoData(env = process.env) {
  if (env.SOMAFRIK_SKIP_DEMO_SEED === "true") {
    return false;
  }
  if (isProductionEnvironment(env)) {
    return false;
  }
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
}

module.exports = {
  isProductionEnvironment,
  shouldSeedDemoData,
  assertProductionSecurityConfiguration,
};
