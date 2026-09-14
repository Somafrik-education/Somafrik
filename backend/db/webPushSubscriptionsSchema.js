"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Web Push — abonnements navigateur (Chrome/Edge) par utilisateur authentifié.
 * Isolation par APP_ENV (backend_environment) + user_id + school_id.
 */

const WEB_PUSH_SUBSCRIPTIONS_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260914_web_push_subscriptions.sql"),
  "utf8",
);

module.exports = {
  WEB_PUSH_SUBSCRIPTIONS_SCHEMA_SQL,
};
