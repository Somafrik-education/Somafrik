/**
 * Détection et purge des artefacts créés par les tests E2E.
 */
const { normalize } = require("./e2e-api-helpers");

const PROTECTED_SCHOOL_CODES = new Set(
  [
    process.env.SOMAFRIK_TEST_SCHOOL_CODE,
    "CD-2026-0001",
    "CG-2026-0001",
  ]
    .map((code) => String(code ?? "").trim().toUpperCase())
    .filter(Boolean),
);

const PROTECTED_USER_IDENTIFIERS = new Set(
  [
    process.env.SOMAFRIK_E2E_SUPERADMIN_ID,
    process.env.SOMAFRIK_E2E_SCHOOL_ADMIN_ID,
    "superadmin",
    "admin",
  ]
    .map((id) => normalize(id))
    .filter(Boolean),
);

const E2E_USER_IDENTIFIER_PATTERNS = [
  /^adm-e2e/,
  /^adm-e2e\d/,
  /^adm-pays-/,
  /^adm-school-/,
  /^adm-sub-/,
  /^cpt-e2e-/,
  /^cpt-imp-/,
  /^usr-e2e/,
  /^usr-country-/,
  /^usr-school-/,
];

const SCOPED_STATE_KEYS = [
  "students",
  "teachers",
  "classes",
  "contacts",
  "relations",
  "subscriptions",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "schoolFeeItems",
  "studentFees",
  "feeTariffHistory",
  "paymentReminders",
  "presences",
  "notes",
  "evaluations",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "courses",
  "assignments",
  "courseSchedules",
  "subscriptionPayments",
  "subscriptionInvoices",
  "subscriptionDiscounts",
];

function schoolCodeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isProtectedSchoolCode(code) {
  return PROTECTED_SCHOOL_CODES.has(schoolCodeKey(code));
}

function isE2eSchool(school) {
  const code = schoolCodeKey(school?.code ?? school?.publicId);
  if (!code || isProtectedSchoolCode(code)) return false;

  const name = String(school?.name ?? "");
  const email = String(school?.email ?? "");
  const principalEmail = String(school?.principalEmail ?? "");

  if (/\be2e\b/i.test(name)) return true;
  if (/e2e[\s._-]/i.test(name)) return true;
  if (/e2e-/i.test(email) && /@somafrik\.app$/i.test(email)) return true;
  if (/e2e-/i.test(principalEmail) && /@somafrik\.app$/i.test(principalEmail)) return true;
  if (/directeur-e2e/i.test(principalEmail)) return true;

  return false;
}

function isE2eUser(user, e2eSchoolCodes) {
  const identifier = normalize(user?.identifier);
  if (!identifier || PROTECTED_USER_IDENTIFIERS.has(identifier)) return false;

  const schoolCode = schoolCodeKey(user?.schoolCode);
  if (schoolCode && schoolCode !== "*" && e2eSchoolCodes.has(schoolCode)) return true;

  if (E2E_USER_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(identifier))) return true;

  const email = String(user?.email ?? "");
  if (/e2e-/i.test(email) && /@somafrik\.app$/i.test(email)) return true;
  if (/somafrik\.test/i.test(email)) return true;

  const id = String(user?.id ?? "");
  if (/^usr-e2e/i.test(id) || /^usr-country-/i.test(id) || /^usr-school-/i.test(id)) return true;

  return false;
}

function belongsToE2eSchool(row, e2eSchoolCodes) {
  const code = schoolCodeKey(row?.schoolCode);
  return Boolean(code && e2eSchoolCodes.has(code));
}

function findE2eSchools(schools = []) {
  return schools.filter(isE2eSchool);
}

function buildE2eSchoolCodeSet(schools = []) {
  return new Set(findE2eSchools(schools).map((school) => schoolCodeKey(school.code ?? school.publicId)));
}

function purgeE2eFromState(state = {}) {
  const e2eSchoolCodes = buildE2eSchoolCodeSet(state.schools ?? []);
  const removedSchools = findE2eSchools(state.schools ?? []);

  const next = { ...state };

  next.schools = (state.schools ?? []).filter((school) => !isE2eSchool(school));
  next.users = (state.users ?? []).filter((user) => !isE2eUser(user, e2eSchoolCodes));

  for (const key of SCOPED_STATE_KEYS) {
    if (!Array.isArray(state[key])) continue;
    next[key] = state[key].filter((row) => !belongsToE2eSchool(row, e2eSchoolCodes));
  }

  if (state.subscriptions) {
    next.subscriptions = state.subscriptions.filter((row) => {
      const code = schoolCodeKey(row.schoolCode);
      if (code && e2eSchoolCodes.has(code)) return false;
      if (String(row.id ?? "").startsWith("SUB-E2E-")) return false;
      return true;
    });
  }

  if (state.notifications) {
    next.notifications = state.notifications.filter((row) => !belongsToE2eSchool(row, e2eSchoolCodes));
  }

  if (state.academicConfigs && typeof state.academicConfigs === "object") {
    const configs = { ...state.academicConfigs };
    for (const code of e2eSchoolCodes) {
      delete configs[code];
    }
    next.academicConfigs = configs;
  }

  if (state.auditLog) {
    next.auditLog = state.auditLog.filter((row) => !belongsToE2eSchool(row, e2eSchoolCodes));
  }

  return {
    state: next,
    removedSchools,
    e2eSchoolCodes: [...e2eSchoolCodes],
    stats: summarizeRemoval(state, next),
  };
}

function summarizeRemoval(before, after) {
  const summary = { schools: 0, users: 0 };
  for (const key of ["schools", "users", ...SCOPED_STATE_KEYS, "subscriptions", "notifications"]) {
    const prev = Array.isArray(before[key]) ? before[key].length : 0;
    const next = Array.isArray(after[key]) ? after[key].length : 0;
    const removed = prev - next;
    if (removed > 0) summary[key] = removed;
  }
  if (before.academicConfigs && after.academicConfigs) {
    const prev = Object.keys(before.academicConfigs).length;
    const next = Object.keys(after.academicConfigs).length;
    const removed = prev - next;
    if (removed > 0) summary.academicConfigs = removed;
  }
  return summary;
}

module.exports = {
  isE2eSchool,
  isE2eUser,
  findE2eSchools,
  purgeE2eFromState,
  PROTECTED_SCHOOL_CODES,
};
