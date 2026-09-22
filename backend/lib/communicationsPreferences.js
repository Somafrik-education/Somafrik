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

function resolvePrefsStore(store) {
  if (store && typeof store.getCommunicationPreferencesStore === "function") {
    return store.getCommunicationPreferencesStore();
  }
  return store;
}

function createMemoryPreferencesQueryable(rows = []) {
  const table = rows;
  return {
    async all(sql, params = []) {
      void sql;
      const [userId, schoolId] = params;
      return table.filter(
        (row) => String(row.user_id) === String(userId) && String(row.school_id) === String(schoolId),
      );
    },
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      if (/DELETE FROM user_communication_preferences/i.test(text)) {
        const before = table.length;
        const keep = table.filter((row) => String(row.user_id) !== String(params[0]));
        table.length = 0;
        table.push(...keep);
        return { rowCount: before - table.length, rows: [] };
      }
      if (!/INSERT INTO user_communication_preferences/i.test(text)) {
        return { rows: [] };
      }
      const [userId, schoolId, channel, enabled] = params;
      const existing = table.find(
        (row) =>
          String(row.user_id) === String(userId)
          && String(row.school_id) === String(schoolId)
          && String(row.channel) === String(channel),
      );
      if (existing) {
        existing.enabled = enabled;
        return { rows: [existing] };
      }
      const row = { user_id: userId, school_id: schoolId, channel, enabled };
      table.push(row);
      return { rows: [row] };
    },
  };
}

function isMissingPrefsTable(error) {
  return String(error?.code || "") === "42P01";
}

function parseEnabledFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const raw = asTrimmed(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "off", "no", "f", "n", ""].includes(raw)) return false;
  const error = new BusinessError(400, "Valeur de canal invalide.");
  error.code = "invalid_channel_flag";
  throw error;
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
      continue;
    }
    if (typeof row.enabled === "string" && !parseEnabledFlag(row.enabled)) {
      enabled.delete(channel);
    }
  }
  return PREFERENCE_CHANNELS.filter((channel) => enabled.has(channel));
}

async function listPreferenceRows(store, { userId, schoolId } = {}) {
  const scopedUserId = uuidOrNull(userId);
  const scopedSchoolId = uuidOrNull(schoolId);
  const db = resolvePrefsStore(store);
  if (!scopedUserId || !scopedSchoolId || typeof db?.all !== "function") return [];
  try {
    return await db.all(
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
  const db = resolvePrefsStore(store);
  if (typeof db?.query !== "function" && typeof db?.one !== "function") {
    throw new BusinessError(500, "Store préférences indisponible.");
  }
  const write = (sql, params) => (typeof db.query === "function" ? db.query(sql, params) : db.one(sql, params));
  const saved = [];
  for (const channel of PREFERENCE_CHANNELS) {
    if (!Object.prototype.hasOwnProperty.call(channels, channel)) continue;
    const enabled = parseEnabledFlag(channels[channel]);
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
    channels[channel] = parseEnabledFlag(raw[channel]);
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
  const db = resolvePrefsStore(store);
  if (!scopedUserId || typeof db?.query !== "function") return 0;
  try {
    const result = await db.query(
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
  parseEnabledFlag,
  isMissingPrefsTable,
  createMemoryPreferencesQueryable,
};
