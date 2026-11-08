"use strict";

// CARTE-PR3-B — une source SQL unique pour la migration et le démarrage du schéma.
const fs = require("node:fs");
const path = require("node:path");

// NFC-PRES-LOCAL-PR1c : extension additive (synchronisation hors ligne, ACK durable), appliquée après.
const ATTENDANCE_ROLL_CALLS_SCHEMA_SQL = [
  "migrations/20261016_attendance_roll_calls.sql",
  "migrations/20261108_attendance_roll_calls_offline_sync.sql",
].map((file) => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");

module.exports = { ATTENDANCE_ROLL_CALLS_SCHEMA_SQL };
