"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALL_INVENTORY_SQL,
  normalizeName,
  matchStreamWatch,
  matchGroupWatch,
  looksLikeClassDivision,
  classifyStreamRow,
  classifyGroupRow,
  buildMatrix,
  buildInventoryReport,
  formatMarkdownReport,
  assertSelectOnlySql,
  assertInventorySqlIsSelectOnly,
  assertNoWriteFlags,
} = require("./pedagogicalReferenceInventory");

test("tous les SQL d'inventaire sont SELECT-only", () => {
  assertInventorySqlIsSelectOnly();
  for (const sql of ALL_INVENTORY_SQL) {
    assert.match(sql, /\bSELECT\b/i);
    assert.doesNotThrow(() => assertSelectOnlySql(sql));
  }
  const standalone = fs.readFileSync(
    path.join(__dirname, "../db/inventory_pedagogical_reference.sql"),
    "utf8",
  );
  assert.doesNotThrow(() => assertSelectOnlySql(standalone));
  assert.match(standalone, /BEGIN READ ONLY/);
});

test("assertSelectOnlySql refuse un UPDATE", () => {
  assert.throws(() => assertSelectOnlySql("UPDATE education_streams SET stream_type = 'option'"), /écriture/);
});

test("drapeaux d'écriture refusés", () => {
  assert.throws(() => assertNoWriteFlags(["node", "script", "--apply"], {}), /écriture refusé/);
  assert.throws(
    () => assertNoWriteFlags(["node", "script"], { SOMAFRIK_PEDAGOGICAL_BACKFILL: "1" }),
    /BACKFILL/,
  );
  assert.doesNotThrow(() => assertNoWriteFlags(["node", "script"], {}));
});

test("watchlist streams : Bio-chimie / Math-Physique / Scientifique / Sciences / Générale", () => {
  assert.equal(matchStreamWatch("Bio-Chimie")?.id, "biochimie");
  assert.equal(matchStreamWatch("Biochimie")?.id, "biochimie");
  assert.equal(matchStreamWatch("Math-Physique")?.id, "math-physique");
  assert.equal(matchStreamWatch("Scientifique")?.id, "scientifique");
  assert.equal(matchStreamWatch("Sciences")?.id, "sciences");
  assert.equal(matchStreamWatch("Générale")?.id, "generale");
  assert.equal(matchStreamWatch("Commerciale"), null);
});

test("watchlist groupes : Confession / Catholique / Protestant / Conventionné / Officiel", () => {
  assert.equal(matchGroupWatch("Confession catholique", "CC")?.id, "confession");
  assert.equal(matchGroupWatch("Catholique", "CATH")?.id, "catholique");
  assert.equal(matchGroupWatch("Réseau protestant", "PROT")?.id, "protestant");
  assert.equal(matchGroupWatch("Conventionné", "CONV")?.id, "conventionne");
  assert.equal(matchGroupWatch("Non conventionné", "NC")?.id, "conventionne");
  assert.equal(matchGroupWatch("Officiel", "OFF")?.id, "officiel");
  assert.equal(matchGroupWatch("Groupe A", "A"), null);
});

test("classification stream signalée = toujours ambiguë / STOP", () => {
  const row = classifyStreamRow({ name: "Bio-chimie", stream_type: "filiere" });
  assert.equal(row.currentType, "filiere");
  assert.equal(row.ambiguous, true);
  assert.equal(row.stop, true);
  assert.match(row.proposedClassification, /option/i);
});

test("Générale et Sciences restent STOP — pas de mapping silencieux", () => {
  assert.equal(classifyStreamRow({ name: "Générale", stream_type: "filiere" }).stop, true);
  assert.equal(classifyStreamRow({ name: "Sciences", stream_type: "filiere" }).stop, true);
});

test("groupe A/B est une division locale, pas STOP", () => {
  assert.equal(looksLikeClassDivision({ group_code: "A", name: "A" }), true);
  assert.equal(looksLikeClassDivision({ group_code: "B", name: "Groupe B" }), true);
  const row = classifyGroupRow({ group_code: "A", name: "A" });
  assert.equal(row.ambiguous, false);
  assert.equal(row.stop, false);
});

