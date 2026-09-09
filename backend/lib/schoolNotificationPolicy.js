"use strict";

/**
 * Lot I — politique notifications établissement.
 * Événement → destinataires canoniques → canaux IN_APP | PUSH | EMAIL.
 * Aucun fournisseur. Hors Auth/sécurité (auth.password.reset).
 */

const {
  SCHOOL_SETTINGS_ERROR,
  asTrimmed,
  createSchoolSettingsError,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  assertSchoolSettingsRead,
  assertSchoolSettingsWrite,
} = require("./schoolSettingsManagement");
const { parseEnabledFlag, isMissingPrefsTable } = require("./communicationsPreferences");
const { uuidOrNull } = require("./principalIdentity");

const LOT_I_EVENTS = Object.freeze([
  "STUDENT_ABSENT",
  "STUDENT_LATE",
  "GRADE_PUBLISHED",
  "REPORT_CARD_PUBLISHED",
  "PAYMENT_RECEIVED",
  "PAYMENT_DUE",
  "ANNOUNCEMENT_PUBLISHED",
  "TIMETABLE_CHANGED",
  "TEACHER_REPLACEMENT",
]);

const RECIPIENT_CATEGORIES = Object.freeze(["PARENT", "STUDENT", "TEACHER", "SCHOOL_ADMIN"]);
const CHANNELS = Object.freeze(["IN_APP", "PUSH", "EMAIL"]);

const CANONICAL_ALLOWED_RECIPIENTS = Object.freeze({
  STUDENT_ABSENT: Object.freeze(["PARENT"]),
  STUDENT_LATE: Object.freeze(["PARENT"]),
  GRADE_PUBLISHED: Object.freeze(["PARENT", "STUDENT"]),
  REPORT_CARD_PUBLISHED: Object.freeze(["PARENT", "STUDENT"]),
  PAYMENT_RECEIVED: Object.freeze(["PARENT"]),
  PAYMENT_DUE: Object.freeze(["PARENT", "SCHOOL_ADMIN"]),
  ANNOUNCEMENT_PUBLISHED: Object.freeze(["PARENT", "STUDENT", "TEACHER", "SCHOOL_ADMIN"]),
  TIMETABLE_CHANGED: Object.freeze(["TEACHER", "SCHOOL_ADMIN"]),
  TEACHER_REPLACEMENT: Object.freeze(["PARENT", "TEACHER", "SCHOOL_ADMIN"]),
});

const C4_TO_LOT_I = Object.freeze({
  "attendance.student.absent": "STUDENT_ABSENT",
  "attendance.student.late": "STUDENT_LATE",
  "pedagogy.grade.published": "GRADE_PUBLISHED",
  "pedagogy.report_card.published": "REPORT_CARD_PUBLISHED",
  "finance.payment.recorded": "PAYMENT_RECEIVED",
  "finance.payment.due": "PAYMENT_DUE",
  "communication.announcement.published": "ANNOUNCEMENT_PUBLISHED",
});

const MANDATORY_EVENT_CHANNELS = Object.freeze({
  "auth.password.reset": Object.freeze(["EMAIL"]),
});

const KIND_TO_CATEGORY = Object.freeze({
  parent: "PARENT",
  parents: "PARENT",
  student: "STUDENT",
  students: "STUDENT",
  eleve: "STUDENT",
  eleves: "STUDENT",
  teacher: "TEACHER",
  teachers: "TEACHER",
  enseignant: "TEACHER",
  enseignants: "TEACHER",
  staff: "SCHOOL_ADMIN",
  personnel: "SCHOOL_ADMIN",
  school_admin: "SCHOOL_ADMIN",
  admin: "SCHOOL_ADMIN",
  administration: "SCHOOL_ADMIN",
});

const SCHOOL_WIDE_KINDS = Object.freeze(new Set(["school", "school_wide", "tous"]));
const SCHOOL_POLICY_UNAVAILABLE = "school_notification_policy_unavailable";

function cloneChannelFlags(flags = {}) {
  return {
    IN_APP: flags.IN_APP !== false,
    PUSH: flags.PUSH !== false,
    EMAIL: flags.EMAIL !== false,
  };
}

