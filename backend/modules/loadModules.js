"use strict";

/**
 * MONO-L0 — chargement du catalogue de production.
 *
 * Le catalogue n'ajoute aucune route. Un écart (module extrait ou route
 * enregistrée) arrête le démarrage : Lot 0 ne change pas le contrat HTTP.
 */

const { MODULE_CATALOG } = require("./catalog");
const { composeModules } = require("./composeModules");

function loadBackendModules(app) {
  const report = composeModules(app, MODULE_CATALOG);
  if (report.routeCount !== 0) {
    throw new Error(
      `MONO-L0 : le catalogue de production a enregistré ${report.routeCount} route(s). ` +
        "Les routes restent dans backend/server.js tant qu'un lot d'extraction n'est pas validé.",
    );
  }
  return report;
}

module.exports = {
  loadBackendModules,
};
