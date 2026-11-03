"use strict";

/**
 * BULLETIN-UI-01 — adaptateur de PRÉSENTATION d'un bulletin du moteur
 * somafrik.report_card.v1 (profils déclarant `subjects`).
 *
 * Lit uniquement ce que le moteur a déjà calculé (`student.subject_totals`,
 * valeurs `exposed`) : aucun calcul, aucune somme, aucun arrondi ici. Le
 * sous-total d'une matière composée est celui du moteur (somme de ses
 * sous-matières) ; le total général est celui du moteur (somme des seules
 * lignes de premier niveau) : aucune double comptabilisation possible.
 *
 * Deux styles (configuration du gabarit de rendu, `presentation.style`) :
 *   - "simple"       (modèle A, La Colombière)  : une ligne par matière ;
 *   - "hierarchical" (modèle B, Berceau de la Sagesse) : matière principale,
 *     sous-total, puis ses sous-matières.
 * Sans configuration : "hierarchical" si le profil a une matière composée.
 *
 * Intitulés : ceux du profil s'ils existent, sinon les libellés de
 * l'établissement (`labels`), sinon l'identifiant. Rien n'est codé en dur.
 */

const STYLES = Object.freeze(["simple", "hierarchical"]);
const NOT_APPLICABLE = "NOT_APPLICABLE";

class ReportCardPresentationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardPresentationError";
    this.code = code;
  }
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function exposed(value) {
  if (value == null || typeof value !== "object") return null;
  if (value.kind === NOT_APPLICABLE) return null;
  return value.exposed == null ? null : value.exposed;
}

function periodEntries(profile) {
  const list = Array.isArray(profile?.periods) ? profile.periods : [];
  return list.map((period, index) =>
    typeof period === "string"
      ? { id: period, order: index + 1, label: "" }
      : { id: text(period.id), order: Number(period.order ?? index + 1), label: text(period.label) }
  );
}

function componentEntries(profile) {
  const list = Array.isArray(profile?.score_components) ? profile.score_components : [];
  return list.map((component) =>
    typeof component === "string" ? { id: component, label: "" } : { id: text(component.id), label: text(component.label) }
  );
}

function subjectEntry(profile, subjectId) {
  return (Array.isArray(profile?.subjects) ? profile.subjects : []).find((subject) => subject.id === subjectId) || null;
}

function rankView(rank) {
  if (!rank || typeof rank !== "object") return null;
  if (rank.kind === "RANK") return { value: rank.exposed, ranked: rank.ranked ?? null };
  return { value: null, reason: text(rank.reason) || "NOT_RANKED" };
}

/**
 * BULLETIN-UX — note en échec (affichage uniquement) : valeur strictement
 * inférieure à `ratio × maximum` de SA cellule (défaut : moitié du maximum ;
 * `presentation.failing_ratio` du gabarit si l'établissement en configure un).
 * Jamais pour un maximum, une note manquante, une valeur non applicable ou un
 * total incomplet. Aucune valeur, aucun total ni aucun rang n'est modifié.
 */
const DEFAULT_FAILING_RATIO = 0.5;

function numberOf(value) {
  if (value == null || typeof value !== "object") return Number.isFinite(value) ? value : null;
  if (Number.isFinite(value.internal)) return value.internal;
  return Number.isFinite(value.exposed) ? value.exposed : null;
}

function isFailing(value, max, ratio) {
  return Number.isFinite(value) && Number.isFinite(max) && max > 0 && value < ratio * max;
}

function totalView(total, ratio = DEFAULT_FAILING_RATIO) {
  if (!total || typeof total !== "object") return null;
  return {
    status: text(total.status) || null,
    points: exposed(total.points),
    max: exposed(total.max_points),
    percentage: exposed(total.percentage),
    rank: rankView(total.rank),
    failing: text(total.status) === "COMPLETE" && isFailing(numberOf(total.points), numberOf(total.max_points), ratio),
  };
}

function componentCell(component, ratio = DEFAULT_FAILING_RATIO) {
  if (!component || component.kind === NOT_APPLICABLE) return { state: NOT_APPLICABLE, value: null, max: null, failing: false };
  const numeric = component.kind === "NUMERIC";
  return {
    state: text(component.kind) || "MISSING",
    value: numeric ? component.exposed ?? null : null,
    max: component.max ?? null,
    failing: numeric && isFailing(Number.isFinite(component.internal) ? component.internal : component.exposed, component.max, ratio),
  };
}

function failingRatioOf(presentation) {
  const value = presentation ? presentation.failing_ratio : undefined;
  if (value === undefined || value === null) return DEFAULT_FAILING_RATIO;
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new ReportCardPresentationError("FAILING_RATIO_INVALID");
  return ratio;
}

function rowPeriods(row, periods, components, ratio) {
  const out = {};
  for (const period of periods) {
    const total = row.periods ? row.periods[period.id] : null;
    const view = totalView(total, ratio) || { status: NOT_APPLICABLE, points: null, max: null, percentage: null, rank: null, failing: false };
    if (row.kind !== "composite") {
      view.components = {};
      for (const component of components) {
        view.components[component.id] = componentCell(total && total.components ? total.components[component.id] : null, ratio);
      }
    }
    delete view.rank;
    out[period.id] = view;
  }
  return out;
}

function resolveStyle(requested, rows) {
  const value = text(requested);
  if (value && value !== "auto") {
    if (!STYLES.includes(value)) throw new ReportCardPresentationError("PRESENTATION_STYLE_INVALID");
    return value;
  }
  return rows.some((row) => row.kind === "composite") ? "hierarchical" : "simple";
}

