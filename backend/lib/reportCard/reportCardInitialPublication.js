"use strict";

/**
 * LOT 9 — publication initiale Bulletins.
 * Cohorte année/classe depuis la ligne `classes` (pas l’année active).
 * Bundle LOT 6 explicitement ciblé (`modelKey`) : profile + schema + template épinglés.
 */

const { computeReportCard } = require("./reportCardEngine");
const { ReportCardPublicationError } = require("./reportCardPublication");
const { scaleByComponentFromProfile } = require("../../db/reportCardFactsStore");

function requireText(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function layerRef(id, version, specSha256) {
  if (id == null || !Number.isInteger(Number(version)) || !requireText(specSha256)) return null;
  return { id, version: Number(version), spec_sha256: String(specSha256) };
}

async function resolveBoundBundle(configuration, schoolId, modelKey) {
  if (!configuration || typeof configuration.lookupActiveBinding !== "function") return null;
  const binding = await Promise.resolve(configuration.lookupActiveBinding({ schoolId, modelKey })).catch(() => null);
  if (!binding) return null;
  const profileSpec = await Promise.resolve(
    configuration.lookupProfileSpec({
      schoolId,
      profileId: binding.profile_id,
      version: binding.profile_version,
      specSha256: binding.profile_spec_sha256,
    })
  ).catch(() => null);
  const schemaSpec = await Promise.resolve(
    configuration.lookupSchemaSpec({
      schoolId,
      schemaId: binding.schema_id,
      version: binding.schema_version,
      specSha256: binding.schema_spec_sha256,
    })
  ).catch(() => null);
  const template = await Promise.resolve(
    configuration.lookupRenderingTemplateSpec({
      schoolId,
      templateId: binding.rendering_template_id,
      version: binding.rendering_template_version,
    })
  ).catch(() => null);
  if (!profileSpec || !schemaSpec || !template || !template.spec) return null;
  if (String(template.spec_sha256) !== String(binding.rendering_template_spec_sha256)) return null;
  const profile = layerRef(binding.profile_id, binding.profile_version, binding.profile_spec_sha256);
  const schema = layerRef(binding.schema_id, binding.schema_version, binding.schema_spec_sha256);
  const templateRef = layerRef(
    binding.rendering_template_id,
    binding.rendering_template_version,
    binding.rendering_template_spec_sha256
  );
  if (!profile || !schema || !templateRef) return null;
  return {
    profile: { spec: profileSpec, ref: profile },
    schema: { spec: schemaSpec, ref: schema },
    template: { spec: template.spec, ref: templateRef },
  };
}

function createReportCardInitialPublication({ publication, factsStore, configuration } = {}) {
  async function publishInitial({ tenant, reportCardId, classId, academicYearId, modelKey } = {}) {
    if (!publication || typeof publication.publish !== "function") {
      throw new ReportCardPublicationError("PUBLICATION_REQUIRED");
    }
    if (!factsStore || typeof factsStore.listFacts !== "function" || typeof factsStore.resolveCohort !== "function") {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const schoolId = tenant && tenant.schoolId;
    const cardId = requireText(reportCardId);
    const requestedClassId = requireText(classId);
    const requestedYearId = requireText(academicYearId);
    if (!schoolId || !cardId || !requestedClassId || !requestedYearId || !requireText(modelKey)) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const cohort = await Promise.resolve(
      factsStore.resolveCohort({
        schoolId,
        classId: requestedClassId,
        academicYearId: requestedYearId,
      })
    );
    if (!cohort || !cohort.classId || !cohort.academicYearId) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const bundle = await resolveBoundBundle(configuration, schoolId, modelKey);
    if (!bundle) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const scaleByComponent = scaleByComponentFromProfile(bundle.profile.spec);
    if (!scaleByComponent) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const facts = await Promise.resolve(
      factsStore.listFacts({
        schoolId,
        classId: cohort.classId,
        academicYearId: cohort.academicYearId,
        scaleByComponent,
      })
    );
    if (!Array.isArray(facts) || facts.length === 0) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const computed = computeReportCard({
      profile: bundle.profile.spec,
      schema: bundle.schema.spec,
      facts,
      provenance: { profile: bundle.profile.ref, schema: bundle.schema.ref },
      tenant,
    });
    return publication.publish({
      tenant,
      payload: {
        report_card_id: cardId,
        published_snapshot_version: 1,
        school_id: schoolId,
        published_at: new Date().toISOString(),
        engine_id: computed.engine_id,
        provenance: {
          profile: computed.provenance.profile,
          schema: computed.provenance.schema,
          template: bundle.template.ref,
        },
        students: computed.students,
        academic_year_id: cohort.academicYearId,
        class_id: cohort.classId,
      },
    });
  }

  return { publishInitial };
}

module.exports = {
  createReportCardInitialPublication,
};
