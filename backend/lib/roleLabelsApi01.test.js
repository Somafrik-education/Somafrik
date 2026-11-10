"use strict";

/**
 * ROLE-LABELS-API-01 — API-RL-01 → API-RL-25.
 * DISPLAY ONLY. JWT / RBAC / roleKey inchangés.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  resolveEffectiveRoleLabel,
  decorateUserWithRoleDisplay,
  decorateIdentifyRole,
  indexRoleDisplayContracts,
  loadRoleDisplayIndexFromRepo,
  resolveVisibleRoleLabel,
} = require("./roleDisplayLabels");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { AuthService } = require("../services/authService");
const { TokenService } = require("../services/tokenService");
const { sanitizePrivacyRequest } = require("./privacyErasure");
const { resolveSchoolComplianceScope } = require("./schoolCompliance");
const { updateRoleDisplayLabel, resetRoleDisplayLabel } = require("./establishmentRolesService");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { createClientsPgStore } = require("../db/clientsPgStore");
const messagesService = require("./communicationsMessagesService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function catalogIndex(overrides = []) {
  const seed = [
    { role_code: "SUPER_ADMIN", role_name: "Super Administrateur Somafrik", display_label: null },
    { role_code: "COUNTRY_ADMIN", role_name: "Admin Pays", display_label: null },
    { role_code: "SCHOOL_ADMIN", role_name: "Admin School", display_label: null },
    { role_code: "TEACHER", role_name: "Enseignant", display_label: null },
    { role_code: "STUDENT", role_name: "Élève / Étudiant", display_label: null },
    { role_code: "PRINCIPAL", role_name: "Directeur", display_label: null },
    { role_code: "SECRETARY", role_name: "Secrétaire", display_label: null },
    { role_code: "PARENT", role_name: "Parent", display_label: null },
    { role_code: "RESPONSABLE_PEDAGOGIQUE", role_name: "Responsable pédagogique", display_label: null },
  ];
  const byKey = new Map(seed.map((row) => [row.role_code, { ...row }]));
  for (const row of overrides) {
    byKey.set(row.role_code, { ...byKey.get(row.role_code), ...row });
  }
  return indexRoleDisplayContracts([...byKey.values()]);
}

function rolesRepo() {
  const store = createEstablishmentRolesMemoryStore({
    roles: [
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        schoolAssignable: false,
      },
      {
        id: "role-teacher",
        roleCode: "TEACHER",
        roleName: "Enseignant",
        scope: "school",
        schoolAssignable: true,
      },
      {
        id: "role-student",
        roleCode: "STUDENT",
        roleName: "Élève / Étudiant",
        scope: "school",
        schoolAssignable: false,
      },
    ],
  });
  const repo = {
    getEstablishmentRolesStore: () => store,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
  };
  return { repo, store };
}

const SUPER = { role: "Super Administrateur Somafrik", identifier: "superadmin", roleKeys: ["SUPER_ADMIN"] };

function schoolAdminUser(extra = {}) {
  return {
    id: "u-sa",
    identifier: "school-admin",
    publicId: "SA-1",
    schoolCode: "CD-2026-0001",
    role: "Admin School",
    roleKey: "SCHOOL_ADMIN",
    roleKeys: ["SCHOOL_ADMIN"],
    accessChannel: "Application",
    status: "Actif",
    password: "Somafrik26!",
    mustChangePassword: false,
    permissions: ["Utilisateurs:READ"],
    ...extra,
  };
}

test("API-RL-01 SCHOOL_ADMIN sans display → Admin School", () => {
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), catalogIndex());
  assert.equal(user.effectiveRoleLabel, "Admin School");
  assert.equal(user.effectiveRoleLabels[0].defaultLabel, "Admin School");
  assert.equal(user.effectiveRoleLabels[0].displayLabel, null);
});

test("API-RL-02 SCHOOL_ADMIN display Directeur → effectiveRoleLabel Directeur", () => {
  const index = catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]);
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), index);
  assert.equal(user.effectiveRoleLabel, "Directeur");
});

test("API-RL-03 roleKey reste SCHOOL_ADMIN", () => {
  const user = decorateUserWithRoleDisplay(
    schoolAdminUser(),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(user.roleKey, "SCHOOL_ADMIN");
  assert.equal(user.role, "Admin School");
});

test("API-RL-04 JWT reste SCHOOL_ADMIN", () => {
  const tokens = new TokenService();
  const user = decorateUserWithRoleDisplay(
    schoolAdminUser(),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  const token = tokens.createAccessToken({
    sub: user.id,
    role: user.role,
    roleKeys: user.roleKeys,
    schoolCode: user.schoolCode,
  });
  const payload = tokens.verify(token, "access");
  assert.equal(payload.role, "Admin School");
  assert.deepEqual(payload.roleKeys, ["SCHOOL_ADMIN"]);
  assert.equal(payload.effectiveRoleLabel, undefined);
  assert.equal(payload.displayLabel, undefined);
  const server = readUtf8("../server.js");
  const send = server.slice(server.indexOf("async function sendAuthenticatedResponse"), server.indexOf("function buildPrincipal"));
  assert.match(send, /createAccessToken\(\{\s*\n\s*\.\.\.principal/);
  assert.ok(send.indexOf("createAccessToken") < send.indexOf("decorateUserWithRoleDisplay"));
});

test("API-RL-05 TEACHER display Professeur", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER"] },
    catalogIndex([{ role_code: "TEACHER", display_label: "Professeur" }]),
  );
  assert.equal(user.effectiveRoleLabel, "Professeur");
  assert.equal(user.roleKey, "TEACHER");
});

test("API-RL-06 STUDENT display Étudiant", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Élève / Étudiant", roleKey: "STUDENT", roleKeys: ["STUDENT"] },
    catalogIndex([{ role_code: "STUDENT", display_label: "Étudiant" }]),
  );
  assert.equal(user.effectiveRoleLabel, "Étudiant");
  assert.equal(user.roleKey, "STUDENT");
});

test("API-RL-07 reset display → retour défaut", async () => {
  const { repo } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER, {});
  const reset = await resetRoleDisplayLabel(repo, "role-school", SUPER, {});
  assert.equal(reset.displayLabel, null);
  assert.equal(reset.effectiveLabel, "Admin School");
});

function identifySchool() {
  return {
    id: "school-1",
    code: "SCH-TEST",
    loginCode: "CD-IN-26-001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
    country: "RDC",
    countryCode: "CD",
    status: "Actif",
    validationStatus: "Validé",
  };
}

function identifyService(userAccounts) {
  attachMemoryLoginLockoutStore();
  const school = identifySchool();
  return new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts,
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    subscriptions: [],
  });
}

test("API-RL-08 /identify utilise effective label", () => {
  const service = identifyService([schoolAdminUser({ identifier: "school-admin", schoolCode: "SCH-TEST" })]);
  const identified = service.identify(
    { schoolCode: "CD-IN-26-001", identifier: "school-admin" },
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(identified.role, "school_admin");
  assert.equal(identified.roleKey, "SCHOOL_ADMIN");
  assert.equal(identified.roleLabel, "Directeur");
  assert.equal(identified.effectiveRoleLabel, "Directeur");
});

test("API-RL-09 /identify fallback utilise defaultLabel canonique", () => {
  const service = identifyService([schoolAdminUser({ identifier: "school-admin", schoolCode: "SCH-TEST" })]);
  const identified = service.identify({ schoolCode: "CD-IN-26-001", identifier: "school-admin" });
  assert.equal(identified.roleLabel, "Admin School");
  assert.notEqual(identified.roleLabel, "Admin Établissement");
  const studentService = identifyService([
    {
      id: "u-st",
      identifier: "eleve",
      schoolCode: "SCH-TEST",
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      accessChannel: "Application",
      status: "Actif",
      password: "x",
    },
  ]);
  const student = studentService.identify({ schoolCode: "CD-IN-26-001", identifier: "eleve" });
  assert.equal(student.roleLabel, "Élève / Étudiant");
  assert.notEqual(student.roleLabel, "Élève");
});

test("API-RL-10 login user reçoit effectiveRoleLabel", () => {
  const user = decorateUserWithRoleDisplay(
    schoolAdminUser({ permissions: ["ALL_PRIVILEGES"] }),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(user.effectiveRoleLabel, "Directeur");
  assert.equal(user.role, "Admin School");
});

test("API-RL-11 / API-RL-12 multi-rôle effectiveRoleLabels", () => {
  const index = catalogIndex([
    { role_code: "TEACHER", display_label: "Professeur" },
    { role_code: "SCHOOL_ADMIN", display_label: "Directeur" },
  ]);
  const user = decorateUserWithRoleDisplay(
    { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER", "SCHOOL_ADMIN"] },
    index,
  );
  assert.equal(user.effectiveRoleLabel, "Professeur");
  assert.deepEqual(
    user.effectiveRoleLabels.map((row) => `${row.roleKey}:${row.effectiveLabel}`),
    ["TEACHER:Professeur", "SCHOOL_ADMIN:Directeur"],
  );
});

test("API-RL-13 aucun toRoleKey(displayLabel)", () => {
  const lifecycle = readUtf8("./userRoleLifecycle.js");
  const resolution = readUtf8("./functionalRbacResolution.js");
  assert.doesNotMatch(lifecycle, /toRoleKey\(.*displayLabel|toRoleKey\(.*effectiveLabel/);
  assert.doesNotMatch(resolution, /displayLabel|effectiveLabel|display_label/);
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
});

test("API-RL-14 collision Directeur / PRINCIPAL ne change pas SCHOOL_ADMIN", () => {
  const index = catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]);
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), index);
  assert.equal(user.effectiveRoleLabel, "Directeur");
  assert.equal(user.roleKey, "SCHOOL_ADMIN");
  assert.equal(toRoleKey(user.effectiveRoleLabel), "PRINCIPAL");
  assert.notEqual(toRoleKey(user.effectiveRoleLabel), user.roleKey);
});

test("API-RL-15 / API-RL-16 messages roleLabel décoré, roleKey inchangé", () => {
  const messages = readUtf8("./communicationsMessagesService.js");
  assert.match(messages, /decorateMessageRole/);
  assert.match(messages, /roleKey/);
  const index = catalogIndex([{ role_code: "TEACHER", display_label: "Professeur" }]);
  assert.equal(resolveVisibleRoleLabel("TEACHER", index, "Enseignant"), "Professeur");
  assert.equal(toRoleKey("Enseignant"), "TEACHER");
});

const SCHOOL_CODE = "CD-2026-0001";

function seedSchoolUser(tables, { id, role, roleKey, firstName, lastName }) {
  tables.users.push({
    id,
    school_id: "school-1",
    user_code: id,
    first_name: firstName,
    last_name: lastName,
    email: `${id}@school.test`,
    role,
    status: "active",
  });
  tables.userRoles.push({
    user_id: id,
    role_key: roleKey,
    status: "active",
    revoked_at: null,
  });
}

async function messagesRuntime({ teacherLabel = "Professeur", adminLabel = null } = {}) {
  const { repo, store: rolesStore } = rolesRepo();
  if (teacherLabel != null) {
    await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: teacherLabel }, SUPER, {});
  }
  if (adminLabel != null) {
    await updateRoleDisplayLabel(repo, "role-school", { displayLabel: adminLabel }, SUPER, {});
  }
  const clients = createClientsMemoryStore({
    school: {
      id: "school-1",
      code: SCHOOL_CODE,
      schoolCode: SCHOOL_CODE,
      name: "École Test",
      country: "Congo",
      countryCode: "CD",
    },
    rootRepository: repo,
    getEstablishmentRolesStore: () => repo.getEstablishmentRolesStore(),
  });
  seedSchoolUser(clients._tables, {
    id: "user-admin",
    role: "Admin School",
    roleKey: "SCHOOL_ADMIN",
    firstName: "Ada",
    lastName: "Admin",
  });
  seedSchoolUser(clients._tables, {
    id: "user-teacher",
    role: "Enseignant",
    roleKey: "TEACHER",
    firstName: "Tom",
    lastName: "Teacher",
  });
  seedSchoolUser(clients._tables, {
    id: "user-teacher-2",
    role: "Enseignant",
    roleKey: "TEACHER",
    firstName: "Léa",
    lastName: "Teacher",
  });
  const adminPrincipal = {
    sub: "user-admin",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: SCHOOL_CODE,
  };
  const teacherPrincipal = {
    sub: "user-teacher",
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: SCHOOL_CODE,
  };
  const originalBind = clients.bind.bind(clients);
  clients.bind = (...args) => {
    const tx = originalBind(...args);
    tx.listTeacherActiveClassIds = async () => ["class-1"];
    return tx;
  };
  const originalWithTransaction = clients.withTransaction.bind(clients);
  clients.withTransaction = async (fn) =>
    originalWithTransaction(async (tx) => {
      tx.listTeacherActiveClassIds = async () => ["class-1"];
      return fn(tx);
    });
  return {
    repo,
    rolesStore,
    clients,
    adminPrincipal,
    teacherPrincipal,
    adminId: "user-admin",
    teacherId: "user-teacher",
    teacher2Id: "user-teacher-2",
  };
}

function spyContractLoads(rolesStore) {
  const original = rolesStore.listRoleDisplayContracts.bind(rolesStore);
  const probe = { calls: 0 };
  rolesStore.listRoleDisplayContracts = async (...args) => {
    probe.calls += 1;
    return original(...args);
  };
  return probe;
}

test("API-RL-15A clients store réel + catalogue : recipient TEACHER → Professeur", async () => {
  const ctx = await messagesRuntime();
  const recipients = await messagesService.listAuthorizedRecipients(ctx.clients, ctx.adminPrincipal, {});
  const teacher = recipients.items.find((row) => row.userId === ctx.teacherId);
  assert.ok(teacher, "destinataire TEACHER présent");
  assert.equal(teacher.roleKey, "TEACHER");
  assert.equal(teacher.roleLabel, "Professeur");
});

test("API-RL-15B participant TEACHER → Professeur", async () => {
  const ctx = await messagesRuntime();
  const sent = await messagesService.createConversation(
    ctx.clients,
    { message: "Bonjour classe", participantUserIds: [ctx.teacherId] },
    ctx.adminPrincipal,
    {},
  );
  const conversation = await messagesService.getConversation(
    ctx.clients,
    sent.conversationId,
    ctx.adminPrincipal,
    {},
  );
  const teacher = conversation.participants.find((row) => row.userId === ctx.teacherId);
  assert.ok(teacher, "participant TEACHER présent");
  assert.equal(teacher.roleKey, "TEACHER");
  assert.equal(teacher.roleLabel, "Professeur");
});

test("API-RL-15C senderRoleLabel → Professeur", async () => {
  const ctx = await messagesRuntime();
  const sent = await messagesService.createConversation(
    ctx.clients,
    { message: "Devoirs", participantUserIds: [ctx.adminId] },
    ctx.teacherPrincipal,
    {},
  );
  assert.equal(sent.senderRoleLabel, "Professeur");
  const detail = await messagesService.getMessage(ctx.clients, sent.id, ctx.teacherPrincipal, {});
  assert.equal(detail.senderRoleLabel, "Professeur");
  const history = await messagesService.listConversationMessages(
    ctx.clients,
    sent.conversationId,
    ctx.teacherPrincipal,
    {},
  );
  assert.equal(history.items[0].senderRoleLabel, "Professeur");
  const inbox = await messagesService.listMessages(ctx.clients, ctx.teacherPrincipal, {});
  assert.equal(inbox[0].senderRoleLabel, "Professeur");
});

test("API-RL-15D reset display_label → Enseignant", async () => {
  const ctx = await messagesRuntime();
  const before = await messagesService.listAuthorizedRecipients(ctx.clients, ctx.adminPrincipal, {});
  assert.equal(before.items.find((row) => row.userId === ctx.teacherId).roleLabel, "Professeur");
  await resetRoleDisplayLabel(ctx.repo, "role-teacher", SUPER, {});
  const after = await messagesService.listAuthorizedRecipients(ctx.clients, ctx.adminPrincipal, {});
  const teacher = after.items.find((row) => row.userId === ctx.teacherId);
  assert.equal(teacher.roleLabel, "Enseignant");
  assert.equal(teacher.roleKey, "TEACHER");
  const sent = await messagesService.createConversation(
    ctx.clients,
    { message: "Reset", participantUserIds: [ctx.adminId] },
    ctx.teacherPrincipal,
    {},
  );
  assert.equal(sent.senderRoleLabel, "Enseignant");
  const conversation = await messagesService.getConversation(
    ctx.clients,
    sent.conversationId,
    ctx.teacherPrincipal,
    {},
  );
  assert.equal(conversation.participants.find((row) => row.userId === ctx.teacherId).roleLabel, "Enseignant");
});

test("API-RL-15E roleKey reste TEACHER partout", async () => {
  const ctx = await messagesRuntime();
  const sent = await messagesService.createConversation(
    ctx.clients,
    { message: "Identité", participantUserIds: [ctx.teacherId] },
    ctx.adminPrincipal,
    {},
  );
  const recipients = await messagesService.listAuthorizedRecipients(ctx.clients, ctx.adminPrincipal, {});
  const conversation = await messagesService.getConversation(
    ctx.clients,
    sent.conversationId,
    ctx.adminPrincipal,
    {},
  );
  assert.equal(recipients.items.find((row) => row.userId === ctx.teacherId).roleKey, "TEACHER");
  assert.equal(conversation.participants.find((row) => row.userId === ctx.teacherId).roleKey, "TEACHER");
  assert.notEqual(toRoleKey(recipients.items.find((row) => row.userId === ctx.teacherId).roleLabel), "PRINCIPAL");
});

test("API-RL-15F SCHOOL_ADMIN → Directeur sans devenir PRINCIPAL", async () => {
  const ctx = await messagesRuntime({ adminLabel: "Directeur" });
  const recipients = await messagesService.listAuthorizedRecipients(ctx.clients, ctx.teacherPrincipal, {});
  const admin = recipients.items.find((row) => row.userId === ctx.adminId);
  assert.ok(admin, "destinataire SCHOOL_ADMIN présent");
  assert.equal(admin.roleKey, "SCHOOL_ADMIN");
  assert.equal(admin.roleLabel, "Directeur");
  assert.equal(toRoleKey(admin.roleLabel), "PRINCIPAL");
  assert.notEqual(admin.roleKey, "PRINCIPAL");
  const sent = await messagesService.createConversation(
    ctx.clients,
    { message: "Collision", participantUserIds: [ctx.adminId] },
    ctx.teacherPrincipal,
    {},
  );
  const conversation = await messagesService.getConversation(
    ctx.clients,
    sent.conversationId,
    ctx.teacherPrincipal,
    {},
  );
  const participant = conversation.participants.find((row) => row.userId === ctx.adminId);
  assert.equal(participant.roleKey, "SCHOOL_ADMIN");
  assert.equal(participant.roleLabel, "Directeur");
});

test("API-RL-15G aucun N+1 catalogue par participant/conversation", async () => {
  const ctx = await messagesRuntime();
  const probe = spyContractLoads(ctx.rolesStore);

  probe.calls = 0;
  const recipients = await messagesService.listAuthorizedRecipients(ctx.clients, ctx.adminPrincipal, {});
  assert.ok(recipients.items.length >= 2);
  assert.equal(probe.calls, 1, "GET recipients : un seul chargement catalogue");

  probe.calls = 0;
  await messagesService.createConversation(
    ctx.clients,
    { message: "Conv 1", participantUserIds: [ctx.teacherId] },
    ctx.adminPrincipal,
    {},
  );
  assert.equal(probe.calls, 1, "createConversation : un seul chargement catalogue");

  probe.calls = 0;
  await messagesService.createConversation(
    ctx.clients,
    { message: "Conv 2", participantUserIds: [ctx.teacher2Id] },
    ctx.adminPrincipal,
    {},
  );
  const listed = await messagesService.listConversations(ctx.clients, ctx.adminPrincipal, {});
  assert.ok(listed.items.length >= 2);
  assert.equal(probe.calls, 2, "create + listConversations : 1 chargement par opération API");
  assert.equal(
    listed.items.every((row) => row.participants.some((item) => item.roleLabel === "Professeur")),
    true,
  );

  probe.calls = 0;
  const history = await messagesService.listConversationMessages(
    ctx.clients,
    listed.items[0].id,
    ctx.adminPrincipal,
    {},
  );
  assert.ok(history.items.length >= 1);
  assert.equal(probe.calls, 1, "conversation messages : un seul chargement catalogue");
});

test("API-RL-15 fallback/memory clients store charge le catalogue via rootRepository", async () => {
  const { repo } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER, {});
  const clients = createClientsMemoryStore({ rootRepository: repo });
  const index = await loadRoleDisplayIndexFromRepo(clients);
  assert.equal(resolveVisibleRoleLabel("TEACHER", index), "Professeur");
  const txIndex = await loadRoleDisplayIndexFromRepo(clients.bind());
  assert.equal(resolveVisibleRoleLabel("TEACHER", txIndex), "Professeur");
});

test("API-RL-15 PG clients store délègue au catalogue repository sans SQL N+1", async () => {
  const { repo, store: rolesStore } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER, {});
  const fakePgRepo = {
    getEstablishmentRolesStore: () => rolesStore,
    withTransaction: async (fn) => fn(fakePgRepo),
    one: async () => null,
    all: async () => {
      throw new Error("SELECT establishment_roles interdit si le store rôles est disponible");
    },
    query: async () => ({ rows: [] }),
  };
  const clients = createClientsPgStore(fakePgRepo);
  const index = await loadRoleDisplayIndexFromRepo(clients);
  assert.equal(resolveVisibleRoleLabel("TEACHER", index), "Professeur");
  const txIndex = await loadRoleDisplayIndexFromRepo(clients.bind({}));
  assert.equal(resolveVisibleRoleLabel("TEACHER", txIndex), "Professeur");
});

test("API-RL-15 PG queryable .all charge establishment_roles une fois", async () => {
  let catalogSelects = 0;
  const pgQueryable = {
    all: async (sql) => {
      const text = String(sql);
      if (text.includes("information_schema.columns")) return [{ available: true }];
      if (text.includes("establishment_roles")) {
        catalogSelects += 1;
        return [{ role_code: "TEACHER", role_name: "Enseignant", display_label: "Professeur" }];
      }
      return [];
    },
  };
  const index = await loadRoleDisplayIndexFromRepo(pgQueryable);
  assert.equal(resolveVisibleRoleLabel("TEACHER", index), "Professeur");
  assert.equal(catalogSelects, 1);
});

function pgLikeUsers() {
  return [
    {
      id: "user-admin",
      user_code: "user-admin",
      school_id: "school-1",
      school_code: SCHOOL_CODE,
      first_name: "Ada",
      last_name: "Admin",
      role: "Admin School",
      status: "active",
      role_keys: ["SCHOOL_ADMIN"],
    },
    {
      id: "user-teacher",
      user_code: "user-teacher",
      school_id: "school-1",
      school_code: SCHOOL_CODE,
      first_name: "Tom",
      last_name: "Teacher",
      role: "Enseignant",
      status: "active",
      role_keys: ["TEACHER"],
    },
    {
      id: "user-teacher-2",
      user_code: "user-teacher-2",
      school_id: "school-1",
      school_code: SCHOOL_CODE,
      first_name: "Léa",
      last_name: "Teacher",
      role: "Enseignant",
      status: "active",
      role_keys: ["TEACHER"],
    },
  ];
}

function createPgLikeMessagesClients({ withRolesStore = true, teacherLabel = "Professeur" } = {}) {
  const { repo, store: rolesStore } = rolesRepo();
  const catalogProbe = { contracts: 0, sql: 0 };
  const original = rolesStore.listRoleDisplayContracts.bind(rolesStore);
  rolesStore.listRoleDisplayContracts = async (...args) => {
    catalogProbe.contracts += 1;
    return original(...args);
  };
  const users = pgLikeUsers();
  const school = {
    id: "school-1",
    school_code: SCHOOL_CODE,
    login_code: SCHOOL_CODE,
    country_id: "country-cd",
    country_code: "CD",
    country_name: "Congo",
    name: "École Test",
  };
  const fakePgRepo = {
    getEstablishmentRolesStore: withRolesStore ? () => rolesStore : undefined,
    withTransaction: async (fn) => fn(fakePgRepo),
    one: async (sql, params = []) => {
      const text = String(sql);
      if (text.includes("FROM schools")) {
        return school;
      }
      if (text.includes("FROM users u") && (text.includes("u.id::text") || text.includes("user_code"))) {
        return users.find((row) => row.id === params[0] || row.user_code === params[0]) ?? null;
      }
      return null;
    },
    all: async (sql, params = []) => {
      const text = String(sql);
      if (text.includes("information_schema.columns")) return [{ available: true }];
      if (text.includes("establishment_roles")) {
        catalogProbe.sql += 1;
        return [
          { role_code: "TEACHER", role_name: "Enseignant", display_label: teacherLabel },
          { role_code: "SCHOOL_ADMIN", role_name: "Admin School", display_label: null },
        ];
      }
      if (text.includes("FROM users u") && text.includes("u.school_id")) {
        return users.filter((row) => row.school_id === params[0] && (row.status ?? "active") === "active");
      }
      if (text.includes("FROM user_roles")) {
        const user = users.find((row) => row.id === params[0]);
        return (user?.role_keys ?? []).map((role_key) => ({ role_key, user_id: params[0] }));
      }
      if (text.includes("teacher_assignments")) {
        return [{ class_id: "class-1" }];
      }
      return [];
    },
    query: async () => ({ rows: [] }),
  };
  const clients = createClientsPgStore(fakePgRepo);
  return {
    repo,
    rolesStore,
    clients,
    catalogProbe,
    users,
    adminPrincipal: {
      sub: "user-admin",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: SCHOOL_CODE,
    },
    teacherId: "user-teacher",
  };
}

test("API-RL-15G-PG-A runtime Messages PG-like : recipients TEACHER → Professeur, 1 catalogue", async () => {
  const { repo, clients, catalogProbe, adminPrincipal, teacherId } = createPgLikeMessagesClients();
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER, {});
  const recipients = await messagesService.listAuthorizedRecipients(clients, adminPrincipal, {});
  const teacher = recipients.items.find((row) => row.userId === teacherId);
  assert.ok(teacher, "destinataire TEACHER présent");
  assert.equal(teacher.roleKey, "TEACHER");
  assert.equal(teacher.roleLabel, "Professeur");
  assert.equal(catalogProbe.contracts, 1, "un seul chargement catalogue pour GET recipients");
  assert.equal(catalogProbe.sql, 0, "pas de SELECT establishment_roles si le store rôles est disponible");
});

test("API-RL-15G-PG-B même tx PG : getUserById N + listSchoolUsers = 1 catalogue", async () => {
  const { repo, clients, catalogProbe } = createPgLikeMessagesClients();
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER, {});
  const tx = clients.bind({});
  const admin = await tx.getUserById("user-admin");
  const teacher = await tx.getUserById("user-teacher");
  const teacher2 = await tx.getUserById("user-teacher-2");
  const listed = await tx.listSchoolUsers("school-1");
  assert.equal(admin.display_label, null);
  assert.equal(teacher.display_label, "Professeur");
  assert.equal(teacher2.display_label, "Professeur");
  assert.equal(listed.length, 3);
  assert.equal(
    listed.find((row) => row.id === "user-teacher").display_label,
    "Professeur",
  );
  assert.equal(catalogProbe.contracts, 1);
});

test("API-RL-15G-PG-C deux opérations PG distinctes : pas de cache process", async () => {
  const { repo, clients, catalogProbe, adminPrincipal } = createPgLikeMessagesClients();
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER, {});
  await messagesService.listAuthorizedRecipients(clients, adminPrincipal, {});
  await messagesService.listAuthorizedRecipients(clients, adminPrincipal, {});
  assert.equal(catalogProbe.contracts, 2, "chaque opération API recharge le catalogue");
});

test("API-RL-15G-PG-D queryable SQL PG-like : 1 SELECT establishment_roles par tx", async () => {
  const { clients, catalogProbe } = createPgLikeMessagesClients({ withRolesStore: false });
  const tx = clients.bind({});
  await tx.getUserById("user-admin");
  await tx.getUserById("user-teacher");
  const listed = await tx.listSchoolUsers("school-1");
  assert.equal(listed.find((row) => row.id === "user-teacher").display_label, "Professeur");
  assert.equal(catalogProbe.sql, 1, "un seul SELECT establishment_roles pour la tx");
  assert.equal(catalogProbe.contracts, 0);
});

test("API-RL-15G-PG-E roleKey reste TEACHER sur le chemin PG-like", async () => {
  const { repo, clients, adminPrincipal, teacherId } = createPgLikeMessagesClients();
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER, {});
  const recipients = await messagesService.listAuthorizedRecipients(clients, adminPrincipal, {});
  const teacher = recipients.items.find((row) => row.userId === teacherId);
  assert.equal(teacher.roleKey, "TEACHER");
  assert.equal(teacher.roleLabel, "Professeur");
  assert.notEqual(toRoleKey(teacher.roleLabel), "PRINCIPAL");
});

test("API-RL-17 / API-RL-18 compliance roleLabel décoré, guards inchangés", () => {
  const index = catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]);
  const row = sanitizePrivacyRequest({ role_label: "Admin School", school_code: "CD-1", identifier: "x" }, index);
  assert.equal(row.roleLabel, "Directeur");
  assert.equal(row.roleKey, "SCHOOL_ADMIN");
  const school = { role: "Admin School", schoolCode: "CD-1", roleKeys: ["SCHOOL_ADMIN"] };
  assert.equal(resolveSchoolComplianceScope(school), "CD-1");
  assert.throws(() => resolveSchoolComplianceScope({ role: "Super Administrateur Somafrik", schoolCode: "*" }), (error) => error.statusCode === 403);
  const privacy = readUtf8("./privacyErasure.js");
  assert.match(privacy, /function assertCanExecuteSchoolErasure/);
  assert.match(privacy, /isPlatformAdminPrincipal/);
});

test("API-RL-19 fallback/memory user décoré", async () => {
  const { repo } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER, {});
  const index = await loadRoleDisplayIndexFromRepo(repo);
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), index);
  assert.equal(user.effectiveRoleLabel, "Directeur");
  const fallback = readUtf8("../db/fallbackRepository.js");
  assert.match(fallback, /listClientsUsers[\s\S]*decorateUserWithRoleDisplay/);
});

test("API-RL-20 PG user non-régression", () => {
  const pg = readUtf8("../db/clientsPgStore.js");
  assert.match(pg, /decorateUserWithRoleDisplay/);
  assert.match(pg, /loadRoleDisplayIndex/);
});

test("API-RL-21 rôle métier custom supporté", () => {
  const index = catalogIndex([
    { role_code: "RESPONSABLE_PEDAGOGIQUE", role_name: "Responsable pédagogique", display_label: "Coordinateur académique" },
  ]);
  const user = decorateUserWithRoleDisplay(
    { role: "Responsable pédagogique", roleKey: "RESPONSABLE_PEDAGOGIQUE", roleKeys: ["RESPONSABLE_PEDAGOGIQUE"] },
    index,
  );
  assert.equal(user.effectiveRoleLabel, "Coordinateur académique");
  assert.equal(user.roleKey, "RESPONSABLE_PEDAGOGIQUE");
});

test("API-RL-22 Country Admin identité inchangée", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Admin Pays", roleKey: "COUNTRY_ADMIN", roleKeys: ["COUNTRY_ADMIN"] },
    catalogIndex(),
  );
  assert.equal(user.roleKey, "COUNTRY_ADMIN");
  assert.equal(user.effectiveRoleLabel, "Admin Pays");
  assert.equal(toRoleLabel("COUNTRY_ADMIN"), "Admin Pays");
});

test("API-RL-23 Superadmin identité inchangée", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Super Administrateur Somafrik", roleKey: "SUPER_ADMIN", roleKeys: ["SUPER_ADMIN"] },
    catalogIndex(),
  );
  assert.equal(user.roleKey, "SUPER_ADMIN");
  assert.equal(user.effectiveRoleLabel, "Super Administrateur Somafrik");
});

test("API-RL-24 permissions identiques avant/après display change", () => {
  const before = schoolAdminUser({ permissions: ["Utilisateurs:READ", "Audit:READ"] });
  const after = decorateUserWithRoleDisplay(
    before,
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.deepEqual(after.permissions, before.permissions);
});

test("API-RL-25 roleKeys multi-rôle identiques avant/après", () => {
  const before = { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER", "SCHOOL_ADMIN"] };
  const after = decorateUserWithRoleDisplay(
    before,
    catalogIndex([
      { role_code: "TEACHER", display_label: "Professeur" },
      { role_code: "SCHOOL_ADMIN", display_label: "Directeur" },
    ]),
  );
  assert.deepEqual(after.roleKeys, ["TEACHER", "SCHOOL_ADMIN"]);
});

test("API-RL fallback unique = defaultLabel pas Admin Établissement", () => {
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }), "Admin School");
  assert.equal(toRoleLabel("SCHOOL_ADMIN"), "Admin School");
  assert.equal(toRoleLabel("STUDENT"), "Élève / Étudiant");
});

test("API-RL identify conserve le slug technique", () => {
  const payload = decorateIdentifyRole(
    { role: "school_admin", roleLabel: "Admin Établissement" },
    schoolAdminUser(),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(payload.role, "school_admin");
  assert.equal(payload.roleLabel, "Directeur");
});
