"use strict";

const {
  DOCUMENTS_EXAMS_ERROR,
  asTrimmed,
  createDocumentsExamsError,
  classifyExamStatuses,
  EXAM_STATUSES,
  assertExamsRead,
  assertExamsWrite,
  assertExamsValidate,
  assertReportCardsRead,
  assertReportCardsWrite,
  assertDocumentsRead,
  assertDocumentsWrite,
  assertTemplatesWrite,
  documentsExamsAuditMetaFromRequest,
} = require("./documentsExamsManagement");
const { createDocumentsExamsPgStore } = require("../db/documentsExamsPgStore");

function recordsStore(repo) {
  if (typeof repo.getDocumentsExamsStore === "function") {
    return repo.getDocumentsExamsStore();
  }
  return createDocumentsExamsPgStore(repo);
}

function resolveSchoolCodeFromPrincipal(principal, explicitSchoolCode) {
  if (explicitSchoolCode) return asTrimmed(explicitSchoolCode).toUpperCase();
  const code = asTrimmed(principal?.schoolCode).toUpperCase();
  if (!code || code === "*") {
    throw createDocumentsExamsError(400, "Établissement requis.", DOCUMENTS_EXAMS_ERROR.FORBIDDEN);
  }
  return code;
}

async function writeAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordAudit !== "function") {
    throw createDocumentsExamsError(500, "Audit indisponible dans la transaction.");
  }
  await tx.recordAudit(
    {
      schoolCode: entry.schoolCode || principal?.schoolCode,
      userId: principal?.sub || principal?.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId ?? ""),
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    },
    tx,
  );
}

async function withSchoolStore(repo, principal, schoolCode, readAssert) {
  readAssert(principal);
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = recordsStore(repo);
  const school = await store.requireSchoolByCode(scopedSchool);
  return { scopedSchool, store, school };
}

async function mutate(repo, principal, auditMeta, schoolCode, readAssert, writeAssert, action) {
  writeAssert(principal);
  const { scopedSchool, school } = await withSchoolStore(repo, principal, schoolCode, readAssert);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = recordsStore(scope);
    const result = await action(scopedStore, school, scopedSchool);
    await writeAudit(scope, principal, auditMeta, result.audit);
    return result.value;
  });
}

async function listExams(repo, principal, schoolCode) {
  const { store, school } = await withSchoolStore(repo, principal, schoolCode, assertExamsRead);
  return store.listExams(school.id);
}

async function getExam(repo, principal, examId, schoolCode) {
  const { store, school } = await withSchoolStore(repo, principal, schoolCode, assertExamsRead);
  return store.getExam(school.id, examId);
}

async function createExam(repo, payload, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertExamsRead, assertExamsWrite, async (store, school, scopedSchool) => {
    const saved = await store.insertExam(school.id, payload);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "create_exam", entityType: "exam", entityId: saved.id, newValue: saved },
    };
  });
}

async function patchExam(repo, examId, payload, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertExamsRead, assertExamsWrite, async (store, school, scopedSchool) => {
    const previous = await store.getExam(school.id, examId);
    const saved = await store.updateExam(school.id, examId, payload);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "update_exam", entityType: "exam", entityId: examId, oldValue: previous, newValue: saved },
    };
  });
}

async function validateExam(repo, examId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertExamsRead, assertExamsValidate, async (store, school, scopedSchool) => {
    const previous = await store.getExam(school.id, examId);
    const saved = await store.setExamStatus(school.id, examId, "validated");
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "validate_exam", entityType: "exam", entityId: examId, oldValue: previous, newValue: saved },
    };
  });
}

async function cancelExam(repo, examId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertExamsRead, assertExamsWrite, async (store, school, scopedSchool) => {
    const previous = await store.getExam(school.id, examId);
    const saved = await store.setExamStatus(school.id, examId, "cancelled");
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "cancel_exam", entityType: "exam", entityId: examId, oldValue: previous, newValue: saved },
    };
  });
}

async function archiveExam(repo, examId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertExamsRead, assertExamsWrite, async (store, school, scopedSchool) => {
    const previous = await store.getExam(school.id, examId);
    const saved = await store.setExamStatus(school.id, examId, "archived");
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "archive_exam", entityType: "exam", entityId: examId, oldValue: previous, newValue: saved },
    };
  });
}

async function listReportCards(repo, principal, schoolCode) {
  const { store, school } = await withSchoolStore(repo, principal, schoolCode, assertReportCardsRead);
  return store.listReportCards(school.id);
}

async function generateReportCard(repo, payload, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertReportCardsRead, assertReportCardsWrite, async (store, school, scopedSchool) => {
    const saved = await store.generateReportCard(school.id, payload);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "generate_report_card", entityType: "report_card", entityId: saved.id, newValue: saved },
    };
  });
}

