"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * BULLETIN-CATALOG-01 — catalogue et disponibilité par pays (migration additive, idempotente).
 * HOLD : chargé uniquement par les tests ; aucun appel au démarrage du serveur.
 */
const REPORT_CARD_CATALOG_SQL = fs.readFileSync(path.join(__dirname, "migrations/20261104_report_card_catalog.sql"), "utf8");

/** Retour arrière documenté : jamais exécuté automatiquement. */
const REPORT_CARD_CATALOG_ROLLBACK_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261104_report_card_catalog.rollback.sql"),
  "utf8",
);

module.exports = { REPORT_CARD_CATALOG_SQL, REPORT_CARD_CATALOG_ROLLBACK_SQL };
