"use strict";

/**
 * LOT 9 — publication initiale Bulletins.
 * Le serveur épinglé academic_year_id + class_id depuis la cohorte PG (classe),
 * jamais depuis un payload client ni depuis l’année active courante.
 */

const { computeReportCard } = require("./reportCardEngine");
const { ReportCardPublicationError } = require("./reportCardPublication");
const { scaleByComponentFromProfile } = require("../../db/reportCardFactsStore");

function requireText(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

async function firstActiveLayer(store, listName, getActiveName, idField, schoolId, actorSchoolId) {
  if (!store || typeof store[listName] !== "function" || typeof store[getActiveName] !== "function") {
    return null;
  }
  try {
    const rows = await Promise.resolve(store[listName](schoolId, actorSchoolId));
    if (!Array.isArray(rows) || !rows.length || !rows[0] || rows[0].id == null) return null;
    const version = await Promise.resolve(
      store[getActiveName]({ schoolId, actorSchoolId, [idField]: rows[0].id })
    );
    if (!version || !version.spec) return null;
    return {
      spec: version.spec,
      ref: {
        id: rows[0].id,
        version: version.version,
        spec_sha256: version.spec_sha256,
      },
    };
  } catch {
    return null;
  }
}

function createReportCardInitialPublication({ publication, factsStore, profileStore, schemaStore } = {}) {
  async function publishInitial({ tenant, reportCardId, classId, academicYearId } = {}) {
    if (!publication || typeof publication.publish !== "function") {
      throw new ReportCardPublicationError("PUBLICATION_REQUIRED");
    }
    if (!factsStore || typeof factsStore.listFacts !== "function" || typeof factsStore.resolveCohort !== "function") {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const schoolId = tenant && tenant.schoolId;
    const actorSchoolId = (tenant && tenant.actorSchoolId) || schoolId;
    const cardId = requireText(reportCardId);
    const requestedClassId = requireText(classId);
    const requestedYearId = requireText(academicYearId);
    if (!schoolId || !cardId || !requestedClassId || !requestedYearId) {
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
    const profile = await firstActiveLayer(
      profileStore,
      "listProfiles",
      "getActive",
      "profileId",
      schoolId,
      actorSchoolId
    );
    const schema = await firstActiveLayer(
      schemaStore,
      "listSchemas",
      "getActive",
      "schemaId",
      schoolId,
      actorSchoolId
    );
    if (!profile || !schema) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const scaleByComponent = scaleByComponentFromProfile(profile.spec);
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
      profile: profile.spec,
      schema: schema.spec,
      facts,
      provenance: { profile: profile.ref, schema: schema.ref },
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
        provenance: computed.provenance,
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
