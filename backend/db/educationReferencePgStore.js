"use strict";

const {
  EDUCATION_REFERENCE_ERROR,
  asTrimmed,
  normalizeCode,
  createEducationReferenceError,
  mapLevelRow,
  mapStreamRow,
  mapGroupRow,
  pedagogicalLabelsFromCountryRow,
} = require("../lib/educationReferenceManagement");

function createEducationReferencePgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function getCountryByCode(countryCode) {
    return one(
      `SELECT id, iso_code, pedagogical_level_label, pedagogical_track_label, pedagogical_group_label
       FROM countries WHERE upper(iso_code) = upper($1)`,
      [asTrimmed(countryCode).toUpperCase()],
    );
  }

  async function getSchoolByCode(schoolCode) {
    return one(
      `SELECT s.id, s.school_code, c.iso_code AS country_code, s.country_id
       FROM schools s
       JOIN countries c ON c.id = s.country_id
       WHERE upper(s.school_code) = upper($1)
          OR upper(coalesce(s.login_code, '')) = upper($1)`,
      [asTrimmed(schoolCode).toUpperCase()],
    );
  }

  async function listLevelsByCountry(countryCode, { includeArchived = false } = {}) {
    const country = await getCountryByCode(countryCode);
    if (!country) return [];
    const rows = await all(
      `SELECT el.*, c.iso_code AS country_code
       FROM education_levels el
       JOIN countries c ON c.id = el.country_id
       WHERE el.country_id = $1
         AND ($2::boolean OR el.status = 'active')
       ORDER BY el.display_order, el.name`,
      [country.id, includeArchived],
    );
    return rows.map((row) => mapLevelRow(row, row.country_code));
  }

  async function listStreamsByCountry(countryCode, { includeArchived = false, streamType = null, levelId = null } = {}) {
    const country = await getCountryByCode(countryCode);
    if (!country) return [];
    const params = [country.id, includeArchived];
    let typeClause = "";
    if (streamType) {
      typeClause = ` AND es.stream_type = $${params.push(streamType)}`;
    }
    let levelClause = "";
    if (levelId) {
      levelClause = ` AND es.level_id = $${params.push(levelId)}::uuid`;
    }
    const rows = await all(
      `SELECT es.*, c.iso_code AS country_code
       FROM education_streams es
       JOIN countries c ON c.id = es.country_id
       WHERE es.country_id = $1
         AND ($2::boolean OR es.status = 'active')
         ${typeClause}
         ${levelClause}
       ORDER BY es.display_order, es.name`,
      params,
    );
    return rows.map((row) => mapStreamRow(row, row.country_code));
  }

  async function getLevelById(levelId) {
    const row = await one(
      `SELECT el.*, c.iso_code AS country_code
       FROM education_levels el
       JOIN countries c ON c.id = el.country_id
       WHERE el.id = $1::uuid`,
      [levelId],
    );
    return row ? mapLevelRow(row, row.country_code) : null;
  }

  async function getStreamById(streamId) {
    const row = await one(
      `SELECT es.*, c.iso_code AS country_code
       FROM education_streams es
       JOIN countries c ON c.id = es.country_id
       WHERE es.id = $1::uuid`,
      [streamId],
    );
    return row ? mapStreamRow(row, row.country_code) : null;
  }

  async function listGroupsByCountry(countryCode, { includeArchived = false } = {}) {
    const country = await getCountryByCode(countryCode);
    if (!country) return [];
    const rows = await all(
      `SELECT eg.*, c.iso_code AS country_code
       FROM education_class_groups eg
       JOIN countries c ON c.id = eg.country_id
       WHERE eg.country_id = $1
         AND ($2::boolean OR eg.status = 'active')
       ORDER BY eg.display_order, eg.group_code`,
      [country.id, includeArchived],
    );
    return rows.map((row) => mapGroupRow(row, row.country_code));
  }

  async function getGroupById(groupId) {
    const row = await one(
      `SELECT eg.*, c.iso_code AS country_code
       FROM education_class_groups eg
       JOIN countries c ON c.id = eg.country_id
       WHERE eg.id = $1::uuid`,
      [groupId],
    );
    return row ? mapGroupRow(row, row.country_code) : null;
  }

  async function insertLevel(input) {
    const row = await one(
      `INSERT INTO education_levels (country_id, level_code, name, display_order, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [input.countryId, input.code, input.name, input.displayOrder ?? 0],
    );
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [input.countryId]);
    return mapLevelRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function updateLevel(levelId, patch) {
    const row = await one(
      `UPDATE education_levels
       SET name = COALESCE($2, name),
           display_order = COALESCE($3, display_order),
           updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [levelId, patch.name ?? null, patch.displayOrder ?? null],
    );
    if (!row) return null;
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [row.country_id]);
    return mapLevelRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function archiveLevel(levelId) {
    const activeSchools = await one(
      `SELECT COUNT(*)::int AS count
       FROM school_levels sl
       WHERE sl.level_id = $1::uuid AND sl.status = 'active'`,
      [levelId],
    );
    if (Number(activeSchools?.count ?? 0) > 0) {
      throw createEducationReferenceError(
        409,
        "Impossible d'archiver ce niveau : il est activé par au moins un établissement.",
        EDUCATION_REFERENCE_ERROR.LEVEL_IN_USE,
        { activeSchools: activeSchools.count },
      );
    }
    const activeStreams = await one(
      `SELECT COUNT(*)::int AS count
       FROM education_streams es
       WHERE es.level_id = $1::uuid AND es.status = 'active'`,
      [levelId],
    );
    if (Number(activeStreams?.count ?? 0) > 0) {
      throw createEducationReferenceError(
        409,
        "Impossible d'archiver ce niveau : des filières actives y sont encore rattachées.",
        EDUCATION_REFERENCE_ERROR.LEVEL_HAS_ACTIVE_STREAMS,
        { activeStreams: activeStreams.count },
      );
    }
    const row = await one(
      `UPDATE education_levels
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [levelId],
    );
    if (!row) return null;
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [row.country_id]);
    return mapLevelRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function insertStream(input) {
    const row = await one(
      `INSERT INTO education_streams (country_id, level_id, stream_code, name, stream_type, display_order, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [
        input.countryId,
        input.levelId ?? null,
        input.code,
        input.name,
        input.streamType,
        input.displayOrder ?? 0,
      ],
    );
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [input.countryId]);
    return mapStreamRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function updateStream(streamId, patch) {
    const sets = ["updated_at = NOW()"];
    const params = [streamId];
    let index = 2;
    if (patch.name !== undefined) {
      sets.push(`name = $${index++}`);
      params.push(patch.name);
    }
    if (patch.levelIdProvided) {
      sets.push(`level_id = $${index++}`);
      params.push(patch.levelId);
    }
    if (patch.displayOrder !== undefined) {
      sets.push(`display_order = $${index++}`);
      params.push(patch.displayOrder);
    }
    const row = await one(
      `UPDATE education_streams
       SET ${sets.join(", ")}
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      params,
    );
    if (!row) return null;
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [row.country_id]);
    return mapStreamRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function archiveStream(streamId) {
    const activeSchools = await one(
      `SELECT COUNT(*)::int AS count
       FROM school_streams ss
       WHERE ss.stream_id = $1::uuid AND ss.status = 'active'`,
      [streamId],
    );
    if (Number(activeSchools?.count ?? 0) > 0) {
      throw createEducationReferenceError(
        409,
        "Impossible d'archiver cette filière : elle est activée par au moins un établissement.",
        EDUCATION_REFERENCE_ERROR.STREAM_IN_USE,
        { activeSchools: activeSchools.count },
      );
    }
    const row = await one(
      `UPDATE education_streams
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [streamId],
    );
    if (!row) return null;
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [row.country_id]);
    return mapStreamRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function insertGroup(input) {
    const row = await one(
      `INSERT INTO education_class_groups (country_id, group_code, name, display_order, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [input.countryId, input.code, input.name, input.displayOrder ?? 0],
    );
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [input.countryId]);
    return mapGroupRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function updateGroup(groupId, patch) {
    const row = await one(
      `UPDATE education_class_groups
       SET name = COALESCE($2, name),
           display_order = COALESCE($3, display_order),
           updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [groupId, patch.name ?? null, patch.displayOrder ?? null],
    );
    if (!row) return null;
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [row.country_id]);
    return mapGroupRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function archiveGroup(groupId) {
    const activeSchools = await one(
      `SELECT COUNT(*)::int AS count
       FROM school_class_groups sg
       WHERE sg.group_id = $1::uuid AND sg.status = 'active'`,
      [groupId],
    );
    if (Number(activeSchools?.count ?? 0) > 0) {
      throw createEducationReferenceError(
        409,
        "Impossible d'archiver ce groupe : il est activé par au moins un établissement.",
        EDUCATION_REFERENCE_ERROR.GROUP_IN_USE,
        { activeSchools: activeSchools.count },
      );
    }
    const row = await one(
      `UPDATE education_class_groups
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [groupId],
    );
    if (!row) return null;
    const country = await one(`SELECT iso_code FROM countries WHERE id = $1`, [row.country_id]);
    return mapGroupRow({ ...row, country_code: country?.iso_code }, country?.iso_code);
  }

  async function getSchoolCatalog(schoolCode) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) {
      throw createEducationReferenceError(404, "Établissement introuvable.", EDUCATION_REFERENCE_ERROR.SCHOOL_NOT_FOUND);
    }
    const levels = await all(
      `SELECT el.*, c.iso_code AS country_code,
              CASE WHEN sl.status = 'active' THEN true ELSE false END AS school_active
       FROM education_levels el
       JOIN countries c ON c.id = el.country_id
       LEFT JOIN school_levels sl ON sl.level_id = el.id AND sl.school_id = $1
       WHERE el.country_id = $2 AND el.status = 'active'
       ORDER BY el.display_order, el.name`,
      [school.id, school.country_id],
    );
    const streams = await all(
      `SELECT es.*, c.iso_code AS country_code,
              CASE WHEN ss.status = 'active' THEN true ELSE false END AS school_active
       FROM education_streams es
       JOIN countries c ON c.id = es.country_id
       LEFT JOIN school_streams ss ON ss.stream_id = es.id AND ss.school_id = $1
       WHERE es.country_id = $2 AND es.status = 'active'
       ORDER BY es.stream_type, es.display_order, es.name`,
      [school.id, school.country_id],
    );
    const groups = await all(
      `SELECT eg.*, c.iso_code AS country_code,
              CASE WHEN sg.status = 'active' THEN true ELSE false END AS school_active
       FROM education_class_groups eg
       JOIN countries c ON c.id = eg.country_id
       LEFT JOIN school_class_groups sg ON sg.group_id = eg.id AND sg.school_id = $1
       WHERE eg.country_id = $2 AND eg.status = 'active'
       ORDER BY eg.display_order, eg.group_code`,
      [school.id, school.country_id],
    );
    const country = await one(
      `SELECT pedagogical_level_label, pedagogical_track_label, pedagogical_group_label
       FROM countries WHERE id = $1`,
      [school.country_id],
    );
    return {
      schoolCode: school.school_code,
      countryCode: school.country_code,
      labels: pedagogicalLabelsFromCountryRow(country),
      levels: levels.map((row) => ({
        ...mapLevelRow(row, row.country_code),
        schoolActive: Boolean(row.school_active),
      })),
      streams: streams.map((row) => ({
        ...mapStreamRow(row, row.country_code),
        schoolActive: Boolean(row.school_active),
      })),
      groups: groups.map((row) => ({
        ...mapGroupRow(row, row.country_code),
        schoolActive: Boolean(row.school_active),
      })),
    };
  }

  async function replaceSchoolActivation(schoolCode, activation) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) {
      throw createEducationReferenceError(404, "Établissement introuvable.", EDUCATION_REFERENCE_ERROR.SCHOOL_NOT_FOUND);
    }

    const levelIds = Array.isArray(activation.levelIds) ? activation.levelIds.map(asTrimmed).filter(Boolean) : [];
    const streamIds = Array.isArray(activation.streamIds) ? activation.streamIds.map(asTrimmed).filter(Boolean) : [];
    const groupIds = Array.isArray(activation.groupIds) ? activation.groupIds.map(asTrimmed).filter(Boolean) : [];

    for (const levelId of levelIds) {
      const level = await one(
        `SELECT id, country_id, status FROM education_levels WHERE id = $1::uuid`,
        [levelId],
      );
      if (!level) {
        throw createEducationReferenceError(404, `Niveau introuvable: ${levelId}`, EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
      }
      if (level.country_id !== school.country_id) {
        throw createEducationReferenceError(
          403,
          "Impossible d'activer un niveau d'un autre pays.",
          EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
        );
      }
      if (level.status !== "active") {
        throw createEducationReferenceError(409, "Ce niveau est archivé.", EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
      }
    }

    for (const streamId of streamIds) {
      const stream = await one(
        `SELECT id, country_id, status FROM education_streams WHERE id = $1::uuid`,
        [streamId],
      );
      if (!stream) {
        throw createEducationReferenceError(404, `Filière introuvable: ${streamId}`, EDUCATION_REFERENCE_ERROR.STREAM_NOT_FOUND);
      }
      if (stream.country_id !== school.country_id) {
        throw createEducationReferenceError(
          403,
          "Impossible d'activer une filière d'un autre pays.",
          EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
        );
      }
      if (stream.status !== "active") {
        throw createEducationReferenceError(409, "Cette filière est archivée.", EDUCATION_REFERENCE_ERROR.STREAM_NOT_FOUND);
      }
    }

    for (const groupId of groupIds) {
      const group = await one(
        `SELECT id, country_id, status FROM education_class_groups WHERE id = $1::uuid`,
        [groupId],
      );
      if (!group) {
        throw createEducationReferenceError(404, `Groupe introuvable: ${groupId}`, EDUCATION_REFERENCE_ERROR.GROUP_NOT_FOUND);
      }
      if (group.country_id !== school.country_id) {
        throw createEducationReferenceError(
          403,
          "Impossible d'activer un groupe d'un autre pays.",
          EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
        );
      }
      if (group.status !== "active") {
        throw createEducationReferenceError(409, "Ce groupe est archivé.", EDUCATION_REFERENCE_ERROR.GROUP_NOT_FOUND);
      }
    }

    await query(`DELETE FROM school_levels WHERE school_id = $1`, [school.id]);
    await query(`DELETE FROM school_streams WHERE school_id = $1`, [school.id]);
    await query(`DELETE FROM school_class_groups WHERE school_id = $1`, [school.id]);

    for (const levelId of levelIds) {
      await query(
        `INSERT INTO school_levels (school_id, level_id, status)
         VALUES ($1, $2::uuid, 'active')
         ON CONFLICT (school_id, level_id) DO UPDATE SET status = 'active', updated_at = NOW()`,
        [school.id, levelId],
      );
    }
    for (const streamId of streamIds) {
      await query(
        `INSERT INTO school_streams (school_id, stream_id, status)
         VALUES ($1, $2::uuid, 'active')
         ON CONFLICT (school_id, stream_id) DO UPDATE SET status = 'active', updated_at = NOW()`,
        [school.id, streamId],
      );
    }
    for (const groupId of groupIds) {
      await query(
        `INSERT INTO school_class_groups (school_id, group_id, status)
         VALUES ($1, $2::uuid, 'active')
         ON CONFLICT (school_id, group_id) DO UPDATE SET status = 'active', updated_at = NOW()`,
        [school.id, groupId],
      );
    }

    return getSchoolCatalog(schoolCode);
  }

  async function getSchoolActiveLists(schoolCode) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) {
      return { levels: [], tracks: [] };
    }
    const levels = await all(
      `SELECT el.name
       FROM school_levels sl
       JOIN education_levels el ON el.id = sl.level_id
       WHERE sl.school_id = $1 AND sl.status = 'active' AND el.status = 'active'
       ORDER BY el.display_order, el.name`,
      [school.id],
    );
    const tracks = await all(
      `SELECT es.name
       FROM school_streams ss
       JOIN education_streams es ON es.id = ss.stream_id
       WHERE ss.school_id = $1 AND ss.status = 'active' AND es.status = 'active'
       ORDER BY es.display_order, es.name`,
      [school.id],
    );
    return {
      levels: levels.map((row) => row.name),
      tracks: tracks.map((row) => row.name),
    };
  }

  async function updateCountryPedagogicalLabels(countryCode, labels) {
    const row = await one(
      `UPDATE countries
       SET pedagogical_level_label = $2,
           pedagogical_track_label = $3,
           pedagogical_group_label = $4,
           updated_at = NOW()
       WHERE upper(iso_code) = upper($1)
       RETURNING id, iso_code, pedagogical_level_label, pedagogical_track_label, pedagogical_group_label`,
      [asTrimmed(countryCode).toUpperCase(), labels.levelLabel, labels.trackLabel, labels.groupLabel],
    );
    if (!row) {
      throw createEducationReferenceError(404, "Pays introuvable.", EDUCATION_REFERENCE_ERROR.COUNTRY_NOT_FOUND);
    }
    return row;
  }

  async function inventoryLegacyAcademicReferencePayloads() {
    const rows = await all(
      `SELECT s.school_code, sac.config_payload
       FROM school_academic_configs sac
       JOIN schools s ON s.id = sac.school_id`,
    );
    const ambiguous = [];
    for (const row of rows) {
      let payload = row.config_payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      const levels = Array.isArray(payload?.levels) ? payload.levels.filter((v) => asTrimmed(v)) : [];
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks.filter((v) => asTrimmed(v)) : [];
      if (levels.length || tracks.length) {
        ambiguous.push({
          schoolCode: row.school_code,
          levelsCount: levels.length,
          tracksCount: tracks.length,
          levelsSample: levels.slice(0, 3),
          tracksSample: tracks.slice(0, 3),
        });
      }
    }
    return ambiguous;
  }

  return {
    getCountryByCode,
    getSchoolByCode,
    listLevelsByCountry,
    listStreamsByCountry,
    getLevelById,
    getStreamById,
    listGroupsByCountry,
    getGroupById,
    insertLevel,
    updateLevel,
    archiveLevel,
    insertStream,
    updateStream,
    archiveStream,
    insertGroup,
    updateGroup,
    archiveGroup,
    getSchoolCatalog,
    replaceSchoolActivation,
    getSchoolActiveLists,
    updateCountryPedagogicalLabels,
    inventoryLegacyAcademicReferencePayloads,
    normalizeCode,
  };
}

module.exports = {
  createEducationReferencePgStore,
};