function getCanonicalSchoolNotificationCatalog() {
  return {
    events: LOT_I_EVENTS.map((event) => ({
      event,
      allowedRecipients: [...CANONICAL_ALLOWED_RECIPIENTS[event]],
    })),
  };
}

function getDefaultSchoolNotificationSettings() {
  const events = {};
  for (const event of LOT_I_EVENTS) {
    const allowedRecipients = [...CANONICAL_ALLOWED_RECIPIENTS[event]];
    const block = { allowedRecipients };
    for (const recipient of allowedRecipients) {
      block[recipient] = cloneChannelFlags();
    }
    events[event] = block;
  }
  return { events };
}

function mapDispatcherEventToLotI(eventType) {
  const key = asTrimmed(eventType);
  if (!key) return null;
  if (C4_TO_LOT_I[key]) return C4_TO_LOT_I[key];
  const known = Object.keys(C4_TO_LOT_I).sort((left, right) => right.length - left.length);
  const match = known.find((type) => key === type || key.startsWith(`${type}:`));
  return match ? C4_TO_LOT_I[match] : null;
}

function canonicalizeKindToken(kind) {
  return asTrimmed(kind)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isSchoolWideRecipientKind(kind) {
  return SCHOOL_WIDE_KINDS.has(canonicalizeKindToken(kind));
}

function mapRecipientKindToCategory(kind) {
  const raw = asTrimmed(kind).toUpperCase();
  if (RECIPIENT_CATEGORIES.includes(raw)) return raw;
  return KIND_TO_CATEGORY[canonicalizeKindToken(kind)] || null;
}

function categoriesFromRoleKeys(roleKeys = []) {
  const cats = new Set();
  for (const raw of roleKeys || []) {
    const mapped = mapRecipientKindToCategory(raw);
    if (mapped) {
      cats.add(mapped);
      continue;
    }
    if (asTrimmed(raw)) cats.add("SCHOOL_ADMIN");
  }
  return [...cats];
}

function wrapSchoolPolicyError(error) {
  const wrapped = new Error(String(error?.message || SCHOOL_POLICY_UNAVAILABLE));
  wrapped.code = SCHOOL_POLICY_UNAVAILABLE;
  wrapped.cause = error;
  return wrapped;
}

async function loadUserRoleKeys(store, { userId, schoolId, adapter } = {}) {
  if (typeof adapter?.listUserRoleKeys === "function") {
    return adapter.listUserRoleKeys({ userId, schoolId });
  }
  const db = resolveQueryable(store);
  if (typeof db?.listActiveUserRoleKeysForSchool === "function") {
    return db.listActiveUserRoleKeysForSchool(userId, schoolId);
  }
  if (typeof adapter?.listActiveUserRoleKeysForSchool === "function") {
    return adapter.listActiveUserRoleKeysForSchool(userId, schoolId);
  }
  if (typeof db?.listActiveUserRoleKeys === "function") {
    return db.listActiveUserRoleKeys(userId);
  }
  const users = adapter?.users;
  if (Array.isArray(users)) {
    const row = users.find(
      (item) => String(item.id) === String(userId) && String(item.school_id || item.schoolId) === String(schoolId),
    );
    if (Array.isArray(row?.roles)) return row.roles;
    if (row?.role) return [row.role];
    if (row?.role_key) return [row.role_key];
    return [];
  }
  const scopedUserId = uuidOrNull(userId);
  const scopedSchoolId = uuidOrNull(schoolId);
  if (!scopedUserId || !scopedSchoolId || typeof db?.all !== "function") return [];
  try {
    const rows = await db.all(
      `SELECT role_key
         FROM user_roles
        WHERE user_id = $1 AND school_id = $2
          AND status = 'active' AND revoked_at IS NULL`,
      [scopedUserId, scopedSchoolId],
    );
    return (rows || []).map((row) => row.role_key || row.roleKey).filter(Boolean);
  } catch (error) {
    if (isMissingPrefsTable(error)) return [];
    throw wrapSchoolPolicyError(error);
  }
}

async function resolveUserRecipientCategories(store, { userId, schoolId, adapter } = {}) {
  const roleKeys = await loadUserRoleKeys(store, { userId, schoolId, adapter });
  return categoriesFromRoleKeys(roleKeys);
}

function userChannelSet(userPreferences) {
  if (userPreferences == null) return new Set(CHANNELS);
  if (Array.isArray(userPreferences)) {
    return new Set(
      userPreferences
        .map((channel) => asTrimmed(channel).toUpperCase())
        .filter((channel) => CHANNELS.includes(channel)),
    );
  }
  if (typeof userPreferences === "object") {
    return new Set(CHANNELS.filter((channel) => userPreferences[channel] !== false && userPreferences[channel] !== 0));
  }
  return new Set(CHANNELS);
}

function resolveAllowedChannels({
  event,
  eventType,
  recipient,
  recipientCategories,
  schoolPolicy,
  userPreferences,
} = {}) {
  const type = asTrimmed(eventType);
  const mandatory = MANDATORY_EVENT_CHANNELS[type];
  if (mandatory) return [...mandatory];

  const lotI = LOT_I_EVENTS.includes(asTrimmed(event).toUpperCase())
    ? asTrimmed(event).toUpperCase()
    : mapDispatcherEventToLotI(eventType);
  const user = userChannelSet(userPreferences);
  if (!lotI) {
    return CHANNELS.filter((channel) => user.has(channel));
  }

  const allowed = CANONICAL_ALLOWED_RECIPIENTS[lotI] || [];
  const events = eventsFromPolicy(schoolPolicy);
  const explicitCats = Array.isArray(recipientCategories)
    ? recipientCategories.map(mapRecipientKindToCategory).filter((item) => item && allowed.includes(item))
    : null;
  if (explicitCats) {
    if (!explicitCats.length) return [];
    return CHANNELS.filter((channel) => {
      if (!user.has(channel)) return false;
      return explicitCats.some((cat) => events[lotI]?.[cat]?.[channel] !== false);
    });
  }

  const recipientCat = mapRecipientKindToCategory(recipient);
  if (!recipientCat || !allowed.includes(recipientCat)) {
    if (!recipientCat) {
      if (isSchoolWideRecipientKind(recipient)) return [];
      return CHANNELS.filter((channel) => {
        if (!user.has(channel)) return false;
        return allowed.some((item) => events[lotI]?.[item]?.[channel] !== false);
      });
    }
    return [];
  }
  const schoolRule = events[lotI]?.[recipientCat] || cloneChannelFlags();
  return CHANNELS.filter((channel) => schoolRule[channel] !== false && user.has(channel));
}

function eventsFromPolicy(schoolPolicy) {
  if (!schoolPolicy || typeof schoolPolicy !== "object") {
    return getDefaultSchoolNotificationSettings().events;
  }
  if (schoolPolicy.events) return schoolPolicy.events;
  return schoolPolicy;
}

function overlayRows(rows = []) {
  const settings = getDefaultSchoolNotificationSettings();
  for (const row of rows) {
    const event = asTrimmed(row.event_key).toUpperCase();
    const recipient = asTrimmed(row.recipient_category).toUpperCase();
    const channel = asTrimmed(row.channel).toUpperCase();
    if (!settings.events[event] || !settings.events[event][recipient]) continue;
    if (!CHANNELS.includes(channel)) continue;
    const enabled = row.enabled === true || row.enabled === "t" || row.enabled === 1 || row.enabled === "1";
    settings.events[event][recipient][channel] = enabled;
  }
  return settings;
}

function resolveQueryable(store) {
  if (!store) return null;
  if (typeof store.getSchoolNotificationSettingsStore === "function") {
    return store.getSchoolNotificationSettingsStore();
  }
  return store;
}

async function requireSchoolFromStore(store, schoolCode) {
  const code = asTrimmed(schoolCode).toUpperCase();
  if (typeof store?.requireSchoolByCode === "function") {
    return store.requireSchoolByCode(code);
  }
  if (typeof store?.getSchoolByCode === "function") {
    const school = await store.getSchoolByCode(code);
    if (!school) {
      throw createSchoolSettingsError(404, "Établissement introuvable.", SCHOOL_SETTINGS_ERROR.SCHOOL_NOT_FOUND);
    }
    return {
      id: school.id,
      school_code: school.school_code || school.code || code,
    };
  }
  throw createSchoolSettingsError(500, "Store établissement indisponible.", SCHOOL_SETTINGS_ERROR.SCHOOL_SETTINGS_UNAVAILABLE);
}

function assertTenantSchool(principal, schoolCode) {
  const requested = asTrimmed(schoolCode).toUpperCase();
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) return;
  const own = asTrimmed(principal?.schoolCode).toUpperCase();
  if (requested && own && own !== "*" && requested !== own) {
    throw createSchoolSettingsError(403, "Accès refusé: établissement hors périmètre.", SCHOOL_SETTINGS_ERROR.FORBIDDEN);
  }
}

