"use strict";

const DOCUMENTS_EXAMS_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID_STATUS: "INVALID_STATUS",
  INVALID_LAYOUT: "INVALID_LAYOUT",
  ACADEMIC_YEAR_REQUIRED: "ACADEMIC_YEAR_REQUIRED",
  TERM_REQUIRED: "TERM_REQUIRED",
  CLASS_REQUIRED: "CLASS_REQUIRED",
  SUBJECT_REQUIRED: "SUBJECT_REQUIRED",
  STUDENT_REQUIRED: "STUDENT_REQUIRED",
  LEGACY_EXAMS_WRITE_FORBIDDEN: "LEGACY_EXAMS_WRITE_FORBIDDEN",
  LEGACY_REPORT_CARDS_WRITE_FORBIDDEN: "LEGACY_REPORT_CARDS_WRITE_FORBIDDEN",
  LEGACY_DOCUMENTS_WRITE_FORBIDDEN: "LEGACY_DOCUMENTS_WRITE_FORBIDDEN",
  LEGACY_EXAMS_AMBIGUOUS: "LEGACY_EXAMS_AMBIGUOUS",
  LEGACY_REPORT_CARDS_AMBIGUOUS: "LEGACY_REPORT_CARDS_AMBIGUOUS",
  LEGACY_DOCUMENTS_AMBIGUOUS: "LEGACY_DOCUMENTS_AMBIGUOUS",
  LEGACY_EXAM_STATUS_AMBIGUOUS: "LEGACY_EXAM_STATUS_AMBIGUOUS",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const EXAM_STATUSES = Object.freeze(["draft", "scheduled", "validated", "completed", "cancelled", "archived"]);
const DETERMINISTIC_EXAM_STATUS_ALIASES = Object.freeze({
  published: "completed",
});
const REPORT_CARD_STATUSES = Object.freeze(["draft", "generated", "published", "archived"]);
const DOCUMENT_STATUSES = Object.freeze(["available", "generating", "archived"]);
const TEMPLATE_LAYOUT_KEYS = Object.freeze([
  "className",
  "reportTitle",
  "reportSubtitle",
  "periodLabel",
  "enabledSubjects",
  "showRank",
  "showAppreciation",
  "showQrCode",
  "footerNote",
  "htmlTemplate",
  "cssTemplate",
  "grapesProject",
  "templateVersion",
]);
const FORBIDDEN_LAYOUT_KEYS = Object.freeze([
  "grades",
  "notes",
  "students",
  "attendance",
  "presences",
  "evaluations",
  "payments",
]);

const EXAM_STATUS_FROM_LABEL = Object.freeze({
  brouillon: "draft",
  draft: "draft",
  programme: "scheduled",
  programmé: "scheduled",
  scheduled: "scheduled",
  "en cours": "scheduled",
  valide: "validated",
  validé: "validated",
  validated: "validated",
  publie: "completed",
  publié: "completed",
  published: "completed",
  completed: "completed",
  termine: "completed",
  terminé: "completed",
  annule: "cancelled",
  annulé: "cancelled",
  cancelled: "cancelled",
  archive: "archived",
  archivé: "archived",
  archived: "archived",
});

const EXAM_STATUS_TO_LABEL = Object.freeze({
  draft: "Brouillon",
  scheduled: "Programmé",
  validated: "Validé",
  completed: "Publié",
  cancelled: "Annulé",
  archived: "Archivé",
});

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeLabel(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasOwn(payload, key) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, key);
}

function createDocumentsExamsError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code || DOCUMENTS_EXAMS_ERROR.FORBIDDEN;
  if (details) error.details = details;
  return error;
}

function isSuperAdminPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(asTrimmed(principal?.role));
}

function principalHasAnyPermission(principal, allowed) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  return allowed.some((key) => permissions.includes(key));
}

function ignoreClientScope(payload = {}) {
  const next = { ...(payload && typeof payload === "object" ? payload : {}) };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.countryCode;
  delete next.country;
  delete next.countryId;
  delete next.tenantId;
  return next;
}

function documentsExamsAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

