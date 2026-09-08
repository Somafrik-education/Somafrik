"use strict";

/**
 * Lot I — configuration notifications établissement (TEST FIRST).
 *
 * Contrats : événement → destinataires canoniques → canaux IN_APP | PUSH | EMAIL.
 * Séparé des préférences personnelles Lot H (`/api/me/communication-preferences`).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createMemoryDeliveryAdapter,
} = require("./communicationChannelFanout");
const {
  dispatchCommunication,
  dispatchProcessedEvents,
  resolveEffectiveChannels,
  mandatoryChannelsForEvent,
} = require("./communicationsDispatcher");
const { list: listPersonalNotifications } = require("./communicationsNotificationsService");
const {
  PREFERENCE_CHANNELS,
  getOwnCommunicationPreferences,
  putOwnCommunicationPreferences,
  createMemoryPreferencesQueryable,
} = require("./communicationsPreferences");

const ROOT = path.resolve(__dirname, "../..");
const POLICY_MODULE = path.join(__dirname, "schoolNotificationPolicy.js");
const API_ROUTE = "/api/backoffice/establishments/:schoolCode/notification-settings";

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const NOTE_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const EVENT_KEY = "attendance.student.absent:dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

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
const FORBIDDEN_CHANNELS = Object.freeze(["SMS", "WHATSAPP", "BREVO_SMS"]);

const CANONICAL_ALLOWED_RECIPIENTS = Object.freeze({
  STUDENT_ABSENT: ["PARENT"],
  STUDENT_LATE: ["PARENT"],
  GRADE_PUBLISHED: ["PARENT", "STUDENT"],
  REPORT_CARD_PUBLISHED: ["PARENT", "STUDENT"],
  PAYMENT_RECEIVED: ["PARENT"],
  PAYMENT_DUE: ["PARENT", "SCHOOL_ADMIN"],
  ANNOUNCEMENT_PUBLISHED: ["PARENT", "STUDENT", "TEACHER", "SCHOOL_ADMIN"],
  TIMETABLE_CHANGED: ["TEACHER", "SCHOOL_ADMIN"],
  TEACHER_REPLACEMENT: ["PARENT", "TEACHER", "SCHOOL_ADMIN"],
});

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function persistenceCorpus() {
  const parts = [
    read("backend/db/schema.sql"),
    read("backend/db/communicationsNotificationsSchema.js"),
    read("backend/db/clientsSchema.js"),
  ];
  const migDir = path.join(ROOT, "backend/db/migrations");
  for (const name of fs.readdirSync(migDir)) {
    if (/\.(sql|js)$/.test(name)) {
      parts.push(fs.readFileSync(path.join(migDir, name), "utf8"));
    }
  }
  return parts.join("\n");
}

function loadPolicy() {
  try {
    return require("./schoolNotificationPolicy");
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND" && String(error.message).includes("schoolNotificationPolicy")) {
      return null;
    }
    throw error;
  }
}

function requirePolicy() {
  const mod = loadPolicy();
  assert.ok(mod, "Lot I : backend/lib/schoolNotificationPolicy.js manquant");
  return mod;
}

function rbacPermissionsFor(route) {
  const src = read("backend/services/rbacService.js");
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = src.match(new RegExp(`"${escaped}":\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function channelFlags(rule, label) {
  assert.equal(typeof rule, "object", `${label} doit être un objet`);
  assert.notEqual(rule, null, `${label} ne doit pas être null`);
  for (const channel of CHANNELS) {
    assert.equal(typeof rule[channel], "boolean", `${label}.${channel} doit être booléen`);
  }
  assert.equal("SMS" in rule, false, `${label} ne doit pas exposer SMS`);
  assert.equal("WHATSAPP" in rule, false, `${label} ne doit pas exposer WHATSAPP`);
}

function eventRule(settings, event) {
  const block = settings?.events?.[event];
  assert.ok(block, `événement ${event} manquant dans la configuration`);
  return block;
}

function adminPrincipal(schoolCode, extra = {}) {
  return {
    sub: extra.sub || USER_A,
    schoolCode,
    role: extra.role || "Admin School",
    permissions: extra.permissions || ["Paramètres Établissement:UPDATE", "Paramètres Établissement:READ"],
  };
}

function readerPrincipal(schoolCode) {
  return {
    sub: USER_B,
    schoolCode,
    role: "Enseignant",
    permissions: ["Paramètres Établissement:READ"],
  };
}

function teacherWriteDenied(schoolCode) {
  return {
    sub: USER_B,
    schoolCode,
    role: "Enseignant",
    permissions: ["Notes:READ", "Présences:READ"],
  };
}

function envPreprod() {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SMTP_HOST: "smtp.test.local",
    MAIL_FROM: "noreply@somafrik.app",
  };
}

function adapterWithParent({ preferences = [], schoolPolicy } = {}) {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [
      {
        id: NOTE_ID,
        event_key: EVENT_KEY,
        event_type: "attendance.student.absent",
        school_id: SCHOOL_A,
        title: "Absence enregistrée",
        body: "Un élève a été signalé(e) absent(e).",
      },
    ],
    recipients: [
      {
        notification_id: NOTE_ID,
        school_id: SCHOOL_A,
        user_id: USER_A,
        recipient_kind: "parent",
      },
    ],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
    preferences,
  });
  if (schoolPolicy) adapter.schoolNotificationPolicy = schoolPolicy;
  return adapter;
}

function defaultPolicyWith(overrides = {}) {
  const policy = requirePolicy();
  const defaults = policy.getDefaultSchoolNotificationSettings();
  const events = { ...defaults.events };
  for (const [event, recipients] of Object.entries(overrides)) {
    events[event] = {
      ...events[event],
      ...Object.fromEntries(
        Object.entries(recipients).map(([recipient, channels]) => [
          recipient,
          { ...events[event][recipient], ...channels },
        ]),
      ),
    };
  }
  return { events };
}

test("I-T01 — isolation tenant : admin A ne lit/écrit pas l'établissement B", async () => {
  const server = read("backend/server.js");
  assert.match(server, /notification-settings/, "route notification-settings absente de server.js");
  assert.match(
    server,
    /app\.(get|patch|put)\("\/api\/backoffice\/establishments\/:schoolCode\/notification-settings"/,
    "contrat HTTP canonique backoffice établissements manquant",
  );
  const getBlock = server.slice(
    server.indexOf('app.get("/api/backoffice/establishments/:schoolCode/notification-settings"'),
    server.indexOf('app.patch("/api/backoffice/establishments/:schoolCode/notification-settings"') + 800,
  );
  assert.match(getBlock, /assertSchoolAccess/, "GET notification-settings doit fail-closed via assertSchoolAccess");
  assert.match(getBlock, /requirePermission/, "GET notification-settings sans requirePermission");

  const policy = requirePolicy();
  assert.equal(typeof policy.getSchoolNotificationSettings, "function");
  assert.equal(typeof policy.patchSchoolNotificationSettings, "function");
  assert.equal(typeof policy.createMemorySchoolNotificationStore, "function");

  const store = policy.createMemorySchoolNotificationStore({
    schools: [
      { id: SCHOOL_A, school_code: "SCH-A" },
      { id: SCHOOL_B, school_code: "SCH-B" },
    ],
  });
  const adminA = adminPrincipal("SCH-A");
  const adminB = adminPrincipal("SCH-B", { sub: USER_B });

  await policy.patchSchoolNotificationSettings(store, adminA, "SCH-A", {
    events: { STUDENT_ABSENT: { PARENT: { PUSH: false } } },
  });

  await assert.rejects(
    () => policy.getSchoolNotificationSettings(store, adminA, "SCH-B"),
    (error) => error.statusCode === 403 || error.statusCode === 404,
    "lecture cross-tenant doit échouer 403/404",
  );
  await assert.rejects(
    () => policy.patchSchoolNotificationSettings(store, adminA, "SCH-B", {
      events: { STUDENT_ABSENT: { PARENT: { EMAIL: false } } },
    }),
    (error) => error.statusCode === 403 || error.statusCode === 404,
    "écriture cross-tenant doit échouer 403/404",
  );

  const settingsB = await policy.getSchoolNotificationSettings(store, adminB, "SCH-B");
  assert.equal(eventRule(settingsB, "STUDENT_ABSENT").PARENT.PUSH, true, "aucune fuite de la config A vers B");
});

test("I-T02 — établissement sans lignes = catalogue canonique déterministe", async () => {
  const policy = requirePolicy();
  assert.equal(typeof policy.getCanonicalSchoolNotificationCatalog, "function");
  assert.equal(typeof policy.getDefaultSchoolNotificationSettings, "function");

  const catalog = policy.getCanonicalSchoolNotificationCatalog();
  const catalogEvents = Array.isArray(catalog.events)
    ? catalog.events.map((row) => row.event)
    : Object.keys(catalog.events || catalog);
  assert.deepEqual([...catalogEvents].sort(), [...LOT_I_EVENTS].sort());

  const defaultsA = policy.getDefaultSchoolNotificationSettings();
  const defaultsB = policy.getDefaultSchoolNotificationSettings();
  assert.notEqual(defaultsA, defaultsB, "aucune configuration globale mutable partagée entre tenants");
  assert.deepEqual(defaultsA, defaultsB);

  const store = policy.createMemorySchoolNotificationStore({
    schools: [
      { id: SCHOOL_A, school_code: "SCH-A" },
      { id: SCHOOL_B, school_code: "SCH-B" },
    ],
  });
  const a = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A");
  const b = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-B", { sub: USER_B }), "SCH-B");
  assert.deepEqual(a.events, defaultsA.events);
  assert.deepEqual(b.events, defaultsB.events);

  const json = JSON.stringify(a);
  assert.equal(json.includes("undefined"), false);
  for (const event of LOT_I_EVENTS) {
    const rule = eventRule(a, event);
    assert.deepEqual([...rule.allowedRecipients].sort(), [...CANONICAL_ALLOWED_RECIPIENTS[event]].sort());
    for (const recipient of rule.allowedRecipients) {
      channelFlags(rule[recipient], `${event}.${recipient}`);
    }
    for (const forbidden of RECIPIENT_CATEGORIES.filter((item) => !CANONICAL_ALLOWED_RECIPIENTS[event].includes(item))) {
      assert.equal(rule[forbidden], undefined, `${event} ne doit pas exposer ${forbidden}`);
    }
  }
});

test("I-T03 — GET ne retourne que les événements, destinataires et canaux supportés", async () => {
  const policy = requirePolicy();
  const store = policy.createMemorySchoolNotificationStore({
    schools: [{ id: SCHOOL_A, school_code: "SCH-A" }],
  });
  const settings = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A");
  assert.equal(settings.schoolCode, "SCH-A");
  const keys = Object.keys(settings.events).sort();
  assert.deepEqual(keys, [...LOT_I_EVENTS].sort());
  for (const event of LOT_I_EVENTS) {
    const rule = eventRule(settings, event);
    for (const recipient of rule.allowedRecipients) {
      channelFlags(rule[recipient], `${event}.${recipient}`);
    }
  }
  const serialized = JSON.stringify(settings);
  assert.doesNotMatch(serialized, /SMS|WHATSAPP|SMTP|Expo|FCM|Brevo|backoffice_state/i);
});

test("I-T04 — PATCH partiel STUDENT_ABSENT / PARENT / PUSH ne détruit pas le reste", async () => {
  const policy = requirePolicy();
  const store = policy.createMemorySchoolNotificationStore({
    schools: [{ id: SCHOOL_A, school_code: "SCH-A" }],
  });
  const before = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A");
  const after = await policy.patchSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A", {
    events: { STUDENT_ABSENT: { PARENT: { PUSH: false } } },
  });
  assert.equal(after.events.STUDENT_ABSENT.PARENT.PUSH, false);
  assert.equal(after.events.STUDENT_ABSENT.PARENT.IN_APP, before.events.STUDENT_ABSENT.PARENT.IN_APP);
  assert.equal(after.events.STUDENT_ABSENT.PARENT.EMAIL, before.events.STUDENT_ABSENT.PARENT.EMAIL);
  assert.deepEqual(after.events.GRADE_PUBLISHED, before.events.GRADE_PUBLISHED);
  assert.deepEqual(after.events.PAYMENT_RECEIVED, before.events.PAYMENT_RECEIVED);
  assert.deepEqual(after.events.ANNOUNCEMENT_PUBLISHED, before.events.ANNOUNCEMENT_PUBLISHED);

  if (typeof policy.putSchoolNotificationSettings === "function") {
    const put = await policy.putSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A", {
      events: { STUDENT_ABSENT: { PARENT: { EMAIL: false } } },
    });
    assert.equal(put.events.STUDENT_ABSENT.PARENT.EMAIL, false);
    assert.equal(put.events.STUDENT_ABSENT.PARENT.PUSH, false, "PUT non destructif : PUSH resté false");
    assert.deepEqual(put.events.GRADE_PUBLISHED, before.events.GRADE_PUBLISHED);
  }
});

test("I-T05 — événement inconnu rejeté, aucune persistance silencieuse", async () => {
  const policy = requirePolicy();
  const store = policy.createMemorySchoolNotificationStore({
    schools: [{ id: SCHOOL_A, school_code: "SCH-A" }],
  });
  await assert.rejects(
    () => policy.patchSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A", {
      events: { SOMETHING_UNKNOWN: { PARENT: { PUSH: true } } },
    }),
    (error) => error.statusCode === 400 && /unknown|inconnu|canonical|event/i.test(`${error.code} ${error.message}`),
  );
  const after = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A");
  assert.equal(after.events.SOMETHING_UNKNOWN, undefined);
  assert.deepEqual(Object.keys(after.events).sort(), [...LOT_I_EVENTS].sort());
});

test("I-T06 — canal SMS / WHATSAPP rejeté", async () => {
  const policy = requirePolicy();
  const store = policy.createMemorySchoolNotificationStore({
    schools: [{ id: SCHOOL_A, school_code: "SCH-A" }],
  });
  for (const channel of FORBIDDEN_CHANNELS) {
    await assert.rejects(
      () => policy.patchSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A", {
        events: { STUDENT_ABSENT: { PARENT: { [channel]: true } } },
      }),
      (error) => error.statusCode === 400 && /channel|canal|SMS|WHATSAPP|unsupported/i.test(`${error.code} ${error.message}`),
      `${channel} doit être rejeté`,
    );
  }
  const after = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A");
  const json = JSON.stringify(after);
  assert.doesNotMatch(json, /"SMS"|"WHATSAPP"/);
});

test("I-T07 — destinataire interdit pour l'événement rejeté", async () => {
  const policy = requirePolicy();
  const store = policy.createMemorySchoolNotificationStore({
    schools: [{ id: SCHOOL_A, school_code: "SCH-A" }],
  });
  await assert.rejects(
    () => policy.patchSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A", {
      events: { STUDENT_ABSENT: { STUDENT: { PUSH: true } } },
    }),
    (error) => error.statusCode === 400 && /recipient|destinataire|forbidden/i.test(`${error.code} ${error.message}`),
  );
  const after = await policy.getSchoolNotificationSettings(store, adminPrincipal("SCH-A"), "SCH-A");
  assert.equal(after.events.STUDENT_ABSENT.STUDENT, undefined);
});

test("I-T08 — préférence utilisateur PUSH=false bloque le push même si l'établissement l'autorise", async () => {
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  assert.match(dispatcher, /resolveAllowedChannels/, "le dispatcher doit déléguer à resolveAllowedChannels");

  const policy = requirePolicy();
  assert.equal(typeof policy.resolveAllowedChannels, "function");
  const channels = policy.resolveAllowedChannels({
    event: "STUDENT_ABSENT",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...channels].includes("PUSH"), false);
  assert.equal([...channels].includes("EMAIL"), true);

  const adapter = adapterWithParent({
    preferences: [{ user_id: USER_A, school_id: SCHOOL_A, channel: "PUSH", enabled: false }],
    schoolPolicy: defaultPolicyWith().events,
  });
  await dispatchCommunication({
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ id: "dev-1" }]; } },
    pushClient: { async sendToTokens() { throw new Error("PUSH utilisateur refusé"); } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), true);
});

test("I-T09 — politique établissement EMAIL=false bloque l'e-mail métier même si l'utilisateur l'autorise", async () => {
  const policy = requirePolicy();
  const channels = policy.resolveAllowedChannels({
    event: "STUDENT_ABSENT",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ STUDENT_ABSENT: { PARENT: { EMAIL: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...channels].includes("EMAIL"), false);
  assert.equal([...channels].includes("PUSH"), true);

  const adapter = adapterWithParent({
    schoolPolicy: defaultPolicyWith({ STUDENT_ABSENT: { PARENT: { EMAIL: false } } }).events,
  });
  await dispatchCommunication({
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return []; } },
    mailer: { async sendMail() { throw new Error("EMAIL établissement refusé"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});

test("I-T10 — delivery externe seulement si établissement ET préférence utilisateur", async () => {
  const policy = requirePolicy();
  const both = policy.resolveAllowedChannels({
    event: "GRADE_PUBLISHED",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...both].includes("PUSH"), true);
  assert.equal([...both].includes("EMAIL"), true);

  const schoolOff = policy.resolveAllowedChannels({
    event: "GRADE_PUBLISHED",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ GRADE_PUBLISHED: { PARENT: { PUSH: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...schoolOff].includes("PUSH"), false);

  const userOff = policy.resolveAllowedChannels({
    event: "GRADE_PUBLISHED",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...userOff].includes("PUSH"), false);
});

test("I-T11 — IN_APP suit la même double autorisation dans le centre personnel", async () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const listFn = service.slice(service.indexOf("async function list("), service.indexOf("async function get("));
  const unreadFn = service.slice(service.indexOf("async function unreadCount("), service.indexOf("async function markRead("));
  assert.match(listFn, /resolveAllowedChannels/, "list() doit filtrer IN_APP via resolveAllowedChannels");
  assert.match(unreadFn, /resolveAllowedChannels/, "unreadCount() doit filtrer IN_APP via resolveAllowedChannels");

  const policy = requirePolicy();
  const hidden = policy.resolveAllowedChannels({
    event: "STUDENT_ABSENT",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ STUDENT_ABSENT: { PARENT: { IN_APP: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...hidden].includes("IN_APP"), false);

  const userHidden = policy.resolveAllowedChannels({
    event: "STUDENT_ABSENT",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: false, PUSH: true, EMAIL: true },
  });
  assert.equal([...userHidden].includes("IN_APP"), false);
});

test("I-T12 — désactiver EMAIL métier ne bloque jamais le reset mot de passe", async () => {
  const policy = requirePolicy();
  const channels = policy.resolveAllowedChannels({
    eventType: "auth.password.reset",
    event: "STUDENT_ABSENT",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({
      STUDENT_ABSENT: { PARENT: { EMAIL: false } },
    }).events,
    userPreferences: { IN_APP: false, PUSH: false, EMAIL: false },
  });
  assert.equal([...channels].includes("EMAIL"), true);

  assert.deepEqual(mandatoryChannelsForEvent("auth.password.reset"), ["EMAIL"]);
  assert.equal(
    resolveEffectiveChannels({
      eventType: "auth.password.reset",
      eventPolicyChannels: ["EMAIL"],
      userEnabledChannels: [],
    }).includes("EMAIL"),
    true,
  );

  const adapter = createMemoryDeliveryAdapter({
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "ada@test.local" }],
    preferences: [{ user_id: USER_A, school_id: SCHOOL_A, channel: "EMAIL", enabled: false }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith({
    STUDENT_ABSENT: { PARENT: { EMAIL: false } },
  }).events;
  await adapter.ensureDelivery({
    deliveryKey: `auth.password.reset:${USER_A}:reset-1`,
    eventKey: `auth.password.reset:${USER_A}:reset-1`,
    notificationId: null,
    schoolId: SCHOOL_A,
    userId: USER_A,
    channel: "EMAIL",
    payload: { title: "reset", body: "body" },
  });
  let sent = 0;
  await dispatchProcessedEvents({
    adapter,
    processed: [],
    mailer: { async sendMail() { sent += 1; } },
    pushClient: { async sendToTokens() { throw new Error("PUSH interdit"); } },
    env: envPreprod(),
  });
  assert.equal(sent, 1);
});

test("I-T13 — même clé d'idempotence ne duplique pas les deliveries", async () => {
  const adapter = adapterWithParent();
  const deps = {
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return []; } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  };
  await dispatchCommunication(deps);
  await dispatchCommunication(deps);
  assert.equal(adapter.deliveries.length, 2);
  assert.deepEqual(adapter.deliveries.map((row) => row.channel).sort(), ["EMAIL", "PUSH"]);
});

test("I-T17 — RBAC : écriture limitée aux rôles paramètres établissement, sans élargir le catalogue", async () => {
  const schoolWrite = rbacPermissionsFor("PATCH /api/backoffice/establishments/:schoolCode/school-settings");
  const notifWrite = rbacPermissionsFor(`PATCH ${API_ROUTE}`);
  const schoolRead = rbacPermissionsFor("GET /api/backoffice/establishments/:schoolCode/school-settings");
  const notifRead = rbacPermissionsFor(`GET ${API_ROUTE}`);
  assert.ok(schoolWrite, "référence school-settings write introuvable");
  assert.ok(notifWrite, `RBAC manquant pour PATCH ${API_ROUTE}`);
  assert.ok(notifRead, `RBAC manquant pour GET ${API_ROUTE}`);
  assert.deepEqual(notifWrite, schoolWrite, "Lot I ne doit pas élargir les permissions d'écriture");
  assert.deepEqual(notifRead, schoolRead, "Lot I ne doit pas élargir les permissions de lecture");

  const policy = requirePolicy();
  const store = policy.createMemorySchoolNotificationStore({
    schools: [{ id: SCHOOL_A, school_code: "SCH-A" }],
  });
  const readable = await policy.getSchoolNotificationSettings(store, readerPrincipal("SCH-A"), "SCH-A");
  assert.ok(readable.events.STUDENT_ABSENT);
  await assert.rejects(
    () => policy.patchSchoolNotificationSettings(store, readerPrincipal("SCH-A"), "SCH-A", {
      events: { STUDENT_ABSENT: { PARENT: { PUSH: false } } },
    }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => policy.patchSchoolNotificationSettings(store, teacherWriteDenied("SCH-A"), "SCH-A", {
      events: { STUDENT_ABSENT: { PARENT: { PUSH: false } } },
    }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => policy.getSchoolNotificationSettings(store, teacherWriteDenied("SCH-A"), "SCH-A"),
    (error) => error.statusCode === 403,
  );
});

test("I-T18 — régression Lot H : contrat /api/me/communication-preferences inchangé", async () => {
  const server = read("backend/server.js");
  assert.match(server, /app\.get\("\/api\/me\/communication-preferences"/);
  assert.match(server, /app\.put\("\/api\/me\/communication-preferences"/);
  assert.deepEqual(PREFERENCE_CHANNELS, ["IN_APP", "PUSH", "EMAIL"]);

  const rows = [];
  const store = {
    getSchoolByCode: async () => ({ id: SCHOOL_A }),
    getCommunicationPreferencesStore: () => createMemoryPreferencesQueryable(rows),
  };
  const got = await getOwnCommunicationPreferences(store, { sub: USER_A, schoolCode: "SCH-A" });
  assert.deepEqual(got.channels, { IN_APP: true, PUSH: true, EMAIL: true });
  const put = await putOwnCommunicationPreferences(
    store,
    { sub: USER_A, schoolCode: "SCH-A" },
    { channels: { EMAIL: false } },
  );
  assert.equal(put.channels.EMAIL, false);
  assert.equal(put.channels.PUSH, true);
  assert.equal(put.channels.IN_APP, true);
});

test("I-T19 — régression C4 : fan-out unique caller + persist IN_APP inchangé", () => {
  const worker = read("backend/lib/communicationsNotificationsWorker.js");
  const runOnce = worker.slice(worker.indexOf("async function runOnce"));
  assert.ok(runOnce.indexOf("await drainOutbox") >= 0);
  assert.ok(runOnce.indexOf("await dispatchProcessedEvents") > runOnce.indexOf("await drainOutbox"));
  assert.doesNotMatch(runOnce, /fanOutNotificationChannels/);

  const service = read("backend/lib/communicationsNotificationsService.js");
  assert.doesNotMatch(service, /communicationChannelFanout|fanOutNotificationChannels|communicationsDispatcher/);
  const processFn = service.slice(service.indexOf("async function processOneEvent"));
  const loop = processFn.slice(
    processFn.indexOf("for (const recipient of spec.recipients)"),
    processFn.indexOf("UPDATE communication_event_outbox SET status='processed'"),
  );
  assert.match(loop, /INSERT INTO notification_recipients/);
  assert.doesNotMatch(loop, /continue/);
});

test("I-T20 — régression Push N1 : Android + Expo, jamais SMS", () => {
  const service = read("backend/lib/mobilePushDevicesService.js");
  assert.match(service, /PUSH-N1 : Android uniquement/);
  assert.doesNotMatch(service, /whatsapp|twilio/i);
  const n1 = read("backend/scripts/verify-mobile-push-n1.js");
  assert.match(n1, /PUSH-N1/);
});

test("persistance PostgreSQL canonique : table school_notification_settings", () => {
  assert.equal(fs.existsSync(POLICY_MODULE), true, "module policy manquant");
  const corpus = persistenceCorpus();
  assert.match(corpus, /school_notification_settings/);
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS school_notification_settings/);
  assert.match(schema, /PRIMARY KEY \(school_id, event_key, recipient_category, channel\)/);
  assert.match(schema, /channel IN \('IN_APP', 'PUSH', 'EMAIL'\)/);
  assert.match(schema, /event_key IN \('STUDENT_ABSENT'/);
  assert.doesNotMatch(schema, /SMS|WHATSAPP|backoffice_state/);

  const migrations = fs.readdirSync(path.join(ROOT, "backend/db/migrations"));
  const lotI = migrations.filter((name) => /school_notification_settings/.test(name));
  assert.equal(lotI.length, 1, "une migration dédiée school_notification_settings");
  const migration = read(`backend/db/migrations/${lotI[0]}`);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS school_notification_settings/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/);

  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  assert.match(schema, /school_notification_settings/);
  assert.match(bootstrap, /applyCommunicationsC4Schema/);
});

test("catalogue Lot I : mapping C4 sans inventer d'événements", () => {
  const policy = requirePolicy();
  assert.equal(policy.mapDispatcherEventToLotI("attendance.student.absent"), "STUDENT_ABSENT");
  assert.equal(policy.mapDispatcherEventToLotI("pedagogy.grade.published"), "GRADE_PUBLISHED");
  assert.equal(policy.mapDispatcherEventToLotI("finance.payment.recorded"), "PAYMENT_RECEIVED");
  assert.equal(policy.mapDispatcherEventToLotI("communication.announcement.published"), "ANNOUNCEMENT_PUBLISHED");
  assert.equal(policy.mapDispatcherEventToLotI("auth.password.reset"), null);
  assert.equal(policy.mapRecipientKindToCategory("parent"), "PARENT");
  assert.equal(policy.mapRecipientKindToCategory("student"), "STUDENT");
  assert.equal(policy.mapRecipientKindToCategory("teacher"), "TEACHER");
  assert.equal(policy.mapRecipientKindToCategory("staff"), "SCHOOL_ADMIN");
});

test("P1 — recipient_kind school applique la catégorie réelle, pas l'union des règles", async () => {
  const policy = requirePolicy();
  const schoolPolicy = defaultPolicyWith({
    ANNOUNCEMENT_PUBLISHED: {
      PARENT: { EMAIL: false, PUSH: true },
      STUDENT: { EMAIL: true, PUSH: true },
      TEACHER: { EMAIL: true, PUSH: true },
    },
  }).events;

  assert.equal(
    policy.resolveAllowedChannels({
      event: "ANNOUNCEMENT_PUBLISHED",
      recipient: "school",
      schoolPolicy,
      userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
    }).includes("EMAIL"),
    false,
    "kind school sans catégorie résolue doit fail-closed",
  );
  assert.equal(
    policy.resolveAllowedChannels({
      event: "ANNOUNCEMENT_PUBLISHED",
      recipient: "school",
      recipientCategories: ["PARENT"],
      schoolPolicy,
      userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
    }).includes("EMAIL"),
    false,
  );
  assert.equal(
    policy.resolveAllowedChannels({
      event: "ANNOUNCEMENT_PUBLISHED",
      recipient: "school",
      recipientCategories: ["STUDENT"],
      schoolPolicy,
      userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
    }).includes("EMAIL"),
    true,
  );

  const announceKey = "communication.announcement.published:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const adapter = createMemoryDeliveryAdapter({
    notifications: [
      {
        id: NOTE_ID,
        event_key: announceKey,
        event_type: "communication.announcement.published",
        school_id: SCHOOL_A,
        title: "Annonce établissement",
        body: "Message à tous.",
      },
    ],
    recipients: [
      {
        notification_id: NOTE_ID,
        school_id: SCHOOL_A,
        user_id: USER_A,
        recipient_kind: "school",
      },
    ],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local", role: "parent" }],
  });
  adapter.schoolNotificationPolicy = schoolPolicy;
  await dispatchCommunication({
    eventKey: announceKey,
    eventType: "communication.announcement.published",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return []; } },
    mailer: { async sendMail() { throw new Error("EMAIL parent interdit pour l'annonce"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});

test("P1 — lecture politique 42501 n'enqueue pas les canaux établissement", async () => {
  const adapter = adapterWithParent();
  adapter.loadSchoolNotificationPolicy = async () => {
    const error = new Error("permission denied for table school_notification_settings");
    error.code = "42501";
    throw error;
  };
  await dispatchCommunication({
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    logger: { error() {} },
    pushStore: { async listActiveForUser() { return []; } },
    mailer: { async sendMail() { throw new Error("EMAIL ne doit pas partir si la politique est illisible"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.length, 0);

  const missingTable = adapterWithParent();
  missingTable.loadSchoolNotificationPolicy = async () => {
    const error = new Error("relation school_notification_settings does not exist");
    error.code = "42P01";
    throw error;
  };
  await dispatchCommunication({
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter: missingTable,
    pushStore: { async listActiveForUser() { return []; } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.deepEqual(missingTable.deliveries.map((row) => row.channel).sort(), ["EMAIL", "PUSH"]);
});

test("P1 — list() continue de paginer après filtrage IN_APP masqué", async () => {
  const hiddenSettings = [
    {
      school_id: SCHOOL_A,
      event_key: "STUDENT_ABSENT",
      recipient_category: "PARENT",
      channel: "IN_APP",
      enabled: false,
    },
  ];
  const rows = [
    { seq: 6, hidden: true },
    { seq: 5, hidden: true },
    { seq: 4, hidden: false, title: "visible-A" },
    { seq: 3, hidden: true },
    { seq: 2, hidden: false, title: "visible-B" },
    { seq: 1, hidden: false, title: "visible-C" },
  ].map((item) => ({
    id: `cccccccc-cccc-4ccc-8ccc-${String(item.seq).padStart(12, "0")}`,
    school_id: SCHOOL_A,
    school_code: "SCH-A",
    event_type: item.hidden ? "attendance.student.absent" : "pedagogy.grade.published",
    title: item.title || `hidden-${item.seq}`,
    body: "body",
    created_at: `2026-09-08T12:00:${String(item.seq).padStart(2, "0")}.000Z`,
    recipient_kind: "parent",
    read_at: null,
    recipient_archived_at: null,
    navigation_target: {},
    metadata: {},
  }));
  const sorted = [...rows].sort((left, right) => {
    if (left.created_at === right.created_at) return String(right.id).localeCompare(String(left.id));
    return String(right.created_at).localeCompare(String(left.created_at));
  });

  const store = {
    async getSchoolByCode() {
      return { id: SCHOOL_A, school_code: "SCH-A" };
    },
    async listActiveUserRoleKeysForSchool() {
      return ["PARENT"];
    },
    async all(sql, params = []) {
      const text = String(sql);
      if (/school_notification_settings/i.test(text)) return hiddenSettings;
      if (/user_communication_preferences/i.test(text)) return [];
      if (/user_roles/i.test(text)) return [{ role_key: "PARENT" }];
      let filtered = sorted;
      if (params.length >= 4) {
        const at = String(params[2]);
        const id = String(params[3]);
        filtered = sorted.filter((row) => {
          if (String(row.created_at) < at) return true;
          if (String(row.created_at) > at) return false;
          return String(row.id) < id;
        });
      }
      const limit = Number(params[params.length - 1]);
      return filtered.slice(0, limit);
    },
  };

  const principal = {
    sub: USER_A,
    schoolCode: "SCH-A",
    role: "Parent",
    permissions: ["Notifications:READ"],
  };
  const page1 = await listPersonalNotifications(store, principal, { limit: 2 });
  assert.deepEqual(page1.items.map((item) => item.title), ["visible-A", "visible-B"]);
  assert.ok(page1.nextCursor, "les notifications visibles plus anciennes doivent rester atteignables");

  const page2 = await listPersonalNotifications(store, principal, { limit: 2, cursor: page1.nextCursor });
  assert.deepEqual(page2.items.map((item) => item.title), ["visible-C"]);
  assert.equal(page2.nextCursor, null);
});

test("P2 — FallbackRepository mémoire persiste PATCH notification-settings", async () => {
  const { FallbackRepository } = require("../db/fallbackRepository");
  const repo = new FallbackRepository();
  const policy = requirePolicy();
  assert.equal(typeof repo.getSchoolNotificationSettingsStore, "function");
  const fallback = read("backend/db/fallbackRepository.js");
  assert.match(fallback, /getSchoolNotificationSettingsStore/);
  const schoolCode = "CD-2026-0001";
  const principal = adminPrincipal(schoolCode);
  const after = await policy.patchSchoolNotificationSettings(repo, principal, schoolCode, {
    events: { STUDENT_ABSENT: { PARENT: { EMAIL: false } } },
  });
  assert.equal(after.events.STUDENT_ABSENT.PARENT.EMAIL, false);
  const again = await policy.getSchoolNotificationSettings(repo, principal, schoolCode);
  assert.equal(again.events.STUDENT_ABSENT.PARENT.EMAIL, false, "GET mémoire doit relire le PATCH, pas les défauts");
});

test("P2 — destinataire multi-rôles : toutes les catégories snapshottées, ordre indifférent", async () => {
  const policy = requirePolicy();
  const schoolPolicy = defaultPolicyWith({
    ANNOUNCEMENT_PUBLISHED: {
      PARENT: { EMAIL: false, PUSH: true },
      TEACHER: { EMAIL: true, PUSH: true },
    },
  }).events;

  assert.deepEqual(
    policy.recipientCategoriesFromContext({ kinds: ["teacher", "parent"] }).sort(),
    ["PARENT", "TEACHER"],
  );

  async function dispatchWithKinds(kinds, recipientKind) {
    const announceKey = `communication.announcement.published:${NOTE_ID}`;
    const adapter = createMemoryDeliveryAdapter({
      notifications: [
        {
          id: NOTE_ID,
          event_key: announceKey,
          event_type: "communication.announcement.published",
          school_id: SCHOOL_A,
          title: "Annonce",
          body: "Message",
        },
      ],
      recipients: [
        {
          notification_id: NOTE_ID,
          school_id: SCHOOL_A,
          user_id: USER_A,
          recipient_kind: recipientKind,
          recipient_context: { kinds },
        },
      ],
      users: [{ id: USER_A, school_id: SCHOOL_A, email: "dual@test.local", roles: ["PARENT", "TEACHER"] }],
    });
    adapter.schoolNotificationPolicy = schoolPolicy;
    await dispatchCommunication({
      eventKey: announceKey,
      eventType: "communication.announcement.published",
      schoolId: SCHOOL_A,
      channels: ["PUSH", "EMAIL"],
      adapter,
      pushStore: { async listActiveForUser() { return []; } },
      mailer: { async sendMail() {} },
      env: envPreprod(),
    });
    return adapter.deliveries.map((row) => row.channel).sort();
  }

  const teacherFirst = await dispatchWithKinds(["teacher", "parent"], "teacher");
  const parentFirst = await dispatchWithKinds(["parent", "teacher"], "parent");
  assert.deepEqual(teacherFirst, ["EMAIL", "PUSH"]);
  assert.deepEqual(parentFirst, ["EMAIL", "PUSH"], "l'ordre de recipientKinds ne doit pas changer le fan-out");

  const parentOnly = await dispatchWithKinds(["parent"], "parent");
  assert.deepEqual(parentOnly, ["PUSH"], "un parent-enseignant ciblé seulement comme parent suit la règle PARENT");

  const service = read("backend/lib/communicationsNotificationsService.js");
  const eventSpecFn = service.slice(
    service.indexOf("async function eventSpec"),
    service.indexOf("async function processOneEvent"),
  );
  assert.match(eventSpecFn, /audience_reason/, "le snapshot C4 doit recopier audience_reason.kinds");
  assert.match(eventSpecFn, /kinds/, "le snapshot C4 doit recopier audience_reason.kinds");
});

test("Lot I n'importe aucun SDK provider et n'utilise pas backoffice_state", () => {
  const policy = requirePolicy();
  void policy;
  const src = read("backend/lib/schoolNotificationPolicy.js");
  assert.doesNotMatch(src, /require\(["'][^"']*(nodemailer|expo-server-sdk|@getbrevo|twilio)/);
  assert.doesNotMatch(src, /backoffice_state|localStorage/);
  assert.doesNotMatch(src, /fanOutNotificationChannels/);
});
