"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DOCUMENTS_EXAMS_ERROR,
  assertLegacyResidualWriteForbidden,
  classifyResidualExam,
  classifyResidualReportCard,
  classifyResidualDocument,
  validateTemplateLayout,
  canonicalizeExamStatus,
  ignoreClientScope,
} = require("./documentsExamsManagement");

test("assertLegacyResidualWriteForbidden refuse exam/bulletin/document", () => {
  const cases = [
    ["exam", DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_WRITE_FORBIDDEN],
    ["exams", DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_WRITE_FORBIDDEN],
    ["bulletin", DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_WRITE_FORBIDDEN],
    ["document", DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_WRITE_FORBIDDEN],
  ];
  for (const [domain, code] of cases) {
    assert.throws(() => assertLegacyResidualWriteForbidden(domain), (error) => error.code === code && error.statusCode === 400);
  }
});

test("canonicalizeExamStatus mappe les libellés legacy vers les statuts stables", () => {
  assert.equal(canonicalizeExamStatus("Programmé"), "scheduled");
  assert.equal(canonicalizeExamStatus("Publié"), "completed");
  assert.equal(canonicalizeExamStatus("published"), "completed");
  assert.equal(canonicalizeExamStatus("Validé"), "validated");
  assert.equal(canonicalizeExamStatus("inconnu"), null);
});

test("ignoreClientScope retire schoolId/schoolCode/tenantId du body", () => {
  const next = ignoreClientScope({
    schoolId: "other",
    schoolCode: "BI-2026-0002",
    tenantId: "x",
    countryCode: "BI",
    name: "Contrôle",
  });
  assert.equal(next.name, "Contrôle");
  assert.equal("schoolId" in next, false);
  assert.equal("schoolCode" in next, false);
  assert.equal("tenantId" in next, false);
  assert.equal("countryCode" in next, false);
});

test("validateTemplateLayout refuse les données métier dans le layout", () => {
  assert.throws(
    () => validateTemplateLayout({ grades: [{ score: 12 }] }),
    (error) => error.code === DOCUMENTS_EXAMS_ERROR.INVALID_LAYOUT,
  );
  const layout = validateTemplateLayout({
    reportTitle: "Bulletin",
    showRank: true,
    unknownKey: "drop",
  });
  assert.equal(layout.reportTitle, "Bulletin");
  assert.equal(layout.showRank, true);
  assert.equal("unknownKey" in layout, false);
});

test("classifyResidualExam STOP si JSON non équivalent", () => {
  const ambiguous = classifyResidualExam(
    { name: "Contrôle fantôme", className: "Classe inventée", subject: "Mathématiques", date: "2026-06-10" },
    {
      classNames: ["6ème A"],
      subjectNames: ["Mathématiques"],
      termNames: ["Trimestre 1"],
      relationalExams: [],
    },
  );
  assert.equal(ambiguous.ambiguous, true);
  assert.ok(ambiguous.issues.some((item) => item.code === DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS));
});

test("classifyResidualExam accepte une équivalence exacte", () => {
  const result = classifyResidualExam(
    { name: "Contrôle T1", className: "6ème A", subject: "Mathématiques", date: "2026-06-10", period: "Trimestre 1" },
    {
      classNames: ["6ème A"],
      subjectNames: ["Mathématiques"],
      termNames: ["Trimestre 1"],
      relationalExams: [
        { name: "Contrôle T1", className: "6ème A", subject: "Mathématiques", date: "2026-06-10" },
      ],
    },
  );
  assert.equal(result.ambiguous, false);
});

test("classifyResidualReportCard et document STOP si non appariés", () => {
  const card = classifyResidualReportCard(
    { studentId: "inconnu", period: "Trimestre 9" },
    { studentIds: ["stu-1"], termNames: ["Trimestre 1"], relationalCards: [] },
  );
  assert.equal(card.ambiguous, true);
  const doc = classifyResidualDocument({ title: "Attestation fantôme" }, { relationalDocuments: [] });
  assert.equal(doc.ambiguous, true);
});

test("classifyExamStatuses autorise published et refuse un statut inconnu", () => {
  const { classifyExamStatuses, DETERMINISTIC_EXAM_STATUS_ALIASES } = require("./documentsExamsManagement");
  assert.equal(DETERMINISTIC_EXAM_STATUS_ALIASES.published, "completed");
  assert.equal(classifyExamStatuses(["draft", "published", "validated"]).ambiguous, false);
  const unknown = classifyExamStatuses(["unknown-status", "pending_review", "scheduled"]);
  assert.equal(unknown.ambiguous, true);
  assert.deepEqual(unknown.unknown, ["unknown-status", "pending_review"]);
});

test("resolveBulletinDesignForStudent n'utilise plus academicConfigs JSON", () => {
  const { resolveBulletinDesignForStudent, readBulletinDesignFromConfig } = require("./bulletinDesignResolver");
  const state = {
    academicConfigs: {
      "CD-2026-0001": {
        bulletinDesignByClass: { "6ème A": { reportTitle: "JSON interdit" } },
      },
    },
  };
  assert.equal(resolveBulletinDesignForStudent(state, { schoolCode: "CD-2026-0001", className: "6ème A" }), null);
  assert.equal(readBulletinDesignFromConfig(state.academicConfigs["CD-2026-0001"], "6ème A"), null);
});
