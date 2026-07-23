/**
 * D3.4b — Inventaire + migration persistée des relations Parent → Élève.
 *
 * Accès store live : API BackOffice (`GET/PUT /api/backoffice/state`),
 * même canal que les E2E ops (superadmin).
 *
 * Usage :
 *   # Inventaire seul (aucune écriture)
 *   node scripts/migrate-parent-relation-contact-ids.js
 *
 *   # Migration persistée (sauvegarde JSON + putStatePatch)
 *   node scripts/migrate-parent-relation-contact-ids.js --apply --confirm
 *
 * Variables :
 *   SOMAFRIK_API_URL
 *   SOMAFRIK_E2E_SUPERADMIN_ID / SOMAFRIK_E2E_SUPERADMIN_PASSWORD
 *     (ou SOMAFRIK_TEST_SUPERADMIN_PASSWORD)
 */
const fs = require("fs");
const path = require("path");
const {
  inventoryParentRelations,
  migrateParentRelationsToContactId,
} = require(path.join(__dirname, "..", "backend", "lib", "parentRelationIdentity"));
const {
  login,
  getState,
  putStatePatch,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
} = require("./e2e-api-helpers");

function hasFlag(name) {
  return process.argv.includes(name);
}

function printSummary(label, summary) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(summary, null, 2));
}

function printLegacySamples(items, status, label) {
  const rows = items.filter((row) => row.status === status);
  if (!rows.length) return;
  console.log(`\nExemples ${label} (${Math.min(5, rows.length)}) :`);
  rows.slice(0, 5).forEach((row) => {
    console.log(
      `- ${row.relationId}: ${row.fromContactId} → ${row.mappedContactId || "?"} (élève ${row.toStudentId})`,
    );
  });
}

async function loadLiveState() {
  const token = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const state = await getState(token);
  return { token, state };
}

function writeBackup(state) {
  const dir = path.join(__dirname, "..", "tmp");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `parent-relation-migration-backup-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  return filePath;
}

async function main() {
  const apply = hasFlag("--apply");
  const confirm = hasFlag("--confirm");

  if (apply && !confirm) {
    console.error("Refus : --apply exige aussi --confirm (persistance store live).");
    process.exit(2);
  }

  console.log(`API : ${process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api"}`);
  console.log(`Mode : ${apply ? "APPLY (persistance)" : "INVENTAIRE (lecture seule)"}`);

  const { token, state } = await loadLiveState();
  const before = inventoryParentRelations(state);
  printSummary("Inventaire avant", before.summary);
  printLegacySamples(before.items, "legacy_user_id", "legacy user.id migrables");
  printLegacySamples(
    before.items,
    "legacy_missing_contact",
    "legacy user.id — contact cible manquant (non migrés)",
  );

  const planned = migrateParentRelationsToContactId(state);
  console.log(`\nPlan migration : ${planned.changed} ligne(s) à remapper.`);
  console.log(`Ignorées (contact cible absent) : ${planned.skippedMissingContact}.`);
  printSummary("Inventaire simulé après", planned.inventory.summary);

  if (!apply) {
    console.log("\nAucune écriture (inventaire / dry-run).");
    console.log("Pour persister : node scripts/migrate-parent-relation-contact-ids.js --apply --confirm");
    return;
  }

  if (planned.changed === 0) {
    console.log("\nRien à persister (déjà convergent ou aucune ligne migrable).");
    return;
  }

  const backupPath = writeBackup(state);
  console.log(`\nSauvegarde écrite : ${backupPath}`);

  await putStatePatch(token, { relations: planned.relations });
  console.log("Persistance OK : putStatePatch({ relations }).");

  const afterState = await getState(token);
  const after = inventoryParentRelations(afterState);
  printSummary("Inventaire après persistance", after.summary);

  const remainingMigratable = after.summary.legacyUserId;
  if (remainingMigratable > 0) {
    console.error(
      `\nÉchec : ${remainingMigratable} relation(s) legacy migrable(s) restantes après apply.`,
    );
    process.exit(1);
  }

  // Idempotence : second passage doit être 0.
  const second = migrateParentRelationsToContactId(afterState);
  if (second.changed !== 0) {
    console.error(`\nÉchec idempotence : second passage changerait ${second.changed} ligne(s).`);
    process.exit(1);
  }

  console.log("\nMigration D3.4b persistée et idempotente.");
  console.log(`Avant legacy_user_id=${before.summary.legacyUserId} → après=${after.summary.legacyUserId}`);
  console.log(`legacy_missing_contact inchangé (non remappé) : ${after.summary.legacyMissingContact}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
