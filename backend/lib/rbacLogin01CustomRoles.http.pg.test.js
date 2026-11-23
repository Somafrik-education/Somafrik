"use strict";

/**
 * RBAC-LOGIN-01 — reconnaissance des rôles personnalisés à la connexion Web.
 *
 * HTTP réel sur PostgreSQL jetable, comptes et rôles fictifs, aucun jeton ni secret
 * journalisé. Les rôles sont créés comme le fait le catalogue (role_code =
 * normalizeRoleCode(role_name)), attribués comme le fait l'API (role_key =
 * toRoleKey(role_name)), et leurs droits configurés comme la matrice RBAC
 * (role_module_permissions.role_key = UPPER(role_code)).
 *
 * RBAC_LOGIN_01_REPRO=1 : relevé de tous les écarts sans arrêt (reproduction).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { hashSecret } = require("../services/credentialService");
const { normalizeRoleCode } = require("./establishmentRolesManagement");
const { toRoleKey } = require("./userRoleLifecycle");
const {
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
} = require("./disposableTestDatabaseGuard");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_rbac_login_01_http_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_RBAC_LOGIN_01_HTTP_PORT ?? 19961);
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const SECRET = `Rbac-Login-01-${crypto.randomBytes(6).toString("hex")}!`;
const PIN = String(100000 + crypto.randomInt(800000));

const REPRO = process.env.RBAC_LOGIN_01_REPRO === "1";
const defects = [];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetIsolatedDatabase() {
  assertDisposableLocalDatabaseUrl(DATABASE_URL);
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url, max: 1 });
  try {
    await assertConnectedToDisposableDatabase(reset, IT_DATABASE);
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    try {
      if ((await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const claims = (token) => JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));

function assertStatus(response, expected, label) {
  const ok = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
  if (!ok && REPRO) {
    defects.push(`${label} : attendu ${expected}, reçu ${response.status}`);
    return false;
  }
  assert.ok(ok, `${label} : attendu ${expected}, reçu ${response.status} ${JSON.stringify(response.data)?.slice(0, 300)}`);
  return true;
}

function check(condition, label) {
  if (!condition && REPRO) {
    defects.push(label);
    return;
  }
  assert.ok(condition, label);
}

const ROLES = {
  conseiller: { name: "Conseiller pédagogique", modules: [{ moduleKey: "classes", canRead: true }] },
  lecteur: { name: "Lecteur élèves", modules: [{ moduleKey: "students", canRead: true }] },
  muet: { name: "Assistant sans droit", modules: [] },
  ancien: { name: "Ancien rôle école", modules: [{ moduleKey: "classes", canRead: true }] },
  revocable: { name: "Agent révocable", modules: [{ moduleKey: "classes", canRead: true }] },
  plateforme: { name: "Auditeur plateforme", scope: "platform", modules: [{ moduleKey: "classes", canRead: true }] },
};

/** Clé de user_roles telle que l'API l'écrit (assertGrantableRole → toRoleKey(role_name)). */
const userRoleKey = (role) => toRoleKey(role.name);
/** Clé des grants telle que la matrice RBAC l'écrit (UPPER(role_code)). */
const grantRoleKey = (role) => normalizeRoleCode(role.name).toUpperCase();

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
     VALUES ('RDC', 'CD', '+243', 'CDF', TRUE)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const insertSchool = async (code, shortCode, name) =>
    (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, short_code, name, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id, login_code, school_code`,
        [country.rows[0].id, code, shortCode, name],
      )
    ).rows[0];
  const schoolA = await insertSchool("CD-2026-0971", "RLA", "Institut RbacLogin A");
  const schoolB = await insertSchool("CD-2026-0972", "RLB", "Institut RbacLogin B");

  for (const role of Object.values(ROLES)) {
    const inserted = await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, status, school_assignable)
       VALUES ($1, $2, $3, 'active', TRUE) RETURNING id`,
      [normalizeRoleCode(role.name), role.name, role.scope ?? "school"],
    );
    role.id = inserted.rows[0].id;
    for (const grant of role.modules) {
      await pool.query(
        `INSERT INTO role_module_permissions (role_key, scope_type, module_key, can_read, status)
         VALUES ($1, 'global', $2, $3, 'active')`,
        [grantRoleKey(role), grant.moduleKey, grant.canRead === true],
      );
    }
  }

  const passwordHash = hashSecret(SECRET);
  const pinHash = hashSecret(PIN);
  const insertUser = async (code, schoolId, role) =>
    (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, role, status,
                            password_hash, pin_hash, must_change_password, profile_payload)
         VALUES ($1, $2, 'Fictif', $7, $3, 'active', $4, $5, FALSE, $6::jsonb) RETURNING id`,
        [schoolId, code, role, passwordHash, pinHash, JSON.stringify({ countryCode: "CD", countryScope: "CD" }), code],
      )
    ).rows[0].id;
  const grant = (userId, schoolId, roleKey) =>
    pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`, [
      userId,
      schoolId,
      roleKey,
    ]);

  const users = {};
  const withRoles = async (key, schoolId, grants, { primaryRole = grants[0]?.[1] ?? null } = {}) => {
    users[key] = await insertUser(`RL01-${key.toUpperCase()}`, schoolId, primaryRole);
    for (const [grantSchoolId, roleKey] of grants) await grant(users[key], grantSchoolId, roleKey);
  };

  await withRoles("custom", schoolA.id, [[schoolA.id, userRoleKey(ROLES.conseiller)]]);
  await withRoles("noperm", schoolA.id, [[schoolA.id, userRoleKey(ROLES.muet)]]);
  await withRoles("archived", schoolA.id, [[schoolA.id, userRoleKey(ROLES.ancien)]]);
  await withRoles("revoked", schoolA.id, [[schoolA.id, userRoleKey(ROLES.revocable)]]);
  await withRoles("multi", schoolA.id, [
    [schoolA.id, userRoleKey(ROLES.conseiller)],
    [schoolA.id, userRoleKey(ROLES.lecteur)],
  ]);
  // Rattaché à A ; rôle Lecteur détenu dans B uniquement (affectation hors périmètre).
  await withRoles("crossmulti", schoolA.id, [
    [schoolA.id, userRoleKey(ROLES.conseiller)],
    [schoolB.id, userRoleKey(ROLES.lecteur)],
  ]);
  // Rattaché à A ; son seul rôle personnalisé est détenu dans B.
  // users.role non renseigné : le backfill legacy de démarrage l'attribuerait sur users.school_id.
  await withRoles("othertenant", schoolA.id, [[schoolB.id, userRoleKey(ROLES.conseiller)]], { primaryRole: null });
  // users.role non renseigné : la migration de démarrage refuse un libellé hors catalogue scolaire.
  await withRoles("platformscope", schoolA.id, [[schoolA.id, userRoleKey(ROLES.plateforme)]], { primaryRole: null });
  await withRoles("outage", schoolA.id, [[schoolA.id, userRoleKey(ROLES.conseiller)]]);
  // Données existantes : même rôle détenu sous la clé API et sous son role_code
  // (doublon créé par un ancien backfill de démarrage).
  await withRoles("duplicate", schoolA.id, [
    [schoolA.id, userRoleKey(ROLES.revocable)],
    [schoolA.id, normalizeRoleCode(ROLES.revocable.name)],
  ]);
  await withRoles("adminA", schoolA.id, [[schoolA.id, "SCHOOL_ADMIN"]]);
  await withRoles("teacherA", schoolA.id, [[schoolA.id, "TEACHER"]]);
  // Rôle système hors liste statique Web (Surveillant) : chemin dynamique, même règles.
  await withRoles("supervisorA", schoolA.id, [[schoolA.id, "SUPERVISOR"]]);
  await withRoles("superadmin", null, [[null, "SUPER_ADMIN"]]);
  await withRoles("pays", null, [[null, "COUNTRY_ADMIN"]]);
  return { schoolA, schoolB, users };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("rbacLogin01CustomRoles.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const url = await resetIsolatedDatabase();
  const repo = createPostgresRepository(url);
  const pool = new Pool({ connectionString: url });
  let child = null;
  const stderrRef = { value: "" };
  const passed = [];
  // En reproduction, un contrôle n'est « OK » que si aucun écart n'a été relevé depuis le précédent.
  let defectsSeen = 0;
  const ok = (label) => {
    passed.push(defects.length > defectsSeen ? `${label} — ÉCART(S) RELEVÉ(S)` : label);
    defectsSeen = defects.length;
  };

  try {
    await repo.init();
    const { schoolA, schoolB, users } = await seed(pool);

    const startServer = async () => {
      child = spawn(process.execPath, ["backend/server.js"], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(HTTP_PORT),
          DATABASE_URL: url,
          JWT_SECRET,
          SOMAFRIK_DB_REQUIRED: "true",
          SOMAFRIK_SKIP_DEMO_SEED: "true",
          SOMAFRIK_API_ONLY: "true",
          SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stderr.on("data", (chunk) => {
        stderrRef.value += String(chunk);
      });
      child.stdout.on("data", () => {});
      await waitForHealth(child, stderrRef);
    };
    await startServer();

    const webLogin = (key, schoolCode = schoolA.login_code) =>
      request("/backoffice/login", {
        method: "POST",
        body: { identifier: `RL01-${key.toUpperCase()}`, password: SECRET, ...(schoolCode ? { schoolCode } : {}) },
      });
    const classesRoute = (token) => request("/classes", { token });
    const studentsRoute = (token) => request("/students?page=1&limit=5", { token });
    const teachersRoute = (token) => request("/teachers?page=1&limit=5", { token });
    const platformRoute = (token) => request("/backoffice/countries", { token });
    const usersRoute = (token) => request("/backoffice/users?page=1&limit=5", { token });

    // RL01-01 — rôle personnalisé actif avec permission Web : connexion et accès autorisés.
    const custom = await webLogin("custom");
    if (assertStatus(custom, 200, "RL01-01 connexion Web rôle personnalisé actif")) {
      const token = custom.data.accessToken;
      check(custom.data.user?.webAccessProfile === "school_custom_role", "RL01-01 profil Web rôle personnalisé");
      check(custom.data.dashboard?.privilegeLevel === "SCHOOL_CUSTOM_ROLE", "RL01-01 tableau de bord neutre");
      check(JSON.stringify(custom.data.menus) === JSON.stringify(["Dashboard"]), "RL01-01 menus serveur minimaux");
      const perms = custom.data.permissions ?? [];
      check(perms.includes("Classes:READ"), `RL01-01 permission configurée présente : ${JSON.stringify(perms)}`);
      check(!perms.includes("ALL_PRIVILEGES") && !perms.includes("COUNTRY_PRIVILEGES"), "RL01-01 aucun privilège plateforme");
      check(!perms.includes("Élèves:READ") && !perms.includes("Enseignants:READ"), "RL01-01 aucune permission non configurée");
      const tokenClaims = claims(token);
      check(String(tokenClaims.schoolId ?? "") === String(schoolA.id), "RL01-01 jeton borné à l'établissement");
      assertStatus(await classesRoute(token), 200, "RL01-01 route autorisée (classes)");
      assertStatus(await teachersRoute(token), 403, "RL01-01 route non autorisée (enseignants)");
      assertStatus(await studentsRoute(token), 403, "RL01-01 route non autorisée (élèves)");
      assertStatus(await platformRoute(token), 403, "RL01-01 route plateforme refusée");
      assertStatus(await usersRoute(token), 403, "RL01-01 gestion des utilisateurs refusée");
      const effective = await request("/auth/effective-permissions", { token });
      assertStatus(effective, 200, "RL01-01 permissions effectives");
      check(
        JSON.stringify(effective.data?.permissions ?? []) === JSON.stringify(perms),
        "RL01-01 navigation (permissions effectives) = permissions de connexion",
      );
      const refreshed = await request("/auth/refresh", { method: "POST", body: { refreshToken: custom.data.refreshToken } });
      assertStatus(refreshed, 200, "RL01-01 refresh");
      check((refreshed.data?.permissions ?? []).includes("Classes:READ"), "RL01-01 refresh conserve les droits configurés");
    }
    ok("RL01-01 rôle personnalisé actif avec permission : connexion et accès autorisés, rien de plus");

    // RL01-02 — rôle personnalisé actif sans permission : aucun accès.
    assertStatus(await webLogin("noperm"), 403, "RL01-02 rôle sans permission Web refusé");
    ok("RL01-02 rôle personnalisé sans permission : connexion refusée");

    // RL01-03 — rôle archivé : session existante invalidée, nouvelle connexion refusée.
    const beforeArchive = await webLogin("archived");
    assertStatus(beforeArchive, 200, "RL01-03 connexion avant archivage");
    const superWeb = await webLogin("superadmin", null);
    assertStatus(superWeb, 200, "RL01-03 connexion Superadmin");
    const archived = await request(`/backoffice/rbac/roles/${ROLES.ancien.id}/archive`, {
      method: "POST",
      token: superWeb.data.accessToken,
      body: {},
    });
    assertStatus(archived, 200, "RL01-03 archivage du rôle");
    assertStatus(await classesRoute(beforeArchive.data?.accessToken), [401, 403], "RL01-03 session existante après archivage");
    assertStatus(
      await request("/auth/refresh", { method: "POST", body: { refreshToken: beforeArchive.data?.refreshToken } }),
      401,
      "RL01-03 refresh après archivage",
    );
    assertStatus(await webLogin("archived"), 403, "RL01-03 connexion après archivage");
    ok("RL01-03 rôle archivé : sessions invalidées, connexion refusée");

    // RL01-04 — rôle révoqué par l'API : sessions invalidées, nouvelle connexion refusée.
    const beforeRevoke = await webLogin("revoked");
    assertStatus(beforeRevoke, 200, "RL01-04 connexion avant révocation");
    const adminA = await webLogin("adminA");
    assertStatus(adminA, 200, "RL01-04 connexion Admin School");
    const revoke = await request(`/backoffice/users/${users.revoked}/roles/revoke`, {
      method: "POST",
      token: adminA.data.accessToken,
      body: { role: userRoleKey(ROLES.revocable) },
    });
    assertStatus(revoke, 200, "RL01-04 révocation du rôle");
    const revokedSessions = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [users.revoked],
    );
    check(revokedSessions.rows[0].n === 0, `RL01-04 sessions actives restantes : ${revokedSessions.rows[0].n}`);
    assertStatus(await classesRoute(beforeRevoke.data?.accessToken), 401, "RL01-04 session existante après révocation");
    assertStatus(await webLogin("revoked"), [200, 403], "RL01-04 nouvelle connexion après révocation");
    const afterRevoke = await webLogin("revoked");
    if (afterRevoke.status === 200) {
      // Compte désormais « Sans affectation » : connexion sans aucun droit.
      check((afterRevoke.data.permissions ?? []).length === 0, `RL01-04 aucun droit après révocation : ${JSON.stringify(afterRevoke.data.permissions)} ${afterRevoke.data.user?.role}`);
      assertStatus(await classesRoute(afterRevoke.data.accessToken), 403, "RL01-04 aucun accès après révocation");
    }
    ok(`RL01-04 rôle révoqué : sessions invalidées, plus aucun accès (connexion ${afterRevoke.status})`);

    // RL01-05 — rôle d'un autre établissement : refus.
    assertStatus(await webLogin("othertenant"), 403, "RL01-05 rôle détenu dans un autre établissement");
    assertStatus(await webLogin("custom", schoolB.login_code), [401, 403], "RL01-05 connexion avec le code d'un autre établissement");
    ok("RL01-05 rôle d'un autre établissement : connexion refusée");

    // RL01-06 — rôles système : aucune régression.
    const teacher = await webLogin("teacherA");
    assertStatus(teacher, 200, "RL01-06 Enseignant");
    check(teacher.data?.user?.webAccessProfile === undefined, "RL01-06 Enseignant sans profil personnalisé");
    assertStatus(await teachersRoute(adminA.data.accessToken), 200, "RL01-06 Admin School conserve ses droits");
    check(adminA.data?.user?.webAccessProfile === undefined, "RL01-06 Admin School sans profil personnalisé");
    check(adminA.data?.dashboard?.privilegeLevel === "SCHOOL_PRIVILEGES", "RL01-06 tableau de bord Admin School inchangé");
    const pays = await webLogin("pays", null);
    assertStatus(pays, 200, "RL01-06 Admin Pays");
    assertStatus(await platformRoute(pays.data.accessToken), 200, "RL01-06 Admin Pays route plateforme");
    assertStatus(await platformRoute(superWeb.data.accessToken), 200, "RL01-06 Superadmin route plateforme");
    assertStatus(await teachersRoute(superWeb.data.accessToken), 403, "RL01-06 Superadmin sans privilège scolaire implicite");
    const supervisor = await webLogin("supervisorA");
    assertStatus(supervisor, [200, 403], "RL01-06 Surveillant (chemin dynamique)");
    if (supervisor.status === 200) {
      const perms = supervisor.data.permissions ?? [];
      check(perms.length > 0, "RL01-06 Surveillant admis uniquement avec des permissions Web");
      check(!perms.includes("ALL_PRIVILEGES") && !perms.includes("COUNTRY_PRIVILEGES"), "RL01-06 Surveillant sans privilège plateforme");
      assertStatus(await platformRoute(supervisor.data.accessToken), 403, "RL01-06 Surveillant route plateforme");
    }
    ok(`RL01-06 rôles système (Admin School, Enseignant, Admin Pays, Superadmin) : inchangés ; Surveillant ${supervisor.status}`);

    // RL01-07 — rôles multiples : union limitée au périmètre légitime.
    const multi = await webLogin("multi");
    if (assertStatus(multi, 200, "RL01-07 connexion multirôle")) {
      assertStatus(await classesRoute(multi.data.accessToken), 200, "RL01-07 droit du rôle 1");
      assertStatus(await studentsRoute(multi.data.accessToken), 200, "RL01-07 droit du rôle 2");
      assertStatus(await teachersRoute(multi.data.accessToken), 403, "RL01-07 droit non accordé");
    }
    const crossMulti = await webLogin("crossmulti");
    if (assertStatus(crossMulti, 200, "RL01-07 connexion multirôle inter-établissements")) {
      assertStatus(await classesRoute(crossMulti.data.accessToken), 200, "RL01-07 rôle de l'établissement");
      assertStatus(await studentsRoute(crossMulti.data.accessToken), 403, "RL01-07 rôle d'un autre établissement ignoré");
      check(!(crossMulti.data.permissions ?? []).includes("Élèves:READ"), "RL01-07 aucune permission importée d'un autre établissement");
    }
    ok("RL01-07 rôles multiples : union des droits du seul établissement de connexion");

    // RL01-08 — rôle personnalisé de portée plateforme attribué dans une école : refus.
    assertStatus(await webLogin("platformscope"), 403, "RL01-08 rôle catalogue non scolaire");
    ok("RL01-08 rôle personnalisé hors portée établissement : refusé");

    // RL01-09 — erreur de résolution RBAC : fail-closed.
    await pool.query("ALTER TABLE establishment_roles RENAME TO establishment_roles_rl01_outage");
    let outage;
    try {
      outage = await webLogin("outage");
    } finally {
      await pool.query("ALTER TABLE establishment_roles_rl01_outage RENAME TO establishment_roles");
    }
    assertStatus(outage, [401, 403, 500, 503], "RL01-09 catalogue indisponible : connexion refusée");
    check(!outage.data?.accessToken, "RL01-09 aucun jeton émis pendant l'incident");
    await pool.query("ALTER TABLE user_roles RENAME TO user_roles_rl01_outage");
    let rolesOutage;
    try {
      rolesOutage = await webLogin("outage");
    } finally {
      await pool.query("ALTER TABLE user_roles_rl01_outage RENAME TO user_roles");
    }
    assertStatus(rolesOutage, [401, 403, 500, 503], "RL01-09 user_roles indisponible : connexion refusée");
    check(!rolesOutage.data?.accessToken, "RL01-09 aucun jeton émis (user_roles indisponible)");
    assertStatus(await webLogin("outage"), 200, "RL01-09 retour à la normale après incident");
    ok(`RL01-09 erreur RBAC : fail-closed (catalogue ${outage.status}, rôles ${rolesOutage.status})`);

    // RL01-10 — parité Mobile : rôle Web uniquement, pas d'accès Mobile imposé.
    const identify = await request("/identify", {
      method: "POST",
      body: { schoolCode: schoolA.login_code, identifier: "RL01-CUSTOM" },
    });
    assertStatus(identify, [403], "RL01-10 Mobile : rôle personnalisé non exposé");
    const mobile = await request("/login", {
      method: "POST",
      body: { role: "school_admin", schoolCode: schoolA.login_code, identifier: "RL01-CUSTOM", pin: PIN },
    });
    assertStatus(mobile, [401, 403], "RL01-10 Mobile : aucune élévation via un profil mobile");
    ok("RL01-10 parité Mobile : accès Mobile non imposé, aucun contournement");

    // RL01-11 — clés équivalentes : la révocation retire tous les doublons, et un
    // redémarrage (backfill legacy) ne recrée ni le rôle révoqué ni de doublon.
    const activeRoleRows = async (userId) =>
      (
        await pool.query(
          `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active' AND revoked_at IS NULL`,
          [userId],
        )
      ).rows.map((row) => row.role_key);
    const duplicate = await webLogin("duplicate");
    assertStatus(duplicate, 200, "RL01-11 connexion (clés équivalentes)");
    const adminAgain = await webLogin("adminA");
    const revokeDuplicate = await request(`/backoffice/users/${users.duplicate}/roles/revoke`, {
      method: "POST",
      token: adminAgain.data.accessToken,
      body: { role: userRoleKey(ROLES.revocable) },
    });
    assertStatus(revokeDuplicate, 200, "RL01-11 révocation");
    check((await activeRoleRows(users.duplicate)).length === 0, `RL01-11 doublon encore actif : ${JSON.stringify(await activeRoleRows(users.duplicate))}`);
    assertStatus(await classesRoute(duplicate.data?.accessToken), 401, "RL01-11 session après révocation");
    // Contrat de migration (userRolesMigration.pg.test.js) : un users.role désignant un rôle
    // archivé bloque le démarrage. Procédure d'exploitation : retirer l'attribution archivée.
    const revokeArchived = await request(`/backoffice/users/${users.archived}/roles/revoke`, {
      method: "POST",
      token: adminAgain.data.accessToken,
      body: { role: userRoleKey(ROLES.ancien) },
    });
    assertStatus(revokeArchived, 200, "RL01-11 retrait de l'attribution du rôle archivé");
    await stopChild(child);
    await startServer();
    check((await activeRoleRows(users.duplicate)).length === 0, `RL01-11 rôle recréé au redémarrage : ${JSON.stringify(await activeRoleRows(users.duplicate))}`);
    check((await activeRoleRows(users.revoked)).length === 0, `RL01-11 rôle révoqué recréé au redémarrage : ${JSON.stringify(await activeRoleRows(users.revoked))}`);
    const customRows = await activeRoleRows(users.custom);
    check(customRows.length === 1, `RL01-11 aucun doublon créé au démarrage : ${JSON.stringify(customRows)}`);
    const afterRestart = await webLogin("duplicate");
    if (afterRestart.status === 200) {
      assertStatus(await classesRoute(afterRestart.data.accessToken), 403, "RL01-11 aucun droit après redémarrage");
    } else {
      assertStatus(afterRestart, 403, "RL01-11 connexion après redémarrage");
    }
    assertStatus(await webLogin("custom"), 200, "RL01-11 rôle actif conservé après redémarrage");
    ok("RL01-11 clés équivalentes : révocation complète, aucun rôle recréé au redémarrage");

    if (REPRO) {
      for (const defect of defects) console.log(`DÉFAUT ${defect}`);
      console.log(`rbacLogin01CustomRoles.http.pg.test.js: REPRO ${defects.length} écart(s)`);
      if (defects.length) process.exitCode = 1;
      return;
    }
    for (const label of passed) console.log(`OK ${label}`);
    console.log(`rbacLogin01CustomRoles.http.pg.test.js: ${passed.length} contrôles OK`);
  } catch (error) {
    for (const label of passed) console.log(`OK ${label}`);
    for (const defect of defects) console.log(`DÉFAUT ${defect}`);
    throw error;
  } finally {
    await stopChild(child);
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
