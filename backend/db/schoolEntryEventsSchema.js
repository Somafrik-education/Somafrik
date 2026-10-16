"use strict";

// CARTE-PR3-A1 — une source SQL unique pour la migration et le démarrage du schéma.
const fs = require("node:fs");
const path = require("node:path");

const SCHOOL_ENTRY_EVENTS_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261016_school_entry_events.sql"), "utf8",
);

module.exports = { SCHOOL_ENTRY_EVENTS_SCHEMA_SQL };
