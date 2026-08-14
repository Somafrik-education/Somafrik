"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_VERSION,
  DATA_EXPORT_SNAPSHOT_ISOLATION,
  DATA_EXPORT_SNAPSHOT_ACCESS_MODE,
  DATA_EXPORT_ERROR,
  assertDataExportRead,
  resolveExportSchoolCode,
  sanitizeExportValue,
  collectSensitiveExportPaths,
  buildExportEnvelope,
} = require("./dataExportManagement");
const { exportSchoolData } = require("./dataExportService");
const { BusinessError } = require("../services/authService");

test("assertDataExportRead refuse un enseignant", () => {
  assert.throws(
    () => assertDataExportRead({ role: "Enseignant", permissions: [] }),
    (error) => error instanceof BusinessError && error.statusCode === 403 && error.code === DATA_EXPORT_ERROR.FORBIDDEN,
  );
});

test("Superadmin / Admin Pays exigent un schoolCode explicite", () => {
  assert.throws(
    () => resolveExportSchoolCode({ role: "Super Administrateur Somafrik", schoolCode: "*" }, ""),
    (error) => error.statusCode === 400 && error.code === DATA_EXPORT_ERROR.SCHOOL_REQUIRED,
  );
  assert.equal(
    resolveExportSchoolCode({ role: "Admin Pays", countryCode: "CD" }, "CD-2026-0001"),
    "CD-2026-0001",
  );
});

test("Admin School ignore le schoolCode client et utilise le JWT", () => {
  assert.equal(
    resolveExportSchoolCode(
      { role: "Admin School", schoolCode: "CD-2026-0001", permissions: ["Paramètres Établissement:READ"] },
      "BI-2026-0002",
    ),
    "CD-2026-0001",
  );
});

test("enveloppe versionnée et domaines réellement inclus", () => {
  const envelope = buildExportEnvelope({
    schoolCode: "CD-2026-0001",
    domains: {
      students: [{ id: "1", firstName: "Amina" }],
      classes: [],
      missing: undefined,
    },
  });
  assert.equal(envelope.format, DATA_EXPORT_FORMAT);
  assert.equal(envelope.version, DATA_EXPORT_VERSION);
  assert.equal(envelope.schoolCode, "CD-2026-0001");
  assert.deepEqual(envelope.includedDomains, ["students", "classes"]);
  assert.equal("missing" in envelope.domains, false);
  assert.ok(envelope.generatedAt);
});

test("aucun secret exporté (hash, jwt, credentials)", () => {
  const dirty = {
    students: [
      {
        name: "Amina",
        password_hash: "scrypt$x",
        pinHash: "scrypt$y",
        refresh_token_hash: "abc",
        nested: { jwt_secret: "nope", DATABASE_URL: "postgres://x" },
      },
    ],
  };
  const clean = sanitizeExportValue(dirty);
  assert.equal(clean.students[0].name, "Amina");
  assert.equal("password_hash" in clean.students[0], false);
  assert.equal("pinHash" in clean.students[0], false);
  assert.equal("refresh_token_hash" in clean.students[0], false);
  assert.equal("jwt_secret" in clean.students[0].nested, false);
  assert.equal("DATABASE_URL" in clean.students[0].nested, false);
  assert.deepEqual(collectSensitiveExportPaths(clean), []);
});

test("snapshot consistency = PostgreSQL REPEATABLE READ READ ONLY", () => {
  assert.equal(DATA_EXPORT_SNAPSHOT_ISOLATION, "REPEATABLE READ");
  assert.equal(DATA_EXPORT_SNAPSHOT_ACCESS_MODE, "READ ONLY");
  const repoSrc = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  const serviceSrc = fs.readFileSync(path.join(__dirname, "dataExportService.js"), "utf8");
  assert.match(repoSrc, /BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ/);
  assert.match(serviceSrc, /withReadOnlyRepeatableRead/);
  assert.match(serviceSrc, /recordAudit/);
});

test("exportSchoolData lit dans withReadOnlyRepeatableRead puis audite hors snapshot", async () => {
  const calls = [];
  const principal = {
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    permissions: ["Paramètres Établissement:READ"],
    sub: "admin-1",
  };
  const repo = {
    async withReadOnlyRepeatableRead(fn) {
      calls.push("snapshot");
      return fn({
        async one(sql) {
          if (String(sql).includes("FROM schools")) {
            return { id: "school-1", school_code: "CD-2026-0001", status: "active" };
          }
          return null;
        },
        async all() {
          return [];
        },
      });
    },
    async recordAudit() {
      calls.push("audit");
    },
  };
  const envelope = await exportSchoolData(repo, principal, "IGNORED");
  assert.equal(envelope.format, DATA_EXPORT_FORMAT);
  assert.deepEqual(calls, ["snapshot", "audit"]);
});

test("échec audit export = fail-closed (pas de payload renvoyé)", async () => {
  const principal = {
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    permissions: ["Paramètres Établissement:READ"],
  };
  const repo = {
    async withReadOnlyRepeatableRead(fn) {
      return fn({
        async one() {
          return { id: "school-1", school_code: "CD-2026-0001" };
        },
        async all() {
          return [];
        },
      });
    },
    async recordAudit() {
      throw new BusinessError(500, "Audit indisponible pour l'export.");
    },
  };
  await assert.rejects(
    () => exportSchoolData(repo, principal, "CD-2026-0001"),
    (error) => error instanceof BusinessError && error.statusCode === 500,
  );
});

test("aucun restore legacy dans l'UI Données ni DataContext.replace-all", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "../../web/src/pages/parametres/DataBackupSettingsPage.tsx"),
    "utf8",
  );
  const context = fs.readFileSync(path.join(__dirname, "../../web/src/context/DataContext.tsx"), "utf8");
  assert.equal(page.includes("Restaurer une sauvegarde"), false);
  assert.equal(/type=["']file["']/.test(page), false);
  assert.equal(page.includes("partial: false"), false);
  assert.equal(page.includes("handleRestoreFile"), false);
  assert.equal(page.includes("restauration complète"), true);
  assert.equal(page.includes("/data-export"), true);
  assert.match(context, /partial === false/);
  assert.match(context, /La restauration complète n'est pas disponible/);
});