async function publishReportCard(repo, cardId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertReportCardsRead, assertReportCardsWrite, async (store, school, scopedSchool) => {
    const previous = (await store.listReportCards(school.id)).find((row) => row.id === cardId);
    if (!previous) throw createDocumentsExamsError(404, "Bulletin introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    const saved = await store.setReportCardStatus(school.id, cardId, "published");
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "publish_report_card", entityType: "report_card", entityId: cardId, oldValue: previous, newValue: saved },
    };
  });
}

async function archiveReportCard(repo, cardId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertReportCardsRead, assertReportCardsWrite, async (store, school, scopedSchool) => {
    const previous = (await store.listReportCards(school.id)).find((row) => row.id === cardId);
    if (!previous) throw createDocumentsExamsError(404, "Bulletin introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    const saved = await store.setReportCardStatus(school.id, cardId, "archived");
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "archive_report_card", entityType: "report_card", entityId: cardId, oldValue: previous, newValue: saved },
    };
  });
}

async function listTemplates(repo, principal, schoolCode) {
  const { store, school } = await withSchoolStore(repo, principal, schoolCode, assertDocumentsRead);
  return store.listTemplates(school.id);
}

async function resolveBulletinLayoutForStudent(repo, student) {
  const schoolCode = asTrimmed(student?.schoolCode ?? student?.school?.code).toUpperCase();
  const className = asTrimmed(student?.className ?? student?.class?.name);
  if (!schoolCode || !className) return null;
  const store = recordsStore(repo);
  const school = typeof store.getSchoolByCode === "function" ? await store.getSchoolByCode(schoolCode) : null;
  if (!school) return null;
  if (typeof store.resolveActiveBulletinLayout !== "function") return null;
  return store.resolveActiveBulletinLayout(school.id, className);
}

async function upsertTemplate(repo, payload, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertDocumentsRead, assertTemplatesWrite, async (store, school, scopedSchool) => {
    const saved = await store.upsertTemplate(school.id, payload);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "upsert_report_card_template", entityType: "report_card_template", entityId: saved.id, newValue: saved },
    };
  });
}

async function archiveTemplate(repo, templateId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertDocumentsRead, assertTemplatesWrite, async (store, school, scopedSchool) => {
    const previous = await store.getTemplate(school.id, templateId);
    const saved = await store.archiveTemplate(school.id, templateId);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "archive_report_card_template", entityType: "report_card_template", entityId: templateId, oldValue: previous, newValue: saved },
    };
  });
}

async function listSchoolDocuments(repo, principal, schoolCode) {
  const { store, school } = await withSchoolStore(repo, principal, schoolCode, assertDocumentsRead);
  return store.listSchoolDocuments(school.id);
}

async function createSchoolDocument(repo, payload, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertDocumentsRead, assertDocumentsWrite, async (store, school, scopedSchool) => {
    const saved = await store.insertSchoolDocument(school.id, payload, principal?.sub);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "create_school_document", entityType: "school_document", entityId: saved.id, newValue: saved },
    };
  });
}

async function patchSchoolDocument(repo, documentId, payload, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertDocumentsRead, assertDocumentsWrite, async (store, school, scopedSchool) => {
    const previous = (await store.listSchoolDocuments(school.id)).find((row) => row.id === documentId);
    if (!previous) throw createDocumentsExamsError(404, "Document introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    const saved = await store.updateSchoolDocument(school.id, documentId, payload);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "update_school_document", entityType: "school_document", entityId: documentId, oldValue: previous, newValue: saved },
    };
  });
}

async function archiveSchoolDocument(repo, documentId, principal, auditMeta, schoolCode) {
  return mutate(repo, principal, auditMeta, schoolCode, assertDocumentsRead, assertDocumentsWrite, async (store, school, scopedSchool) => {
    const previous = (await store.listSchoolDocuments(school.id)).find((row) => row.id === documentId);
    if (!previous) throw createDocumentsExamsError(404, "Document introuvable.", DOCUMENTS_EXAMS_ERROR.NOT_FOUND);
    const saved = await store.archiveSchoolDocument(school.id, documentId);
    return {
      value: saved,
      audit: { schoolCode: scopedSchool, action: "archive_school_document", entityType: "school_document", entityId: documentId, oldValue: previous, newValue: saved },
    };
  });
}

function throwAmbiguous(code, label, rows) {
  const details = rows
    .slice(0, 5)
    .map((row) => `${row.schoolCode}(keys=${(row.keys ?? []).join(",")})`)
    .join("; ");
  const message =
    `${label} : ${rows.length} établissement(s) ont un JSON résiduel non exactement équivalent aux sources PostgreSQL. ` +
    `Aucune correspondance automatique. Résolution explicite requise.` +
    (details ? ` Exemples: ${details}` : "");
  const error = new Error(message);
  error.name = "DocumentsExamsConstraintsError";
  error.code = code;
  error.inventory = { ambiguous: rows };
  throw error;
}

