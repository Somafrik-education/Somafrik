"use strict";

// CARTE-PR3-B — une source SQL unique pour la migration et le démarrage du schéma.
const fs = require("node:fs");
const path = require("node:path");

const ATTENDANCE_ROLL_CALLS_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261016_attendance_roll_calls.sql"), "utf8",
);

module.exports = { ATTENDANCE_ROLL_CALLS_SCHEMA_SQL };
