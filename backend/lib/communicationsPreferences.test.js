"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PREFERENCE_CHANNELS,
  defaultEnabledChannels,
  enabledChannelsFromRows,
  enabledChannelsForUser,
  upsertUserCommunicationPreferences,
  putOwnCommunicationPreferences,
  rejectProviderFields,
  parseEnabledFlag,
  isMissingPrefsTable,
  createMemoryPreferencesQueryable,
} = require("./communicationsPreferences");

const ROOT = path.resolve(__dirname, "../..");
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function memoryPrefsStore(seed = []) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    async all(sql, params) {
      void sql;
      const [userId, schoolId] = params;
      return rows.filter((row) => row.user_id === userId && row.school_id === schoolId);
    },
    async query(sql, params) {
      if (/DELETE FROM user_communication_preferences/.test(sql)) {
        const before = rows.length;
        const keep = rows.filter((row) => row.user_id !== params[0]);
        rows.length = 0;
        rows.push(...keep);
        return { rowCount: before - rows.length };
      }
      const [userId, schoolId, channel, enabled] = params;
      const existing = rows.find(
        (row) => row.user_id === userId && row.school_id === schoolId && row.channel === channel,
      );
      if (existing) {
        existing.enabled = enabled;
        return { rows: [existing] };
      }
      const row = { user_id: userId, school_id: schoolId, channel, enabled };
      rows.push(row);
      return { rows: [row] };
    },
  };
}

test("défaut sans ligne = IN_APP + PUSH + EMAIL", async () => {
  assert.deepEqual(defaultEnabledChannels(), ["IN_APP", "PUSH", "EMAIL"]);
  const enabled = await enabledChannelsForUser(memoryPrefsStore(), { userId: USER_A, schoolId: SCHOOL_A });
  assert.deepEqual(enabled, ["IN_APP", "PUSH", "EMAIL"]);
});

test("EMAIL=false n'ôte ni PUSH ni IN_APP", () => {
  assert.deepEqual(
    enabledChannelsFromRows([
      { channel: "EMAIL", enabled: false },
    ]),
    ["IN_APP", "PUSH"],
  );
});

test("PUSH=false n'ôte ni EMAIL ni IN_APP", () => {
  assert.deepEqual(
    enabledChannelsFromRows([
      { channel: "PUSH", enabled: false },
    ]),
    ["IN_APP", "EMAIL"],
  );
});

test("préférence school A n'est pas lue pour school B", async () => {
  const store = memoryPrefsStore([
    { user_id: USER_A, school_id: SCHOOL_A, channel: "PUSH", enabled: false },
  ]);
  assert.deepEqual(await enabledChannelsForUser(store, { userId: USER_A, schoolId: SCHOOL_A }), ["IN_APP", "EMAIL"]);
  assert.deepEqual(await enabledChannelsForUser(store, { userId: USER_A, schoolId: SCHOOL_B }), ["IN_APP", "PUSH", "EMAIL"]);
});

test("upsert refuse tout champ provider", async () => {
  const store = memoryPrefsStore();
  assert.throws(
    () => rejectProviderFields({ preferred_provider: "brevo" }),
    (error) => error.code === "unsupported_preference_provider",
  );
  await assert.rejects(
    () => upsertUserCommunicationPreferences(store, {
      userId: USER_A,
      schoolId: SCHOOL_A,
      channels: { EMAIL: false, push_provider: "expo" },
    }),
    (error) => error.code === "unsupported_preference_provider",
  );
});

test("module prefs n'importe aucun SDK et ne révoque pas les devices", () => {
  const src = read("backend/lib/communicationsPreferences.js");
  assert.doesNotMatch(src, /require\(["'][^"']*(nodemailer|expo-server-sdk|@getbrevo)/);
  assert.doesNotMatch(src, /mobile_push_devices|revokeCurrent|revokeByToken|expo_push_token/);
  assert.equal(PREFERENCE_CHANNELS.includes("SMS"), false);
});

test("schéma UNIQUE(user_id, school_id, channel) sans colonne provider", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const migration = read("backend/db/migrations/20260910_user_communication_preferences.sql");
  for (const src of [schema, migration]) {
    assert.match(src, /user_communication_preferences/);
    assert.match(src, /PRIMARY KEY \(user_id, school_id, channel\)/);
    assert.match(src, /channel IN \('IN_APP', 'PUSH', 'EMAIL'\)/);
    assert.doesNotMatch(src, /preferred_provider|push_provider|expo_push_token/i);
  }
});

test("permission denied n'est pas traité comme table absente", async () => {
  assert.equal(isMissingPrefsTable({ code: "42P01" }), true);
  assert.equal(
    isMissingPrefsTable({
      code: "42501",
      message: "permission denied for table user_communication_preferences",
    }),
    false,
  );
  const store = {
    async all() {
      const error = new Error("permission denied for table user_communication_preferences");
      error.code = "42501";
      throw error;
    },
  };
  await assert.rejects(
    () => enabledChannelsForUser(store, { userId: USER_A, schoolId: SCHOOL_A }),
    (error) => error.code === "42501",
  );
});

test('parseEnabledFlag("false") reste false', () => {
  assert.equal(parseEnabledFlag("false"), false);
  assert.equal(parseEnabledFlag(false), false);
  assert.equal(parseEnabledFlag("true"), true);
  assert.equal(parseEnabledFlag(true), true);
  assert.throws(() => parseEnabledFlag("maybe"), (error) => error.code === "invalid_channel_flag");
});

test("PUT mémoire persiste EMAIL=false même si string", async () => {
  const rows = [];
  const store = {
    getSchoolByCode: async () => ({ id: SCHOOL_A }),
    getCommunicationPreferencesStore: () => createMemoryPreferencesQueryable(rows),
  };
  const result = await putOwnCommunicationPreferences(
    store,
    { sub: USER_A, schoolCode: "SCH-A" },
    { channels: { EMAIL: "false" } },
  );
  assert.equal(result.channels.EMAIL, false);
  assert.equal(result.channels.PUSH, true);
  assert.equal(result.channels.IN_APP, true);
  const again = await upsertUserCommunicationPreferences(store, {
    userId: USER_A,
    schoolId: SCHOOL_A,
    channels: { PUSH: "false" },
  });
  assert.deepEqual(again, ["IN_APP"]);
});
