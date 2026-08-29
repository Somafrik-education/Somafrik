"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * PUSH-N1 — Jetons Expo Push (Android) par utilisateur authentifié.
 * Isolation par APP_ENV (backend_environment) + métadonnée app_profile.
 * Receipts Expo persistés pour une vérification différée (~15 min).
 */

const MOBILE_PUSH_DEVICES_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260829_mobile_push_devices.sql"),
  "utf8",
);

module.exports = {
  MOBILE_PUSH_DEVICES_SCHEMA_SQL,
};
