"use strict";

/**
 * BULLETIN-PUBLISH-01 — publication officielle des bulletins d'une classe à
 * partir des notes réelles.
 *
 * Parcours : classe (établissement + année) → modèle actif (LOT 6) → catalogue
 * des matières → notes de la classe → faits canoniques → moteur
 * somafrik.report_card.v1 (cohorte = inscrits de la classe) → brouillon non
 * officiel (empreinte) → validation explicite de CETTE empreinte → snapshots
 * signés, un par élève, publiés dans une seule transaction.
 *
 * Aucun second moteur. Un PDF ne publie jamais un bulletin. Aucune donnée
 * personnelle dans les journaux.
 */

const crypto = require("node:crypto");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { computeReportCard } = require("./reportCardEngine");
const { ReportCardPublicationError, IdempotencyConflict } = require("./reportCardPublication");
const { resolveBoundBundle } = require("./reportCardInitialPublication");
const { assertProfileSubjectsInCatalog } = require("./subjectCatalog");
const { buildPublicationFacts, BLOCKING } = require("./reportCardFactBuilder");

const ANNUAL = "ANNUAL";

class ReportCardClassPublicationError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "ReportCardClassPublicationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, details) {
  throw new ReportCardClassPublicationError(code, details);
}

function requireText(value, code) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) fail(code);
  return text;
}

