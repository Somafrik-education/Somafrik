"use strict";

/**
 * Client HTTP de tests : prépare l'offre établissement puis POST /classes canonique.
 * Aucun nom / niveau / filière / groupe texte libre.
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

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.levels)) return payload.levels;
  if (Array.isArray(payload?.groups)) return payload.groups;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function ensureCountryLevel(request, superToken, countryCode, name) {
  const listed = await request(
    `/backoffice/education-levels?countryCode=${encodeURIComponent(countryCode)}&includeArchived=true`,
    { token: superToken },
  );
  const existing = extractList(listed.data).find((row) => String(row.name) === name);
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

async function ensureCountryGroup(request, superToken, countryCode, code) {
  const groupCode = String(code ?? "").trim().toUpperCase();
  const listed = await request(
    `/backoffice/education-class-groups?countryCode=${encodeURIComponent(countryCode)}&includeArchived=true`,
    { token: superToken },
  );
  const existing = extractList(listed.data).find((row) => String(row.code).toUpperCase() === groupCode);
  if (existing) return existing;
  const created = await request("/backoffice/education-class-groups", {
    method: "POST",
    token: superToken,
    body: { countryCode, code: groupCode, name: groupCode },
  });
  if (created.status !== 201) {
    throw new Error(`create group ${countryCode}/${groupCode}: ${JSON.stringify(created.data)}`);
  }
  return created.data;
}

async function ensureSchoolYear(request, schoolToken, name = "2025-2026", schoolCode, { isCurrent = true } = {}) {
  const listed = await request("/v2/academic-years", { token: schoolToken });
  const rows = extractList(listed.data);
  const existing = rows.find(
    (row) => row.name === name && (!schoolCode || !row.schoolCode || row.schoolCode === schoolCode),
  );
  if (existing) return existing;
  const yearMatch = String(name).match(/^(\d{4})-(\d{4})$/);
  const startDate = yearMatch ? `${yearMatch[1]}-09-01` : isCurrent ? "2025-09-01" : "2024-09-01";
  const endDate = yearMatch ? `${yearMatch[2]}-08-31` : isCurrent ? "2026-08-31" : "2025-08-31";
  const { isV2SchoolLoginCode } = require("./schoolCodeV2");
  const created = await request("/v2/academic-years", {
    method: "POST",
    token: schoolToken,
    body: {
      ...(isV2SchoolLoginCode(schoolCode) ? { schoolCode } : {}),
      name,
      startDate,
      endDate,
      isCurrent,
    },
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create academic year: ${JSON.stringify(created.data)}`);
  }
  return created.data;
}

async function activateOffering(request, schoolToken, levelIds, streamIds = [], groupIds = []) {
  const catalog = await request("/education-reference/catalog", { token: schoolToken });
  const current = catalog.status === 200 ? catalog.data : { levels: [], streams: [], groups: [] };
  const mergedLevelIds = [
    ...new Set([
      ...(current.levels ?? []).filter((row) => row.schoolActive).map((row) => row.id),
      ...levelIds,
    ]),
  ];
  const mergedStreamIds = [
    ...new Set([
      ...(current.streams ?? []).filter((row) => row.schoolActive).map((row) => row.id),
      ...streamIds,
    ]),
  ];
  const mergedGroupIds = [
    ...new Set([
      ...(current.groups ?? []).filter((row) => row.schoolActive).map((row) => row.id),
      ...groupIds,
    ]),
  ];
  const saved = await request("/education-reference/school-activation", {
    method: "PUT",
    token: schoolToken,
    body: { levelIds: mergedLevelIds, streamIds: mergedStreamIds, groupIds: mergedGroupIds },
  });
  if (saved.status !== 200) {
    throw new Error(`activate offering: ${JSON.stringify(saved.data)}`);
  }
  return saved.data;
}

/**
 * @param {(path: string, opts?: object) => Promise<{status: number, data: any}>} request
 */
async function prepareCanonicalClassContext(request, options) {
  const {
    schoolCode,
    countryCode,
    levelName = "6ème",
    groupCode = "A",
    superToken: providedSuperToken,
    schoolToken: providedSchoolToken,
    superIdentifier = "superadmin",
    superPassword = "1234",
    schoolIdentifier = "admin",
    schoolPassword = "1234",
  } = options;
  const superToken = providedSuperToken || (await login(request, superIdentifier, superPassword));
  const schoolToken = providedSchoolToken || (await login(request, schoolIdentifier, schoolPassword, schoolCode));
  const level = await ensureCountryLevel(request, superToken, countryCode, levelName);
  const group = await ensureCountryGroup(request, superToken, countryCode, groupCode);
  await activateOffering(request, schoolToken, [level.id], [], [group.id]);
  const academicYear = await ensureSchoolYear(request, schoolToken, "2025-2026", schoolCode);
  return { superToken, schoolToken, level, group, academicYear };
}

async function postCanonicalClass(request, schoolToken, { academicYearId, levelId, streamId = null, groupId, status = "active" }) {
  return request("/classes", {
    method: "POST",
    token: schoolToken,
    body: {
      academicYearId,
      levelId,
      ...(streamId ? { streamId } : {}),
      groupId,
      status,
    },
  });
}

module.exports = {
  login,
  ensureCountryLevel,
  ensureCountryGroup,
  ensureSchoolYear,
  activateOffering,
  prepareCanonicalClassContext,
  postCanonicalClass,
};