/** Lignes dans l'ordre d'affichage : parent puis ses enfants (style hiérarchique) ou feuilles seules (style simple). */
function orderedRows(rows, style) {
  const byOrder = (a, b) => Number(a.order) - Number(b.order) || String(a.subject_id).localeCompare(String(b.subject_id));
  const top = rows.filter((row) => row.parent_id == null).sort(byOrder);
  const out = [];
  for (const row of top) {
    const children = rows.filter((child) => child.parent_id === row.subject_id).sort(byOrder);
    if (style === "hierarchical") {
      out.push({ row, level: 0 });
      for (const child of children) out.push({ row: child, level: 1 });
    } else if (row.kind === "composite") {
      for (const child of children) out.push({ row: child, level: 0, parent: row });
    } else {
      out.push({ row, level: 0 });
    }
  }
  return out;
}

/**
 * @param {object} input
 * @param {object} input.student élève du snapshot (résultat moteur, avec subject_totals)
 * @param {object} input.profile spécification du profil épinglé (provenance du snapshot)
 * @param {object} [input.labels] { school, className, academicYear, subjects:{code:libellé}, students:{code:{name}} }
 * @param {object} [input.presentation] { style, signatures } du gabarit de rendu
 * @param {object} [input.meta] { official, report_card_id, version, period_scope, published_at, verification_status }
 */
function buildStudentPresentation({ student, profile, labels = {}, presentation = {}, meta = {} } = {}) {
  if (!student || typeof student !== "object") throw new ReportCardPresentationError("STUDENT_REQUIRED");
  const totals = student.subject_totals;
  if (!totals || !Array.isArray(totals.rows)) throw new ReportCardPresentationError("SUBJECT_TOTALS_REQUIRED");
  if (!profile || !Array.isArray(profile.subjects)) throw new ReportCardPresentationError("PROFILE_REQUIRED");

  const allPeriods = periodEntries(profile);
  const scopeIds = Array.isArray(totals.scope?.periods) ? totals.scope.periods : allPeriods.map((period) => period.id);
  const periodLabels = (presentation && presentation.period_labels) || {};
  const periods = scopeIds.map((id) => {
    const entry = allPeriods.find((period) => period.id === id);
    return { id, label: (entry && entry.label) || text(periodLabels[id]) || id };
  });
  const componentLabels = (presentation && presentation.component_labels) || {};
  const components = componentEntries(profile).map((component) => ({
    id: component.id,
    label: component.label || text(componentLabels[component.id]) || component.id,
  }));
  const subjectLabels = labels.subjects || {};
  const style = resolveStyle(presentation.style, totals.rows);
  const failingRatio = failingRatioOf(presentation);

  const rows = orderedRows(totals.rows, style).map(({ row, level, parent }) => {
    const spec = subjectEntry(profile, row.subject_id);
    const label = text(spec && spec.label) || text(subjectLabels[row.subject_id]) || row.subject_id;
    const parentLabel = parent ? text(subjectEntry(profile, parent.subject_id)?.label) || text(subjectLabels[parent.subject_id]) || parent.subject_id : null;
    return {
      subject_id: row.subject_id,
      parent_id: row.parent_id ?? null,
      kind: row.kind === "composite" ? "composite" : "simple",
      level,
      label,
      ...(parentLabel ? { group_label: parentLabel } : {}),
      periods: rowPeriods(row, periods, components, failingRatio),
      annual: totals.scope && totals.scope.annual ? (() => {
        const view = totalView(row.annual, failingRatio);
        if (view) delete view.rank;
        return view;
      })() : null,
    };
  });

  const periodTotals = {};
  for (const period of periods) periodTotals[period.id] = totalView(totals.periods ? totals.periods[period.id] : null, failingRatio);
  const studentCode = text(student.student_id);
  const studentLabel = labels.students ? labels.students[studentCode] : null;
  const decision = (Array.isArray(student.slots) ? student.slots : []).find((slot) => slot && slot.kind === "DECISION");
  const signatures = (Array.isArray(presentation.signatures) ? presentation.signatures : []).map(text).filter(Boolean);

  return {
    official: meta.official === true,
    report_card_id: meta.report_card_id ?? null,
    version: meta.version ?? null,
    verification_status: meta.verification_status ?? null,
    published_at: meta.published_at ?? null,
    period_scope: meta.period_scope ?? null,
    style,
    school: { name: text(labels.school) || null },
    class_name: text(labels.className) || null,
    academic_year: text(labels.academicYear) || null,
    student: { code: studentCode, name: text(studentLabel && studentLabel.name) || null },
    periods,
    components,
    rows,
    totals: {
      periods: periodTotals,
      annual: totals.scope && totals.scope.annual ? totalView(totals.annual, failingRatio) : null,
    },
    status: text(totals.status) || null,
    failing_ratio: failingRatio,
    cohort_size: totals.cohort_size ?? null,
    issues: Array.isArray(totals.issues) ? totals.issues.map((issue) => ({ ...issue })) : [],
    decision: decision ? { passed: decision.passed === true ? true : decision.passed === false ? false : null } : null,
    signatures,
  };
}

/** Un snapshot sans subject_totals (bulletins historiques) n'a pas de présentation par matière : rendu générique conservé. */
function hasSubjectTotals(payload) {
  const students = Array.isArray(payload && payload.students) ? payload.students : [];
  return students.length > 0 && students.every((student) => student && student.subject_totals && Array.isArray(student.subject_totals.rows));
}

module.exports = {
  STYLES,
  ReportCardPresentationError,
  buildStudentPresentation,
  hasSubjectTotals,
};
