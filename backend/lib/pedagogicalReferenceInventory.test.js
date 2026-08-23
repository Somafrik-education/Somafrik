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
  publicTargetLabel,
  sanitizeInventoryForPublication,
  containsOperationalIdentifiers,
  containsPublishedDatabaseInfrastructure,
  assertProofPathAllowed,
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
  const row = classifyStreamRow({ name: "Bio-chimie", stream_type: "filiere", country_code: "CD" });
  assert.equal(row.currentType, "filiere");
  assert.equal(row.ambiguous, true);
  assert.equal(row.stop, true);
  assert.match(row.proposedClassification, /option/i);
});

test("hypothèse Bio-chimie → option uniquement si country_code=CD", () => {
  const cd = classifyStreamRow({ name: "Bio-chimie", stream_type: "filiere", country_code: "CD" });
  const sn = classifyStreamRow({ name: "Bio-chimie", stream_type: "filiere", country_code: "SN" });
  const unknown = classifyStreamRow({ name: "Bio-chimie", stream_type: "filiere" });
  assert.equal(cd.hypothesisApplies, true);
  assert.match(cd.proposedClassification, /option/i);
  assert.equal(sn.hypothesisApplies, false);
  assert.doesNotMatch(sn.proposedClassification, /option/i);
  assert.match(sn.proposedClassification, /aucune hypothèse nationale RDC/);
  assert.equal(unknown.hypothesisApplies, false);
  assert.match(unknown.proposedClassification, /pays inconnu/);
});

test("Scientifique → section RDC seulement pour CD, pas pour CI", () => {
  const cd = classifyStreamRow({ name: "Scientifique", stream_type: "filiere", country_code: "CD" });
  const ci = classifyStreamRow({ name: "Scientifique", stream_type: "serie", country_code: "CI" });
  assert.match(cd.proposedClassification, /section/i);
  assert.doesNotMatch(ci.proposedClassification, /section/i);
  assert.match(ci.proposedClassification, /aucune hypothèse nationale RDC/);
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
  const cd = classifyGroupRow({ group_code: "CATH", name: "Confession catholique", country_code: "CD" });
  const sn = classifyGroupRow({ group_code: "CATH", name: "Confession catholique", country_code: "SN" });
  assert.equal(cd.stop, true);
  assert.equal(cd.ambiguous, true);
  assert.match(cd.proposedClassification, /hors Groupe/i);
  assert.match(cd.proposedClassification, /RDC/);
  assert.equal(sn.stop, true);
  assert.doesNotMatch(sn.proposedClassification, /\(RDC\)/);
  assert.match(sn.proposedClassification, /Ne pas appliquer le régime de gestion RDC/);
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
  const md = formatMarkdownReport(report, {
    generatedAt: "2026-08-23T00:00:00.000Z",
    source: "DATABASE_URL",
    databaseUrlRedacted: "postgresql://***@localhost/somafrik",
  });
  assert.match(md, /Verdict classification : \*\*STOP\*\*/);
  assert.match(md, /Cible : DATABASE_URL/);
  assert.match(md, /Générale/);
  assert.match(md, /Confession catholique/);
  assert.match(md, /oui — STOP/);
  assert.match(md, /Aucune écriture SQL/);
  assert.doesNotMatch(md, /postgresql:/i);
  assert.doesNotMatch(md, /localhost/);
  assert.doesNotMatch(md, /somafrik/);
});

test("normalizeName est accent-insensible", () => {
  assert.equal(normalizeName("Générale"), normalizeName("Generale"));
  assert.equal(normalizeName("Bio-Chimie"), "bio chimie");
});

