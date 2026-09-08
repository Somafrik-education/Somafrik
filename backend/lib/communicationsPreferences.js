"use strict";

/**
 * Préférences de communication par CANAL (IN_APP | PUSH | EMAIL).
 * Scoped user_id + school_id. Aucun fournisseur dans ce module.
 * Absence de ligne = canal activé (comportement historique).
 */

const { BusinessError } = require("../services/authService");
const { uuidOrNull } = require("./principalIdentity");

const PREFERENCE_CHANNELS = Object.freeze(["IN_APP", "PUSH", "EMAIL"]);
const PROVIDER_FIELD_RE = /provider|brevo|expo|fcm|smtp|twilio|sendgrid/i;

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function defaultEnabledChannels() {
  return [...PREFERENCE_CHANNELS];
}

function isMissingPrefsTable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return code === "42P01" || message.includes("user_communication_preferences");
}

function rejectProviderFields(payload = {}) {
  const keys = [
    ...Object.keys(payload || {}),
    ...Object.keys(payload.channels || {}),
  ];
  for (const key of keys) {
    if (PROVIDER_FIELD_RE.test(key)) {
      const error = new BusinessError(400, "Les préférences sont par canal, jamais par fournisseur.");
      error.code = "unsupported_preference_provider";
      throw error;
    }
  }
}

function enabledChannelsFromRows(rows = []) {
  const enabled = new Set(PREFERENCE_CHANNELS);
  for (const row of rows) {
    const channel = asTrimmed(row.channel).toUpperCase();
    if (!PREFERENCE_CHANNELS.includes(channel)) continue;
    if (row.enabled === false || row.enabled === "f" || row.enabled === 0 || row.enabled === "0") {
      enabled.delete(channel);
    }
  }
  return PREFERENCE_CHANNELS.filter((channel) => enabled.has(channel));
}

async function listPreferenceRows(store, { userId, schoolId } = {}) {
  const scopedUserId = uuidOrNull(userId);
  const scopedSchoolId = uuidOrNull(schoolId);
  if (!scopedUserId || !scopedSchoolId || typeof store?.all !== "function") return [];
  try {
    return await store.all(
      `SELECT user_id, school_id, channel, enabled
         FROM user_communication_preferences
        WHERE user_id = $1 AND school_id = $2`,
      [scopedUserId, scopedSchoolId],
    );
  } catch (error) {
    if (isMissingPrefsTable(error)) return [];
    throw error;
  }
}

async function enabledChannelsForUser(store, { userId, schoolId } = {}) {
  const rows = await listPreferenceRows(store, { userId, schoolId });
  return enabledChannelsFromRows(rows);
}

async function upsertUserCommunicationPreferences(store, { userId, schoolId, channels = {} } = {}) {
  rejectProviderFields(channels);
  rejectProviderFields({ channels });
  const scopedUserId = uuidOrNull(userId);
  const scopedSchoolId = uuidOrNull(schoolId);
  if (!scopedUserId || !scopedSchoolId) {
    throw new BusinessError(400, "user_id et school_id requis pour les préférences.");
  }
  if (typeof store?.query !== "function" && typeof store?.one !== "function") {
    throw new BusinessError(500, "Store préférences indisponible.");
  }
  const write = (sql, params) => (typeof store.query === "function" ? store.query(sql, params) : store.one(sql, params));
  const saved = [];
  for (const channel of PREFERENCE_CHANNELS) {
    if (!Object.prototype.hasOwnProperty.call(channels, channel)) continue;
    const enabled = Boolean(channels[channel]);
    const row = await write(
      `INSERT INTO user_communication_preferences (user_id, school_id, channel, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, school_id, channel)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
       RETURNING user_id, school_id, channel, enabled`,
      [scopedUserId, scopedSchoolId, channel, enabled],
    );
    saved.push(row?.rows?.[0] || row);
  }
  return enabledChannelsForUser(store, { userId: scopedUserId, schoolId: scopedSchoolId });
}

function sessionUserId(principal) {
  const userId = uuidOrNull(principal?.sub);
  if (!userId) throw new BusinessError(401, "Session utilisateur invalide.");
  return userId;
}

async function sessionSchoolId(store, principal) {
  if (typeof store.resolveSchoolId === "function") {
    const schoolId = uuidOrNull(await store.resolveSchoolId(principal?.schoolCode));
    if (!schoolId) throw new BusinessError(400, "École de session requise.");
    return schoolId;
  }
  if (typeof store.getSchoolByCode === "function") {
    const school = await store.getSchoolByCode(principal?.schoolCode);
    const schoolId = uuidOrNull(school?.id);
    if (!schoolId) throw new BusinessError(400, "École de session requise.");
    return schoolId;
  }
  throw new BusinessError(400, "École de session requise.");
}

function publicChannelsDto(enabled) {
  const set = new Set(enabled);
  return {
    IN_APP: set.has("IN_APP"),
    PUSH: set.has("PUSH"),
    EMAIL: set.has("EMAIL"),
  };
}

function parseChannelPatch(body = {}) {
  rejectProviderFields(body);
  const raw = body.channels && typeof body.channels === "object" ? body.channels : body;
  rejectProviderFields(raw);
  const channels = {};
  for (const channel of PREFERENCE_CHANNELS) {
    if (!Object.prototype.hasOwnProperty.call(raw, channel)) continue;
    channels[channel] = Boolean(raw[channel]);
  }
  if (!Object.keys(channels).length) {
    throw new BusinessError(400, "Aucun canal IN_APP | PUSH | EMAIL à enregistrer.");
  }
  return channels;
}

async function getOwnCommunicationPreferences(store, principal) {
  const userId = sessionUserId(principal);
  const schoolId = await sessionSchoolId(store, principal);
  const enabled = await enabledChannelsForUser(store, { userId, schoolId });
  return { schoolId, channels: publicChannelsDto(enabled) };
}

async function putOwnCommunicationPreferences(store, principal, body = {}) {
  if (body.userId != null || body.user_id != null || body.schoolId != null || body.school_id != null) {
    throw new BusinessError(400, "Identité user/school interdite depuis le client.");
  }
  const userId = sessionUserId(principal);
  const schoolId = await sessionSchoolId(store, principal);
  const channels = parseChannelPatch(body);
  const enabled = await upsertUserCommunicationPreferences(store, { userId, schoolId, channels });
  return { schoolId, channels: publicChannelsDto(enabled) };
}

async function deletePreferencesForUser(store, userId) {
  const scopedUserId = uuidOrNull(userId);
  if (!scopedUserId || typeof store?.query !== "function") return 0;
  try {
    const result = await store.query(
      `DELETE FROM user_communication_preferences WHERE user_id = $1`,
      [scopedUserId],
    );
    return Number(result?.rowCount || 0);
  } catch (error) {
    if (isMissingPrefsTable(error)) return 0;
    throw error;
  }
}

module.exports = {
  PREFERENCE_CHANNELS,
  defaultEnabledChannels,
  enabledChannelsFromRows,
  enabledChannelsForUser,
  listPreferenceRows,
  upsertUserCommunicationPreferences,
  getOwnCommunicationPreferences,
  putOwnCommunicationPreferences,
  deletePreferencesForUser,
  rejectProviderFields,
};
