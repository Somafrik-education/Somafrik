"use strict";

const fs = require("fs");
const path = require("path");
const {
  disableLegacyBackOfficeRuntimeMigrations,
} = require("../backend/db/repositoryFactory");

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
for (const forbidden of ["fetch(", "axios", "/api/", "document.", "window.", "React", "createRoot"]) {
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

const notificationsScreenSource = fs.readFileSync(
  path.join(root, "Mobile", "src", "screens", "PlatformNotificationsScreen.tsx"),
  "utf8",
);
if (notificationsScreenSource.includes("markNotificationsRead")) {
  throw new Error("MOBILE_NOTIFICATION_OPTIMISTIC_READ_FORBIDDEN");
}
if (!notificationsScreenSource.includes("updatePlatformNotification")) {
  throw new Error("MOBILE_NOTIFICATION_SERVER_PATCH_REQUIRED");
}
if (!notificationsScreenSource.includes("await refreshBackOfficeState()")) {
  throw new Error("MOBILE_NOTIFICATION_CANONICAL_REFRESH_REQUIRED");
}

let evaluationMigrationCalls = 0;
let noteMigrationCalls = 0;
const postgresProbe = {
  engine: "postgresql",
  migrateEvaluationsFromBackOffice: async () => {
    evaluationMigrationCalls += 1;
  },
  migrateNotesFromBackOffice: async () => {
    noteMigrationCalls += 1;
  },
};
disableLegacyBackOfficeRuntimeMigrations(postgresProbe);
Promise.resolve()
  .then(() => postgresProbe.migrateEvaluationsFromBackOffice())
  .then(() => postgresProbe.migrateNotesFromBackOffice())
  .then(() => {
    if (evaluationMigrationCalls !== 0 || noteMigrationCalls !== 0) {
      throw new Error("LEGACY_BACKOFFICE_RUNTIME_MIGRATION_STILL_ACTIVE");
    }

    const memoryEvaluation = async () => "memory-eval";
    const memoryNotes = async () => "memory-note";
    const memoryProbe = {
      engine: "memory",
      migrateEvaluationsFromBackOffice: memoryEvaluation,
      migrateNotesFromBackOffice: memoryNotes,
    };
    disableLegacyBackOfficeRuntimeMigrations(memoryProbe);
    if (
      memoryProbe.migrateEvaluationsFromBackOffice !== memoryEvaluation ||
      memoryProbe.migrateNotesFromBackOffice !== memoryNotes
    ) {
      throw new Error("MEMORY_REPOSITORY_MUST_NOT_BE_PATCHED");
    }

    console.log(
      "OK verify:remove-legacy-sync-core — BackOffice supprimé, migrations runtime legacy neutralisées, notifications Mobile server-first",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
