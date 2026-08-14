"use strict";

const { randomUUID } = require("node:crypto");
const {
  DOCUMENTS_EXAMS_ERROR,
  asTrimmed,
  createDocumentsExamsError,
  canonicalizeExamStatus,
  parseIsoDate,
  validateTemplateLayout,
  mapExamRow,
  mapReportCardRow,
  mapTemplateRow,
  mapSchoolDocumentRow,
  classifyResidualExam,
  classifyResidualReportCard,
  classifyResidualDocument,
  ignoreClientScope,
  examStatusLabel,
} = require("../lib/documentsExamsManagement");

function createDocumentsExamsMemoryStore(seed = {}) {
  const schools = new Map();
  const exams = [];
  const reportCards = [];
  const templates = [];
  const documents = [];
  const residual = { exam: [], bulletin: [], document: [] };

  function rememberSchool(school) {
    const code = asTrimmed(school.code ?? school.schoolCode ?? school.school_code).toUpperCase();
    if (!code) return null;
    const entry = { id: school.id ?? randomUUID(), school_code: code };
    schools.set(code, entry);
    return entry;
  }

  for (const school of seed.schools ?? []) rememberSchool(school);
  if (seed.school) rememberSchool(seed.school);

  function schoolByCode(schoolCode) {
    return schools.get(asTrimmed(schoolCode).toUpperCase()) ?? null;
  }

  function notFound(label) {
    throw createDocumentsExamsError(404, `${label} introuvable.`, DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
  }

  return {
    registerSchool(school) {
      return rememberSchool(school);
    },
    async requireSchoolByCode(schoolCode) {
      const school = schoolByCode(schoolCode);
      if (!school) {
        throw createDocumentsExamsError(404, "Établissement introuvable.", DOCUMENTS_EXAMS_ERROR.SCHOOL_NOT_FOUND);
      }
      return school;
    },
    async listExams(schoolId) {
      return exams.filter((row) => row.school_id === schoolId).map((row) => mapExamRow(row, {
        schoolCode: row.school_code,
        className: row.class_name,
        subjectName: row.subject_name,
        termName: row.term_name,
        examDate: row.exam_date,
      }));
    },
    async getExam(schoolId, examId) {
      const row = exams.find((item) => item.id === examId && item.school_id === schoolId);
      if (!row) notFound("Examen");
      return mapExamRow(row, {
        schoolCode: row.school_code,
        className: row.class_name,
        subjectName: row.subject_name,
        termName: row.term_name,
        examDate: row.exam_date,
      });
    },
    async insertExam(schoolId, payload) {
      const body = ignoreClientScope(payload);
      const school = [...schools.values()].find((item) => item.id === schoolId);
      const name = asTrimmed(body.name);
      const examDate = parseIsoDate(body.date ?? body.examDate);
      if (!name) throw createDocumentsExamsError(400, "Intitulé d'examen obligatoire.");
      if (!examDate) throw createDocumentsExamsError(400, "Date d'examen obligatoire.");
      if (!asTrimmed(body.classId || body.className)) {
        throw createDocumentsExamsError(400, "Classe obligatoire.", DOCUMENTS_EXAMS_ERROR.CLASS_REQUIRED);
      }
      if (!asTrimmed(body.subjectId || body.subject)) {
        throw createDocumentsExamsError(400, "Matière obligatoire.", DOCUMENTS_EXAMS_ERROR.SUBJECT_REQUIRED);
      }
      if (!asTrimmed(body.termId || body.period)) {
        throw createDocumentsExamsError(400, "Période académique obligatoire.", DOCUMENTS_EXAMS_ERROR.TERM_REQUIRED);
      }
      const duplicate = exams.find(
        (row) =>
          row.school_id === schoolId &&
          row.class_name === asTrimmed(body.className) &&
          row.exam_date === examDate &&
          row.name.toLowerCase() === name.toLowerCase() &&
          row.status !== "archived",
      );
      if (duplicate) {
        throw createDocumentsExamsError(409, "Un examen identique existe déjà pour cette classe et cette date.", DOCUMENTS_EXAMS_ERROR.CONFLICT);
      }
      const row = {
        id: randomUUID(),
        school_id: schoolId,
        school_code: school?.school_code,
        class_id: body.classId || randomUUID(),
        class_name: asTrimmed(body.className),
        subject_id: body.subjectId || null,
        subject_name: asTrimmed(body.subject),
        term_id: body.termId || randomUUID(),
        term_name: asTrimmed(body.period),
        academic_year_id: body.academicYearId || randomUUID(),
        exam_code: asTrimmed(body.code) || `EXA-${randomUUID().slice(0, 8).toUpperCase()}`,
        name,
        exam_type: asTrimmed(body.examType ?? body.type) || "Examen",
        exam_date: examDate,
        starts_at: body.startsAt || null,
        ends_at: body.endsAt || null,
        status: canonicalizeExamStatus(body.status) || "scheduled",
        evaluation_type_id: body.evaluationTypeId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      exams.push(row);
      return this.getExam(schoolId, row.id);
    },
    async updateExam(schoolId, examId, payload) {
      const current = exams.find((item) => item.id === examId && item.school_id === schoolId);
      if (!current) notFound("Examen");
      const body = ignoreClientScope(payload);
      if (body.status) {
        const next = canonicalizeExamStatus(body.status);
        if (!next) throw createDocumentsExamsError(400, "Statut d'examen invalide.", DOCUMENTS_EXAMS_ERROR.INVALID_STATUS);
        current.status = next;
      }
      if (body.name) current.name = asTrimmed(body.name);
      current.updated_at = new Date().toISOString();
      return this.getExam(schoolId, examId);
    },
    async setExamStatus(schoolId, examId, status) {
      return this.updateExam(schoolId, examId, { status });
    },
    async listReportCards(schoolId) {
      return reportCards.filter((row) => row.school_id === schoolId).map((row) => mapReportCardRow(row, {
        schoolCode: row.school_code,
        studentName: row.student_name,
        className: row.class_name,
        termName: row.term_name,
        average: row.average,
      }));
    },
    async generateReportCard(schoolId, payload) {
      const body = ignoreClientScope(payload);
      const studentId = asTrimmed(body.studentId);
      if (!studentId) throw createDocumentsExamsError(400, "Élève obligatoire.", DOCUMENTS_EXAMS_ERROR.STUDENT_REQUIRED);
      if (!asTrimmed(body.termId || body.period)) {
        throw createDocumentsExamsError(400, "Période académique obligatoire.", DOCUMENTS_EXAMS_ERROR.TERM_REQUIRED);
      }
      const school = [...schools.values()].find((item) => item.id === schoolId);
      const existing = reportCards.find(
        (row) => row.school_id === schoolId && row.student_id === studentId && row.term_name === asTrimmed(body.period) && row.status !== "archived",
      );
      if (existing) return this.listReportCards(schoolId).then((rows) => rows.find((row) => row.id === existing.id));
      const row = {
        id: randomUUID(),
        school_id: schoolId,
        school_code: school?.school_code,
        student_id: studentId,
        student_name: asTrimmed(body.studentName),
        class_id: body.classId || null,
        class_name: asTrimmed(body.className),
        academic_year_id: body.academicYearId || randomUUID(),
        term_id: body.termId || randomUUID(),
        term_name: asTrimmed(body.period),
        status: "generated",
        average: null,
        generated_at: new Date().toISOString(),
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      reportCards.push(row);
      return mapReportCardRow(row, {
        schoolCode: row.school_code,
        studentName: row.student_name,
        className: row.class_name,
        termName: row.term_name,
      });
    },
    async setReportCardStatus(schoolId, cardId, status) {
      const row = reportCards.find((item) => item.id === cardId && item.school_id === schoolId);
      if (!row) notFound("Bulletin");
      row.status = status;
      if (status === "published") row.published_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      return mapReportCardRow(row, {
        schoolCode: row.school_code,
        studentName: row.student_name,
        className: row.class_name,
        termName: row.term_name,
        average: row.average,
      });
    },
    async listTemplates(schoolId) {
      return templates.filter((row) => row.school_id === schoolId).map((row) => mapTemplateRow(row, {
        schoolCode: row.school_code,
        className: row.class_name,
      }));
    },
    async upsertTemplate(schoolId, payload) {
      const body = ignoreClientScope(payload);
      const layout = validateTemplateLayout(body.layout ?? body);
      const school = [...schools.values()].find((item) => item.id === schoolId);
      const classId = body.classId || null;
      const existing = templates.find(
        (row) => row.school_id === schoolId && String(row.class_id) === String(classId) && row.template_type === (asTrimmed(body.templateType) || "bulletin") && row.status === "active",
      );
      if (existing) {
        existing.layout = layout;
        existing.version += 1;
        existing.updated_at = new Date().toISOString();
        return mapTemplateRow(existing, { schoolCode: school?.school_code, className: existing.class_name });
      }
      const row = {
        id: randomUUID(),
        school_id: schoolId,
        school_code: school?.school_code,
        class_id: classId,
        class_name: asTrimmed(body.className) || null,
        academic_year_id: body.academicYearId || null,
        template_type: asTrimmed(body.templateType) || "bulletin",
        layout,
        status: "active",
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      templates.push(row);
      return mapTemplateRow(row, { schoolCode: school?.school_code, className: row.class_name });
    },
    async getTemplate(schoolId, templateId) {
      const row = templates.find((item) => item.id === templateId && item.school_id === schoolId);
      if (!row) notFound("Modèle");
      return mapTemplateRow(row, { schoolCode: row.school_code, className: row.class_name });
    },
    async archiveTemplate(schoolId, templateId) {
      const row = templates.find((item) => item.id === templateId && item.school_id === schoolId);
      if (!row) notFound("Modèle");
      row.status = "archived";
      row.updated_at = new Date().toISOString();
      return mapTemplateRow(row, { schoolCode: row.school_code, className: row.class_name });
    },
    async listSchoolDocuments(schoolId) {
      return documents.filter((row) => row.school_id === schoolId).map((row) => mapSchoolDocumentRow(row, {
        schoolCode: row.school_code,
        studentName: row.student_name,
      }));
    },
    async insertSchoolDocument(schoolId, payload) {
      const body = ignoreClientScope(payload);
      const title = asTrimmed(body.title);
      if (!title) throw createDocumentsExamsError(400, "Titre de document obligatoire.");
      const school = [...schools.values()].find((item) => item.id === schoolId);
      const row = {
        id: randomUUID(),
        school_id: schoolId,
        school_code: school?.school_code,
        student_id: body.studentId || null,
        student_name: asTrimmed(body.studentName),
        document_type: asTrimmed(body.documentType) || "document",
        title,
        storage_key: asTrimmed(body.storageKey) || null,
        mime_type: asTrimmed(body.mimeType) || null,
        status: asTrimmed(body.status) || "available",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      documents.push(row);
      return mapSchoolDocumentRow(row, { schoolCode: row.school_code, studentName: row.student_name });
    },
    async updateSchoolDocument(schoolId, documentId, payload) {
      const row = documents.find((item) => item.id === documentId && item.school_id === schoolId);
      if (!row) notFound("Document");
      const body = ignoreClientScope(payload);
      if (body.title) row.title = asTrimmed(body.title);
      if (body.status) row.status = asTrimmed(body.status);
      row.updated_at = new Date().toISOString();
      return mapSchoolDocumentRow(row, { schoolCode: row.school_code, studentName: row.student_name });
    },
    async archiveSchoolDocument(schoolId, documentId) {
      return this.updateSchoolDocument(schoolId, documentId, { status: "archived" });
    },
    setResidual(domain, schoolCode, items) {
      residual[domain] = (items ?? []).map((item) => ({
        schoolCode: asTrimmed(schoolCode).toUpperCase(),
        payload: item,
      }));
    },
    async inventoryLegacyResidualRecords() {
      const examAmbiguous = [];
      const cardAmbiguous = [];
      const docAmbiguous = [];
      const inventory = [];
      for (const school of schools.values()) {
        const relationalExams = await this.listExams(school.id);
        const relationalCards = await this.listReportCards(school.id);
        const relationalDocuments = await this.listSchoolDocuments(school.id);
        const context = {
          classNames: relationalExams.map((row) => row.className).filter(Boolean),
          subjectNames: relationalExams.map((row) => row.subject).filter(Boolean),
          termNames: [...relationalExams, ...relationalCards].map((row) => row.period).filter(Boolean),
          relationalExams,
          relationalCards,
          relationalDocuments,
          studentIds: relationalCards.map((row) => row.studentId),
          studentCodes: [],
        };
        const examIssues = [];
        for (const item of residual.exam.filter((row) => row.schoolCode === school.school_code)) {
          const classified = classifyResidualExam(item.payload, context);
          if (classified.ambiguous) examIssues.push({ schoolCode: school.school_code, keys: classified.issues.map((issue) => issue.key) });
        }
        const cardIssues = [];
        for (const item of residual.bulletin.filter((row) => row.schoolCode === school.school_code)) {
          const classified = classifyResidualReportCard(item.payload, context);
          if (classified.ambiguous) cardIssues.push({ schoolCode: school.school_code, keys: classified.issues.map((issue) => issue.key) });
        }
        const docIssues = [];
        for (const item of residual.document.filter((row) => row.schoolCode === school.school_code)) {
          const classified = classifyResidualDocument(item.payload, context);
          if (classified.ambiguous) docIssues.push({ schoolCode: school.school_code, keys: classified.issues.map((issue) => issue.key) });
        }
        inventory.push({ schoolCode: school.school_code, examIssues, cardIssues, docIssues });
        examAmbiguous.push(...examIssues);
        cardAmbiguous.push(...cardIssues);
        docAmbiguous.push(...docIssues);
      }
      return { inventory, examAmbiguous, cardAmbiguous, docAmbiguous };
    },
    examStatusLabel,
  };
}

module.exports = {
  createDocumentsExamsMemoryStore,
};
