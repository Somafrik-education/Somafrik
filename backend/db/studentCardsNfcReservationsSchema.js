"use strict";

// A single SQL source is used by migration tooling and the existing schema boot.
const fs = require("node:fs");
const path = require("node:path");
const STUDENT_CARDS_NFC_RESERVATIONS_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261013_student_cards_nfc_reservations.sql"), "utf8",
);
module.exports = { STUDENT_CARDS_NFC_RESERVATIONS_SCHEMA_SQL };