test("Confession catholique est STOP et hors domaine Groupe", () => {
  const row = classifyGroupRow({ group_code: "CATH", name: "Confession catholique" });
  assert.equal(row.stop, true);
  assert.equal(row.ambiguous, true);
  assert.match(row.proposedClassification, /hors Groupe/i);
});

test("matrice agrège classes et établissements, sans corriger le type", () => {
  const matrix = buildMatrix({
    streams: [
      {
        id: "s1",
        name: "Bio-chimie",
        stream_type: "filiere",
        country_code: "CD",
      },
    ],
    groups: [
      { id: "g1", group_code: "CATH", name: "Confession catholique", country_code: "CD" },
      { id: "g2", group_code: "A", name: "A", country_code: "CD" },
    ],
    classes: [
      { stream_id: "s1", group_id: "g1", school_code: "CD-IN-26-001" },
      { stream_id: "s1", group_id: "g2", school_code: "CD-IN-26-002" },
    ],
    schoolStreams: [{ stream_id: "s1", school_code: "CD-IN-26-001" }],
    schoolGroups: [{ group_id: "g1", school_code: "CD-IN-26-001" }],
  });

  const bio = matrix.find((row) => row.value === "Bio-chimie");
  assert.equal(bio.classCount, 2);
  assert.deepEqual(bio.establishments, ["CD-IN-26-001", "CD-IN-26-002"]);
  assert.equal(bio.currentType, "filiere");
  assert.equal(bio.stop, true);

  const confession = matrix.find((row) => /confession/i.test(row.value));
  assert.ok(confession);
  assert.equal(confession.classCount, 1);
  assert.equal(confession.stop, true);

  const letterA = matrix.find((row) => row.value === "A");
  assert.equal(letterA, undefined, "les divisions A/B/C hors signalement ne polluent pas la matrice STOP");
});

test("rapport : STOP si une valeur signalée, unicité NULL documentée", () => {
  const report = buildInventoryReport({
    streams: [{ id: "s1", name: "Scientifique", stream_type: "filiere", country_code: "CD" }],
    groups: [],
    classes: [],
    schoolStreams: [],
    schoolGroups: [],
    classesWithNullGroup: 3,
    nullGroupStructuralDuplicates: [
      { school_code: "CD-1", academic_year_name: "2026-2027", level_name: "3ème", stream_name: "Scientifique", duplicate_count: 2, class_codes: ["CLS-1", "CLS-2"] },
    ],
  });
  assert.equal(report.classificationVerdict, "STOP");
  assert.equal(report.autoMutation, false);
  assert.equal(report.uniqueness.classesWithNullGroup, 3);
  assert.equal(report.uniqueness.nullGroupStructuralDuplicateGroups, 1);
  assert.match(report.uniqueness.note, /WHERE group_id IS NOT NULL/);
});

test("markdown contient la matrice et le mot STOP", () => {
  const report = buildInventoryReport({
    streams: [{ id: "s1", name: "Générale", stream_type: "filiere", country_code: "CD" }],
    groups: [{ id: "g1", group_code: "CC", name: "Confession catholique", country_code: "CD" }],
    classes: [],
    schoolStreams: [],
    schoolGroups: [],
    classesWithNullGroup: 0,
    nullGroupStructuralDuplicates: [],
  });
  const md = formatMarkdownReport(report, { generatedAt: "2026-08-23T00:00:00.000Z", databaseUrlRedacted: "postgresql://***@localhost/somafrik" });
  assert.match(md, /Verdict classification : \*\*STOP\*\*/);
  assert.match(md, /Générale/);
  assert.match(md, /Confession catholique/);
  assert.match(md, /oui — STOP/);
  assert.match(md, /Aucune écriture SQL/);
});

test("normalizeName est accent-insensible", () => {
  assert.equal(normalizeName("Générale"), normalizeName("Generale"));
  assert.equal(normalizeName("Bio-Chimie"), "bio chimie");
});
