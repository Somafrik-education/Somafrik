/**
 * D3.6b — Contrat canonique Notes / Évaluations (statuts, score, calcul).
 * Moteur normatif partagé ; web/mobile restent des consommateurs.
 */

const EVALUATION_STATUSES = Object.freeze(["draft", "open", "locked", "published", "archived"]);
const GRADE_STATUSES = Object.freeze(["graded", "absent", "excused", "not_submitted", "exempt"]);
const EXCLUDED_FROM_AVERAGE = Object.freeze(new Set(["absent", "excused", "not_submitted", "exempt"]));

const EVAL_STATUS_TO_UI = Object.freeze({
  draft: "Brouillon",
  open: "Ouverte",
  locked: "Validée",
  published: "Publiée",
  archived: "Annulée",
});

const EVAL_STATUS_FROM_UI = Object.freeze({
  brouillon: "draft",
  ouverte: "open",
  "saisie terminee": "open",
  "saisie terminée": "open",
  validee: "locked",
  validée: "locked",
  publiee: "published",
  publiée: "published",
  annulee: "archived",
  annulée: "archived",
  draft: "draft",
  open: "open",
  locked: "locked",
  published: "published",
  archived: "archived",
});

const GRADE_STATUS_TO_UI = Object.freeze({
  graded: "Saisie",
  absent: "Absente",
  excused: "Justifiée",
  not_submitted: "Non justifiée",
  exempt: "Dispensée",
});

const GRADE_STATUS_FROM_UI = Object.freeze({
  saisie: "graded",
  validee: "graded",
  validée: "graded",
  corrigee: "graded",
  corrigée: "graded",
  absente: "absent",
  justifiee: "excused",
  justifiée: "excused",
  "non justifiee": "not_submitted",
  "non justifiée": "not_submitted",
  "en attente": "not_submitted",
  dispensee: "exempt",
  dispensée: "exempt",
  graded: "graded",
  absent: "absent",
  excused: "excused",
  not_submitted: "not_submitted",
  exempt: "exempt",
});

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toEvaluationStatus(value, fallback = "draft") {
  const mapped = EVAL_STATUS_FROM_UI[normalizeKey(value)];
  return EVALUATION_STATUSES.includes(mapped) ? mapped : fallback;
}

function fromEvaluationStatus(value) {
  const status = toEvaluationStatus(value, "draft");
  return EVAL_STATUS_TO_UI[status] ?? "Brouillon";
}

function toGradeStatus(value, hasScore = false) {
  const mapped = GRADE_STATUS_FROM_UI[normalizeKey(value)];
  if (GRADE_STATUSES.includes(mapped)) return mapped;
  return hasScore ? "graded" : "not_submitted";
}

function fromGradeStatus(value) {
  const status = toGradeStatus(value, true);
  return GRADE_STATUS_TO_UI[status] ?? "Saisie";
}

function isPublishedEvaluationStatus(value) {
  return toEvaluationStatus(value, "") === "published";
}

function isLockedEvaluationStatus(value) {
  const status = toEvaluationStatus(value, "");
  return status === "locked" || status === "published" || status === "archived";
}

/** UI « Validée » = PostgreSQL `locked`. Seul statut qui ouvre la saisie des notes. */
function isValidatedEvaluationStatus(value) {
  return toEvaluationStatus(value, "") === "locked";
}

/**
 * Valide score / statut / barème / coefficient.
 * @returns {string|null} message d'erreur ou null
 */
function validateGradeContract({ status, score, maxScore, coefficient } = {}) {
  const gradeStatus = toGradeStatus(status, score != null && score !== "");
  const max = Number(maxScore);
  const coef = Number(coefficient ?? 1);

  if (!(max > 0)) return "Le barème (max_score) doit être strictement positif.";
  if (!(coef > 0)) return "Le coefficient doit être strictement positif.";

  if (gradeStatus === "graded") {
    if (score == null || score === "") return "Une note graded exige un score.";
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) return "Score invalide.";
    if (numeric < 0 || numeric > max) return `Le score doit être entre 0 et ${max}.`;
    return null;
  }

  if (score != null && score !== "") {
    return `Le statut ${gradeStatus} exige score = null.`;
  }
  return null;
}

