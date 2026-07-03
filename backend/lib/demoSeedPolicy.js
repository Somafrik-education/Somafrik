/** Désactive le rechargement automatique des données de démonstration (backend/data.js). */
function shouldSeedDemoData() {
  return process.env.SOMAFRIK_SKIP_DEMO_SEED !== "true";
}

module.exports = { shouldSeedDemoData };