function sha256(value) {
  return crypto.createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

/**
 * Périmètre : bulletin trimestriel = trimestres jusqu'à la période demandée
 * (cumul, sans bilan annuel) ; ANNUAL = toutes les périodes + bilan annuel,
 * TOUTES complètes (aucun trimestre manquant n'est toléré).
 */
function resolvePeriodScope(profile, period) {
  const ordered = [...profile.periods].sort((a, b) => a.order - b.order).map((item) => item.id);
  if (period === ANNUAL) {
    if (profile.annual === false) fail("INVALID_PERIOD_SCOPE");
    return { id: ANNUAL, periods: ordered, annual: true };
  }
  const index = ordered.indexOf(period);
  if (index < 0) fail("INVALID_PERIOD_SCOPE");
  return { id: period, periods: ordered.slice(0, index + 1), annual: false };
}

function reportCardIdFor({ schoolId, classId, academicYearId, modelKey, scopeId, studentUuid }) {
  const digest = sha256({ v: 1, school_id: schoolId, class_id: classId, academic_year_id: academicYearId, model_key: modelKey, scope: scopeId, student: studentUuid });
  return `rc-${digest.slice(0, 40)}`;
}

function engineError(err) {
  if (err instanceof ReportCardClassPublicationError) throw err;
  fail("INVALID_PEDAGOGICAL_DATA", [{ code: err && err.code ? String(err.code) : "ENGINE_ERROR", severity: BLOCKING }]);
}

function createReportCardClassPublication({ publication, factsStore, configuration, catalogStore } = {}) {
  function requireDeps() {
    if (!publication || typeof publication.publishBatch !== "function") fail("PUBLICATION_REQUIRED");
    for (const name of ["resolveCohort", "listClassCohort", "listClassGradeSources", "listClassEvaluationSources"]) {
      if (!factsStore || typeof factsStore[name] !== "function") fail("FACTS_REQUIRED");
    }
    if (!catalogStore || typeof catalogStore.listSchoolSubjectCatalog !== "function") fail("FACTS_REQUIRED");
  }

  async function loadBundle({ schoolId, modelKey, pinned, classId, academicYearId }) {
    if (pinned) return pinned;
    const bundle = await resolveBoundBundle(configuration, schoolId, modelKey, { classId, academicYearId });
    if (!bundle) fail("MODEL_NOT_BOUND");
    return bundle;
  }

  /** Calcul complet d'une classe (sans écriture). */
  async function computeClass({ tenant, classId, academicYearId, modelKey, period, pinned } = {}) {
    requireDeps();
    const schoolId = tenant && tenant.schoolId;
    if (!schoolId || !tenant.actorSchoolId || tenant.actorSchoolId !== schoolId) fail("TENANT_MISMATCH");
    const cls = requireText(classId, "CLASS_REQUIRED");
    const year = requireText(academicYearId, "CLASS_REQUIRED");
    const key = requireText(modelKey, "MODEL_KEY_REQUIRED");
    const periodId = requireText(period, "INVALID_PERIOD_SCOPE");
    const cohortRow = await factsStore.resolveCohort({ schoolId, classId: cls, academicYearId: year });
    if (!cohortRow) fail("CLASS_NOT_FOUND");
    // Classe et année validées par resolveCohort (établissement du jeton) : résolution par classe.
    const bundle = await loadBundle({ schoolId, modelKey: key, pinned, classId: cohortRow.classId, academicYearId: cohortRow.academicYearId });
    const profile = bundle.profile.spec;
    if (!Array.isArray(profile.subjects) || !profile.fact_sources) fail("PROFILE_NOT_PUBLISHABLE");
    const scope = resolvePeriodScope(profile, periodId);
    const catalog = await catalogStore.listSchoolSubjectCatalog(schoolId);
    try {
      assertProfileSubjectsInCatalog({ schoolId, profileSpec: profile, catalog });
    } catch (err) {
      fail("INVALID_PEDAGOGICAL_DATA", [{ code: err.code || "CATALOG_MISMATCH", severity: BLOCKING }]);
    }
    const [cohort, gradeRows, evaluationRows] = await Promise.all([
      factsStore.listClassCohort({ schoolId, classId: cohortRow.classId, academicYearId: cohortRow.academicYearId }),
      factsStore.listClassGradeSources({ schoolId, classId: cohortRow.classId, academicYearId: cohortRow.academicYearId }),
      factsStore.listClassEvaluationSources({ schoolId, classId: cohortRow.classId, academicYearId: cohortRow.academicYearId }),
    ]);
    const built = buildPublicationFacts({
      profile,
      schoolId,
      classAcademicYearId: cohortRow.academicYearId,
      periods: scope.periods,
      cohort,
      gradeRows,
      evaluationRows,
    });
    let computed;
    try {
      computed = computeReportCard({
        profile,
        schema: bundle.schema.spec,
        facts: built.facts,
        cohort: built.facts,
        roster: built.roster,
        scope: { periods: scope.periods, annual: scope.annual },
        tenant,
        provenance: { profile: bundle.profile.ref, schema: bundle.schema.ref },
      });
    } catch (err) {
      engineError(err);
    }
    const uuidByCode = new Map(cohort.map((row) => [String(row.student_code), String(row.student_uuid)]));
    const provenance = { profile: bundle.profile.ref, schema: bundle.schema.ref, template: bundle.template.ref };
    const students = computed.students.map((student) => {
      const reportCardId = reportCardIdFor({
        schoolId,
        classId: cohortRow.classId,
        academicYearId: cohortRow.academicYearId,
        modelKey: key,
        scopeId: scope.id,
        studentUuid: uuidByCode.get(String(student.student_id)),
      });
      const content = {
        engine_id: computed.engine_id,
        provenance,
        school_id: schoolId,
        class_id: cohortRow.classId,
        academic_year_id: cohortRow.academicYearId,
        model_key: key,
        period_scope: scope.id,
        student,
      };
      const studentIssues = built.issues.filter((item) => item.student_id === String(student.student_id));
      const complete = student.subject_totals.status === "COMPLETE" && !studentIssues.some((item) => item.severity === BLOCKING);
      return { report_card_id: reportCardId, student, content, content_sha256: sha256(content), complete, issues: studentIssues };
    });
    const blocking = built.issues.filter((item) => item.severity === BLOCKING);
    const publishable = students.length > 0 && blocking.length === 0 && students.every((item) => item.complete);
    const draftSha256 = sha256(students.map((item) => [item.report_card_id, item.content_sha256]));
    return { schoolId, cohortRow, scope, modelKey: key, provenance, students, issues: built.issues, publishable, draftSha256 };
  }

  function draftView(result) {
    return {
      official: false,
      draft_sha256: result.draftSha256,
      publishable: result.publishable,
      period_scope: result.scope.id,
      class_id: result.cohortRow.classId,
      academic_year_id: result.cohortRow.academicYearId,
      model_key: result.modelKey,
      provenance: result.provenance,
      issues: result.issues,
      students: result.students.map((item) => ({
        report_card_id: item.report_card_id,
        student_id: item.student.student_id,
        status: item.complete ? "COMPLETE" : "INCOMPLETE",
        issues: item.issues,
        subject_totals: item.student.subject_totals,
        slots: item.student.slots,
      })),
    };
  }

  async function preview(args = {}) {
    return draftView(await computeClass(args));
  }

  async function existingState(tenant, students) {
    const states = [];
    for (const item of students) {
      let history = [];
      try {
        history = (await Promise.resolve(publication.listHistory({ tenant, reportCardId: item.report_card_id }))) || [];
      } catch (err) {
        if (!err || err.code !== "PUBLICATION_NOT_FOUND") throw err;
      }
      if (!history.length) {
        states.push({ item, state: "NEW" });
        continue;
      }
      const active = history.find((row) => row.verification_status === "ACTIVE");
      let same = false;
      if (active) {
        const payload = await Promise.resolve(
          publication.payloadForRender({ tenant, reportCardId: item.report_card_id, version: active.published_snapshot_version })
        );
        same = payload && payload.content_sha256 === item.content_sha256;
      }
      states.push({ item, state: same ? "SAME" : "DIFFERENT" });
    }
    return states;
  }

  function publicationRows(states, records) {
    const byId = new Map((records || []).map((record) => [record.report_card_id, record]));
    return states.map(({ item }) => {
      const record = byId.get(item.report_card_id);
      return {
        report_card_id: item.report_card_id,
        student_id: item.student.student_id,
        published_snapshot_version: record ? record.published_snapshot_version : 1,
        ...(record && record.public_id ? { public_id: record.public_id } : {}),
      };
    });
  }

  /** Publication officielle : uniquement l'empreinte de brouillon validée. */
  async function publish({ tenant, actor, classId, academicYearId, modelKey, period, expectedDraftSha256 } = {}) {
    const confirmed = typeof expectedDraftSha256 === "string" ? expectedDraftSha256.trim() : "";
    if (!confirmed) fail("DRAFT_CONFIRMATION_REQUIRED");
    const result = await computeClass({ tenant, classId, academicYearId, modelKey, period });
    if (result.draftSha256 !== confirmed) fail("DRAFT_CHANGED");
    if (!result.publishable) {
      fail("REPORT_CARD_INCOMPLETE", draftView(result).students.filter((item) => item.status !== "COMPLETE").map((item) => ({
        student_id: item.student_id,
        issues: item.issues.length ? item.issues : item.subject_totals.issues,
      })).concat(result.issues.filter((item) => item.severity === BLOCKING && !item.student_id).map((item) => ({ issues: [item] }))));
    }
    const states = await existingState(tenant, result.students);
    if (states.some((entry) => entry.state === "DIFFERENT")) {
      fail("PUBLICATION_ALREADY_EXISTS", states.filter((entry) => entry.state === "DIFFERENT").map((entry) => ({ report_card_id: entry.item.report_card_id })));
    }
    const toPublish = states.filter((entry) => entry.state === "NEW");
    if (!toPublish.length) {
      return { status: "ALREADY_PUBLISHED", draft_sha256: result.draftSha256, publications: publicationRows(states, []) };
    }
    const publishedAt = new Date().toISOString();
    const actorId = actor && actor.actorId ? String(actor.actorId) : null;
    if (!actorId) fail("RBAC_DENIED");
    const payloads = toPublish.map(({ item }) => ({
      report_card_id: item.report_card_id,
      published_snapshot_version: 1,
      school_id: result.schoolId,
      published_at: publishedAt,
      published_by: actorId,
      engine_id: item.content.engine_id,
      provenance: item.content.provenance,
      students: [item.student],
      academic_year_id: item.content.academic_year_id,
      class_id: item.content.class_id,
      model_key: item.content.model_key,
      period_scope: item.content.period_scope,
      content_sha256: item.content_sha256,
    }));
    let records;
    try {
      records = await publication.publishBatch({ tenant, payloads, lineage: { actor_id: actorId } });
    } catch (err) {
      if (err instanceof IdempotencyConflict || (err && err.name === "IdempotencyConflict")) {
        // Publication concurrente : relecture ; aucune ligne de ce lot n'a été écrite.
        const after = await existingState(tenant, result.students);
        if (after.every((entry) => entry.state === "SAME")) {
          return { status: "ALREADY_PUBLISHED", draft_sha256: result.draftSha256, publications: publicationRows(after, []) };
        }
        fail("CONCURRENCY_CONFLICT");
      }
      throw err;
    }
    return { status: "PUBLISHED", draft_sha256: result.draftSha256, publications: publicationRows(states, records) };
  }

  /**
   * Correction officielle (LOT 9) d'un bulletin publié par ce parcours : même
   * classe, même année, même modèle ÉPINGLÉ (profil + schéma + gabarit du
   * snapshot), même périmètre ; notes publiées actuelles. Refus si incomplet.
   */
  async function recomputeStudent({ tenant, payload, profile, schema }) {
    const pinned = {
      profile: { spec: profile, ref: payload.provenance.profile },
      schema: { spec: schema, ref: payload.provenance.schema },
      template: { ref: payload.provenance.template },
    };
    const result = await computeClass({
      tenant,
      classId: payload.class_id,
      academicYearId: payload.academic_year_id,
      modelKey: payload.model_key,
      period: payload.period_scope,
      pinned,
    });
    const item = result.students.find((entry) => entry.report_card_id === payload.report_card_id);
    if (!item) fail("FACTS_REQUIRED");
    if (!item.complete || result.issues.some((entry) => entry.severity === BLOCKING && !entry.student_id)) {
      fail("REPORT_CARD_INCOMPLETE", [{ student_id: item.student.student_id, issues: item.issues.length ? item.issues : item.student.subject_totals.issues }]);
    }
    return { student: item.student, content_sha256: item.content_sha256 };
  }

  return { computeClass, preview, publish, recomputeStudent };
}

module.exports = {
  ANNUAL,
  ReportCardClassPublicationError,
  createReportCardClassPublication,
  resolvePeriodScope,
  reportCardIdFor,
};
