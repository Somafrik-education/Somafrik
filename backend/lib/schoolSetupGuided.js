"use strict";

/**
 * Configuration guidée établissement — 10 étapes.
 * LOT 0 `GET /api/v2/school-setup/status` reste le statut dérivé 3-core.
 * Ici : curseur persisté + étapes validées ∩ données réellement présentes.
 */

const { BusinessError } = require("../services/authService");
const { resolveSchoolSetupTenant, loadSchoolSetupSnapshot } = require("./schoolSetupStatus");

const GUIDED_STEP_KEYS = Object.freeze([
  "establishment",
  "academicYear",
  "structure",
  "subjects",
  "teachers",
  "students",
  "finance",
  "pedagogy",
  "communication",
  "users",
]);

const GUIDED_STEP_LABELS = Object.freeze({
  establishment: "Informations établissement",
  academicYear: "Année scolaire",
  structure: "Structure pédagogique",
  subjects: "Matières",
  teachers: "Enseignants",
  students: "Élèves",
  finance: "Finance",
  pedagogy: "Paramètres pédagogiques",
  communication: "Communication",
  users: "Utilisateurs et droits",
});

const GUIDED_STEP_TOTAL = 10;
const GUIDED_OPERATIONAL_STEP_TOTAL = 6;
const REQUIRED_STEP_KEYS = GUIDED_STEP_KEYS.slice(0, GUIDED_OPERATIONAL_STEP_TOTAL);

function asCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function filled(value) {
  return String(value ?? "").trim().length > 0;
}

function stepSatisfied(stepKey, snapshot = {}) {
  switch (stepKey) {
    case "establishment":
      return Boolean(
        snapshot.hasName &&
          snapshot.hasCountry &&
          snapshot.hasAddress &&
          snapshot.hasPhone &&
          snapshot.hasCurrency,
      );
    case "academicYear":
      return Boolean(snapshot.hasCurrentOrOpenAcademicYear && snapshot.hasAcademicYearDates);
    case "structure":
      return asCount(snapshot.activatedLevelCount) >= 1
        && asCount(snapshot.activatedGroupCount) >= 1
        && asCount(snapshot.classCount) >= 1;
    case "subjects":
      return asCount(snapshot.subjectCount) >= 1;
    case "teachers":
      return asCount(snapshot.teacherCount) >= 1 && asCount(snapshot.teacherAssignmentCount) >= 1;
    case "students":
      return asCount(snapshot.enrolledStudentCount) >= 1;
    case "finance":
      return asCount(snapshot.feeGridCount) >= 1 || asCount(snapshot.paymentMethodCount) >= 1;
    case "pedagogy":
      return asCount(snapshot.evaluationTypeCount) >= 1;
    case "communication":
      return Boolean(snapshot.notificationsConfigured);
    case "users":
      return asCount(snapshot.userCount) >= 1;
    default:
      return false;
  }
}

function normalizeCompleted(list) {
  const seen = new Set();
  const next = [];
  for (const key of GUIDED_STEP_KEYS) {
    if ((list ?? []).includes(key) && !seen.has(key)) {
      seen.add(key);
      next.push(key);
    }
  }
  return next;
}

function consecutiveValidCompleted(persistedSteps, snapshot) {
  const persisted = persistedSteps ?? [];
  const bootstrapFromCanonical = persisted.length === 0;
  const completed = [];
  for (const key of GUIDED_STEP_KEYS) {
    if (!stepSatisfied(key, snapshot)) break;
    if (bootstrapFromCanonical || persisted.includes(key)) {
      completed.push(key);
    } else {
      break;
    }
  }
  return completed;
}

function deriveGuidedProgress(snapshot = {}, persisted = {}, schoolId = "") {
  const completedSteps = consecutiveValidCompleted(normalizeCompleted(persisted.completedSteps), snapshot);
  const percent = completedSteps.length * 10;
  const lastValidStep = completedSteps.length;
  const currentStep = percent >= 100 ? 10 : lastValidStep + 1;
  const nextStepKey = percent >= 100 ? null : GUIDED_STEP_KEYS[currentStep - 1];
  const operational = REQUIRED_STEP_KEYS.every((key) => completedSteps.includes(key));
  return {
    completedSteps,
    currentStep,
    lastValidStep,
    nextStepKey,
    nextStepLabel: nextStepKey ? GUIDED_STEP_LABELS[nextStepKey] : null,
    percent,
    schoolId: String(schoolId ?? ""),
    status: operational ? "operational" : "configuration_required",
    steps: GUIDED_STEP_KEYS.map((key, index) => ({
      key,
      index: index + 1,
      label: GUIDED_STEP_LABELS[key],
      done: completedSteps.includes(key),
      unlocked: index <= lastValidStep,
    })),
    updatedAt: persisted.updatedAt ?? null,
  };
}

