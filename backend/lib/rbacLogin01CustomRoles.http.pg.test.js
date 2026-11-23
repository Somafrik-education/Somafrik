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
  // Deux entrées actives équivalentes (role_code « double » et role_name « DOUBLE ») : ambigu.
  doubleA: { name: "Double A", code: "double", modules: [{ moduleKey: "payments", canRead: true }] },
  doubleB: { name: "DOUBLE", code: "double_bis", modules: [{ moduleKey: "payments", canRead: true }] },
  course1: { name: "Rôle course un", modules: [{ moduleKey: "classes", canRead: true }] },
  course2: { name: "Rôle course deux", modules: [{ moduleKey: "classes", canRead: true }] },
  course3: { name: "Rôle course trois", modules: [{ moduleKey: "classes", canRead: true }] },
  course4: { name: "Rôle verrou", modules: [{ moduleKey: "classes", canRead: true }] },
  // RL01-15 — homonymes : même clé canonique « delegue_de_classe » par le nom de delegueBis.
  delegue: { name: "Délégué de classe", modules: [] },
  delegueBis: { name: "Délégué-de-Classe", code: "delegue_classe_bis", modules: [] },
  delegueAdjoint: { name: "Délégué de classe adjoint", modules: [] },
  // RL01-16 — affectations logiques : deux clés équivalentes actives pour un même compte.
  doublon: { name: "Agent double", modules: [{ moduleKey: "classes", canRead: true }] },
};
/** Grants d'une clé absente du catalogue (rôle inconnu / supprimé). */
const PHANTOM_ROLE_KEY = "ROLE_FANTOME";