async function listSettingsRows(db, schoolId) {
  const scopedSchoolId = uuidOrNull(schoolId);
  if (!scopedSchoolId || typeof db?.all !== "function") return [];
  try {
    return await db.all(
      `SELECT school_id, event_key, recipient_category, channel, enabled
         FROM school_notification_settings
        WHERE school_id = $1`,
      [scopedSchoolId],
    );
  } catch (error) {
    if (isMissingPrefsTable(error)) return [];
    throw error;
  }
}

async function getSchoolPolicyEventsBySchoolId(store, schoolId) {
  const db = resolveQueryable(store);
  const rows = await listSettingsRows(db, schoolId);
  return overlayRows(rows).events;
}

async function getSchoolNotificationSettings(store, principal, schoolCode) {
  assertSchoolSettingsRead(principal);
  const code = asTrimmed(schoolCode).toUpperCase();
  assertTenantSchool(principal, code);
  const db = resolveQueryable(store);
  const school = await requireSchoolFromStore(db, code);
  const rows = await listSettingsRows(db, school.id);
  return {
    schoolCode: school.school_code || school.code || code,
    events: overlayRows(rows).events,
  };
}

function unknownEventError(event) {
  const error = createSchoolSettingsError(400, `Événement de notification inconnu: ${event}.`, "unknown_notification_event");
  return error;
}

