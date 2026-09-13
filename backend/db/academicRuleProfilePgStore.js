"use strict";

const {
  AcademicRuleProfileError,
  requireSchoolId,
  assertSameTenant,
  validateSpec,
  specSha256,
} = require("../lib/reportCard/academicRuleProfile");

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    school_id: row.school_id,
    profile_id: row.profile_id,
    version: Number(row.version),
    status: row.status,
    spec: row.spec,
    spec_sha256: row.spec_sha256,
    created_at: row.created_at,
  };
}

function createAcademicRuleProfilePgStore(db) {
  async function withClient(fn) {
    if (typeof db.connect === "function") {
      const client = await db.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }
    return fn(db);
  }

  async function withTx(fn) {
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    });
  }

  async function queryOne(client, sql, params) {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  }

  async function requireProfile(client, schoolId, profileId, { forUpdate = false } = {}) {
    const profile = await queryOne(
      client,
      `SELECT id FROM academic_rule_profiles WHERE id = $1 AND school_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [profileId, schoolId]
    );
    if (!profile) throw new AcademicRuleProfileError("PROFILE_NOT_FOUND");
    return profile;
  }

  async function createProfile({ schoolId, actorSchoolId, profileKey, spec, activate = false }) {
    assertSameTenant(schoolId, actorSchoolId);
    requireSchoolId(schoolId);
    const normalized = validateSpec(spec);
    const sha = specSha256(normalized);
    try {
      return await withTx(async (client) => {
        const profileRes = await client.query(
          `INSERT INTO academic_rule_profiles (school_id, profile_key)
           VALUES ($1, $2)
           RETURNING id, school_id, profile_key, created_at`,
          [schoolId, String(profileKey || "default")]
        );
        const profile = profileRes.rows[0];
        const versionRes = await client.query(
          `INSERT INTO academic_rule_profile_versions
             (school_id, profile_id, version, status, spec, spec_sha256)
           VALUES ($1, $2, 1, $3, $4::jsonb, $5)
           RETURNING *`,
          [schoolId, profile.id, activate ? "ACTIVE" : "DRAFT", JSON.stringify(normalized), sha]
        );
        return { profile, version: mapVersion(versionRes.rows[0]) };
      });
    } catch (err) {
      if (err.code === "23505") throw new AcademicRuleProfileError("PROFILE_KEY_TAKEN");
      throw err;
    }
  }

  async function addVersion({ schoolId, actorSchoolId, profileId, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    const normalized = validateSpec(spec);
    const sha = specSha256(normalized);
    return withTx(async (client) => {
      await requireProfile(client, schoolId, profileId, { forUpdate: true });
      const next = await queryOne(
        client,
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
         FROM academic_rule_profile_versions
         WHERE profile_id = $1 AND school_id = $2`,
        [profileId, schoolId]
      );
      const versionRes = await client.query(
        `INSERT INTO academic_rule_profile_versions
           (school_id, profile_id, version, status, spec, spec_sha256)
         VALUES ($1, $2, $3, 'DRAFT', $4::jsonb, $5)
         RETURNING *`,
        [schoolId, profileId, Number(next.next), JSON.stringify(normalized), sha]
      );
      return mapVersion(versionRes.rows[0]);
    });
  }

  async function activateVersion({ schoolId, actorSchoolId, profileId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withTx(async (client) => {
      await requireProfile(client, schoolId, profileId);
      const target = await queryOne(
        client,
        `SELECT id FROM academic_rule_profile_versions
         WHERE profile_id = $1 AND version = $2 AND school_id = $3
         FOR UPDATE`,
        [profileId, version, schoolId]
      );
      if (!target) throw new AcademicRuleProfileError("VERSION_NOT_FOUND");
      await client.query(
        `UPDATE academic_rule_profile_versions
         SET status = 'SUPERSEDED'
         WHERE profile_id = $1 AND school_id = $2 AND status = 'ACTIVE' AND version <> $3`,
        [profileId, schoolId, version]
      );
      const updated = await queryOne(
        client,
        `UPDATE academic_rule_profile_versions
         SET status = 'ACTIVE'
         WHERE profile_id = $1 AND version = $2 AND school_id = $3
         RETURNING *`,
        [profileId, version, schoolId]
      );
      return mapVersion(updated);
    });
  }

  async function updateDraftSpec({ schoolId, actorSchoolId, profileId, version, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      await requireProfile(client, schoolId, profileId);
      const current = await queryOne(
        client,
        `SELECT * FROM academic_rule_profile_versions
         WHERE profile_id = $1 AND version = $2 AND school_id = $3`,
        [profileId, version, schoolId]
      );
      if (!current) throw new AcademicRuleProfileError("VERSION_NOT_FOUND");
      if (current.status !== "DRAFT") throw new AcademicRuleProfileError("VERSION_IMMUTABLE");
      const normalized = validateSpec(spec);
      const sha = specSha256(normalized);
      try {
        const updated = await queryOne(
          client,
          `UPDATE academic_rule_profile_versions
           SET spec = $1::jsonb, spec_sha256 = $2
           WHERE id = $3 AND school_id = $4 AND status = 'DRAFT'
           RETURNING *`,
          [JSON.stringify(normalized), sha, current.id, schoolId]
        );
        if (!updated) throw new AcademicRuleProfileError("VERSION_IMMUTABLE");
        return mapVersion(updated);
      } catch (err) {
        if (String(err.message).includes("ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE")) {
          throw new AcademicRuleProfileError("VERSION_IMMUTABLE");
        }
        throw err;
      }
    });
  }

  async function getVersion({ schoolId, actorSchoolId, profileId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      await requireProfile(client, schoolId, profileId);
      const row = await queryOne(
        client,
        `SELECT * FROM academic_rule_profile_versions
         WHERE profile_id = $1 AND version = $2 AND school_id = $3`,
        [profileId, version, schoolId]
      );
      if (!row) throw new AcademicRuleProfileError("VERSION_NOT_FOUND");
      return mapVersion(row);
    });
  }

  async function getActive({ schoolId, actorSchoolId, profileId }) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      await requireProfile(client, schoolId, profileId);
      const row = await queryOne(
        client,
        `SELECT * FROM academic_rule_profile_versions
         WHERE profile_id = $1 AND school_id = $2 AND status = 'ACTIVE'`,
        [profileId, schoolId]
      );
      if (!row) throw new AcademicRuleProfileError("NO_ACTIVE_VERSION");
      return mapVersion(row);
    });
  }

  async function listProfiles(schoolId, actorSchoolId) {
    assertSameTenant(schoolId, actorSchoolId);
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT id, school_id, profile_key, created_at
         FROM academic_rule_profiles WHERE school_id = $1
         ORDER BY created_at`,
        [schoolId]
      );
      return result.rows;
    });
  }

  return {
    createProfile,
    addVersion,
    activateVersion,
    updateDraftSpec,
    getVersion,
    getActive,
    listProfiles,
  };
}

module.exports = { createAcademicRuleProfilePgStore };
