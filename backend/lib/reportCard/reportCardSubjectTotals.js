"use strict";

/**
 * BULLETIN-MODEL-01 — totaux par matière du moteur somafrik.report_card.v1
 * (profils déclarant `subjects`). Pur et déterministe ; aucune donnée live.
 *
 * Sous-matière / matière simple, période p :
 *   points = Σ (note × poids) des composantes NUMERIC
 *   max    = Σ (max  × poids) des composantes attendues (NUMERIC + MISSING)
 * Matière composée : Σ de ses sous-matières (elle n'a aucune composante propre).
 * Période : Σ des lignes de premier niveau (matières simples + composées).
 * Année : Σ des périodes applicables. Pourcentage = 100 × points / max.
 * Arrondi : affichage uniquement (`exposed`) ; les valeurs internes ne sont jamais arrondies.
 *
 * États : COMPLETE · INCOMPLETE (au moins une note attendue MISSING) ·
 * NOT_APPLICABLE (rien d'attendu). Une note MISSING n'est jamais 0 : elle ne
 * rapporte aucun point et son maximum reste attendu.
 */

const { resolveSubjectComponentRule } = require("./academicRuleProfile");

/** Statut d'un fait transmis au moteur (défaut : PUBLISHED). */
const FACT_STATUSES = Object.freeze(["PUBLISHED", "UNPUBLISHED", "CANCELLED"]);
const COMPLETE = "COMPLETE";
const INCOMPLETE = "INCOMPLETE";
const NOT_APPLICABLE = "NOT_APPLICABLE";

function orderedPeriods(profile) {
  return [...profile.periods].sort((a, b) => a.order - b.order).map((period) => period.id);
}

function componentIds(profile) {
  return profile.score_components.map((component) => component.id);
}

function leafSubjects(profile) {
  return profile.subjects.filter((subject) => subject.kind !== "composite");
}

/** Cellules attendues sans fait : MISSING (NOT_ENTERED), jamais 0. */
function expectedMissingCells(profile, studentId, cells) {
  const present = new Set(cells.map((cell) => `${cell.subject_id}\0${cell.period_id}\0${cell.score_component_id}`));
  const missing = [];
  for (const subject of leafSubjects(profile)) {
    for (const periodId of orderedPeriods(profile)) {
      for (const componentId of componentIds(profile)) {
        const rule = resolveSubjectComponentRule(profile, subject.id, periodId, componentId);
        if (rule.state !== "APPLICABLE") continue;
        if (present.has(`${subject.id}\0${periodId}\0${componentId}`)) continue;
        missing.push({
          student_id: studentId,
          subject_id: subject.id,
          period_id: periodId,
          score_component_id: componentId,
          max: rule.max,
          weight: rule.weight,
          kind: "MISSING",
          reason: "NOT_ENTERED",
          internal: null,
          exposed: null,
        });
      }
    }
  }
  return missing;
}

function combineStatus(statuses) {
  const relevant = statuses.filter((status) => status !== NOT_APPLICABLE);
  if (!relevant.length) return NOT_APPLICABLE;
  return relevant.includes(INCOMPLETE) ? INCOMPLETE : COMPLETE;
}

function sumTotals(parts, round) {
  const applicable = parts.filter((part) => part.status !== NOT_APPLICABLE);
  const points = applicable.reduce((acc, part) => acc + part.points.internal, 0);
  const max = applicable.reduce((acc, part) => acc + part.max_points.internal, 0);
  return totalOf(points, max, combineStatus(parts.map((part) => part.status)), round);
}

function totalOf(points, max, status, round) {
  return {
    status,
    points: { internal: points, exposed: round(points) },
    max_points: { internal: max, exposed: round(max) },
    percentage: max > 0 ? { internal: (100 * points) / max, exposed: round((100 * points) / max) } : { kind: NOT_APPLICABLE },
  };
}

function componentView(cell, rule) {
  if (rule.state !== "APPLICABLE") {
    return { kind: NOT_APPLICABLE, internal: null, exposed: null, max: null };
  }
  const view = { kind: cell.kind, internal: cell.internal, exposed: cell.exposed, max: rule.max };
  if (rule.weight !== 1) view.weight = rule.weight;
  if (cell.reason) view.reason = cell.reason;
  return view;
}