function assertExamsRead(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = [
    "Examens:READ",
    "Organiser examens",
    "Valider examens",
    "Gérer cours",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Accès refusé aux examens.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertExamsWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Organiser examens", "Valider examens", "Examens:UPDATE", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Vous n'avez pas le droit de modifier les examens.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertExamsValidate(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Valider examens", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Vous n'avez pas le droit de valider les examens.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertReportCardsRead(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Bulletins:READ", "Valider bulletins", "Voir rapports", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Accès refusé aux bulletins.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertReportCardsWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Bulletins:UPDATE", "Valider bulletins", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Vous n'avez pas le droit de modifier les bulletins.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertDocumentsRead(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Documents:READ", "Valider bulletins", "Voir rapports", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Accès refusé aux documents.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertDocumentsWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Documents:UPDATE", "Valider bulletins", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Vous n'avez pas le droit de modifier les documents.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function assertTemplatesWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = ["Documents:UPDATE", "Conception bulletins", "ALL_PRIVILEGES"];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createDocumentsExamsError(403, "Vous n'avez pas le droit de modifier les modèles de bulletin.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
}

function canonicalizeExamStatus(value) {
  const key = normalizeLabel(value);
  return EXAM_STATUS_FROM_LABEL[key] || (EXAM_STATUSES.includes(asTrimmed(value)) ? asTrimmed(value) : null);
}

function classifyExamStatuses(statuses = []) {
  const unknown = [];
  for (const raw of statuses) {
    const status = asTrimmed(raw);
    if (!status) continue;
    if (EXAM_STATUSES.includes(status)) continue;
    if (Object.prototype.hasOwnProperty.call(DETERMINISTIC_EXAM_STATUS_ALIASES, status)) continue;
    unknown.push(status);
  }
  return { unknown, ambiguous: unknown.length > 0 };
}

function examStatusLabel(status) {
  return EXAM_STATUS_TO_LABEL[status] || status;
}

function parseIsoDate(value) {
  const text = asTrimmed(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

function validateTemplateLayout(layout) {
  if (layout == null) return {};
  if (typeof layout !== "object" || Array.isArray(layout)) {
    throw createDocumentsExamsError(400, "Le layout du modèle doit être un objet JSON.", DOCUMENTS_EXAMS_ERROR.INVALID_LAYOUT);
  }
  const next = {};
  for (const key of Object.keys(layout)) {
    if (FORBIDDEN_LAYOUT_KEYS.includes(key)) {
      throw createDocumentsExamsError(
        400,
        `Le layout ne peut pas contenir de données métier (${key}).`,
        DOCUMENTS_EXAMS_ERROR.INVALID_LAYOUT,
        { key },
      );
    }
    if (!TEMPLATE_LAYOUT_KEYS.includes(key)) continue;
    next[key] = layout[key];
  }
  return next;
}

function mapExamRow(row, extras = {}) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: extras.schoolCode ?? row.school_code ?? "",
    code: row.exam_code,
    name: row.name,
    examType: row.exam_type,
    classId: row.class_id,
    className: extras.className ?? row.class_name ?? "",
    subjectId: row.subject_id,
    subject: extras.subjectName ?? row.subject_name ?? "",
    academicYearId: row.academic_year_id,
    termId: row.term_id,
    period: extras.termName ?? row.term_name ?? "",
    date: extras.examDate ?? row.exam_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: examStatusLabel(row.status),
    statusCode: row.status,
    evaluationTypeId: row.evaluation_type_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReportCardRow(row, extras = {}) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: extras.schoolCode ?? row.school_code ?? "",
    studentId: row.student_id,
    studentName: extras.studentName ?? "",
    classId: row.class_id,
    className: extras.className ?? row.class_name ?? "",
    academicYearId: row.academic_year_id,
    termId: row.term_id,
    period: extras.termName ?? row.term_name ?? "",
    status: row.status,
    average: extras.average ?? null,
    rank: extras.rank ?? null,
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTemplateRow(row, extras = {}) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: extras.schoolCode ?? row.school_code ?? "",
    classId: row.class_id,
    className: extras.className ?? row.class_name ?? null,
    academicYearId: row.academic_year_id,
    templateType: row.template_type,
    layout: row.layout && typeof row.layout === "object" ? row.layout : {},
    status: row.status,
    version: Number(row.version ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSchoolDocumentRow(row, extras = {}) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: extras.schoolCode ?? row.school_code ?? "",
    studentId: row.student_id,
    studentName: extras.studentName ?? "",
    documentType: row.document_type,
    title: row.title,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function classifyResidualExam(payload, context = {}) {
  const issues = [];
  if (!payload || typeof payload !== "object") {
    return { ambiguous: true, issues: [{ key: "payload", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS }] };
  }
  const name = asTrimmed(payload.name ?? payload.title);
  const className = asTrimmed(payload.className);
  const subject = asTrimmed(payload.subject);
  const date = parseIsoDate(payload.date);
  if (!name) issues.push({ key: "name", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS });
  if (className && !(context.classNames ?? []).map(normalizeLabel).includes(normalizeLabel(className))) {
    issues.push({ key: "className", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS });
  }
  if (subject && !(context.subjectNames ?? []).map(normalizeLabel).includes(normalizeLabel(subject))) {
    issues.push({ key: "subject", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS });
  }
  const period = asTrimmed(payload.period);
  if (period && !(context.termNames ?? []).map(normalizeLabel).includes(normalizeLabel(period))) {
    issues.push({ key: "period", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS });
  }
  if (payload.date && !date) issues.push({ key: "date", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS });
  const matched = (context.relationalExams ?? []).some((exam) => {
    const sameName = normalizeLabel(exam.name) === normalizeLabel(name);
    const sameDate = !date || asTrimmed(exam.examDate ?? exam.date) === date;
    const sameClass = !className || normalizeLabel(exam.className) === normalizeLabel(className);
    const sameSubject = !subject || normalizeLabel(exam.subject) === normalizeLabel(subject);
    return sameName && sameDate && sameClass && sameSubject;
  });
  if (!matched) issues.push({ key: "unmatched", code: DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS });
  return { ambiguous: issues.length > 0, issues };
}

function classifyResidualReportCard(payload, context = {}) {
  const issues = [];
  if (!payload || typeof payload !== "object") {
    return { ambiguous: true, issues: [{ key: "payload", code: DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_AMBIGUOUS }] };
  }
  const studentId = asTrimmed(payload.studentId);
  const period = asTrimmed(payload.period);
  if (studentId && !(context.studentIds ?? []).includes(studentId) && !(context.studentCodes ?? []).includes(studentId)) {
    issues.push({ key: "studentId", code: DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_AMBIGUOUS });
  }
  if (period && !(context.termNames ?? []).map(normalizeLabel).includes(normalizeLabel(period))) {
    issues.push({ key: "period", code: DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_AMBIGUOUS });
  }
  const matched = (context.relationalCards ?? []).some((card) => {
    const sameStudent =
      asTrimmed(card.studentId) === studentId || asTrimmed(card.studentCode) === studentId;
    const samePeriod = !period || normalizeLabel(card.period) === normalizeLabel(period);
    return sameStudent && samePeriod;
  });
  if (!matched) issues.push({ key: "unmatched", code: DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_AMBIGUOUS });
  return { ambiguous: issues.length > 0, issues };
}

function classifyResidualDocument(payload, context = {}) {
  const issues = [];
  if (!payload || typeof payload !== "object") {
    return { ambiguous: true, issues: [{ key: "payload", code: DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_AMBIGUOUS }] };
  }
  const title = asTrimmed(payload.title);
  const id = asTrimmed(payload.id);
  if (!title && !id) issues.push({ key: "title", code: DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_AMBIGUOUS });
  const matched = (context.relationalDocuments ?? []).some((doc) => {
    const sameId = id && (asTrimmed(doc.id) === id || asTrimmed(doc.code) === id);
    const sameTitle = title && normalizeLabel(doc.title) === normalizeLabel(title);
    return sameId || sameTitle;
  });
  if (!matched) issues.push({ key: "unmatched", code: DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_AMBIGUOUS });
  return { ambiguous: issues.length > 0, issues };
}

function assertLegacyResidualWriteForbidden(domain) {
  const record = String(domain ?? "").toLowerCase();
  if (record === "exam" || record === "exams") {
    throw createDocumentsExamsError(
      400,
      "Les examens ne sont plus modifiables via planning-exams JSON. Utilisez /api/exams.",
      DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_WRITE_FORBIDDEN,
    );
  }
  if (record === "bulletin" || record === "bulletins") {
    throw createDocumentsExamsError(
      400,
      "Les bulletins ne sont plus modifiables via report-cards JSON. Utilisez /api/report-cards.",
      DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_WRITE_FORBIDDEN,
    );
  }
  if (record === "document" || record === "documents") {
    throw createDocumentsExamsError(
      400,
      "Les documents ne sont plus modifiables via establishment-documents JSON. Utilisez /api/school-documents.",
      DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_WRITE_FORBIDDEN,
    );
  }
}

module.exports = {
  DOCUMENTS_EXAMS_ERROR,
  EXAM_STATUSES,
  DETERMINISTIC_EXAM_STATUS_ALIASES,
  REPORT_CARD_STATUSES,
  DOCUMENT_STATUSES,
  TEMPLATE_LAYOUT_KEYS,
  asTrimmed,
  normalizeLabel,
  hasOwn,
  createDocumentsExamsError,
  isSuperAdminPrincipal,
  ignoreClientScope,
  documentsExamsAuditMetaFromRequest,
  assertExamsRead,
  assertExamsWrite,
  assertExamsValidate,
  assertReportCardsRead,
  assertReportCardsWrite,
  assertDocumentsRead,
  assertDocumentsWrite,
  assertTemplatesWrite,
  canonicalizeExamStatus,
  classifyExamStatuses,
  examStatusLabel,
  parseIsoDate,
  validateTemplateLayout,
  mapExamRow,
  mapReportCardRow,
  mapTemplateRow,
  mapSchoolDocumentRow,
  classifyResidualExam,
  classifyResidualReportCard,
  classifyResidualDocument,
  assertLegacyResidualWriteForbidden,
};
