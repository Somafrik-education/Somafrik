"use strict";

/**
 * MONO-T1 — préchargement (outil d'inventaire, jamais chargé par l'application).
 *
 * Enregistre chaque route réellement déclarée sur l'application Express par
 * backend/server.js (méthode, chemin, ligne source), puis écrit le relevé
 * dans MONO_T1_ROUTE_DUMP à la sortie du processus. app.listen est neutralisé :
 * aucun port n'est ouvert, aucune requête n'est servie.
 */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const DUMP = process.env.MONO_T1_ROUTE_DUMP;
const VERBS = ["get", "post", "put", "patch", "delete", "all"];
const routes = [];

/** Premier cadre de pile hors Express et hors ce préchargement : fichier et ligne d'enregistrement. */
function callerSite() {
  const frames = String(new Error().stack).split("\n").slice(1);
  for (const frame of frames) {
    const match = frame.match(/\(?((?:\/|[A-Za-z]:\\)[^():]+):(\d+):\d+\)?$/);
    if (!match) continue;
    const file = match[1];
    if (file === __filename || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    return { file: path.relative(path.resolve(__dirname, ".."), file), line: Number(match[2]) };
  }
  return { file: null, line: null };
}

function patchExpress(express) {
  if (express.__monoT1Patched) return;
  express.__monoT1Patched = true;
  for (const verb of VERBS) {
    const original = express.application[verb];
    express.application[verb] = function patched(routePath, ...handlers) {
      // app.get("setting") est un accesseur de configuration, pas une route.
      if (!(verb === "get" && handlers.length === 0)) {
        routes.push({
          method: verb.toUpperCase(),
          path: routePath instanceof RegExp ? String(routePath) : String(routePath),
          pathIsRegExp: routePath instanceof RegExp,
          ...callerSite(),
          handlerCount: handlers.length,
          // Noms des fonctions de la chaîne (le dernier élément est le gestionnaire).
          handlerNames: handlers.flat().map((handler) => (typeof handler === "function" ? handler.name || "<anonyme>" : typeof handler)),
        });
      }
      return original.call(this, routePath, ...handlers);
    };
  }
  express.application.listen = function noListen() {
    process.exit(0);
  };
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (request === "express") patchExpress(loaded);
  return loaded;
};

process.on("exit", () => {
  if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(routes, null, 2));
});
