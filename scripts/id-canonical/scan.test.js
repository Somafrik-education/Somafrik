"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const {
  REQUIRED_ENTITIES,
  ALLOWLIST_PREFIXES,
  FORBIDDEN_RUNTIME_ALLOWLIST_ROOTS,
  isAllowlisted,
  isForbiddenRuntimeAllowlistEntry,
} = require("./rules");
const { scanRepository, scanFile, loadEntityInventory, INVENTORY_RELATIVE } = require("./scan");

const ROOT = path.resolve(__dirname, "../..");

test("inventaire JSON couvre toutes les entités mandatées", () => {
  const inventory = loadEntityInventory(ROOT);
  assert.equal(inventory.ok, true, inventory.error || inventory.missingEntities.join(","));
  for (const name of REQUIRED_ENTITIES) {
    assert.ok(
      inventory.entities.some((row) => row.entity === name),
      `entité manquante: ${name}`,
    );
  }
});

test("allowlist couvre le contrat et le scanner, pas le runtime enseignant", () => {
  assert.equal(isAllowlisted("docs/audits/ID-CANONICAL-01A-INVENTAIRE-CONTRAT.md"), true);
  assert.equal(isAllowlisted("scripts/id-canonical/rules.js"), true);
  assert.equal(isAllowlisted("backend/lib/teacherCodeAllocation.js"), false);
  assert.equal(isAllowlisted("backend/lib/teachersLegacyCodeSchema.js"), false);
  assert.equal(isAllowlisted("backend/db/postgresRepository.js"), false);
  assert.equal(isAllowlisted("backend/data.js"), false);
});

test("aucun préfixe runtime ne peut entrer dans ALLOWLIST_PREFIXES", () => {
  for (const root of FORBIDDEN_RUNTIME_ALLOWLIST_ROOTS) {
    assert.equal(isForbiddenRuntimeAllowlistEntry(root), true, root);
    assert.equal(isForbiddenRuntimeAllowlistEntry(root.slice(0, -1)), true, root.slice(0, -1));
  }
  assert.equal(isForbiddenRuntimeAllowlistEntry("backend/lib/teachersLegacyCodeSchema.js"), true);
  assert.equal(isForbiddenRuntimeAllowlistEntry("web/src/lib/entityIdentifiers.ts"), true);
  assert.equal(isForbiddenRuntimeAllowlistEntry("Mobile/src/data/demoCredentials.ts"), true);
  assert.equal(isForbiddenRuntimeAllowlistEntry("apps/api/index.js"), true);
  assert.equal(isForbiddenRuntimeAllowlistEntry("packages/auth/src/index.js"), true);
  assert.equal(
    isForbiddenRuntimeAllowlistEntry("backend/db/migrations/20260819_teacher_legacy_code.sql"),
    false,
  );
  for (const prefix of ALLOWLIST_PREFIXES) {
    assert.equal(
      isForbiddenRuntimeAllowlistEntry(prefix),
      false,
      `préfixe runtime interdit dans ALLOWLIST_PREFIXES: ${prefix}`,
    );
  }
});

test("scanFile détecte les formats et helpers legacy, y compris en minuscules", () => {
  const sample = `
    const school = "CD-2026-0001";
    const schoolLower = "cd-2026-0001";
    const login = "ENS-0001";
    const loginLower = "ens-0001";
    const composite = "CD-2026-0001-ENS-0001";
    const compositeLower = "cd-2026-0001-ens-0001";
    const legacy_teacher_code = "ENS-0001";
    function isLegacyShortTeacherCode() {}
    const sql = sqlTeacherIdentityEquals("t", "u", "$2");
    await this.materializeBackOfficeTeacher(record);
    await this.collectTeacherLookupKeysForPrincipal(principal, schoolId);
  `;
  const findings = scanFile("backend/lib/fake-legacy.js", sample);
  const ids = new Set(findings.map((item) => item.ruleId));
  assert.ok(ids.has("LEGACY_SCHOOL_CODE_FORMAT"));
  assert.ok(ids.has("LEGACY_SHORT_TEACHER_LOGIN"));
  assert.ok(ids.has("LEGACY_COMPOSITE_TEACHER_CODE"));
  assert.ok(ids.has("LEGACY_TEACHER_CODE_COLUMN"));
  assert.ok(ids.has("LEGACY_SHORT_TEACHER_HELPER"));
  assert.ok(ids.has("TEACHER_SUFFIX_SQL"));
  assert.ok(ids.has("MATERIALIZE_BACKOFFICE_IDENTITY"));
  assert.ok(ids.has("COLLECT_TEACHER_LOOKUP_KEYS"));
  assert.ok(findings.some((item) => item.ruleId === "LEGACY_SCHOOL_CODE_FORMAT" && item.match === "cd-2026-0001"));
  assert.ok(findings.some((item) => item.ruleId === "LEGACY_SHORT_TEACHER_LOGIN" && item.match === "ens-0001"));
});

test("teacherCodeAllocation n'a plus de helper ENS", () => {
  const report = scanRepository({ root: ROOT, strict: false });
  const teacherHelper = report.findings.find(
    (item) => item.file === "backend/lib/teacherCodeAllocation.js" && item.ruleId === "LEGACY_SHORT_TEACHER_HELPER",
  );
  assert.equal(teacherHelper, undefined, "allocation enseignant Lot B ne doit plus exposer le helper ENS");
});

test("CLI rapport sort 0 ; --strict sort 1 sur une fixture avec résidu", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "id-canonical-cli-"));
  fs.mkdirSync(path.join(tmp, "docs/audits"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "backend/lib"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, INVENTORY_RELATIVE), path.join(tmp, INVENTORY_RELATIVE));
  fs.writeFileSync(path.join(tmp, "backend/lib/legacy-fixture.js"), 'const school = "CD-2026-0001";\n');

  const cli = path.join(ROOT, "scripts/verify-id-canonical.js");
  const report = spawnSync(process.execPath, [cli, `--root=${tmp}`], { encoding: "utf8" });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /ID-CANONICAL-01/);
  assert.match(report.stdout, /inventaire OK/);
  assert.match(report.stdout, /bloquants=1/);

  const strict = spawnSync(process.execPath, [cli, "--strict", `--root=${tmp}`], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /résidu/);
});

test("inventaire incomplet échoue même en mode rapport", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "id-canonical-"));
  fs.mkdirSync(path.join(tmp, "docs/audits"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "backend"), { recursive: true });
  fs.writeFileSync(path.join(tmp, INVENTORY_RELATIVE), JSON.stringify({ entities: [] }));
  const report = scanRepository({ root: tmp, strict: false });
  assert.equal(report.inventory.ok, false);
  assert.ok(report.inventory.missingEntities.includes("Teacher"));
});
