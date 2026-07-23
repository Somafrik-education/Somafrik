/**
 * D3.4b — Inventaire + migration idempotente des relations Parent → Élève.
 *
 * Usage :
 *   node scripts/migrate-parent-relation-contact-ids.js --dry-run
 *   node scripts/migrate-parent-relation-contact-ids.js --apply
 *
 * Sans --apply : inventaire seul (dry-run).
 */
const path = require("path");
const {
  inventoryParentRelations,
  migrateParentRelationsToContactId,
} = require(path.join(__dirname, "..", "backend", "lib", "parentRelationIdentity"));

async function loadState() {
  // Chargement léger via module data si disponible (environnements locaux).
  const dataPath = path.join(__dirname, "..", "backend", "data.js");
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const data = require(dataPath);
  const state = typeof data.getState === "function" ? data.getState() : data.state ?? data;
  return state;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const state = await loadState();
  const before = inventoryParentRelations(state);

  console.log("=== D3.4b inventaire relations Parent → Élève ===");
  console.log(JSON.stringify(before.summary, null, 2));

  if (before.summary.legacyUserId > 0) {
    console.log(
      `\nExemples legacy user.id (${Math.min(5, before.summary.legacyUserId)}) :`,
    );
    before.items
      .filter((row) => row.status === "legacy_user_id")
      .slice(0, 5)
      .forEach((row) => {
        console.log(
          `- ${row.relationId}: ${row.fromContactId} → ${row.mappedContactId} (élève ${row.toStudentId})`,
        );
      });
  }

  const migrated = migrateParentRelationsToContactId(state);
  console.log(`\nMigration idempotente : ${migrated.changed} ligne(s) à remapper.`);
  console.log("Après migration :", JSON.stringify(migrated.inventory.summary, null, 2));

  if (!apply) {
    console.log("\nDry-run uniquement (passez --apply pour écrire — non branché ici sur le store live).");
    console.log(
      "Intégration apply : utiliser migrateParentRelationsToContactId(state) puis persister relations.",
    );
    return;
  }

  console.log(
    "\n--apply demandé : ce script documente et valide la migration ;",
    "la persistance runtime passe par le store BackOffice / putStatePatch côté ops.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