function unknownChannelError(channel) {
  return createSchoolSettingsError(400, `Canal ${channel} non autorisé.`, "unsupported_notification_channel");
}

function forbiddenRecipientError(event, recipient) {
  return createSchoolSettingsError(
    400,
    `Destinataire ${recipient} interdit pour ${event}.`,
    "forbidden_notification_recipient",
  );
}

function parseSettingsWrite(body = {}) {
  const events = body.events && typeof body.events === "object" ? body.events : body;
  if (!events || typeof events !== "object" || Array.isArray(events)) {
    throw createSchoolSettingsError(400, "Aucune règle de notification à enregistrer.", "invalid_notification_settings");
  }
  const patch = [];
  for (const [eventRaw, recipients] of Object.entries(events)) {
    const event = asTrimmed(eventRaw).toUpperCase();
    if (!LOT_I_EVENTS.includes(event)) throw unknownEventError(eventRaw);
    if (!recipients || typeof recipients !== "object") {
      throw createSchoolSettingsError(400, "Règle de destinataires invalide.", "invalid_notification_settings");
    }
    for (const [recipientRaw, channels] of Object.entries(recipients)) {
      if (recipientRaw === "allowedRecipients") continue;
      const recipient = asTrimmed(recipientRaw).toUpperCase();
      if (!CANONICAL_ALLOWED_RECIPIENTS[event].includes(recipient)) {
        throw forbiddenRecipientError(event, recipientRaw);
      }
      if (!channels || typeof channels !== "object") {
        throw createSchoolSettingsError(400, "Canaux invalides.", "invalid_notification_settings");
      }
      for (const [channelRaw, value] of Object.entries(channels)) {
        const channel = asTrimmed(channelRaw).toUpperCase();
        if (!CHANNELS.includes(channel)) throw unknownChannelError(channelRaw);
        patch.push({ event, recipient, channel, enabled: parseEnabledFlag(value) });
      }
    }
  }
  if (!patch.length) {
    throw createSchoolSettingsError(400, "Aucune règle de notification à enregistrer.", "invalid_notification_settings");
  }
  return patch;
}

