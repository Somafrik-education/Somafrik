"use strict";

// NFC-P0-R2 — single SQL source shared by migration tooling and schema boot.
const fs = require("node:fs");
const path = require("node:path");
const STUDENT_CARDS_NFC_RECOVERY_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261017_student_cards_nfc_recovery.sql"), "utf8",
);
module.exports = { STUDENT_CARDS_NFC_RECOVERY_SCHEMA_SQL };
