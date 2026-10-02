"use strict";

/**
 * ADMIN-04 — Utilisateurs : preuves U04-01 → U04-18.
 * Pas de reconstruction. Mutations via services existants.
 * displayLabel visuel uniquement — jamais en entrée RBAC.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { USER_ROLE_ERROR, toRoleKey } = require("./userRoleLifecycle");
const { hydrateUser } = require("./userRoleLifecycleService");
const { resolveUsersSchoolScope } = require("./usersSchoolScope");
const { resolveEffectiveRoleLabel } = require("./roleDisplayLabels");

const SUPER_ADMIN = {
  sub: "super",
  role: "Super Administrateur Somafrik",
  schoolCode: "*",
  identifier: "superadmin",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
};
const COUNTRY_ADMIN = {
  sub: "admin-pays",
  role: "Admin Pays",
  countryCode: "CD",
  schoolCode: "*",
  identifier: "admin-rdc",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
};
const SCHOOL_ADMIN = {
  sub: "admin-school",
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  schoolId: "school-cd",
  usersLoginCode: "CD-IB-26-002",
  usersSchoolId: "school-cd",
  countryCode: "CD",
  identifier: "admin-cd",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Utilisateurs:UPDATE", "Gérer utilisateurs"],
};
const AUDIT = { ipAddress: "127.0.0.1", userAgent: "admin04-u04" };

function buildStore(seed = {}) {
  return createClientsMemoryStore({
    platformSchools: [
      {
        id: "school-cd",
        code: "CD-2026-0001",
        name: "Institut Bukavu",
        countryId: "country-cd",
        countryCode: "CD",
        country: "RDC",
        login_code: "CD-IB-26-002",
      },
      {
        id: "school-cd-2",
        code: "CD-2026-0002",
        name: "Unikin",
        countryId: "country-cd",
        countryCode: "CD",
        country: "RDC",
        login_code: "CD-UN-26-001",
      },
      {
        id: "school-bi",
        code: "BI-2026-0001",
        name: "Ecole Kanyosha",
        countryId: "country-bi",
        countryCode: "BI",
        country: "Burundi",
        login_code: "BI-EK-26-001",
      },
    ],
    countries: [
      { id: "country-cd", iso_code: "CD", name: "RDC" },
      { id: "country-bi", iso_code: "BI", name: "Burundi" },
    ],
    ...seed,
  });
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error(`Expected rejection ${code || status}`);
  } catch (error) {
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code, error.message);
  }
}

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function secretLeak(value) {
  const blob = JSON.stringify(value ?? {});
  return /temporaryPassword|temporarySecret|password_hash|pin_hash|refresh_token|Bearer /.test(blob) ? blob : null;
}

test("U04-01 Superadmin liste comptes plateforme autorisés", async () => {
  const store = buildStore({
    users: [
      {
        id: "teacher-hidden",
        school_id: "school-cd",
        user_code: "USR-TEACH",
        first_name: "Hidden",
        last_name: "Teacher",
        email: "hidden.teacher@test.local",
        role: "TEACHER",
        status: "active",
      },
    ],
    userRoles: [{ user_id: "teacher-hidden", role_key: "TEACHER", status: "active", school_id: "school-cd" }],
  });
  const country = await store.provisionUser(
    {
      firstName: "Amina",
      lastName: "Pays",
      email: "u04.country@test.local",
      temporaryPassword: "CountryAdmin!2026",
      roleKey: "COUNTRY_ADMIN",
      countryCode: "CD",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const school = await store.provisionUser(
    {
      firstName: "Patrick",
      lastName: "School",
      email: "u04.school@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const listed = store.listUsers(resolveUsersSchoolScope(SUPER_ADMIN));
  const ids = listed.map((row) => String(row.id));
  assert.ok(ids.includes(String(country.id)));
  assert.ok(ids.includes(String(school.id)));
  assert.ok(!ids.includes("teacher-hidden"));
  assert.ok(listed.every((row) => (row.roleKeys || []).some((key) => key === "COUNTRY_ADMIN" || key === "SCHOOL_ADMIN")));
});

test("U04-02 SCHOOL_ADMIN isolation école", async () => {
  const store = buildStore();
  const local = await store.provisionUser(
    {
      firstName: "Local",
      lastName: "Admin",
      email: "u04.local.school@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  await store.provisionUser(
    {
      firstName: "Foreign",
      lastName: "Admin",
      email: "u04.foreign.school@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "BI",
      schoolCode: "BI-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const listed = store.listUsers(resolveUsersSchoolScope(SCHOOL_ADMIN));
  assert.ok(listed.every((row) => String(row.schoolId ?? row.school_id) === "school-cd"));
  assert.ok(listed.some((row) => String(row.id) === String(local.id)));
  assert.ok(!listed.some((row) => String(row.email) === "u04.foreign.school@test.local"));

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Nope",
        lastName: "Pays",
        email: "u04.school.creates.country@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "CD",
      },
      SCHOOL_ADMIN,
      AUDIT,
    ),
    { status: 403, code: USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN },
  );
});

test("U04-03 create COUNTRY_ADMIN persiste", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Claire",
      lastName: "Pays",
      email: "u04.create.country@test.local",
      temporaryPassword: "CountryAdmin!2026",
      roleKey: "COUNTRY_ADMIN",
      countryCode: "CD",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const row = await store.getUserById(created.id);
  assert.equal(row.role, "COUNTRY_ADMIN");
  assert.equal(row.school_id, null);
  assert.ok(store._tables.userRoles.some((item) => item.user_id === created.id && item.role_key === "COUNTRY_ADMIN" && item.status === "active"));
});

test("U04-04 create SCHOOL_ADMIN persiste", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Serge",
      lastName: "Ecole",
      email: "u04.create.school@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const row = await store.getUserById(created.id);
  assert.equal(row.role, "SCHOOL_ADMIN");
  assert.equal(String(row.school_id), "school-cd");
  assert.ok(store._tables.userRoles.some((item) => item.user_id === created.id && item.role_key === "SCHOOL_ADMIN" && item.status === "active"));
});

test("U04-05 SUPER_ADMIN creation interdite", async () => {
  const store = buildStore();
  await expectRejection(
    store.provisionUser(
      {
        firstName: "Evil",
        lastName: "Twin",
        email: "u04.super.create@test.local",
        roleKey: "SUPER_ADMIN",
        countryCode: "CD",
      },
      SUPER_ADMIN,
      AUDIT,
    ),
    { status: 400, code: CLIENTS_ERROR.ROLE_NOT_ALLOWED },
  );
});

test("U04-06 PATCH identité persiste", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Old",
      lastName: "Name",
      email: "u04.patch.id@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  await store.updateUser(created.id, { firstName: "New", lastName: "Identity", phone: "+243800000001" }, SUPER_ADMIN, AUDIT);
  const row = await store.getUserById(created.id);
  assert.equal(row.first_name, "New");
  assert.equal(row.last_name, "Identity");
  assert.equal(row.phone, "+243800000001");
  assert.equal(row.role, "SCHOOL_ADMIN");
});

test("U04-07 validation pending persiste", async () => {
  const store = buildStore();
  const pending = await store.provisionUser(
    {
      firstName: "Pending",
      lastName: "Validate",
      email: "u04.pending.validate@test.local",
      temporaryPassword: "SchoolPending!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    COUNTRY_ADMIN,
    AUDIT,
  );
  assert.equal(pending.status, "En attente de validation");
  await expectRejection(
    store.updateUser(pending.id, { status: "Actif", validationStatus: "Validé" }, COUNTRY_ADMIN, AUDIT),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  await store.updateUser(
    pending.id,
    { status: "Actif", validationStatus: "Validé", validatedBy: "superadmin", validatedAt: new Date().toISOString() },
    SUPER_ADMIN,
    AUDIT,
  );
  const row = await store.getUserById(pending.id);
  assert.equal(row.status, "active");
  assert.equal(row.profile_payload.validationStatus, "Validé");
});

test("U04-08 refus pending persiste", async () => {
  const store = buildStore();
  const pending = await store.provisionUser(
    {
      firstName: "Pending",
      lastName: "Refuse",
      email: "u04.pending.refuse@test.local",
      temporaryPassword: "SchoolPending!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    COUNTRY_ADMIN,
    AUDIT,
  );
  await expectRejection(
    store.updateUser(pending.id, { status: "Archivé" }, COUNTRY_ADMIN, AUDIT),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  await store.updateUser(pending.id, { status: "Archivé" }, SUPER_ADMIN, AUDIT);
  const row = await store.getUserById(pending.id);
  assert.equal(row.status, "archived");
});

test("U04-09 suspension persiste", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Suspend",
      lastName: "Me",
      email: "u04.suspend@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  await store.updateUser(created.id, { status: "Suspendu" }, SUPER_ADMIN, AUDIT);
  assert.equal((await store.getUserById(created.id)).status, "suspended");
});

test("U04-10 réactivation persiste", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Reactivate",
      lastName: "Me",
      email: "u04.reactivate@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  await store.updateUser(created.id, { status: "Suspendu" }, SUPER_ADMIN, AUDIT);
  await store.updateUser(created.id, { status: "Actif" }, SUPER_ADMIN, AUDIT);
  assert.equal((await store.getUserById(created.id)).status, "active");
});

async function schoolActor(store, email) {
  const provisioned = await store.provisionUser(
    {
      firstName: "Actor",
      lastName: "School",
      email,
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  return {
    sub: provisioned.id,
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolId: "school-cd",
    usersLoginCode: "CD-IB-26-002",
    usersSchoolId: "school-cd",
    identifier: provisioned.identifier,
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Utilisateurs:UPDATE", "Gérer utilisateurs"],
  };
}

test("U04-11 grant rôle persiste", async () => {
  const store = buildStore();
  const actor = await schoolActor(store, "u04.grant.actor@test.local");
  const created = await store.createUser(
    {
      firstName: "Grant",
      lastName: "Role",
      email: "u04.grant@test.local",
      temporaryPassword: "GrantUser!2026",
    },
    actor,
    AUDIT,
  );
  await store.grantUserRole(created.id, { role: "Secrétaire" }, actor, AUDIT);
  const keys = store._tables.userRoles
    .filter((row) => row.user_id === created.id && row.status === "active" && !row.revoked_at)
    .map((row) => row.role_key);
  assert.ok(keys.includes("SECRETARY"));
  assert.equal((await store.getUserById(created.id)).role, "SECRETARY");
});

test("U04-12 revoke rôle persiste", async () => {
  const store = buildStore();
  const actor = await schoolActor(store, "u04.revoke.actor@test.local");
  const created = await store.createUser(
    {
      firstName: "Revoke",
      lastName: "Role",
      email: "u04.revoke@test.local",
      temporaryPassword: "GrantUser!2026",
    },
    actor,
    AUDIT,
  );
  await store.grantUserRole(created.id, { role: "Secrétaire" }, actor, AUDIT);
  await store.revokeUserRole(created.id, { role: "Secrétaire" }, actor, AUDIT);
  const active = store._tables.userRoles.filter(
    (row) => row.user_id === created.id && row.status === "active" && !row.revoked_at,
  );
  assert.equal(active.length, 0);
  assert.ok(store._tables.userRoles.some((row) => row.user_id === created.id && row.role_key === "SECRETARY" && row.status === "revoked"));
});

test("U04-13 reassign school cohérent", async () => {
  const store = buildStore({
    sessions: [{ id: "sess-1", user_id: null, revoked_at: null, revoke_reason: null }],
  });
  const created = await store.provisionUser(
    {
      firstName: "Move",
      lastName: "School",
      email: "u04.reassign@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  store._tables.sessions.push({ id: "sess-move", user_id: created.id, revoked_at: null, revoke_reason: null });
  await store.reassignUserSchool(created.id, { schoolCode: "CD-2026-0002", countryCode: "CD" }, SUPER_ADMIN, AUDIT);
  const row = await store.getUserById(created.id);
  assert.equal(String(row.school_id), "school-cd-2");
  const roles = store._tables.userRoles.filter((item) => item.user_id === created.id && item.status === "active");
  assert.ok(roles.every((item) => String(item.school_id) === "school-cd-2"));
  const session = store._tables.sessions.find((item) => item.id === "sess-move");
  assert.ok(session.revoked_at);
  assert.equal(session.revoke_reason, "tenant_reassign");
});

test("U04-14 cross-tenant refusé", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Stay",
      lastName: "Here",
      email: "u04.cross@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  await expectRejection(
    store.reassignUserSchool(created.id, { schoolCode: "BI-2026-0001" }, SCHOOL_ADMIN, AUDIT),
    { status: 403, code: CLIENTS_ERROR.USER_TENANT_REASSIGN_FORBIDDEN },
  );
  await expectRejection(
    store.reassignUserSchool(created.id, { schoolCode: "BI-2026-0001", countryCode: "BI" }, COUNTRY_ADMIN, AUDIT),
    { status: 403, code: CLIENTS_ERROR.TENANT_MISMATCH },
  );
  assert.equal(String((await store.getUserById(created.id)).school_id), "school-cd");
});

test("U04-15 reset password persiste", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Reset",
      lastName: "Pwd",
      email: "u04.reset@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const before = await store.getUserById(created.id);
  const updated = store.resetUserPassword([created.id, created.identifier], "ResetTmp!2026");
  const after = await store.getUserById(created.id);
  assert.equal(after.must_change_password, true);
  assert.notEqual(after.password_hash, before.password_hash);
  assert.equal(after.password_hash, after.pin_hash);
  assert.ok(!String(JSON.stringify(updated)).includes("ResetTmp!2026"));
});

test("U04-16 reset invalide sessions selon contrat", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Session",
      lastName: "Kill",
      email: "u04.sessions@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  store._tables.sessions.push({ id: "live-sess", user_id: created.id, revoked_at: null, revoke_reason: null });
  store.resetUserPassword([created.id], "ResetTmp!2026");
  const revoked = await store.withTransaction((tx) => tx.revokeUserSessions(created.id, "password_reset"));
  assert.equal(revoked, 1);
  const session = store._tables.sessions.find((row) => row.id === "live-sess");
  assert.ok(session.revoked_at);
  assert.equal(session.revoke_reason, "password_reset");
});

test("U04-17 audit sans password/PIN/token", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Audit",
      lastName: "Clean",
      email: "u04.audit@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  await store.updateUser(created.id, { firstName: "Audited" }, SUPER_ADMIN, AUDIT);
  for (const entry of store.getAuditLog()) {
    const leak = secretLeak(entry);
    assert.equal(leak, null, leak);
  }
  const handler = readUtf8("../server.js");
  const resetBlock = handler.slice(
    handler.indexOf('app.post("/api/users/:id/reset-password"'),
    handler.indexOf('app.get("/api/payments"'),
  );
  const auditCall = resetBlock.slice(resetBlock.indexOf("auditService.record"), resetBlock.indexOf("res.json"));
  assert.match(auditCall, /reset_user_password/);
  assert.match(auditCall, /oldPasswordInvalidated/);
  assert.doesNotMatch(auditCall, /temporaryPassword|password_hash|pin_hash|Bearer /);
  assert.match(resetBlock, /revokeAllSessionsForUser|revoke_reason = 'password_reset'/);
  assert.match(resetBlock, /DELETE FROM login_lockouts/);
});

test("U04-18 displayLabel n’influence jamais roleKey/RBAC", async () => {
  const store = buildStore();
  const created = await store.provisionUser(
    {
      firstName: "Visual",
      lastName: "Directeur",
      email: "u04.display@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER_ADMIN,
    AUDIT,
  );
  const row = await store.getUserById(created.id);
  const hydrated = hydrateUser({ ...row, display_label: "Directeur" }, ["SCHOOL_ADMIN"]);
  assert.equal(hydrated.roleKeys[0], "SCHOOL_ADMIN");
  assert.equal(hydrated.effectiveRoleLabel, "Directeur");
  assert.equal(toRoleKey(hydrated.effectiveRoleLabel), "PRINCIPAL");
  assert.equal(toRoleKey(hydrated.roleKeys[0]), "SCHOOL_ADMIN");
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" }), "Directeur");

  const rbacSources = [
    "../lib/userRoleLifecycle.js",
    "../lib/functionalRbacResolution.js",
    "../lib/rbacMandatoryPermissions.js",
    "../services/rbacService.js",
    "../lib/liveRbacPrincipalAuthority.js",
  ];
  for (const relative of rbacSources) {
    const source = readUtf8(relative);
    assert.doesNotMatch(source, /displayLabel|effectiveLabel|display_label/);
  }
});
