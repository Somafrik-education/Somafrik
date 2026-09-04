"use strict";

const fs = require("fs");
const path = require("path");
const { PERSONAL_DATA_MODULE_KEYS } = require("../lib/platformPersonalDataGuard");

const PLATFORM_PERSONAL_DATA_DENY_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260904_p0_platform_personal_data_deny.sql"),
  "utf8",
);

async function applyPlatformPersonalDataDeny(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new Error("applyPlatformPersonalDataDeny: executor.query requis");
  }
  await executor.query(PLATFORM_PERSONAL_DATA_DENY_SQL);
}

module.exports = {
  PLATFORM_PERSONAL_DATA_DENY_SQL,
  PERSONAL_DATA_MODULE_KEYS,
  applyPlatformPersonalDataDeny,
};
