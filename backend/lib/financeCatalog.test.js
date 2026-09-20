"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  foldPaymentStudentOptions,
  resolveCatalogPaymentMethods,
  buildFinanceCatalog,
  CANONICAL_PAYMENT_METHODS,
} = require("./financeCatalog");

test("foldPaymentStudentOptions accepte le roster canonique active + enrolled", () => {
  const rows = foldPaymentStudentOptions([
    {
      student_id: "esther",
      student_code: "CD-2026-0001-STU-ESTHER",
      first_name: "Esther",
      last_name: "OKITO",
      student_status: "active",
      enrollment_status: "enrolled",
      class_id: "c-1pa",
      class_code: "1PA",
      class_name: "1ère Primaire A",
    },
    {
      student_id: "esther",
      student_code: "CD-2026-0001-STU-ESTHER",
      first_name: "Esther",
      last_name: "OKITO",
      student_status: "active",
      enrollment_status: "transferred",
      class_id: "c-old",
      class_code: "OLD",
      class_name: "Ancienne",
    },
    {
      student_id: "awa",
      student_code: "STU-AWA",
      first_name: "Awa",
      last_name: "Diop",
      student_status: "active",
      enrollment_status: "active",
      class_id: "c-6a",
      class_code: "6A",
      class_name: "6ème A",
    },
    {
      student_id: "upper",
      student_code: "STU-UP",
      first_name: "Noah",
      last_name: "Upper",
      student_status: "active",
      enrollment_status: "ENROLLED",
      class_id: "c-up",
      class_code: "UP",
      class_name: "Upper",
    },
    {
      student_id: "dead-enr",
      student_code: "STU-ARCH",
      first_name: "Marc",
      last_name: "Archived",
      student_status: "active",
      enrollment_status: "archived",
      class_id: "c-arch",
      class_code: "AR",
      class_name: "Archivée",
    },
    {
      student_id: "inact-enr",
      student_code: "STU-IN",
      first_name: "Lina",
      last_name: "Inactive",
      student_status: "active",
      enrollment_status: "inactive",
      class_id: "c-in",
      class_code: "IN",
      class_name: "Inactive",
    },
  ]);
  assert.equal(rows.some((row) => row.studentCode === "CD-2026-0001-STU-ESTHER"), true);
  const esther = rows.find((row) => row.studentCode === "CD-2026-0001-STU-ESTHER");
  assert.equal(esther.classes.length, 1);
  assert.equal(esther.classCode, "1PA");
  assert.equal(rows.some((row) => row.studentCode === "STU-AWA"), true);
  assert.equal(rows.some((row) => row.studentCode === "STU-UP"), true);
  assert.equal(rows.some((row) => row.studentCode === "STU-ARCH"), false);
  assert.equal(rows.some((row) => row.studentCode === "STU-IN"), false);
});

test("foldPaymentStudentOptions déduplique, ignore sans inscription, trie", () => {
  const rows = foldPaymentStudentOptions([
    {
      student_id: "bbbb",
      student_code: "STU-B",
      first_name: "Zoé",
      last_name: "Zola",
      student_status: "active",
      enrollment_status: "active",
      class_id: "c1",
      class_code: "C1",
      class_name: "1ère",
    },
    {
      student_id: "aaaa",
      student_code: "STU-A",
      first_name: "Ada",
      last_name: "Lovelace",
      student_status: "active",
      enrollment_status: "active",
      class_id: "c2",
      class_code: "C2",
      class_name: "2ème",
    },
    {
      student_id: "aaaa",
      student_code: "STU-A",
      first_name: "Ada",
      last_name: "Lovelace",
      student_status: "active",
      enrollment_status: "active",
      class_id: "c3",
      class_code: "C3",
      class_name: "3ème",
    },
    {
      student_id: "dead",
      student_code: "STU-X",
      first_name: "Inactif",
      last_name: "X",
      student_status: "inactive",
      enrollment_status: "active",
      class_id: "c9",
      class_code: "C9",
      class_name: "X",
    },
    {
      student_id: "none",
      student_code: "STU-N",
      first_name: "Sans",
      last_name: "Classe",
      student_status: "active",
      enrollment_status: "active",
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].studentCode, "STU-A");
  assert.equal(rows[0].classes.length, 2);
  assert.equal(rows[1].studentCode, "STU-B");
  assert.equal(rows.some((row) => row.studentCode === "STU-X"), false);
});

test("catalogue méthodes : défauts canoniques si aucune ligne persistée", () => {
  const empty = resolveCatalogPaymentMethods([]);
  assert.equal(empty.length, CANONICAL_PAYMENT_METHODS.length);
  assert.equal(empty.every((row) => row.persisted === false), true);
  const saved = resolveCatalogPaymentMethods([
    { method_code: "cash", label: "Espèces", is_active: true, sort_order: 1 },
  ]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].persisted, true);
});

test("buildFinanceCatalog diffère réductions/pénalités", () => {
  const catalog = buildFinanceCatalog({
    currency: "cdf",
    currencySource: "country",
    paymentMethods: [],
    feeTypes: [],
  });
  assert.equal(catalog.currency, "CDF");
  assert.equal(catalog.discountsDeferred, true);
  assert.equal(catalog.penaltiesDeferred, true);
  assert.ok(catalog.feeTypeCatalog?.length);
  assert.equal(catalog.feeTypeCatalog.some((row) => row.code === "TUITION" && row.feeType === "Scolarité"), true);
  assert.equal(catalog.feeTypeCatalog.some((row) => row.feeType === "Acompte"), false);
  assert.equal(catalog.canonicalFeeTypes[0].code, catalog.feeTypeCatalog[0].code);
});

test("catalogue : devise absente n'est pas remplacée par CDF/USD/EUR", () => {
  const catalog = buildFinanceCatalog({ currency: "", currencySource: "country", paymentMethods: [], feeTypes: [] });
  assert.equal(catalog.currency, "");
});

test("catalogue types identique pour tout établissement (système, pas par tenant)", () => {
  const catalogA = buildFinanceCatalog({ currency: "CDF", currencySource: "country", paymentMethods: [], feeTypes: [] });
  const catalogB = buildFinanceCatalog({ currency: "USD", currencySource: "school", paymentMethods: [], feeTypes: [] });
  assert.deepEqual(catalogA.feeTypeCatalog, catalogB.feeTypeCatalog);
});
