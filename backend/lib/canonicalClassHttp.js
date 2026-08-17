"use strict";

/**
 * Client HTTP de tests : prépare l'offre établissement puis POST /classes canonique.
 * Aucun nom / niveau / filière texte libre.
 */

async function login(request, identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  if (result.status !== 200) {
    throw new Error(`login ${identifier}: ${JSON.stringify(result.data)}`);
  }
  return result.data.accessToken || result.data.token;
}

async function ensureCountryLevel(request, superToken, countryCode, name) {
  const listed = await request(
    `/backoffice/education-levels?countryCode=${encodeURIComponent(countryCode)}&includeArchived=true`,
    { token: superToken },
  );
  const existing = (listed.data?.levels ?? []).find((row) => String(row.name) === name);
  if (existing) return existing;
  const created = await request("/backoffice/education-levels", {
    method: "POST",
    token: superToken,
    body: { countryCode, name },
  });
  if (created.status !== 201) {
    throw new Error(`create level ${countryCode}/${name}: ${JSON.stringify(created.data)}`);
  }
  return created.data;
}

async function ensureSchoolYear(request, schoolToken, name = "2025-2026", schoolCode) {
  const listed = await request("/v2/academic-years", { token: schoolToken });
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const existing =
    rows.find((row) => row.name === name && (!schoolCode || !row.schoolCode || row.schoolCode === schoolCode)) ||
    rows.find((row) => row.isCurrent && (!schoolCode || !row.schoolCode || row.schoolCode === schoolCode)) ||
    rows.find((row) => !schoolCode || !row.schoolCode || row.schoolCode === schoolCode);
  if (existing) return existing;
  const created = await request("/v2/academic-years", {
    method: "POST",
    token: schoolToken,
    body: {
      schoolCode,
      name,
      startDate: "2025-09-01",
      endDate: "2026-08-31",
      isCurrent: true,
    },
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create academic year: ${JSON.stringify(created.data)}`);
  }
  return created.data;
}

async function activateOffering(request, schoolToken, levelIds, streamIds = []) {
  const saved = await request("/education-reference/school-activation", {
    method: "PUT",
    token: schoolToken,
    body: { levelIds, streamIds },
  });
  if (saved.status !== 200) {
    throw new Error(`activate offering: ${JSON.stringify(saved.data)}`);
  }
  return saved.data;
}

/**
 * @param {(path: string, opts?: object) => Promise<{status: number, data: any}>} request
 */
async function prepareCanonicalClassContext(request, { schoolCode, countryCode, levelName = "6ème" }) {
  const superToken = await login(request, "superadmin", "1234");
  const schoolToken = await login(request, "admin", "1234", schoolCode);
  const level = await ensureCountryLevel(request, superToken, countryCode, levelName);
  await activateOffering(request, schoolToken, [level.id], []);
  const academicYear = await ensureSchoolYear(request, schoolToken, "2025-2026", schoolCode);
  return { superToken, schoolToken, level, academicYear };
}

async function postCanonicalClass(request, schoolToken, { academicYearId, levelId, streamId = null, groupCode, status = "active" }) {
  return request("/classes", {
    method: "POST",
    token: schoolToken,
    body: {
      academicYearId,
      levelId,
      ...(streamId ? { streamId } : {}),
      groupCode,
      status,
    },
  });
}

module.exports = {
  login,
  ensureCountryLevel,
  ensureSchoolYear,
  activateOffering,
  prepareCanonicalClassContext,
  postCanonicalClass,
};
