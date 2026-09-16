"use strict";

/**
 * Adaptateur strictement Démo publique.
 *
 * Le writer PostgreSQL historique de seed-platform-bulk.js reste inchangé :
 * on lui fournit ici le builder public DRC réduit (1 école / 10 classes /
 * 200 élèves / 20 enseignants) au lieu du catalogue de charge bulk.
 *
 * Ce script n'est jamais utilisé par PROD/PREPROD et n'est invoqué que par
 * reset-demo-environment.js derrière les gardes destructives APP_ENV=demo.
 */
const { buildPublicDemoPlatformSeed, verifyPublicDemoSeed } = require("../lib/demoPublicPlatformSeed");

const bulkSeedModulePath = require.resolve("../lib/bulkPlatformSeed");
const publicBuilder = () => {
  const seed = buildPublicDemoPlatformSeed();
  const proof = verifyPublicDemoSeed(seed);
  console.log(`Dataset public Démo préparé : ${JSON.stringify(proof)}`);
  return seed;
};

// seed-platform-bulk.js dépend uniquement de buildBulkPlatformSeed depuis ce
// module. L'injection est locale à ce processus Node dédié, avant le require du
// writer ; aucune mutation du runtime API n'est possible.
require.cache[bulkSeedModulePath] = {
  id: bulkSeedModulePath,
  filename: bulkSeedModulePath,
  loaded: true,
  exports: { buildBulkPlatformSeed: publicBuilder },
  children: [],
  paths: [],
};

require("./seed-platform-bulk");
