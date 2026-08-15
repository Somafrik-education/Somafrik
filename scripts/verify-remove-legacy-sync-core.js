"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const legacyDir = path.join(root, "BackOffice");
const forbiddenLegacyFiles = [
  "index.html",
  "styles.css",
  path.join("assets", "schoollink-logo.png"),
  path.join("assets", "somafrik-icon.png"),
  path.join("assets", "somafrik-logo.png"),
];

for (const relative of forbiddenLegacyFiles) {
  const target = path.join(legacyDir, relative);
  if (fs.existsSync(target)) {
    throw new Error(`LEGACY_BACKOFFICE_FILE_FORBIDDEN: ${relative}`);
  }
}

const tombstone = path.join(legacyDir, "app.js");
if (!fs.existsSync(tombstone)) {
  throw new Error("LEGACY_BACKOFFICE_TOMBSTONE_REQUIRED");
}
const tombstoneSource = fs.readFileSync(tombstone, "utf8");
for (const forbidden of ["fetch(", "axios", "/api/", "document.", "window.", "React", "createRoot"] ) {
  if (tombstoneSource.includes(forbidden)) {
    throw new Error(`LEGACY_BACKOFFICE_TOMBSTONE_MUST_BE_INERT: ${forbidden}`);
  }
}

const serverSource = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
if (!serverSource.includes('app.get("/api/backoffice/state"')) {
  throw new Error("BACKOFFICE_STATE_READ_REMOVAL_ROUTE_MISSING");
}
if (!serverSource.includes('app.put("/api/backoffice/state"')) {
  throw new Error("BACKOFFICE_STATE_WRITE_REMOVAL_ROUTE_MISSING");
}
if (!serverSource.includes("sendBackOfficeStateReadRemoved")) {
  throw new Error("BACKOFFICE_STATE_READ_MUST_FAIL_CLOSED");
}
if (!serverSource.includes("sendBackOfficeStateWriteRemoved")) {
  throw new Error("BACKOFFICE_STATE_WRITE_MUST_FAIL_CLOSED");
}

console.log("OK verify:remove-legacy-sync-core — BackOffice UI supprimé, tombstone inerte, state global fail-closed");
