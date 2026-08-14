"use strict";

const { randomUUID } = require("node:crypto");
const {
  EDUCATION_REFERENCE_ERROR,
  asTrimmed,
  normalizeCode,
  createEducationReferenceError,
  mapLevelRow,
  mapStreamRow,
} = require("../lib/educationReferenceManagement");

function createEducationReferenceMemoryStore(seed = {}) {
  const levels = [];
  const streams = [];
  const schoolLevels = new Map();
  const schoolStreams = new Map();

  const countries = new Map(
    (seed.countries ?? []).map((country) => [
      asTrimmed(country.code ?? country.iso_code).toUpperCase(),
      { id: country.id ?? randomUUID(), iso_code: asTrimmed(country.code ?? country.iso_code).toUpperCase() },
    ]),
  );
  const schools = new Map(
    (seed.schools ?? []).map((school) => {
      const code = asTrimmed(school.code ?? school.schoolCode).toUpperCase();
      const countryCode = asTrimmed(school.countryCode ?? school.country_code ?? "CD").toUpperCase();
      const country = countries.get(countryCode) ?? { id: randomUUID(), iso_code: countryCode };
      if (!countries.has(countryCode)) countries.set(countryCode, country);
      return [
        code,
        {
          id: school.id ?? randomUUID(),
          school_code: code,
          country_id: country.id,
          country_code: countryCode,
        },
      ];
    }),
  );

  if (seed.school && !schools.has(asTrimmed(seed.school.code).toUpperCase())) {
    const code = asTrimmed(seed.school.code).toUpperCase();
    const countryCode = asTrimmed(seed.school.countryCode ?? "CD").toUpperCase();
    const country = countries.get(countryCode) ?? { id: randomUUID(), iso_code: countryCode };
    countries.set(countryCode, country);
    schools.set(code, {
      id: seed.school.id ?? randomUUID(),
      school_code: code,
      country_id: country.id,
      country_code: countryCode,
    });
  }

  const legacyPayloads = new Map();

  function rowLevel(level) {
    return mapLevelRow(level, level.country_code);
  }

  function rowStream(stream) {
    return mapStreamRow(stream, stream.country_code);
  }

  return {
    setLegacyAcademicPayload(schoolCode, payload) {
      legacyPayloads.set(asTrimmed(schoolCode).toUpperCase(), payload);
    },
    async getCountryByCode(countryCode) {
      return countries.get(asTrimmed(countryCode).toUpperCase()) ?? null;
    },
    async getSchoolByCode(schoolCode) {
      return schools.get(asTrimmed(schoolCode).toUpperCase()) ?? null;
    },
    async listLevelsByCountry(countryCode, { includeArchived = false } = {}) {
      const country = countries.get(asTrimmed(countryCode).toUpperCase());
      if (!country) return [];
      return levels
        .filter((row) => row.country_id === country.id && (includeArchived || row.status === "active"))
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
        .map(rowLevel);
    },
    async listStreamsByCountry(countryCode, { includeArchived = false, streamType = null, levelId = null } = {}) {
      const country = countries.get(asTrimmed(countryCode).toUpperCase());
      if (!country) return [];
      return streams
        .filter((row) => {
          if (row.country_id !== country.id) return false;
          if (!includeArchived && row.status !== "active") return false;
          if (streamType && row.stream_type !== streamType) return false;
          if (levelId && row.level_id !== levelId) return false;
          return true;
        })
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
        .map(rowStream);
    },
    async getLevelById(levelId) {
      const row = levels.find((item) => item.id === levelId);
      return row ? rowLevel(row) : null;
    },
    async getStreamById(streamId) {
      const row = streams.find((item) => item.id === streamId);
      return row ? rowStream(row) : null;
    },
    async insertLevel(input) {
      const row = {
        id: randomUUID(),
        country_id: input.countryId,
        country_code: [...countries.values()].find((c) => c.id === input.countryId)?.iso_code ?? "",
        level_code: input.code,
        name: input.name,
        display_order: input.displayOrder ?? 0,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (levels.some((item) => item.country_id === row.country_id && item.level_code === row.level_code)) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      levels.push(row);
      return rowLevel(row);
    },
    async updateLevel(levelId, patch) {
      const index = levels.findIndex((item) => item.id === levelId && item.status === "active");
      if (index < 0) return null;
      levels[index] = {
        ...levels[index],
        name: patch.name ?? levels[index].name,
        display_order: patch.displayOrder ?? levels[index].display_order,
        updated_at: new Date().toISOString(),
      };
      return rowLevel(levels[index]);
    },
    async archiveLevel(levelId) {
      const activeSchools = [...schoolLevels.entries()].filter(
        ([, value]) => value.level_id === levelId && value.status === "active",
      ).length;
      if (activeSchools > 0) {
        throw createEducationReferenceError(409, "Niveau utilisé", EDUCATION_REFERENCE_ERROR.LEVEL_IN_USE);
      }
      const index = levels.findIndex((item) => item.id === levelId && item.status === "active");
      if (index < 0) return null;
      levels[index] = { ...levels[index], status: "archived", updated_at: new Date().toISOString() };
      return rowLevel(levels[index]);
    },
    async insertStream(input) {
      const row = {
        id: randomUUID(),
        country_id: input.countryId,
        country_code: [...countries.values()].find((c) => c.id === input.countryId)?.iso_code ?? "",
        level_id: input.levelId ?? null,
        stream_code: input.code,
        name: input.name,
        stream_type: input.streamType,
        display_order: input.displayOrder ?? 0,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (streams.some((item) => item.country_id === row.country_id && item.stream_code === row.stream_code)) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      streams.push(row);
      return rowStream(row);
    },
    async updateStream(streamId, patch) {
      const index = streams.findIndex((item) => item.id === streamId && item.status === "active");
      if (index < 0) return null;
      streams[index] = {
        ...streams[index],
        name: patch.name ?? streams[index].name,
        level_id: patch.levelId !== undefined ? patch.levelId : streams[index].level_id,
        display_order: patch.displayOrder ?? streams[index].display_order,
        updated_at: new Date().toISOString(),
      };
      return rowStream(streams[index]);
    },
    async archiveStream(streamId) {
      const activeSchools = [...schoolStreams.entries()].filter(
        ([, value]) => value.stream_id === streamId && value.status === "active",
      ).length;
      if (activeSchools > 0) {
        throw createEducationReferenceError(409, "Filière utilisée", EDUCATION_REFERENCE_ERROR.STREAM_IN_USE);
      }
      const index = streams.findIndex((item) => item.id === streamId && item.status === "active");
      if (index < 0) return null;
      streams[index] = { ...streams[index], status: "archived", updated_at: new Date().toISOString() };
      return rowStream(streams[index]);
    },
    async getSchoolCatalog(schoolCode) {
      const school = schools.get(asTrimmed(schoolCode).toUpperCase());
      if (!school) {
        throw createEducationReferenceError(404, "Établissement introuvable.", EDUCATION_REFERENCE_ERROR.SCHOOL_NOT_FOUND);
      }
      const activeLevelIds = new Set(
        [...schoolLevels.values()]
          .filter((row) => row.school_id === school.id && row.status === "active")
          .map((row) => row.level_id),
      );
      const activeStreamIds = new Set(
        [...schoolStreams.values()]
          .filter((row) => row.school_id === school.id && row.status === "active")
          .map((row) => row.stream_id),
      );
      return {
        schoolCode: school.school_code,
        countryCode: school.country_code,
        levels: levels
          .filter((row) => row.country_id === school.country_id && row.status === "active")
          .map((row) => ({ ...rowLevel(row), schoolActive: activeLevelIds.has(row.id) })),
        streams: streams
          .filter((row) => row.country_id === school.country_id && row.status === "active")
          .map((row) => ({ ...rowStream(row), schoolActive: activeStreamIds.has(row.id) })),
      };
    },
    async replaceSchoolActivation(schoolCode, activation) {
      const school = schools.get(asTrimmed(schoolCode).toUpperCase());
      if (!school) {
        throw createEducationReferenceError(404, "Établissement introuvable.", EDUCATION_REFERENCE_ERROR.SCHOOL_NOT_FOUND);
      }
      const levelIds = Array.isArray(activation.levelIds) ? activation.levelIds.map(asTrimmed).filter(Boolean) : [];
      const streamIds = Array.isArray(activation.streamIds) ? activation.streamIds.map(asTrimmed).filter(Boolean) : [];
      for (const levelId of levelIds) {
        const level = levels.find((item) => item.id === levelId);
        if (!level || level.country_id !== school.country_id || level.status !== "active") {
          throw createEducationReferenceError(403, "Niveau invalide pour cet établissement.", EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH);
        }
      }
      for (const streamId of streamIds) {
        const stream = streams.find((item) => item.id === streamId);
        if (!stream || stream.country_id !== school.country_id || stream.status !== "active") {
          throw createEducationReferenceError(403, "Filière invalide pour cet établissement.", EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH);
        }
      }
      for (const key of [...schoolLevels.keys()]) {
        if (schoolLevels.get(key).school_id === school.id) schoolLevels.delete(key);
      }
      for (const key of [...schoolStreams.keys()]) {
        if (schoolStreams.get(key).school_id === school.id) schoolStreams.delete(key);
      }
      for (const levelId of levelIds) {
        schoolLevels.set(`${school.id}:${levelId}`, { school_id: school.id, level_id: levelId, status: "active" });
      }
      for (const streamId of streamIds) {
        schoolStreams.set(`${school.id}:${streamId}`, { school_id: school.id, stream_id: streamId, status: "active" });
      }
      return this.getSchoolCatalog(schoolCode);
    },
    async getSchoolActiveLists(schoolCode) {
      const catalog = await this.getSchoolCatalog(schoolCode);
      return {
        levels: catalog.levels.filter((row) => row.schoolActive).map((row) => row.name),
        tracks: catalog.streams.filter((row) => row.schoolActive).map((row) => row.name),
      };
    },
    async inventoryLegacyAcademicReferencePayloads() {
      const ambiguous = [];
      for (const [schoolCode, payload] of legacyPayloads.entries()) {
        const levelsList = Array.isArray(payload?.levels) ? payload.levels.filter((v) => asTrimmed(v)) : [];
        const tracksList = Array.isArray(payload?.tracks) ? payload.tracks.filter((v) => asTrimmed(v)) : [];
        if (levelsList.length || tracksList.length) {
          ambiguous.push({
            schoolCode,
            levelsCount: levelsList.length,
            tracksCount: tracksList.length,
            levelsSample: levelsList.slice(0, 3),
            tracksSample: tracksList.slice(0, 3),
          });
        }
      }
      return ambiguous;
    },
    normalizeCode,
  };
}

module.exports = {
  createEducationReferenceMemoryStore,
};