function leafPeriodTotal(profile, subject, periodId, cellsByKey, round) {
  const components = {};
  let points = 0;
  let max = 0;
  let expected = 0;
  let missing = 0;
  for (const componentId of componentIds(profile)) {
    const rule = resolveSubjectComponentRule(profile, subject.id, periodId, componentId);
    const cell = cellsByKey.get(`${subject.id}\0${periodId}\0${componentId}`);
    components[componentId] = componentView(cell || {}, rule);
    if (rule.state !== "APPLICABLE" || !cell) continue;
    expected += 1;
    if (cell.kind === "NUMERIC") {
      points += cell.internal * cell.weight;
      max += cell.max * cell.weight;
    } else if (cell.kind === "MISSING") {
      missing += 1;
      max += cell.max * cell.weight;
    }
  }
  const status = expected === 0 ? NOT_APPLICABLE : missing ? INCOMPLETE : COMPLETE;
  return { ...totalOf(points, max, status, round), components };
}

function compareIssue(a, b) {
  return (
    String(a.code).localeCompare(String(b.code)) ||
    String(a.subject_id).localeCompare(String(b.subject_id)) ||
    String(a.period_id).localeCompare(String(b.period_id)) ||
    String(a.score_component_id).localeCompare(String(b.score_component_id))
  );
}

function collectIssues(cells) {
  const issues = [];
  for (const cell of cells) {
    const where = { subject_id: cell.subject_id, period_id: cell.period_id, score_component_id: cell.score_component_id };
    if (cell.kind === "MISSING") issues.push({ code: "MISSING_SCORE", reason: cell.reason, ...where });
    if (cell.kind === "NOT_CONFIGURED") issues.push({ code: "SUBJECT_NOT_CONFIGURED", ...where });
  }
  return issues.sort(compareIssue);
}

/**
 * @param {object} profile spécification validée (avec `subjects`)
 * @param {object[]} cells cellules d'un élève (buildCells)
 * @param {(value:number)=>number} round arrondi d'affichage du profil
 */
function computeSubjectTotals(profile, cells, round) {
  const periods = orderedPeriods(profile);
  const cellsByKey = new Map(cells.map((cell) => [`${cell.subject_id}\0${cell.period_id}\0${cell.score_component_id}`, cell]));
  const leafRows = new Map();
  for (const subject of leafSubjects(profile)) {
    const perPeriod = {};
    for (const periodId of periods) perPeriod[periodId] = leafPeriodTotal(profile, subject, periodId, cellsByKey, round);
    leafRows.set(subject.id, perPeriod);
  }
  const rows = profile.subjects.map((subject) => {
    let perPeriod;
    if (subject.kind === "composite") {
      const children = profile.subjects.filter((child) => child.parent_id === subject.id);
      perPeriod = {};
      for (const periodId of periods) {
        perPeriod[periodId] = sumTotals(children.map((child) => leafRows.get(child.id)[periodId]), round);
      }
    } else {
      perPeriod = leafRows.get(subject.id);
    }
    const row = {
      subject_id: subject.id,
      parent_id: subject.parent_id ?? null,
      kind: subject.kind,
      order: subject.order,
      periods: perPeriod,
    };
    if (profile.annual !== false) row.annual = sumTotals(periods.map((periodId) => perPeriod[periodId]), round);
    return row;
  });
  const topLevel = rows.filter((row) => row.parent_id === null);
  const periodTotals = {};
  for (const periodId of periods) {
    periodTotals[periodId] = sumTotals(topLevel.map((row) => row.periods[periodId]), round);
  }
  const result = { rows, periods: periodTotals };
  if (profile.annual !== false) result.annual = sumTotals(periods.map((periodId) => periodTotals[periodId]), round);
  const overall = profile.annual !== false ? result.annual.status : combineStatus(Object.values(periodTotals).map((total) => total.status));
  result.status = overall === INCOMPLETE ? INCOMPLETE : COMPLETE;
  result.issues = collectIssues(cells);
  return result;
}

module.exports = {
  FACT_STATUSES,
  expectedMissingCells,
  computeSubjectTotals,
};
