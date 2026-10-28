"use strict";

/**
 * MONO-L0 — registre de routes pour un module extrait.
 *
 * Le registre ne propose pas `use` : un module ne peut pas insérer de
 * middleware global ni modifier la chaîne déjà posée par backend/server.js.
 * Chaque enregistrement délègue au verbe Express correspondant, dans l'ordre
 * des gestionnaires reçus.
 */

const VERBS = Object.freeze(["get", "post", "put", "patch", "delete", "all"]);

function handlerName(handler) {
  if (typeof handler === "function") return handler.name || "<anonyme>";
  return typeof handler;
}

function isApplication(app) {
  // Express exporte une fonction (le gestionnaire de requêtes), pas un simple objet.
  return Boolean(app) && (typeof app === "function" || typeof app === "object");
}

function createRouteRegistry(app, { moduleId, allowRoutes }) {
  if (!isApplication(app)) {
    throw new TypeError("Application Express requise.");
  }
  if (typeof moduleId !== "string" || !/^[a-z][a-z0-9-]*$/.test(moduleId)) {
    throw new TypeError(`Identifiant de module invalide : « ${moduleId} ».`);
  }
  const records = [];
  const registry = { moduleId };
  for (const verb of VERBS) {
    registry[verb] = function register(routePath, ...handlers) {
      if (!allowRoutes) {
        throw new Error(
          `${moduleId} : module encore inline dans server.js, aucun enregistrement de route n'est autorisé.`,
        );
      }
      if (typeof routePath !== "string" && !(routePath instanceof RegExp)) {
        throw new TypeError(`${moduleId} : chemin de route invalide pour ${verb.toUpperCase()}.`);
      }
      if (typeof routePath === "string" && routePath.length === 0) {
        throw new TypeError(`${moduleId} : chemin de route vide.`);
      }
      const flat = handlers.flat(Infinity);
      if (flat.length === 0 || flat.some((handler) => typeof handler !== "function")) {
        throw new TypeError(
          `${moduleId} : ${verb.toUpperCase()} ${String(routePath)} exige une chaîne de fonctions.`,
        );
      }
      if (typeof app[verb] !== "function") {
        throw new TypeError(`${moduleId} : l'application n'expose pas ${verb}.`);
      }
      records.push({
        moduleId,
        method: verb.toUpperCase(),
        path: routePath instanceof RegExp ? String(routePath) : routePath,
        pathIsRegExp: routePath instanceof RegExp,
        handlerNames: flat.map(handlerName),
      });
      return app[verb](routePath, ...flat);
    };
  }
  registry.routes = () => records.map((row) => ({ ...row, handlerNames: [...row.handlerNames] }));
  return registry;
}

module.exports = {
  VERBS,
  createRouteRegistry,
  handlerName,
};