function validateEvaluationContract({ maxScore, coefficient, status } = {}) {
  const max = Number(maxScore);
  const coef = Number(coefficient ?? 1);
  if (!(max > 0)) return "Le barème (max_score) doit être strictement positif.";
  if (!(coef > 0)) return "Le coefficient doit être strictement positif.";
  const evalStatus = toEvaluationStatus(status, "");
  if (!EVALUATION_STATUSES.includes(evalStatus)) {
    return `Statut d'évaluation invalide: ${status}`;
  }
  return null;
}

function normalizedScore(score, maxScore) {
  const max = Number(maxScore);
  const value = Number(score);
  if (!(max > 0) || !Number.isFinite(value)) return null;
  return value / max;
}

function gradeCountsInAverage(note = {}) {
  const status = toGradeStatus(note.gradeStatus ?? note.status, note.value != null || note.score != null);
  if (EXCLUDED_FROM_AVERAGE.has(status)) return false;
  if (status !== "graded") return false;
  const score = note.value ?? note.score;
  return score != null && score !== "" && Number.isFinite(Number(score));
}

/**
 * Moyenne pondérée canonique sur notes éligibles.
 * Retourne la moyenne en échelle d'affichage (défaut /20).
 */
function weightedAverage(notes = [], { displayScale = 20 } = {}) {
  let weighted = 0;
  let coefficients = 0;

  for (const note of notes) {
    if (!gradeCountsInAverage(note)) continue;
    const maxScore = Number(note.maxScore ?? note.scale ?? displayScale);
    const score = Number(note.value ?? note.score);
    const coefficient = Number(note.evaluationCoefficient ?? note.coefficient ?? 1);
    if (!(coefficient > 0) || !(maxScore > 0)) continue;
    const normalized = normalizedScore(score, maxScore);
    if (normalized == null) continue;
    weighted += normalized * coefficient;
    coefficients += coefficient;
  }

  if (!coefficients) {
    return { average: 0, totalCoefficients: 0, displayScale: displayScale };
  }

  const unitAverage = weighted / coefficients;
  return {
    average: unitAverage * displayScale,
    totalCoefficients: coefficients,
    displayScale,
  };
}

function formatAverageForDisplay(average, digits = 2) {
  const value = Number(average);
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  return value.toFixed(digits);
}

/**
 * Priorité de conservation des doublons (miroir SQL ORDER BY DESC).
 */
function pickCanonicalGradeRow(rows = []) {
  const list = Array.isArray(rows) ? [...rows] : [];
  list.sort((left, right) => {
    const version = compareDesc(left.version, right.version);
    if (version !== 0) return version;
    const updated = compareDesc(left.updated_at ?? left.updatedAt, right.updated_at ?? right.updatedAt);
    if (updated !== 0) return updated;
    const created = compareDesc(left.created_at ?? left.createdAt, right.created_at ?? right.createdAt);
    if (created !== 0) return created;
    return compareDesc(String(left.id ?? ""), String(right.id ?? ""));
  });
  return list[0] ?? null;
}

function compareDesc(left, right) {
  const a = toSortable(left);
  const b = toSortable(right);
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a > b ? -1 : 1;
}

function toSortable(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(value).trim() !== "") {
    // Prefer numeric for version; dates still parse via Date.parse below when needed.
    if (!String(value).includes("-") && !String(value).includes(":")) return asNumber;
  }
  const asDate = Date.parse(String(value));
  if (!Number.isNaN(asDate)) return asDate;
  return String(value);
}

module.exports = {
  EVALUATION_STATUSES,
  GRADE_STATUSES,
  EXCLUDED_FROM_AVERAGE,
  toEvaluationStatus,
  fromEvaluationStatus,
  toGradeStatus,
  fromGradeStatus,
  isPublishedEvaluationStatus,
  isLockedEvaluationStatus,
  isValidatedEvaluationStatus,
  validateGradeContract,
  validateEvaluationContract,
  normalizedScore,
  gradeCountsInAverage,
  weightedAverage,
  formatAverageForDisplay,
  pickCanonicalGradeRow,
};