test("publication : aucun school_code / class_code / school_name", () => {
  const report = buildInventoryReport({
    streams: [{ id: "s1", name: "Bio-chimie", stream_type: "filiere", country_code: "CD" }],
    groups: [{ id: "g1", group_code: "CATH", name: "Confession catholique", country_code: "CD" }],
    classes: [{ stream_id: "s1", group_id: "g1", school_code: "CD-IN-26-001" }],
    schoolStreams: [{ stream_id: "s1", school_code: "CD-IN-26-001", school_name: "Lycée Test" }],
    schoolGroups: [],
    classesWithNullGroup: 1,
    nullGroupStructuralDuplicates: [
      {
        country_code: "CD",
        school_code: "CD-IN-26-001",
        academic_year_name: "2026-2027",
        level_name: "3ème",
        stream_name: "Bio-chimie",
        duplicate_count: 2,
        class_codes: ["CLS-1", "CLS-2"],
      },
    ],
  });
  const published = sanitizeInventoryForPublication(report);
  assert.equal(published.identifiersRedacted, true);
  assert.equal(containsOperationalIdentifiers(published), false);
  assert.equal(containsPublishedDatabaseInfrastructure(published), false);
  assert.equal(published.target.source, "ABSENT");
  assert.equal(published.target.databaseUrlRedacted, undefined);
  assert.equal(published.matrix[0].establishmentCount, 1);
  assert.equal(published.matrix[0].establishments, undefined);
  const md = formatMarkdownReport(published, { generatedAt: "2026-08-23T00:00:00.000Z" });
  assert.doesNotMatch(md, /CD-IN-26-001/);
  assert.doesNotMatch(md, /CLS-1/);
  assert.doesNotMatch(md, /Lycée Test/);
  assert.match(md, /Cible : ABSENT/);
});

test("publication : cible = label env, aucun host ni nom de base", () => {
  assert.equal(publicTargetLabel("PREPROD_DATABASE_URL"), "PREPROD_DATABASE_URL");
  assert.equal(publicTargetLabel("DATABASE_URL"), "DATABASE_URL");
  assert.equal(publicTargetLabel("postgresql://user:secret@db-preprod.internal/somafrik_preprod"), "ABSENT");
  assert.equal(publicTargetLabel(""), "ABSENT");

  const leakyHost = "db-preprod.internal.example";
  const leakyDatabase = "somafrik_preprod";
  const leakyUrl = `postgresql://***@${leakyHost}/${leakyDatabase}`;
  const report = buildInventoryReport({
    streams: [{ id: "s1", name: "Bio-chimie", stream_type: "filiere", country_code: "CD" }],
    groups: [],
    classes: [],
    schoolStreams: [],
    schoolGroups: [],
    classesWithNullGroup: 0,
    nullGroupStructuralDuplicates: [],
  });
  const leaky = {
    ...report,
    target: {
      source: "PREPROD_DATABASE_URL",
      databaseUrlRedacted: leakyUrl,
    },
  };
  const published = sanitizeInventoryForPublication(leaky);
  const md = formatMarkdownReport(published, {
    generatedAt: "2026-08-23T00:00:00.000Z",
    source: "PREPROD_DATABASE_URL",
    databaseUrlRedacted: leakyUrl,
  });
  const publishedJson = JSON.stringify(published);

  assert.deepEqual(published.target, { source: "PREPROD_DATABASE_URL" });
  assert.equal(published.target.databaseUrlRedacted, undefined);
  assert.match(md, /Cible : PREPROD_DATABASE_URL/);
  assert.equal(containsPublishedDatabaseInfrastructure(published), false);
  assert.equal(containsPublishedDatabaseInfrastructure(md), false);
  assert.equal(containsPublishedDatabaseInfrastructure(publishedJson), false);
  for (const surface of [publishedJson, md]) {
    assert.doesNotMatch(surface, /postgresql:/i);
    assert.doesNotMatch(surface, /databaseUrlRedacted/);
    assert.doesNotMatch(surface, new RegExp(leakyHost.replace(/\./g, "\\.")));
    assert.doesNotMatch(surface, new RegExp(leakyDatabase));
    assert.doesNotMatch(surface, /@/);
  }
  assert.equal(containsPublishedDatabaseInfrastructure({ target: { databaseUrlRedacted: leakyUrl } }), true);
  assert.equal(containsPublishedDatabaseInfrastructure(`Cible : ${leakyUrl}`), true);
});

test("PROOF_OUT sous docs/audits/evidence ou dans le repo est refusé", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  assert.throws(
    () => assertProofPathAllowed(path.join(repoRoot, "docs/audits/evidence/pedagogical-reference-inventory.json"), repoRoot),
    /docs\/audits\/evidence/,
  );
  assert.throws(
    () => assertProofPathAllowed(path.join(repoRoot, "tmp-inventory.json"), repoRoot),
    /dépôt Git/,
  );
  assert.doesNotThrow(() => assertProofPathAllowed("/tmp/pedagogical-reference-inventory.json", repoRoot));
});
