"use strict";

/**
 * BULLETIN-SEC-01 — périmètre du bulletin historique (fonction pure) et
 * identité / logo de l'établissement propriétaire dans le HTML du bulletin.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const QRCode = require("qrcode");
const {
  BULLETIN_SCHOOL_UNRESOLVED,
  buildStudentBulletinScope,
  bulletinSchoolIdentity,
  isPublishedBulletinGrade,
  resolveOwnerSchool,
} = require("./studentBulletinScope");
const { GradeBookService } = require("../services/gradeBookService");
const { saveSchoolLogo } = require("./schoolLogo");
const { renderReportCardPreviewHtml } = require("../services/bulletinPdfRenderer");

const SCHOOL_A = { id: "11111111-1111-4111-8111-111111111111", code: "CD-2026-0001", loginCode: "CD-ALP-26-001", name: "Lycée Alpha" };
const SCHOOL_B = { id: "22222222-2222-4222-8222-222222222222", code: "BI-2026-0001", loginCode: "BI-BET-26-001", name: "Lycée Beta" };

function pgNote(studentId, schoolId, value, publication = {}) {
  return {
    studentId,
    schoolId,
    subject: "Mathématiques",
    period: "Trimestre 1",
    value,
    score: value,
    scale: 20,
    coefficient: 1,
    evaluationCoefficient: 1,
    gradeStatus: "graded",
    bulletinPublication: { publicationStatus: "published", hasEvaluation: true, evaluationStatus: "published", evaluationActive: true, ...publication },
  };
}

test("règle de publication : publiée, héritée publiée incluses ; brouillon, inactive, inconnue, non publiée exclues", () => {
  const published = { publicationStatus: "published", hasEvaluation: true, evaluationStatus: "published", evaluationActive: true };
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: published }), true);
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: { publicationStatus: "published", hasEvaluation: false } }), true, "note héritée publiée (règle LOT 9)");
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: { ...published, evaluationStatus: "draft" } }), false);
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: { ...published, evaluationStatus: "locked" } }), false, "verrouillée ≠ publiée");
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: { ...published, evaluationActive: false } }), false);
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: { ...published, evaluationStatus: null } }), false, "statut inconnu : exclue");
  assert.equal(isPublishedBulletinGrade({ bulletinPublication: { ...published, publicationStatus: "draft" } }), false);
  // Dépôt mémoire : statut lu dans la liste des évaluations, inconnu = exclu.
  const evaluations = new Map([["E-PUB", { id: "E-PUB", status: "Publiée" }], ["E-DRAFT", { id: "E-DRAFT", status: "Brouillon" }]]);
  assert.equal(isPublishedBulletinGrade({ evaluationId: "E-PUB" }, evaluations), true);
  assert.equal(isPublishedBulletinGrade({ evaluationId: "E-DRAFT" }, evaluations), false);
  assert.equal(isPublishedBulletinGrade({ evaluationId: "E-ABSENTE" }, evaluations), false);
  assert.equal(isPublishedBulletinGrade({}, evaluations), true, "note sans évaluation, publiée par défaut");
});

test("établissement propriétaire : UUID prioritaire ; code ambigu ou absent ⇒ introuvable", () => {
  assert.equal(resolveOwnerSchool([SCHOOL_A, SCHOOL_B], { schoolId: SCHOOL_B.id, schoolCode: SCHOOL_A.code }), SCHOOL_B);
  assert.equal(resolveOwnerSchool([SCHOOL_A, SCHOOL_B], { schoolCode: "bi-bet-26-001" }), SCHOOL_B);
  assert.equal(resolveOwnerSchool([SCHOOL_A, { ...SCHOOL_B, code: SCHOOL_A.code }], { schoolCode: SCHOOL_A.code }), null);
  assert.equal(resolveOwnerSchool([SCHOOL_A], { schoolId: SCHOOL_B.id }), null);
  assert.equal(resolveOwnerSchool([SCHOOL_A], {}), null);
});

test("échec sécurisé : aucun bulletin si l'établissement propriétaire est introuvable", () => {
  assert.throws(
    () => buildStudentBulletinScope({ student: { id: "S1", schoolId: SCHOOL_B.id }, schools: [SCHOOL_A], students: [], notes: [] }),
    (error) => error.statusCode === 409 && error.code === BULLETIN_SCHOOL_UNRESOLVED,
  );
});

test("cohorte : même établissement et même classe (identifiant), homonymes et archivés exclus", () => {
  const student = { id: "ALICE", schoolId: SCHOOL_A.id, className: "6ème A", classId: "A1" };
  const scope = buildStudentBulletinScope({
    student,
    schools: [SCHOOL_A],
    classId: "A1",
    students: [
      student,
      { id: "AMIR", schoolId: SCHOOL_A.id, className: "6ème A", classId: "A1" },
      { id: "ARCHIVE", schoolId: SCHOOL_A.id, className: "6ème A", classId: "A1", archived: true },
      { id: "ASTRID", schoolId: SCHOOL_A.id, className: "6ème A", classId: "A2" },
      { id: "BENOIT", schoolId: SCHOOL_B.id, className: "6ème A", classId: "A1" },
    ],
    notes: [
      pgNote("ALICE", SCHOOL_A.id, 12),
      pgNote("ALICE", SCHOOL_A.id, 2, { evaluationStatus: "draft" }),
      pgNote("AMIR", SCHOOL_A.id, 10),
      pgNote("ASTRID", SCHOOL_A.id, 19),
      pgNote("ALICE", SCHOOL_B.id, 20),
    ],
  });
  assert.deepEqual(scope.students.map((row) => row.id), ["ALICE", "AMIR"]);
  assert.equal(scope.students[0], student, "l'objet élève vérifié est conservé");
  assert.deepEqual(scope.notes.map((row) => row.value), [12, 10]);
  const report = new GradeBookService({ students: scope.students, notes: scope.notes, courses: [] }).generateReport("ALICE");
  assert.equal(report.averageDisplay, "12.00");
  assert.equal(report.rankLabel, "1e / 2");
});

test("dépôt mémoire (sans identifiant de classe) : nom de classe limité à l'établissement", () => {
  const student = { id: "1", schoolCode: "CD-2026-0001", className: "6ème A" };
  const scope = buildStudentBulletinScope({
    student,
    schools: [SCHOOL_A, SCHOOL_B],
    students: [
      student,
      { id: "2", schoolCode: "CD-2026-0001", className: "6ème A" },
      { id: "3", schoolCode: "BI-2026-0001", className: "6ème A" },
    ],
    notes: [
      { studentId: "1", schoolCode: "CD-2026-0001", subject: "Maths", period: "Trimestre 1", value: 14, scale: 20 },
      { studentId: "1", schoolCode: "BI-2026-0001", subject: "Maths", period: "Trimestre 1", value: 3, scale: 20 },
      { studentId: "3", schoolCode: "BI-2026-0001", subject: "Maths", period: "Trimestre 1", value: 20, scale: 20 },
    ],
  });
  assert.equal(scope.school, SCHOOL_A);
  assert.deepEqual(scope.students.map((row) => row.id), ["1", "2"]);
  assert.deepEqual(scope.notes.map((row) => row.value), [14], "note d'un homonyme d'identifiant dans l'autre école exclue");
});

test("identité et logo imprimés : ceux de l'établissement propriétaire uniquement", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bulletin-sec-01-logo-"));
  const previous = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = root;
  try {
    const withLogo = async (school, label) => {
      const png = await QRCode.toBuffer(label, { width: 96 });
      const saved = await saveSchoolLogo({ school, buffer: png, fileName: "logo.png", mimeType: "image/png" });
      return {
        school: { ...school, logoUrl: saved.storageKey, logoSource: "school_upload", logoUploadedAt: "2026-11-02T00:00:00.000Z" },
        base64: png.toString("base64"),
      };
    };
    const a = await withLogo(SCHOOL_A, "logo-alpha");
    const b = await withLogo(SCHOOL_B, "logo-beta");
    const student = { id: "BENOIT", schoolId: SCHOOL_B.id, className: "6ème A" };
    const scope = buildStudentBulletinScope({
      student,
      schools: [a.school, b.school],
      classId: "B1",
      students: [student],
      notes: [pgNote("BENOIT", SCHOOL_B.id, 18)],
    });
    assert.equal(scope.school.id, SCHOOL_B.id);
    assert.deepEqual(bulletinSchoolIdentity(scope.school), { code: "BI-2026-0001", name: "Lycée Beta" });
    const report = new GradeBookService({ students: scope.students, notes: scope.notes, courses: [] }).generateReport("BENOIT");
    const html = await renderReportCardPreviewHtml({ ...report, design: { showQrCode: false } }, scope.school);
    assert.match(html, /Lycée Beta/);
    assert.match(html, /BI-2026-0001/);
    assert.ok(html.includes(b.base64), "logo de l'établissement propriétaire incorporé");
    assert.ok(!html.includes(a.base64), "aucun logo d'un autre établissement");
    assert.doesNotMatch(html, /Lycée Alpha|CD-2026-0001/);
  } finally {
    if (previous === undefined) delete process.env.SOMAFRIK_COMMUNICATION_STORAGE;
    else process.env.SOMAFRIK_COMMUNICATION_STORAGE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