async function upsertSettingRow(db, { schoolId, event, recipient, channel, enabled }) {
  if (typeof db?.query !== "function" && typeof db?.one !== "function") {
    throw createSchoolSettingsError(500, "Store notifications établissement indisponible.", SCHOOL_SETTINGS_ERROR.SCHOOL_SETTINGS_UNAVAILABLE);
  }
  const write = (sql, params) => (typeof db.query === "function" ? db.query(sql, params) : db.one(sql, params));
  await write(
    `INSERT INTO school_notification_settings (
       school_id, event_key, recipient_category, channel, enabled, updated_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (school_id, event_key, recipient_category, channel)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [schoolId, event, recipient, channel, enabled],
  );
}

async function patchSchoolNotificationSettings(store, principal, schoolCode, body = {}) {
  assertSchoolSettingsWrite(principal);
  const code = asTrimmed(schoolCode).toUpperCase();
  assertTenantSchool(principal, code);
  const patch = parseSettingsWrite(body);
  const db = resolveQueryable(store);
  const school = await requireSchoolFromStore(db, code);
  for (const row of patch) {
    await upsertSettingRow(db, { schoolId: school.id, ...row });
  }
  return getSchoolNotificationSettings(store, principal, schoolCode);
}

function putSchoolNotificationSettings(store, principal, schoolCode, body = {}) {
  return patchSchoolNotificationSettings(store, principal, schoolCode, body);
}

function parseJsonish(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

function recipientCategoriesFromContext(context) {
  const parsed = parseJsonish(context);
  const raw = Array.isArray(parsed.kinds) ? parsed.kinds : [];
  const cats = [];
  for (const item of raw) {
    const mapped = mapRecipientKindToCategory(item);
    if (mapped && !cats.includes(mapped)) cats.push(mapped);
  }
  return cats;
}

function createMemorySchoolNotificationStore({ schools = [], rows = [], schoolLookup } = {}) {
  const table = rows.map((row) => ({ ...row }));
  const schoolByCode = new Map(
    schools.map((school) => [asTrimmed(school.school_code || school.code).toUpperCase(), school]),
  );
  return {
    rows: table,
    async requireSchoolByCode(code) {
      if (typeof schoolLookup === "function") {
        const school = await schoolLookup(code);
        if (!school) {
          throw createSchoolSettingsError(404, "Établissement introuvable.", SCHOOL_SETTINGS_ERROR.SCHOOL_NOT_FOUND);
        }
        return {
          id: school.id,
          school_code: school.school_code || school.code || asTrimmed(code).toUpperCase(),
        };
      }
      const school = schoolByCode.get(asTrimmed(code).toUpperCase());
      if (!school) {
        throw createSchoolSettingsError(404, "Établissement introuvable.", SCHOOL_SETTINGS_ERROR.SCHOOL_NOT_FOUND);
      }
      return school;
    },
    async all(sql, params = []) {
      void sql;
      const [schoolId] = params;
      return table.filter((row) => String(row.school_id) === String(schoolId));
    },
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      if (!/INSERT INTO school_notification_settings/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      const [schoolId, eventKey, recipient, channel, enabled] = params;
      const existing = table.find(
        (row) =>
          String(row.school_id) === String(schoolId)
          && String(row.event_key) === String(eventKey)
          && String(row.recipient_category) === String(recipient)
          && String(row.channel) === String(channel),
      );
      if (existing) {
        existing.enabled = enabled;
        existing.updated_at = new Date().toISOString();
        return { rows: [existing], rowCount: 1 };
      }
      const row = {
        school_id: schoolId,
        event_key: eventKey,
        recipient_category: recipient,
        channel,
        enabled,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      table.push(row);
      return { rows: [row], rowCount: 1 };
    },
  };
}

module.exports = {
  LOT_I_EVENTS,
  RECIPIENT_CATEGORIES,
  CHANNELS,
  CANONICAL_ALLOWED_RECIPIENTS,
  getCanonicalSchoolNotificationCatalog,
  getDefaultSchoolNotificationSettings,
  mapDispatcherEventToLotI,
  mapRecipientKindToCategory,
  isSchoolWideRecipientKind,
  recipientCategoriesFromContext,
  resolveUserRecipientCategories,
  resolveAllowedChannels,
  getSchoolPolicyEventsBySchoolId,
  getSchoolNotificationSettings,
  patchSchoolNotificationSettings,
  putSchoolNotificationSettings,
  createMemorySchoolNotificationStore,
  SCHOOL_POLICY_UNAVAILABLE,
};
