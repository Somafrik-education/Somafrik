"use strict";

/**
 * MONO-L0 — composition ordonnée des modules.
 *
 * L'ordre du tableau est l'ordre d'enregistrement. Un module `inline` ne peut
 * rien enregistrer : ses routes restent dans backend/server.js jusqu'au lot
 * qui l'extrait. Un identifiant en double est refusé avant tout enregistrement
 * supplémentaire.
 */

const { createRouteRegistry } = require("./routeRegistry");

function composeModules(app, modules) {
  if (!Array.isArray(modules)) {
    throw new TypeError("La composition attend un tableau de modules.");
  }
  const seen = new Set();
  const loaded = [];
  for (const mod of modules) {
    if (!mod || typeof mod.id !== "string" || typeof mod.register !== "function") {
      throw new TypeError("Chaque module doit exposer id et register().");
    }
    if (mod.status !== "inline" && mod.status !== "extracted") {
      throw new Error(`${mod.id} : statut « ${mod.status} » refusé (inline ou extracted).`);
    }
    if (seen.has(mod.id)) {
      throw new Error(`${mod.id} : module déjà composé.`);
    }
    seen.add(mod.id);
    const registry = createRouteRegistry(app, {
      moduleId: mod.id,
      allowRoutes: mod.status === "extracted",
    });
    mod.register(registry);
    const routes = registry.routes();
    loaded.push({
      id: mod.id,
      status: mod.status,
      routeCount: routes.length,
      routes,
    });
  }
  return {
    order: loaded.map((mod) => mod.id),
    routeCount: loaded.reduce((total, mod) => total + mod.routeCount, 0),
    modules: loaded,
  };
}

module.exports = { composeModules };
