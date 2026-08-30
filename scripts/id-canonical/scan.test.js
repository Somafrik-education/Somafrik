"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { REQUIRED_ENTITIES, isAllowlisted } = require("./rules");
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
  assert.equal(isAllowlisted("backend/db/postgresRepository.js"), false);
  assert.equal(isAllowlisted("backend/data.js"), false);
});

test("scanFile détecte les formats et helpers legacy", () => {
  const sample = `
    const school = "CD-2026-0001";
    const login = "ENS-0001";
    const composite = "CD-2026-0001-ENS-0001";
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
});

test("le dépôt actuel expose encore des résidus runtime hors allowlist", () => {
  const report = scanRepository({ root: ROOT, strict: false });
  assert.ok(report.summary.blocking > 0, "Lot A attend des résidus — le chantier n'est pas fini");
  const teacherHelper = report.findings.find(
    (item) => item.file === "backend/lib/teacherCodeAllocation.js" && item.ruleId === "LEGACY_SHORT_TEACHER_HELPER",
  );
  assert.ok(teacherHelper, "teacherCodeAllocation.js doit encore apparaître dans l'inventaire");
});

test("CLI rapport sort 0 ; --strict sort 1 tant que des résidus existent", () => {
  const cli = path.join(ROOT, "scripts/verify-id-canonical.js");
  const report = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /ID-CANONICAL-01/);
  assert.match(report.stdout, /inventaire OK/);

  const strict = spawnSync(process.execPath, [cli, "--strict"], { encoding: "utf8" });
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