async function ensureDocumentsExamsConstraints(repo, logger = console) {
  const store = recordsStore(repo);
  const { inventory, examAmbiguous, cardAmbiguous, docAmbiguous } = await store.inventoryLegacyResidualRecords();
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  logInfo(
    `[documents-exams] inventaire residual : ${inventory.length} établissement(s), exams=${examAmbiguous.length} bulletins=${cardAmbiguous.length} documents=${docAmbiguous.length} ambigu(s)`,
  );
  if (examAmbiguous.length) throwAmbiguous(DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS, "Examens", examAmbiguous);
  if (cardAmbiguous.length) throwAmbiguous(DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_AMBIGUOUS, "Bulletins", cardAmbiguous);
  if (docAmbiguous.length) throwAmbiguous(DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_AMBIGUOUS, "Documents", docAmbiguous);
  return { inventory };
}

async function stripLegacyResidualRecords(repo) {
  const { STRIP_LEGACY_RESIDUAL_RECORDS_SQL } = require("../db/documentsExamsSchema");
  if (typeof repo.query === "function") {
    await repo.query(STRIP_LEGACY_RESIDUAL_RECORDS_SQL);
  }
}

async function listDistinctExamStatuses(repo) {
  if (typeof repo.all === "function") {
    return repo.all("SELECT DISTINCT status FROM exams");
  }
  if (typeof repo.query === "function") {
    const result = await repo.query("SELECT DISTINCT status FROM exams");
    return result.rows ?? [];
  }
  return [];
}

async function inventoryExamStatuses(repo) {
  const rows = await listDistinctExamStatuses(repo);
  return classifyExamStatuses(rows.map((row) => row.status));
}

function throwExamStatusAmbiguous(unknown) {
  const unique = [...new Set(unknown)];
  const error = new Error(
    `Examens : ${unique.length} statut(s) non reconnus (${unique.join(", ")}). ` +
      `Conversion déterministe autorisée : published → completed. Aucune heuristique.`,
  );
  error.name = "DocumentsExamsConstraintsError";
  error.code = DOCUMENTS_EXAMS_ERROR.LEGACY_EXAM_STATUS_AMBIGUOUS;
  error.inventory = { unknown: unique };
  throw error;
}

async function ensureExamStatusesDeterministic(repo, logger = console) {
  const { unknown, ambiguous } = await inventoryExamStatuses(repo);
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  logInfo(`[documents-exams] inventaire statuts exams : unknown=${unknown.length}`);
  if (ambiguous) throwExamStatusAmbiguous(unknown);
  return { unknown };
}

async function verifyDocumentsExamsCanonicalSchema(repo) {
  if (typeof repo.one !== "function") return;
  for (const name of ["report_cards", "report_card_templates", "school_documents"]) {
    const row = await repo.one("SELECT to_regclass($1) AS ref", [`public.${name}`]);
    if (!row?.ref) {
      const error = new Error(`Table canonique ${name} absente après le DDL LOT 5.`);
      error.code = "DOCUMENTS_EXAMS_SCHEMA_VERIFY";
      throw error;
    }
  }
  const rows = await listDistinctExamStatuses(repo);
  const leftover = rows
    .map((row) => String(row.status ?? "").trim())
    .filter((status) => status && !EXAM_STATUSES.includes(status));
  if (leftover.length) throwExamStatusAmbiguous(leftover);
}

async function runDocumentsExamsCanonicalBoot(repo, logger = console) {
  const { assertDocumentsExamsSchemaPreflight } = require("../db/documentsExamsSchema");
  await assertDocumentsExamsSchemaPreflight(repo);
  const { inventory } = await ensureDocumentsExamsConstraints(repo, logger);
  await ensureExamStatusesDeterministic(repo, logger);
  const {
    DOCUMENTS_EXAMS_SCHEMA_DDL_SQL,
    DOCUMENTS_EXAMS_DATA_NORMALIZATION_SQL,
    DOCUMENTS_EXAMS_STATUS_CHECK_SQL,
  } = require("../db/documentsExamsSchema");
  if (typeof repo.query === "function") {
    await repo.query(DOCUMENTS_EXAMS_SCHEMA_DDL_SQL);
    await repo.query(DOCUMENTS_EXAMS_DATA_NORMALIZATION_SQL);
    await repo.query(DOCUMENTS_EXAMS_STATUS_CHECK_SQL);
  }
  await verifyDocumentsExamsCanonicalSchema(repo);
  await stripLegacyResidualRecords(repo);
  return { inventory };
}

module.exports = {
  documentsExamsAuditMetaFromRequest,
  listExams,
  getExam,
  createExam,
  patchExam,
  validateExam,
  cancelExam,
  archiveExam,
  listReportCards,
  generateReportCard,
  publishReportCard,
  archiveReportCard,
  listTemplates,
  resolveBulletinLayoutForStudent,
  upsertTemplate,
  archiveTemplate,
  listSchoolDocuments,
  createSchoolDocument,
  patchSchoolDocument,
  archiveSchoolDocument,
  ensureDocumentsExamsConstraints,
  ensureExamStatusesDeterministic,
  stripLegacyResidualRecords,
  runDocumentsExamsCanonicalBoot,
};