function canUpdateGuided(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  return (
    permissions.has("Paramètres Établissement:UPDATE")
    || permissions.has("ALL_PRIVILEGES")
    || permissions.has("COUNTRY_PRIVILEGES")
    || permissions.has("Gérer établissements")
  );
}

function createMemoryProgressStore(seed = {}) {
  const rows = { ...seed };
  return {
    async load(schoolId) {
      const row = rows[String(schoolId)];
      return row
        ? { lastValidStep: row.lastValidStep, completedSteps: [...row.completedSteps], updatedAt: row.updatedAt }
        : { lastValidStep: 0, completedSteps: [], updatedAt: null };
    },
    async save(schoolId, row) {
      rows[String(schoolId)] = {
        lastValidStep: row.lastValidStep,
        completedSteps: [...row.completedSteps],
        updatedAt: row.updatedAt,
      };
    },
  };
}

function createPgProgressStore(one, query) {
  return {
    async load(schoolId) {
      const row = await one(
        `SELECT last_valid_step, completed_steps, updated_at
         FROM school_setup_progress
         WHERE school_id::text = $1`,
        [String(schoolId)],
      );
      if (!row) return { lastValidStep: 0, completedSteps: [], updatedAt: null };
      const raw = row.completed_steps;
      const completedSteps = Array.isArray(raw) ? raw : [];
      return {
        lastValidStep: Number(row.last_valid_step) || 0,
        completedSteps,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    },
    async save(schoolId, row) {
      await query(
        `INSERT INTO school_setup_progress (school_id, last_valid_step, completed_steps, updated_at)
         VALUES ($1::uuid, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (school_id) DO UPDATE SET
           last_valid_step = EXCLUDED.last_valid_step,
           completed_steps = EXCLUDED.completed_steps,
           updated_at = EXCLUDED.updated_at`,
        [String(schoolId), row.lastValidStep, JSON.stringify(row.completedSteps), row.updatedAt],
      );
    },
  };
}

function resolveProgressStore(input) {
  if (input?.progressStore && typeof input.progressStore.load === "function") {
    return input.progressStore;
  }
  if (typeof input?.one === "function" && typeof input?.dbQuery === "function") {
    return createPgProgressStore(input.one, input.dbQuery);
  }
  throw new BusinessError(503, "Source de données indisponible.");
}

async function countExact(one, sql, params) {
  if (typeof one !== "function") {
    throw new BusinessError(503, "Source de données indisponible.");
  }
  const row = await one(sql, params);
  return asCount(row?.c ?? row?.count ?? 0);
}

async function loadSchoolSetupGuidedSnapshot(one, schoolId) {
  const id = String(schoolId ?? "").trim();
  if (!id) {
    throw new BusinessError(403, "Accès refusé: établissement hors périmètre.");
  }
  const base = await loadSchoolSetupSnapshot(one, id);
  const params = [id];
  const school = await one(
    `SELECT s.name, s.country_id, s.address, s.phone, s.logo_url, s.profile_payload,
            c.currency AS country_currency
     FROM schools s
     LEFT JOIN countries c ON c.id = s.country_id
     WHERE s.id::text = $1`,
    params,
  );
  const profile = school?.profile_payload && typeof school.profile_payload === "object" ? school.profile_payload : {};
  const currency = String(profile.currency ?? school?.country_currency ?? "").trim();
  const [
    datedYearCount,
    enrolledStudentCount,
    teacherAssignmentCount,
    paymentMethodCount,
    evaluationTypeCount,
    userCount,
  ] = await Promise.all([
    countExact(
      one,
      `SELECT COUNT(*)::int AS c
       FROM academic_years
       WHERE school_id::text = $1
         AND (is_current = TRUE OR lower(btrim(COALESCE(status, ''))) = 'open')
         AND start_date IS NOT NULL
         AND end_date IS NOT NULL`,
      params,
    ),
    countExact(
      one,
      `SELECT COUNT(*)::int AS c
       FROM enrollments e
       INNER JOIN students st ON st.id = e.student_id
       WHERE st.school_id::text = $1
         AND e.class_id IS NOT NULL`,
      params,
    ),
    countExact(
      one,
      `SELECT COUNT(*)::int AS c
       FROM teacher_assignments ta
       INNER JOIN teachers t ON t.id = ta.teacher_id
       WHERE t.school_id::text = $1
         AND ta.status = 'active'
         AND ta.class_id IS NOT NULL
         AND ta.subject_id IS NOT NULL`,
      params,
    ),
    countExact(
      one,
      `SELECT COUNT(*)::int AS c
       FROM school_payment_methods
       WHERE school_id::text = $1 AND is_active = TRUE`,
      params,
    ),
    countExact(
      one,
      `SELECT COUNT(*)::int AS c
       FROM evaluation_types
       WHERE school_id::text = $1`,
      params,
    ),
    countExact(
      one,
      `SELECT COUNT(*)::int AS c
       FROM users
       WHERE school_id::text = $1`,
      params,
    ),
  ]);

  return {
    ...base,
    hasName: filled(school?.name),
    hasCountry: Boolean(school?.country_id),
    hasAddress: filled(school?.address),
    hasPhone: filled(school?.phone),
    hasCurrency: filled(currency),
    hasAcademicYearDates: datedYearCount >= 1,
    enrolledStudentCount,
    teacherAssignmentCount,
    paymentMethodCount,
    evaluationTypeCount,
    userCount,
  };
}

async function resolveGuidedContext(input = {}) {
  const tenant = await resolveSchoolSetupTenant(input);
  const snapshot =
    typeof input.loadSnapshot === "function"
      ? await input.loadSnapshot(tenant)
      : await loadSchoolSetupGuidedSnapshot(input.one, tenant.schoolId);
  const progressStore = resolveProgressStore(input);
  const persisted = await progressStore.load(tenant.schoolId);
  return { tenant, snapshot: snapshot || {}, progressStore, persisted };
}

async function getSchoolSetupGuided(input = {}) {
  const { tenant, snapshot, persisted } = await resolveGuidedContext(input);
  return deriveGuidedProgress(snapshot, persisted, tenant.schoolId);
}

async function completeGuidedStep(input = {}) {
  if (!canUpdateGuided(input.principal)) {
    throw new BusinessError(403, "Accès refusé: permission de configuration requise.");
  }
  const stepKey = String(input.stepKey ?? "").trim();
  const stepIndex = GUIDED_STEP_KEYS.indexOf(stepKey);
  if (stepIndex < 0) {
    throw new BusinessError(400, "Étape de configuration inconnue.");
  }

  const { tenant, snapshot, progressStore, persisted } = await resolveGuidedContext(input);

  for (let index = 0; index < stepIndex; index += 1) {
    const previous = GUIDED_STEP_KEYS[index];
    if (!stepSatisfied(previous, snapshot)) {
      const error = new BusinessError(409, "STEP_DEPENDENCY: l'étape précédente n'est pas satisfaite.");
      error.code = "STEP_DEPENDENCY";
      throw error;
    }
  }

  if (!stepSatisfied(stepKey, snapshot)) {
    const error = new BusinessError(409, "STEP_NOT_SATISFIED: données requises absentes.");
    error.code = "STEP_NOT_SATISFIED";
    throw error;
  }

  const persistedList = normalizeCompleted(persisted.completedSteps);
  const seeded = persistedList.length === 0 ? consecutiveValidCompleted([], snapshot) : persistedList;
  const completedSteps = normalizeCompleted([...seeded, stepKey]);
  const prefix = consecutiveValidCompleted(completedSteps, snapshot);
  const nextPersisted = {
    lastValidStep: prefix.length,
    completedSteps,
    updatedAt: new Date().toISOString(),
  };
  await progressStore.save(tenant.schoolId, nextPersisted);
  return deriveGuidedProgress(snapshot, nextPersisted, tenant.schoolId);
}

module.exports = {
  GUIDED_STEP_KEYS,
  GUIDED_STEP_LABELS,
  GUIDED_STEP_TOTAL,
  GUIDED_OPERATIONAL_STEP_TOTAL,
  deriveGuidedProgress,
  stepSatisfied,
  getSchoolSetupGuided,
  completeGuidedStep,
  loadSchoolSetupGuidedSnapshot,
  createMemoryProgressStore,
  createPgProgressStore,
};
