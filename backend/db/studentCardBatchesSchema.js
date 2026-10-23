"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STUDENT_CARD_BATCHES_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261023_student_card_batches.sql"),
  "utf8",
);

module.exports = { STUDENT_CARD_BATCHES_SCHEMA_SQL };
