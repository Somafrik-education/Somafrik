"use strict";

const crypto = require("node:crypto");
const {
  PROFILE_STATUSES,
  AcademicRuleProfileError,
  requireSchoolId,
  assertSameTenant,
  validateSpec,
  specSha256,
} = require("./academicRuleProfile");

function createAcademicRuleProfileStore() {
  const profiles = new Map();
  const versions = new Map();

  function profileKey(schoolId, id) {
    return `${schoolId}::${id}`;
  }

  function versionsOf(profileId) {
    if (!versions.has(profileId)) versions.set(profileId, []);
    return versions.get(profileId);
  }

  function getProfile(schoolId, profileId) {
    requireSchoolId(schoolId);
    const row = profiles.get(profileId);
    if (!row || row.school_id !== schoolId) {
      throw new AcademicRuleProfileError("PROFILE_NOT_FOUND");
    }
    return row;
  }

  function createProfile({ schoolId, actorSchoolId, profileKey: key, spec, activate = false }) {
    assertSameTenant(schoolId, actorSchoolId);
    const normalized = validateSpec(spec);
    const profileId = crypto.randomUUID();
    const profile = Object.freeze({
      id: profileId,
      school_id: schoolId,
      profile_key: String(key || "default"),
      created_at: new Date().toISOString(),
    });
    for (const existing of profiles.values()) {
      if (existing.school_id === schoolId && existing.profile_key === profile.profile_key) {
        throw new AcademicRuleProfileError("PROFILE_KEY_TAKEN");
      }
    }
    profiles.set(profileId, profile);
    const version = Object.freeze({
      id: crypto.randomUUID(),
      school_id: schoolId,
      profile_id: profileId,
      version: 1,
      status: activate ? "ACTIVE" : "DRAFT",
      spec: normalized,
      spec_sha256: specSha256(normalized),
      created_at: new Date().toISOString(),
    });
    versionsOf(profileId).push(version);
    return { profile, version };
  }

  function addVersion({ schoolId, actorSchoolId, profileId, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    getProfile(schoolId, profileId);
    const normalized = validateSpec(spec);
    const list = versionsOf(profileId);
    const nextNo = list.length + 1;
    const version = Object.freeze({
      id: crypto.randomUUID(),
      school_id: schoolId,
      profile_id: profileId,
      version: nextNo,
      status: "DRAFT",
      spec: normalized,
      spec_sha256: specSha256(normalized),
      created_at: new Date().toISOString(),
    });
    list.push(version);
    return version;
  }

  function activateVersion({ schoolId, actorSchoolId, profileId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    getProfile(schoolId, profileId);
    const list = versionsOf(profileId);
    const target = list.find((row) => row.version === version);
    if (!target || target.school_id !== schoolId) {
      throw new AcademicRuleProfileError("VERSION_NOT_FOUND");
    }
    const next = list.map((row) => {
      if (row.version === version) {
        return Object.freeze({ ...row, status: "ACTIVE" });
      }
      if (row.status === "ACTIVE") {
        return Object.freeze({ ...row, status: "SUPERSEDED" });
      }
      return row;
    });
    versions.set(profileId, next);
    return next.find((row) => row.version === version);
  }

  function updateDraftSpec({ schoolId, actorSchoolId, profileId, version, spec }) {
    assertSameTenant(schoolId, actorSchoolId);
    getProfile(schoolId, profileId);
    const list = versionsOf(profileId);
    const idx = list.findIndex((row) => row.version === version);
    if (idx < 0) throw new AcademicRuleProfileError("VERSION_NOT_FOUND");
    const current = list[idx];
    if (current.status !== "DRAFT") {
      throw new AcademicRuleProfileError("VERSION_IMMUTABLE");
    }
    const normalized = validateSpec(spec);
    const updated = Object.freeze({
      ...current,
      spec: normalized,
      spec_sha256: specSha256(normalized),
    });
    list[idx] = updated;
    return updated;
  }

  function getVersion({ schoolId, actorSchoolId, profileId, version }) {
    assertSameTenant(schoolId, actorSchoolId);
    getProfile(schoolId, profileId);
    const row = versionsOf(profileId).find((item) => item.version === version);
    if (!row) throw new AcademicRuleProfileError("VERSION_NOT_FOUND");
    return row;
  }

  function getActive({ schoolId, actorSchoolId, profileId }) {
    assertSameTenant(schoolId, actorSchoolId);
    getProfile(schoolId, profileId);
    const row = versionsOf(profileId).find((item) => item.status === "ACTIVE");
    if (!row) throw new AcademicRuleProfileError("NO_ACTIVE_VERSION");
    return row;
  }

  function listProfiles(schoolId, actorSchoolId) {
    assertSameTenant(schoolId, actorSchoolId);
    requireSchoolId(schoolId);
    return [...profiles.values()].filter((row) => row.school_id === schoolId);
  }

  return {
    createProfile,
    addVersion,
    activateVersion,
    updateDraftSpec,
    getVersion,
    getActive,
    listProfiles,
    PROFILE_STATUSES,
  };
}

module.exports = { createAcademicRuleProfileStore };
