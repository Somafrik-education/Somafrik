"use strict";

/**
 * BULLETIN-REEMISSION-01 / PR1 — publication contrôlée d'une nouvelle version.
 * Utilise la primitive canonique publish() (snapshot signé + nouveau token QR),
 * dont le store PostgreSQL atomise SUPERSEDED(vN) et ACTIVE(vN+1).
 * Ne modifier jamais les canonical_bytes des versions antérieures.
 */
const { createReportCardReissuePreview, ReportCardReissueError } = require("./reportCardReissue");
const { canonicalize } = require("../../contracts/reportCard/jcs");

function fail(code) { throw new ReportCardReissueError(code); }
function requireId(value, code, max = 256) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) fail(code);
  return text;
}
function createReportCardReissuePublisher({ publication, classPublication, getTemplate, identityStore }) {
  const reader = createReportCardReissuePreview({ publication, classPublication, getTemplate });
  async function publish({ tenant, actor, reportCardId, sourceVersion, reason, commandId, expectedDraftSha256 }) {
    if (!tenant?.schoolId || tenant.actorSchoolId !== tenant.schoolId) fail("TENANT_MISMATCH");
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) fail("VERSION_NOT_FOUND");
    requireId(reportCardId, "PUBLICATION_NOT_FOUND");
    const why = requireId(reason, "REISSUE_REASON_REQUIRED", 500);
    const id = requireId(commandId, "REISSUE_COMMAND_REQUIRED", 128);
    const expected = requireId(expectedDraftSha256, "DRAFT_CONFIRMATION_REQUIRED", 128);
    const actorId = requireId(actor?.actorId, "RBAC_DENIED");

    if (!publication?.publish || !publication?.findCommand || !publication?.findByCommand ||
        !classPublication?.prepareReissueCandidate) fail("REISSUE_UNAVAILABLE");

    // Replays must succeed even after vN has become SUPERSEDED, but never for
    // a command ID reused with different semantics.
    const previousCommand = await publication.findCommand({ tenant, reportCardId, commandId: id });
    if (previousCommand) {
      if (previousCommand.reason !== why ||
          Number(previousCommand.source_version) !== sourceVersion) fail("REISSUE_COMMAND_CONFLICT");
      const existing = await publication.findByCommand({ tenant, reportCardId, commandId: id });
      if (!existing) fail("REISSUE_COMMAND_CONFLICT");
      return { status: "ALREADY_REISSUED", report_card_id: reportCardId, published_snapshot_version: existing.published_snapshot_version, public_id: existing.public_id };
    }

    const proposal = await reader.preview({ tenant, reportCardId, sourceVersion });
    if (proposal.expected_draft_sha256 !== expected) fail("DRAFT_CHANGED");

    const candidate = await classPublication.prepareReissueCandidate({
      tenant, reportCardId,
      classId: proposal.class_id,
      academicYearId: proposal.academic_year_id,
      modelKey: proposal.model_key,
      period: proposal.period_scope,
    });
    if (candidate.schoolId !== tenant.schoolId || candidate.draftSha256 !== proposal.draft_sha256 ||
        candidate.item.report_card_id !== reportCardId ||
        candidate.item.student.student_id !== proposal.student_id) fail("DRAFT_CHANGED");
    if (canonicalize(candidate.item.student.subject_totals) !== canonicalize(proposal.subject_totals)) fail("DRAFT_CHANGED");
    if (canonicalize(candidate.item.content.official_identity) !== canonicalize(proposal.official_identity)) fail("DRAFT_CHANGED");

    if (candidate.officialLogo) {
      if (!identityStore || typeof identityStore.freezeLogo !== "function") fail("OFFICIAL_ASSETS_UNAVAILABLE");
      await identityStore.freezeLogo(tenant.schoolId, candidate.officialLogo);
    }
    const content = candidate.item.content;
    const payload = {
      report_card_id: reportCardId,
      published_snapshot_version: sourceVersion + 1,
      school_id: tenant.schoolId,
      published_at: new Date().toISOString(),
      published_by: actorId,
      engine_id: content.engine_id,
      provenance: content.provenance,
      students: [candidate.item.student],
      academic_year_id: content.academic_year_id,
      class_id: content.class_id,
      model_key: content.model_key,
      period_scope: content.period_scope,
      content_sha256: candidate.item.content_sha256,
      official_identity: content.official_identity,
    };
    const record = await publication.publish({
      tenant, payload,
      lineage: {
        corrected_from_version: sourceVersion,
        correction_reason: why,
        actor_id: actorId,
        command_id: id,
      },
      command: { commandId: id, reason: why, sourceVersion },
    });
    return { status: "REISSUED", report_card_id: reportCardId, published_snapshot_version: record.published_snapshot_version, public_id: record.public_id };
  }
  return { publish };
}
module.exports = { createReportCardReissuePublisher };
