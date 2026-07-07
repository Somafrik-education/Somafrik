/**
 * Rétablit les fiches établissement absentes mais encore référencées
 * (academicConfigs, abonnements, utilisateurs, journal d'audit).
 * Protège contre les effacements accidentels lors de PUT partiels.
 */

function normalizeSchoolCodeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function inferCountryFromSchoolCode(schoolCode, countries = []) {
  const prefix = String(schoolCode ?? "").split("-")[0]?.toUpperCase();
  const match = countries.find((country) => normalizeToken(country.code) === normalizeToken(prefix));
  if (match) {
    return {
      country: String(match.name ?? match.label ?? prefix).trim() || prefix,
      countryCode: String(match.code ?? prefix).trim() || prefix,
    };
  }
  if (prefix === "BI") return { country: "Burundi", countryCode: "BI" };
  if (prefix === "CD") return { country: "République Démocratique du Congo", countryCode: "CD" };
  if (prefix === "CG") return { country: "Congo", countryCode: "CG" };
  return { country: prefix, countryCode: prefix };
}

function collectReferencedSchoolCodes(state = {}) {
  const codes = new Set();

  for (const key of Object.keys(state.academicConfigs ?? {})) {
    const code = normalizeSchoolCodeKey(key);
    if (code && code !== "*") codes.add(code);
  }

  for (const subscription of state.subscriptions ?? []) {
    const code = normalizeSchoolCodeKey(subscription.schoolCode);
    if (code) codes.add(code);
  }

  for (const user of state.users ?? []) {
    const code = normalizeSchoolCodeKey(user.schoolCode);
    if (code && code !== "*") codes.add(code);
  }

  for (const entry of state.auditLog ?? []) {
    const code = normalizeSchoolCodeKey(entry.schoolCode);
    if (code) codes.add(code);
  }

  return codes;
}

const LEGACY_SCHOOL_NAMES = {
  "BI-2026-0001": "Complexe scolaire",
};

function buildSchoolStub(code, state = {}, knownNames = {}) {
  const names = { ...LEGACY_SCHOOL_NAMES, ...knownNames };
  const subscription = (state.subscriptions ?? []).find(
    (row) => normalizeSchoolCodeKey(row.schoolCode) === code,
  );
  const inferred = inferCountryFromSchoolCode(code, state.countries ?? []);
  const country = String(subscription?.country ?? inferred.country).trim() || inferred.country;
  const countryCode = String(subscription?.countryCode ?? inferred.countryCode).trim() || inferred.countryCode;

  return {
    code,
    name: names[code] ?? subscription?.schoolName ?? `Établissement ${code}`,
    type: subscription?.schoolType ?? "Collège",
    country,
    countryCode,
    city: subscription?.city ?? "",
    email: subscription?.email ?? "",
    phone: subscription?.phone ?? "",
    status: subscription?.status === "Suspendu" ? "Suspendu" : "Actif",
    validationStatus: "Validé",
    subscriptionPlan: subscription?.plan ?? "Standard",
    createdAt: new Date().toISOString(),
  };
}

/**
 * @returns {{ state: object, repaired: string[] }}
 */
function repairOrphanSchools(state = {}, options = {}) {
  const knownNames = options.knownNames ?? {};
  const schools = Array.isArray(state.schools) ? [...state.schools] : [];
  const existing = new Set(schools.map((school) => normalizeSchoolCodeKey(school.code ?? school.publicId)));
  const repaired = [];

  for (const code of collectReferencedSchoolCodes(state)) {
    if (existing.has(code)) continue;
    schools.push(buildSchoolStub(code, state, knownNames));
    existing.add(code);
    repaired.push(code);
  }

  if (!repaired.length) {
    return { state, repaired };
  }

  return {
    state: { ...state, schools },
    repaired,
  };
}

module.exports = {
  repairOrphanSchools,
  collectReferencedSchoolCodes,
  buildSchoolStub,
};
