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

const postgresRepositorySource = fs.readFileSync(
  path.join(root, "backend", "db", "postgresRepository.js"),
  "utf8",
);
function extractAsyncMethod(source, methodName) {
  const start = source.indexOf(`async ${methodName}(`);
  if (start < 0) {
    throw new Error(`LEGACY_BOOT_METHOD_MISSING: ${methodName}`);
  }
  const next = source.slice(start + 1).search(/\n  async [A-Za-z0-9_]+\(/);
  return next >= 0 ? source.slice(start, start + 1 + next) : source.slice(start);
}
const initSource = extractAsyncMethod(postgresRepositorySource, "init");
const ensureNotesSource = extractAsyncMethod(postgresRepositorySource, "ensureNotesCanonicalPersistence");
for (const forbidden of ["migrateEvaluationsFromBackOffice", "migrateNotesFromBackOffice"]) {
  if (initSource.includes(forbidden) || ensureNotesSource.includes(forbidden)) {
    throw new Error(`LEGACY_BOOT_STILL_CALLS_${forbidden}`);
  }
}
for (const methodName of ["migrateEvaluationsFromBackOffice", "migrateNotesFromBackOffice"]) {
  const body = extractAsyncMethod(postgresRepositorySource, methodName);
  if (/SELECT\s+state_payload/i.test(body) || /upsertEvaluationFromLegacy|upsertGrade/.test(body)) {
    throw new Error(`LEGACY_BOOT_MIGRATION_STILL_READS_BACKOFFICE_STATE: ${methodName}`);
  }
  if (!body.includes("LEGACY_BACKOFFICE_RUNTIME_MIGRATION_REMOVED")) {
    throw new Error(`LEGACY_BOOT_TOMBSTONE_REQUIRED: ${methodName}`);
  }
}

const factorySource = fs.readFileSync(
  path.join(root, "backend", "db", "repositoryFactory.js"),
  "utf8",
);
if (/async\s*\(\)\s*=>\s*undefined/.test(factorySource)) {
  throw new Error("LEGACY_BOOT_FACTORY_SILENT_NOOP_FORBIDDEN");
}

const evalFn = async () => "original-eval";
const notesFn = async () => "original-notes";
const postgresProbe = {
  engine: "postgresql",
  migrateEvaluationsFromBackOffice: evalFn,
  migrateNotesFromBackOffice: notesFn,
};
disableLegacyBackOfficeRuntimeMigrations(postgresProbe);
Promise.resolve()
  .then(() => {
    if (
      postgresProbe.migrateEvaluationsFromBackOffice !== evalFn ||
      postgresProbe.migrateNotesFromBackOffice !== notesFn
    ) {
      throw new Error("LEGACY_BOOT_FACTORY_MUST_NOT_REPLACE_TOMBSTONES");
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
      "OK verify:remove-legacy-sync-core — BackOffice supprimé, boot sans import evaluations/notes, notifications Mobile server-first",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
