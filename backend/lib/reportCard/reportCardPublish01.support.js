"use strict";

/**
 * BULLETIN-PUBLISH-01 — support de test uniquement (non importé en runtime).
 * Construit, à partir des fixtures fictives BULLETIN-MODEL-01, des profils
 * publiables (`fact_sources`) et des lignes de notes au format
 * listClassGradeSources (TJ = deux interrogations en mode `sum`).
 */

const simpleFixture = require("./fixtures/model-01/subjects-simple.json");
const compositeFixture = require("./fixtures/model-01/subjects-composite.json");
const { validateSpec, resolveSubjectComponentRule } = require("./academicRuleProfile");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const TERM_NAMES = Object.freeze({ T1: "Trimestre 1", T2: "Deuxième trimestre", T3: "TRIMESTRE   3" });

function simpleProfile() {
  const profile = clone(simpleFixture.profile);
  profile.fact_sources = {
    components: {
      TJ: { evaluation_types: ["interrogation", "devoir"], aggregation: "sum" },
      EX: { evaluation_types: ["examen"], aggregation: "sum" },
    },
    periods: {
      T1: { term_names: ["Trimestre 1", "Premier trimestre"] },
      T2: { term_names: ["Trimestre 2", "Deuxième trimestre"] },
      T3: { term_names: ["Trimestre 3", "Troisième trimestre"] },
    },
  };
  return profile;
}

function compositeProfile() {
  const profile = clone(compositeFixture.profile);
  profile.fact_sources = {
    components: {
      TJ: { evaluation_types: ["devoir"], aggregation: "weighted_average" },
      EX: { evaluation_types: ["examen"], aggregation: "weighted_average" },
    },
    periods: {
      T1: { term_names: ["Trimestre 1"] },
      T2: { term_names: ["Trimestre 2"] },
      T3: { term_names: ["Trimestre 3"] },
    },
  };
  return profile;
}

/**
 * Plan d'évaluations et de notes pour des faits {student_id, subject_id,
 * period_id, score_component_id, raw_score}. Mode `sum` : TJ réparti sur deux
 * interrogations de maximum moitié ; EX = un examen. Mode `weighted_average` :
 * une évaluation par cellule, de maximum égal à celui de la cellule.
 */
function gradePlan(profileRaw, facts, { mode, termNames = TERM_NAMES }) {
  const profile = validateSpec(clone(profileRaw));
  const evaluations = new Map();
  const grades = [];
  for (const fact of facts) {
    const rule = resolveSubjectComponentRule(profile, fact.subject_id, fact.period_id, fact.score_component_id);
    if (rule.state !== "APPLICABLE") continue;
    const parts =
      mode === "sum" && fact.score_component_id === "TJ"
        ? [
            { suffix: "A", type: "interrogation", max: rule.max / 2, score: Math.floor(fact.raw_score / 2) },
            { suffix: "B", type: "interrogation", max: rule.max / 2, score: fact.raw_score - Math.floor(fact.raw_score / 2) },
          ]
        : [{ suffix: "U", type: fact.score_component_id === "TJ" ? "devoir" : "examen", max: rule.max, score: fact.raw_score }];
    for (const part of parts) {
      const key = `${fact.subject_id}|${fact.period_id}|${fact.score_component_id}|${part.suffix}`;
      if (!evaluations.has(key)) {
        evaluations.set(key, {
          key,
          subject_code: fact.subject_id,
          term_name: termNames[fact.period_id],
          type_code: part.type,
          max_score: part.max,
        });
      }
      grades.push({ evaluation_key: key, student_code: fact.student_id, score: part.score });
    }
  }
  return { evaluations: [...evaluations.values()], grades };
}

/** Lignes listClassGradeSources pour les tests purs (sans base). */
function gradeRowsFor(profileRaw, facts, { mode, schoolId, yearId, studentUuid = (code) => `uuid-${code}`, parentOf = () => null } = {}) {
  const plan = gradePlan(profileRaw, facts, { mode });
  const byKey = new Map(plan.evaluations.map((evaluation) => [evaluation.key, evaluation]));
  return plan.grades.map((grade, index) => {
    const evaluation = byKey.get(grade.evaluation_key);
    return {
      grade_id: `g-${index + 1}`,
      grade_school_id: schoolId,
      student_uuid: studentUuid(grade.student_code),
      student_code: grade.student_code,
      student_school_id: schoolId,
      subject_code: evaluation.subject_code,
      subject_school_id: schoolId,
      subject_status: "active",
      subject_parent_code: parentOf(evaluation.subject_code),
      term_name: evaluation.term_name,
      term_year_id: yearId,
      evaluation_id: `e-${evaluation.key}`,
      evaluation_school_id: schoolId,
      evaluation_status: "published",
      evaluation_active: true,
      evaluation_type_code: evaluation.type_code,
      evaluation_type_text: evaluation.type_code,
      max_score: evaluation.max_score,
      coefficient: 1,
      score: grade.score,
      grade_status: "graded",
      publication_status: "published",
      course_id: `course-${parentOf(evaluation.subject_code) || evaluation.subject_code}`,
    };
  });
}

module.exports = {
  TERM_NAMES,
  simpleFixture,
  compositeFixture,
  simpleProfile,
  compositeProfile,
  gradePlan,
  gradeRowsFor,
};
