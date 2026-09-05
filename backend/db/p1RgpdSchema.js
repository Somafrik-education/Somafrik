"use strict";

const fs = require("fs");
const path = require("path");

const P1_RGPD_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260904_p1_sessions_privacy_retention.sql"),
  "utf8",
);

async function applyP1RgpdSchema(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new Error("applyP1RgpdSchema: executor.query requis");
  }
  await executor.query(P1_RGPD_SCHEMA_SQL);
}

module.exports = {
  P1_RGPD_SCHEMA_SQL,
  applyP1RgpdSchema,
};
