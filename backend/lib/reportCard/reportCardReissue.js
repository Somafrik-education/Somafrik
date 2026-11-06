"use strict";

/**
 * BULLETIN-REEMISSION-01 / PR0 — préflight strictement en lecture seule.
 * Le nouveau modèle et l'identité proviennent du binding ACTIF de la classe.
 * L'ancienne publication reste inchangée, même en cas d'erreur.
 */
const crypto = require("node:crypto");
const { canonicalize } = require("../../contracts/reportCard/jcs");

class ReportCardReissueError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReportCardReissueError";
    this.code = code;
  }
}
function reject(code) { throw new ReportCardReissueError(code); }
function same(a, b) { return canonicalize(a) === canonicalize(b); }
function fingerprint(value) {
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex");
}

function createReportCardReissuePreview({ publication, classPublication, getTemplate }) {
  async function preview({ tenant, reportCardId, sourceVersion }) {
    if (!tenant?.schoolId || tenant.actorSchoolId !== tenant.schoolId) reject("TENANT_MISMATCH");
    if (typeof reportCardId !== "string" || !reportCardId) reject("PUBLICATION_NOT_FOUND");
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) reject("VERSION_NOT_FOUND");
    if (!publication?.lookup || !publication?.payloadForRender ||
        !classPublication?.preview || typeof getTemplate !== "function") reject("REISSUE_UNAVAILABLE");

    const record = await publication.lookup({ tenant, reportCardId, version: sourceVersion });
    if (!record) reject("PUBLICATION_NOT_FOUND");
    if (record.verification_status !== "ACTIVE") reject("REISSUE_SOURCE_NOT_ACTIVE");

    // This unscoped lookup is safe only inside the authenticated, tenant-checked route.
    const source = await publication.payloadForRender({ tenant, reportCardId, version: sourceVersion });
    const student = Array.isArray(source.students) && source.students.length === 1 ? source.students[0] : null;
    if (!student || !source.class_id || !source.academic_year_id || !source.model_key || !source.period_scope) {
      reject("REISSUE_SOURCE_INVALID");
    }

    const draft = await classPublication.preview({
      tenant,
      classId: source.class_id,
      academicYearId: source.academic_year_id,
      modelKey: source.model_key,
      period: source.period_scope,
    });
    if (!draft?.publishable) reject("REPORT_CARD_INCOMPLETE");
    if (draft.class_id !== source.class_id || draft.academic_year_id !== source.academic_year_id ||
        draft.model_key !== source.model_key || draft.period_scope !== source.period_scope) {
      reject("REISSUE_SCOPE_MISMATCH");
    }
    const candidate = (draft.students || []).find(row =>
      row.report_card_id === reportCardId && row.student_id === student.student_id
    );
    if (!candidate || candidate.status !== "COMPLETE") reject("REISSUE_STUDENT_MISMATCH");
    if (!same(student.subject_totals, candidate.subject_totals) ||
        !same(student.slots, candidate.slots)) reject("REISSUE_GRADES_CHANGED");

    const templateRef = draft.provenance?.template;
    if (!templateRef?.id || !Number.isInteger(templateRef.version)) reject("REISSUE_TEMPLATE_MISSING");
    const result = await getTemplate({
      tenant,
      schoolId: tenant.schoolId,
      templateId: templateRef.id,
      version: templateRef.version,
    });
    const spec = result?.spec ?? result;
    if (!spec?.presentation?.header?.title) reject("REISSUE_HEADER_MISSING");
    if (!draft.official_identity) reject("OFFICIAL_IDENTITY_UNAVAILABLE");

    const expectedDraftSha256 = fingerprint({
      v: 1, reportCardId, sourceVersion,
      sourceSnapshot: record.snapshot_sha256,
      draft: draft.draft_sha256,
      template: templateRef,
      officialIdentity: draft.official_identity,
      studentId: student.student_id,
    });
    return {
      ok: true,
      official: false,
      report_card_id: reportCardId,
      source_version: sourceVersion,
      proposed_version: sourceVersion + 1,
      class_id: source.class_id,
      academic_year_id: source.academic_year_id,
      model_key: source.model_key,
      period_scope: source.period_scope,
      student_id: student.student_id,
      source_template: source.provenance?.template ?? null,
      proposed_template: templateRef,
      official_identity: draft.official_identity,
      header: spec.presentation.header,
      signatures: spec.presentation.signatures || [],
      subject_totals: candidate.subject_totals,
      draft_sha256: draft.draft_sha256,
      expected_draft_sha256: expectedDraftSha256,
      changes: { template: true, identity: true, grades: false },
    };
  }
  return { preview };
}
module.exports = { createReportCardReissuePreview, ReportCardReissueError };