/** Clé de user_roles telle que l'API l'écrit (assertGrantableRole → toRoleKey(role_name)). */
const userRoleKey = (role) => toRoleKey(role.name);
/** Clé des grants telle que la matrice RBAC l'écrit (UPPER(role_code)). */
const grantRoleKey = (role) => (role.code ?? normalizeRoleCode(role.name)).toUpperCase();

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
      [role.code ?? normalizeRoleCode(role.name), role.name, role.scope ?? "school"],
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

  await pool.query(
    `INSERT INTO role_module_permissions (role_key, scope_type, module_key, can_read, status)
     VALUES ($1, 'global', 'payments', TRUE, 'active')`,
    [PHANTOM_ROLE_KEY],
  );

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
  // Enseignant + rôles hors catalogue utilisable (inconnu, ambigu, hors portée) : ces
  // rôles ne doivent rien ajouter aux droits de l'Enseignant.
  await withRoles("teacherUnknown", schoolA.id, [[schoolA.id, "TEACHER"], [schoolA.id, PHANTOM_ROLE_KEY]]);
  await withRoles("teacherAmbiguous", schoolA.id, [[schoolA.id, "TEACHER"], [schoolA.id, "DOUBLE"]]);
  await withRoles("teacherPlatform", schoolA.id, [[schoolA.id, "TEACHER"], [schoolA.id, userRoleKey(ROLES.plateforme)]]);
  await withRoles("parentA", schoolA.id, [[schoolA.id, "PARENT"]]);
  for (const key of ["race1", "race2", "race3"]) await withRoles(key, schoolA.id, [[schoolA.id, "TEACHER"]]);
  // RL01-15 — affectations homonymes sur deux établissements + plateforme + révoquée.
  await withRoles("delegueA1", schoolA.id, [[schoolA.id, "DÉLÉGUÉ_DE_CLASSE"]], { primaryRole: null });
  await withRoles("delegueA2", schoolA.id, [[schoolA.id, "delegue_de_classe"]], { primaryRole: null });
  await withRoles("delegueB1", schoolB.id, [[schoolB.id, "DELEGUE_DE_CLASSE"]], { primaryRole: null });
  await withRoles("delegueRevoked", schoolB.id, [[schoolB.id, "DÉLÉGUÉ_DE_CLASSE"]], { primaryRole: null });
  await pool.query(
    `UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`,
    [users.delegueRevoked],
  );
  await withRoles("delegueAdjointA", schoolA.id, [[schoolA.id, "DÉLÉGUÉ_DE_CLASSE_ADJOINT"]], { primaryRole: null });
  await withRoles("delegueBisA", schoolA.id, [[schoolA.id, "DELEGUE_CLASSE_BIS"]], { primaryRole: null });
  await withRoles("deleguePlatform", null, [[null, "DÉLÉGUÉ_DE_CLASSE"]], { primaryRole: null });
  // RL01-16 — clé API (toRoleKey(role_name)) + clé backfill (role_code) actives ensemble.
  await withRoles("dupA", schoolA.id, [[schoolA.id, userRoleKey(ROLES.doublon)], [schoolA.id, normalizeRoleCode(ROLES.doublon.name)]], { primaryRole: null });
  await withRoles("dupB", schoolB.id, [[schoolB.id, userRoleKey(ROLES.doublon)]], { primaryRole: null });
  await withRoles("dupPlatform", null, [[null, userRoleKey(ROLES.doublon)], [null, normalizeRoleCode(ROLES.doublon.name)]], { primaryRole: null });
  await withRoles("adminB", schoolB.id, [[schoolB.id, "SCHOOL_ADMIN"]]);
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

    // RL01-14 — non-élargissement des rôles système : instantané comparable entre
    // develop et cette branche (RBAC_LOGIN_01_SNAPSHOT=<fichier>), puis invariants.
    const ROUTES = {
      classes: "/classes",
      students: "/students?page=1&limit=5",
      teachers: "/teachers?page=1&limit=5",
      countries: "/backoffice/countries",
      schools: "/backoffice/schools",
      users: "/backoffice/users?page=1&limit=5",
      rbac: "/backoffice/rbac/catalog",
    };
    const systemSnapshot = {};
    for (const [key, schoolCode] of [
      ["superadmin", null],
      ["pays", null],
      ["adminA", schoolA.login_code],
      ["teacherA", schoolA.login_code],
      ["parentA", schoolA.login_code],
    ]) {
      const login = await webLogin(key, schoolCode);
      const entry = {
        login: login.status,
        role: login.data?.user?.role ?? null,
        webAccessProfile: login.data?.user?.webAccessProfile ?? null,
        privilegeLevel: login.data?.dashboard?.privilegeLevel ?? null,
        menus: login.data?.menus ?? null,
        permissions: [...(login.data?.permissions ?? [])].sort(),
        routes: {},
      };
      if (login.status === 200) {
        for (const [name, route] of Object.entries(ROUTES)) {
          entry.routes[name] = (await request(route, { token: login.data.accessToken })).status;
        }
        const effective = await request("/auth/effective-permissions", { token: login.data.accessToken });
        entry.effectiveRoleKeys = effective.data?.roleKeys ?? null;
      }
      systemSnapshot[key] = entry;
      check(entry.webAccessProfile === null, `RL01-14 ${key} : aucun profil de rôle personnalisé`);
    }
    if (process.env.RBAC_LOGIN_01_SNAPSHOT) {
      require("fs").writeFileSync(process.env.RBAC_LOGIN_01_SNAPSHOT, `${JSON.stringify(systemSnapshot, null, 2)}\n`);
    }
    check(!systemSnapshot.teacherA.permissions.includes("ALL_PRIVILEGES"), "RL01-14 Enseignant sans ALL_PRIVILEGES");
    check(!systemSnapshot.parentA.permissions.includes("ALL_PRIVILEGES"), "RL01-14 Parent sans ALL_PRIVILEGES");
    check(!systemSnapshot.pays.permissions.includes("ALL_PRIVILEGES"), "RL01-14 Admin Pays sans ALL_PRIVILEGES");
    check(systemSnapshot.superadmin.routes.teachers === 403, "RL01-14 Superadmin sans données scolaires");

    // Jeton falsifié : la portée de lecture personnalisée ne vient jamais d'une revendication.
    const teacherForge = await webLogin("teacherA");
    if (assertStatus(teacherForge, 200, "RL01-14 connexion Enseignant (falsification)")) {
      const [encodedHeader, encodedPayload] = String(teacherForge.data.accessToken).split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ ...claims(teacherForge.data.accessToken), customRoleReadScope: { classes: true, students: true } }),
      ).toString("base64url");
      const forgedSignature = crypto
        .createHmac("sha256", JWT_SECRET)
        .update(`${encodedHeader}.${forgedPayload}`)
        .digest("base64url");
      const forged = `${encodedHeader}.${forgedPayload}.${forgedSignature}`;
      const honestStudents = await studentsRoute(teacherForge.data.accessToken);
      const forgedStudents = await studentsRoute(forged);
      check(
        forgedStudents.status === honestStudents.status &&
          JSON.stringify(forgedStudents.data) === JSON.stringify(honestStudents.data),
        `RL01-14 revendication customRoleReadScope ignorée (élèves ${honestStudents.status} → ${forgedStudents.status})`,
      );
      const honestClasses = await classesRoute(teacherForge.data.accessToken);
      const forgedClasses = await classesRoute(forged);
      check(
        JSON.stringify(forgedClasses.data) === JSON.stringify(honestClasses.data),
        "RL01-14 revendication customRoleReadScope ignorée (classes)",
      );
    }
    ok("RL01-14 Superadmin / Admin Pays / Admin School / Enseignant / Parent : aucun élargissement, jeton falsifié sans effet");

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

    // RL01-03 — archivage : refusé (409 + audit) tant que le rôle est attribué ;
    // autorisé après retrait des affectations (sessions invalidées par le retrait).
    const auditRows = async (action, roleId) =>
      (
        await pool.query(
          `SELECT action, new_value FROM audit_logs WHERE action = $1 AND entity_id = $2 ORDER BY created_at`,
          [action, String(roleId)],
        )
      ).rows;
    const roleStatus = async (roleId) =>
      (await pool.query(`SELECT status FROM establishment_roles WHERE id = $1`, [roleId])).rows[0]?.status;
    const beforeArchive = await webLogin("archived");
    assertStatus(beforeArchive, 200, "RL01-03 connexion avant archivage");
    const superWeb = await webLogin("superadmin", null);
    assertStatus(superWeb, 200, "RL01-03 connexion Superadmin");
    const adminA = await webLogin("adminA");
    assertStatus(adminA, 200, "RL01-03 connexion Admin School");
    const archiveRole = (roleId) =>
      request(`/backoffice/rbac/roles/${roleId}/archive`, { method: "POST", token: superWeb.data.accessToken, body: {} });
    const refused = await archiveRole(ROLES.ancien.id);
    assertStatus(refused, 409, "RL01-03 archivage d'un rôle attribué refusé");
    check(await roleStatus(ROLES.ancien.id) === "active", "RL01-03 rôle toujours actif après refus");
    const refusalAudit = await auditRows("ROLE_ARCHIVE_REFUSED", ROLES.ancien.id);
    check(refusalAudit.length === 1, `RL01-03 audit du refus : ${refusalAudit.length}`);
    const refusalValue = refusalAudit[0]?.new_value ?? {};
    check(
      refusalValue.reason === "ROLE_HAS_ACTIVE_ASSIGNMENTS" && refusalValue.activeAssignments === 1,
      `RL01-03 audit du refus détaillé : ${JSON.stringify(refusalValue)}`,
    );
    check((await auditRows("ROLE_ARCHIVE", ROLES.ancien.id)).length === 0, "RL01-03 aucun audit d'archivage après refus");
    assertStatus(await classesRoute(beforeArchive.data?.accessToken), 200, "RL01-03 accès inchangé après refus");
    const revokeArchivedAssignment = await request(`/backoffice/users/${users.archived}/roles/revoke`, {
      method: "POST",
      token: adminA.data.accessToken,
      body: { role: userRoleKey(ROLES.ancien) },
    });
    assertStatus(revokeArchivedAssignment, 200, "RL01-03 retrait de l'affectation");
    assertStatus(await classesRoute(beforeArchive.data?.accessToken), 401, "RL01-03 session invalidée par le retrait");
    const archived = await archiveRole(ROLES.ancien.id);
    assertStatus(archived, 200, "RL01-03 archivage autorisé sans affectation active");
    check(await roleStatus(ROLES.ancien.id) === "archived", "RL01-03 rôle archivé");
    check((await auditRows("ROLE_ARCHIVE", ROLES.ancien.id)).length === 1, "RL01-03 audit d'archivage");
    assertStatus(await archiveRole(ROLES.ancien.id), 404, "RL01-03 double archivage");
    const regrantArchived = await request(`/backoffice/users/${users.archived}/roles/grant`, {
      method: "POST",
      token: adminA.data.accessToken,
      body: { role: ROLES.ancien.name },
    });
    assertStatus(regrantArchived, [404, 409], "RL01-03 octroi d'un rôle archivé refusé");
    const afterArchive = await webLogin("archived");
    if (afterArchive.status === 200) {
      check((afterArchive.data.permissions ?? []).length === 0, "RL01-03 aucun droit après archivage");
      assertStatus(await classesRoute(afterArchive.data.accessToken), 403, "RL01-03 aucun accès après archivage");
    } else {
      assertStatus(afterArchive, 403, "RL01-03 connexion après archivage");
    }
    ok(`RL01-03 archivage : 409 + audit si attribué ; autorisé après retrait (connexion ensuite ${afterArchive.status})`);

    // RL01-04 — rôle révoqué par l'API : sessions invalidées, nouvelle connexion refusée.
    const beforeRevoke = await webLogin("revoked");
    assertStatus(beforeRevoke, 200, "RL01-04 connexion avant révocation");
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
    // Redémarrage après archivage autorisé (RL01-03) : le contrat de migration est respecté.
    await stopChild(child);
    await startServer();
    check((await activeRoleRows(users.duplicate)).length === 0, `RL01-11 rôle recréé au redémarrage : ${JSON.stringify(await activeRoleRows(users.duplicate))}`);
    check((await activeRoleRows(users.revoked)).length === 0, `RL01-11 rôle révoqué recréé au redémarrage : ${JSON.stringify(await activeRoleRows(users.revoked))}`);
    check((await activeRoleRows(users.archived)).length === 0, `RL01-11 rôle archivé recréé au redémarrage : ${JSON.stringify(await activeRoleRows(users.archived))}`);
    check(await roleStatus(ROLES.ancien.id) === "archived", "RL01-11 rôle toujours archivé après redémarrage");
    const customRows = await activeRoleRows(users.custom);
    check(customRows.length === 1, `RL01-11 aucun doublon créé au démarrage : ${JSON.stringify(customRows)}`);
    const afterRestart = await webLogin("duplicate");
    if (afterRestart.status === 200) {
      assertStatus(await classesRoute(afterRestart.data.accessToken), 403, "RL01-11 aucun droit après redémarrage");
    } else {
      assertStatus(afterRestart, 403, "RL01-11 connexion après redémarrage");
    }
    assertStatus(await webLogin("custom"), 200, "RL01-11 rôle actif conservé après redémarrage");
    ok("RL01-11 clés équivalentes et archivage : démarrage réussi, aucun rôle recréé");

    // RL01-12 — rôles inconnu, ambigu ou hors portée : aucun droit ajouté (fail-closed).
    const teacherRef = await webLogin("teacherA");
    assertStatus(teacherRef, 200, "RL01-12 Enseignant de référence");
    const refPerms = JSON.stringify([...(teacherRef.data.permissions ?? [])].sort());
    for (const key of ["teacherUnknown", "teacherAmbiguous", "teacherPlatform"]) {
      const login = await webLogin(key);
      assertStatus(login, 200, `RL01-12 connexion ${key}`);
      const perms = JSON.stringify([...(login.data?.permissions ?? [])].sort());
      check(perms === refPerms, `RL01-12 ${key} : droits identiques à l'Enseignant (${perms} ≠ ${refPerms})`);
      check(login.data?.user?.webAccessProfile === undefined, `RL01-12 ${key} sans profil personnalisé`);
      const effective = await request("/auth/effective-permissions", { token: login.data?.accessToken });
      const effectiveKeys = effective.data?.roleKeys ?? [];
      check(
        JSON.stringify(effectiveKeys) === JSON.stringify(["TEACHER"]),
        `RL01-12 ${key} : rôles effectifs ${JSON.stringify(effectiveKeys)}`,
      );
    }
    ok("RL01-12 rôles inconnu / ambigu / hors portée : retirés des droits effectifs");

    // RL01-13 — octroi et archivage concurrents : jamais un rôle archivé encore attribué.
    const raceOutcomes = [];
    for (const [index, role] of [ROLES.course1, ROLES.course2, ROLES.course3].entries()) {
      const userId = users[`race${index + 1}`];
      const [grantResult, archiveResult] = await Promise.all([
        request(`/backoffice/users/${userId}/roles/grant`, {
          method: "POST",
          token: adminAgain.data.accessToken,
          body: { role: role.name },
        }),
        archiveRole(role.id),
      ]);
      const status = await roleStatus(role.id);
      const active = (await activeRoleRows(userId)).filter((key) => key !== "TEACHER");
      check(!(status === "archived" && active.length > 0), `RL01-13 rôle archivé encore attribué (${role.name})`);
      check(
        (grantResult.status === 200) !== (archiveResult.status === 200),
        `RL01-13 exactement une opération gagne (octroi ${grantResult.status}, archivage ${archiveResult.status})`,
      );
      raceOutcomes.push(`${grantResult.status}/${archiveResult.status}`);
    }
    // Ordre inverse, déterministe : un octroi en cours (verrou FOR SHARE posé comme
    // lockCatalogRoleForGrant) bloque l'archivage, qui voit ensuite l'affectation validée.
    const lockClient = await pool.connect();
    let lockedArchive;
    let settledEarly = false;
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        `SELECT 1 FROM establishment_roles
         WHERE somafrik_normalize_role_code(role_code) = somafrik_normalize_role_code($1)
            OR somafrik_normalize_role_code(role_name) = somafrik_normalize_role_code($1)
         FOR SHARE`,
        [userRoleKey(ROLES.course4)],
      );
      await lockClient.query(
        `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`,
        [users.race1, schoolA.id, userRoleKey(ROLES.course4)],
      );
      const pending = archiveRole(ROLES.course4.id).then((result) => {
        settledEarly = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      check(!settledEarly, "RL01-13 l'archivage attend la fin de l'octroi en cours");
      await lockClient.query("COMMIT");
      lockedArchive = await pending;
    } finally {
      await lockClient.query("ROLLBACK").catch(() => {});
      lockClient.release();
    }
    assertStatus(lockedArchive, 409, "RL01-13 archivage après octroi validé");
    check(await roleStatus(ROLES.course4.id) === "active", "RL01-13 rôle resté actif");
    ok(`RL01-13 octroi / archivage concurrents sérialisés (octroi/archivage : ${raceOutcomes.join(", ")} ; verrou : archivage ${lockedArchive.status} après attente)`);

    // RL01-15 — garde d'archivage : comptage exact dans PostgreSQL (clé canonique),
    // plusieurs établissements, homonymes ; index et plan ; fail-closed.
    const {
      createEstablishmentRolesPgStore,
      COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL,
    } = require("../db/establishmentRolesPgStore");
    const directStore = (db) =>
      createEstablishmentRolesPgStore({
        query: (sql, params) => db.query(sql, params),
        one: async (sql, params) => (await db.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await db.query(sql, params)).rows,
      });
    const roleRef = (role) => ({ roleCode: role.code ?? normalizeRoleCode(role.name), roleName: role.name });
    const expectedCounts = [
      // A1 + A2 (A), B1 (B), plateforme ; révoquée et « adjoint » exclues.
      [ROLES.delegue, { activeAssignments: 4, schools: 2, platformAssignments: 1, activeRows: 4 }],
      // Son role_name se normalise en « delegue_de_classe » : il couvre aussi ces clés (prudent).
      [ROLES.delegueBis, { activeAssignments: 5, schools: 2, platformAssignments: 1, activeRows: 5 }],
      [ROLES.delegueAdjoint, { activeAssignments: 1, schools: 1, platformAssignments: 0, activeRows: 1 }],
    ];
    for (const [role, expected] of expectedCounts) {
      const counted = await directStore(pool).countActiveAssignmentsForRole(roleRef(role));
      check(
        JSON.stringify(counted) === JSON.stringify(expected),
        `RL01-15 comptage ${role.name} : ${JSON.stringify(counted)} ≠ ${JSON.stringify(expected)}`,
      );
    }
    const refusedDelegue = await archiveRole(ROLES.delegue.id);
    assertStatus(refusedDelegue, 409, "RL01-15 archivage d'un rôle attribué dans deux établissements");
    const delegueAudit = (await auditRows("ROLE_ARCHIVE_REFUSED", ROLES.delegue.id))[0]?.new_value ?? {};
    check(
      delegueAudit.activeAssignments === 4 && delegueAudit.schools === 2,
      `RL01-15 audit du refus exact : ${JSON.stringify(delegueAudit)}`,
    );
    check(await roleStatus(ROLES.delegue.id) === "active", "RL01-15 rôle resté actif");

    // Index et plan : volume réaliste (3 000 affectations actives d'un autre rôle).
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, status, must_change_password)
       SELECT $1, 'RL01-BULK-' || g, 'Bulk', 'U' || g, 'active', FALSE FROM generate_series(1, 3000) AS g`,
      [schoolA.id],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       SELECT u.id, u.school_id, 'TEACHER', 'active' FROM users u WHERE u.user_code LIKE 'RL01-BULK-%'`,
    );
    await pool.query("ANALYZE user_roles");
    const indexDef = (
      await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_user_roles_active_normalized_key'`)
    ).rows[0]?.indexdef ?? "";
    check(
      /somafrik_normalize_role_code\(role_key\)/.test(indexDef) && /WHERE/.test(indexDef),
      `RL01-15 index partiel présent : ${indexDef}`,
    );
    const planFor = async (forceIndex) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (forceIndex) await client.query("SET LOCAL enable_seqscan = off");
        const explained = await client.query(`EXPLAIN (FORMAT JSON) ${COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL}`, [
          "delegue_de_classe",
          "Délégué de classe",
        ]);
        return JSON.stringify(explained.rows[0]["QUERY PLAN"]);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    };
    const naturalPlan = await planFor(false);
    const usesIndex = naturalPlan.includes("idx_user_roles_active_normalized_key");
    check(usesIndex, `RL01-15 plan naturel sur l'index (3 000+ lignes) : ${naturalPlan.slice(0, 400)}`);
    check(!/"Node Type":"Seq Scan"/.test(naturalPlan), "RL01-15 aucun parcours séquentiel de user_roles");
    const afterBulk = await directStore(pool).countActiveAssignmentsForRole(roleRef(ROLES.delegue));
    check(afterBulk.activeAssignments === 4, `RL01-15 comptage inchangé après volume : ${JSON.stringify(afterBulk)}`);

    // Fail-closed : table ou fonction indisponible → 503, jamais « 0 » (transaction annulée).
    const failClosed = async (sabotage, label) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sabotage);
        let error = null;
        try {
          await directStore(client).countActiveAssignmentsForRole(roleRef(ROLES.delegueAdjoint));
        } catch (caught) {
          error = caught;
        }
        check(
          error?.statusCode === 503 && error?.code === "ROLE_ASSIGNMENTS_UNAVAILABLE",
          `RL01-15 fail-closed (${label}) : ${error ? `${error.statusCode} ${error.code}` : "aucune erreur"}`,
        );
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    };
    await failClosed("ALTER TABLE user_roles RENAME TO user_roles_rl01_hidden", "table user_roles");
    await failClosed(
      "ALTER FUNCTION somafrik_normalize_role_code(text) RENAME TO somafrik_normalize_role_code_rl01_hidden",
      "fonction de normalisation",
    );
    check(
      (await directStore(pool).countActiveAssignmentsForRole(roleRef(ROLES.delegueAdjoint))).activeAssignments === 1,
      "RL01-15 retour à la normale après incident",
    );
    // RL01-16 — affectations LOGIQUES distinctes (user_id, school_id), pas lignes brutes.
    const doublonRef = roleRef(ROLES.doublon);
    const countDoublon = () => directStore(pool).countActiveAssignmentsForRole(doublonRef);
    const sameCounts = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
    const initial = await countDoublon();
    check(
      sameCounts(initial, { activeAssignments: 3, schools: 2, platformAssignments: 1, activeRows: 5 }),
      `RL01-16 comptage initial (dupA×2 en A, dupB en B, plateforme×2) : ${JSON.stringify(initial)}`,
    );
    const dupKeysA = await activeRoleRows(users.dupA);
    check(dupKeysA.length === 2, `RL01-16 deux clés équivalentes actives pour dupA : ${JSON.stringify(dupKeysA)}`);
    const dupSession = await webLogin("dupA");
    assertStatus(dupSession, 200, "RL01-16 connexion dupA (clés équivalentes)");
    check(
      JSON.stringify(dupSession.data?.permissions ?? []) === JSON.stringify(["Classes:READ"]),
      `RL01-16 droits dupA dédoublonnés : ${JSON.stringify(dupSession.data?.permissions)}`,
    );
    const refused1 = await archiveRole(ROLES.doublon.id);
    assertStatus(refused1, 409, "RL01-16 archivage refusé (3 affectations logiques)");
    check(
      sameCounts(refused1.data?.details, { activeAssignments: 3, schools: 2, platformAssignments: 1 }),
      `RL01-16 détails du 409 : ${JSON.stringify(refused1.data?.details)}`,
    );
    const doublonAudits = async () =>
      (await auditRows("ROLE_ARCHIVE_REFUSED", ROLES.doublon.id)).map((row) => row.new_value ?? {});
    const audit1 = (await doublonAudits())[0] ?? {};
    check(
      audit1.activeAssignments === 3 && audit1.schools === 2 && audit1.platformAssignments === 1 && audit1.activeRows === 5,
      `RL01-16 audit du refus (logiques 3, lignes 5) : ${JSON.stringify(audit1)}`,
    );
    // Retrait par l'API de dupA : les deux clés équivalentes tombent, une seule affectation logique en moins.
    const adminBSession = await webLogin("adminB", schoolB.login_code);
    assertStatus(adminBSession, 200, "RL01-16 connexion Admin School B");
    const revokeDupA = await request(`/backoffice/users/${users.dupA}/roles/revoke`, {
      method: "POST",
      token: adminAgain.data.accessToken,
      body: { role: userRoleKey(ROLES.doublon) },
    });
    assertStatus(revokeDupA, 200, "RL01-16 retrait dupA");
    check((await activeRoleRows(users.dupA)).length === 0, `RL01-16 clés de dupA toutes révoquées : ${JSON.stringify(await activeRoleRows(users.dupA))}`);
    assertStatus(await classesRoute(dupSession.data?.accessToken), 401, "RL01-16 session dupA invalidée");
    const afterDupA = await countDoublon();
    check(
      sameCounts(afterDupA, { activeAssignments: 2, schools: 1, platformAssignments: 1, activeRows: 3 }),
      `RL01-16 comptage après retrait dupA : ${JSON.stringify(afterDupA)}`,
    );
    const refused2 = await archiveRole(ROLES.doublon.id);
    assertStatus(refused2, 409, "RL01-16 archivage toujours refusé (2 restantes)");
    const audit2 = (await doublonAudits())[1] ?? {};
    check(audit2.activeAssignments === 2 && audit2.activeRows === 3, `RL01-16 second audit : ${JSON.stringify(audit2)}`);
    const revokeDupB = await request(`/backoffice/users/${users.dupB}/roles/revoke`, {
      method: "POST",
      token: adminBSession.data.accessToken,
      body: { role: userRoleKey(ROLES.doublon) },
    });
    assertStatus(revokeDupB, 200, "RL01-16 retrait dupB (Admin School B)");
    // Affectation plateforme d'un rôle d'établissement : non attribuable par l'API (donnée héritée) ;
    // retirée comme une opération d'exploitation, puis comptée à 0.
    await pool.query(
      `UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND status = 'active'`,
      [users.dupPlatform],
    );
    const afterAll = await countDoublon();
    check(
      sameCounts(afterAll, { activeAssignments: 0, schools: 0, platformAssignments: 0, activeRows: 0 }),
      `RL01-16 comptage après tous les retraits : ${JSON.stringify(afterAll)}`,
    );
    const archivedDoublon = await archiveRole(ROLES.doublon.id);
    assertStatus(archivedDoublon, 200, "RL01-16 archivage autorisé à 0 affectation");
    check((await auditRows("ROLE_ARCHIVE", ROLES.doublon.id)).length === 1, "RL01-16 audit d'archivage");
    // Redémarrage : démarrage réussi, rien n'est recréé, rôle toujours archivé.
    await stopChild(child);
    await startServer();
    for (const key of ["dupA", "dupB", "dupPlatform"]) {
      check((await activeRoleRows(users[key])).length === 0, `RL01-16 ${key} : aucun rôle recréé au redémarrage`);
    }
    check(await roleStatus(ROLES.doublon.id) === "archived", "RL01-16 rôle toujours archivé après redémarrage");
    check(
      sameCounts(await countDoublon(), { activeAssignments: 0, schools: 0, platformAssignments: 0, activeRows: 0 }),
      "RL01-16 comptage nul après redémarrage",
    );
    const dupAfterRestart = await webLogin("dupA");
    if (dupAfterRestart.status === 200) {
      check((dupAfterRestart.data?.permissions ?? []).length === 0, "RL01-16 dupA sans droit après redémarrage");
    } else {
      assertStatus(dupAfterRestart, 403, "RL01-16 connexion dupA après redémarrage");
    }
    ok("RL01-16 affectations logiques (user_id, school_id) : 3 / 5 lignes → 409 + audit exacts, retraits, archivage, redémarrage");
    ok(`RL01-15 comptage PostgreSQL exact (4 / 2 établissements), index ${usesIndex ? "utilisé" : "NON utilisé"}, fail-closed 503`);

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
