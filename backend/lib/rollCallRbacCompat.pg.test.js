"use strict";

/**
 * NFC-ROLES-ACCESS-01 — compatibilité du droit dédié « Appel NFC/QR » (module roll_call), PostgreSQL réel.
 *
 * 1. Copie UNIQUE : chaque grant Présences en écriture d'un rôle qui avait l'appel (TEACHER,
 *    SCHOOL_ADMIN, PROVISEUR, PRINCIPAL, PREFET_ETUDES, SECRETARY) donne le droit d'appel à
 *    l'identique (même rôle, même portée globale / pays / établissement).
 * 2. Aucun nouveau titulaire : rôle sans écriture Présences, ou autre rôle (surveillant) → rien.
 * 3. Un retrait (archivage ou décochage) n'est JAMAIS annulé par un redémarrage ; rejouable sans doublon.
 * 4. Rôle sans aucun grant (repli historique) : droit d'appel dérivé de SES présences, rôle par rôle.
 */

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { backfillRollCallGrantsFromAttendance, ROLL_CALL_PERMISSION } = require("./rollCallRbacCompat");
const { resolveEffectivePermissionsForPrincipal, ensureFunctionalRbacBootstrap } = require("./functionalRbacService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_roll_call_rbac_compat_it";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function main() {
  if (!DATABASE_URL) {
    console.log("rollCallRbacCompat.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE])).rowCount) {
      await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
    }
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  await reset.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await reset.end();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(url);
  const pool = new Pool({ connectionString: url });
  try {
    await repo.init();
    const country = (await pool.query("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Testland','TL','+000','XOF') RETURNING id")).rows[0].id;
    await pool.query("ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL");
    const school = (await pool.query(
      "INSERT INTO schools (country_id, school_code, name, status) VALUES ($1,'TL-2026-0001','Ecole compat','active') RETURNING id", [country],
    )).rows[0].id;
    // État « avant » : uniquement des grants Présences (aucune ligne roll_call).
    await pool.query("UPDATE role_module_permissions SET status = 'archived' WHERE module_key = 'roll_call'");
    await pool.query("DELETE FROM role_module_permissions WHERE module_key IN ('roll_call', 'attendance')");
    const put = (roleKey, scope, flags, moduleKey = "attendance") => pool.query(
      `INSERT INTO role_module_permissions (role_key, scope_type, country_id, school_id, module_key, can_create, can_read, can_update, can_delete, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, FALSE, 'compat-test')`,
      [roleKey, scope, scope === "country" ? country : null, scope === "school" ? school : null, moduleKey, flags.create, flags.update],
    );
    await put("TEACHER", "global", { create: true, update: true });
    await put("SECRETARY", "school", { create: false, update: true }); // override établissement
    await put("PREFET_ETUDES", "country", { create: true, update: false });
    await put("PRINCIPAL", "global", { create: false, update: false }); // lecture seule
    await put("SUPERVISOR", "global", { create: true, update: true }); // n'avait pas l'appel
    await put("PROVISEUR", "global", { create: true, update: true });
    await put("PROVISEUR", "global", { create: false, update: false }, "roll_call"); // déjà configuré (retiré)
    await pool.query("UPDATE role_module_permissions SET status = 'archived' WHERE role_key = 'PROVISEUR' AND module_key = 'roll_call'");

    const created = await backfillRollCallGrantsFromAttendance(repo);
    const rows = async () => (await pool.query(
      `SELECT upper(role_key) AS role, scope_type, country_id::text AS c, school_id::text AS s, can_create, can_read, can_update, status
         FROM role_module_permissions WHERE module_key = 'roll_call' ORDER BY role, scope_type, status`,
    )).rows;
    const after = await rows();
    assert.equal(created, 3, "TEACHER, SECRETARY, PREFET_ETUDES");
    const active = after.filter((r) => r.status === "active");
    assert.deepEqual(
      active.map((r) => [r.role, r.scope_type, r.c, r.s, r.can_create, r.can_read, r.can_update]),
      [
        ["PREFET_ETUDES", "country", country, null, true, true, false],
        ["SECRETARY", "school", null, school, true, true, false],
        ["TEACHER", "global", null, null, true, true, false],
      ],
      "copie à l'identique de la portée ; ni surveillant, ni principal en lecture seule, ni proviseur déjà configuré",
    );
    // Rejouable : aucun doublon.
    assert.equal(await backfillRollCallGrantsFromAttendance(repo), 0);
    // Retrait par la matrice (archivage) : jamais rétabli, même après un démarrage complet.
    await pool.query("UPDATE role_module_permissions SET status = 'archived' WHERE module_key = 'roll_call' AND role_key = 'TEACHER'");
    await ensureFunctionalRbacBootstrap(repo);
    assert.equal(await backfillRollCallGrantsFromAttendance(repo), 0);
    assert.equal((await rows()).some((r) => r.role === "TEACHER" && r.status === "active"), false, "retrait respecté au redémarrage");
    // Décochage (ligne active, droits à faux) : jamais réécrit non plus.
    await pool.query("UPDATE role_module_permissions SET can_create = FALSE WHERE module_key = 'roll_call' AND role_key = 'SECRETARY'");
    await ensureFunctionalRbacBootstrap(repo);
    assert.equal((await rows()).find((r) => r.role === "SECRETARY" && r.status === "active").can_create, false);

    // Permissions effectives : le droit d'appel suit le grant dédié, pas les présences.
    const perms = async (roleKey) => (await resolveEffectivePermissionsForPrincipal(repo, { roleKeys: [roleKey], schoolCode: "TL-2026-0001" })).permissions;
    assert.ok((await perms("PREFET_ETUDES")).includes(ROLL_CALL_PERMISSION), "préfet : override pays copié");
    assert.ok(!(await perms("TEACHER")).includes(ROLL_CALL_PERMISSION), "enseignant : droit retiré, présences conservées");
    assert.ok((await perms("TEACHER")).includes("Présences:CREATE"), "droits Présences inchangés");
    assert.ok(!(await perms("SUPERVISOR")).includes(ROLL_CALL_PERMISSION), "surveillant : jamais accordé automatiquement");

    // Repli historique (rôle sans AUCUN grant) : dérivé de SES présences, rôle par rôle.
    await pool.query("DELETE FROM role_module_permissions WHERE upper(role_key) IN ('ACCOUNTANT', 'SCHOOL_ADMIN')");
    const accountant = await perms("ACCOUNTANT");
    assert.ok(!accountant.includes(ROLL_CALL_PERMISSION), "comptable sans grant : jamais dérivé");
    const schoolAdmin = await perms("SCHOOL_ADMIN");
    assert.equal(
      schoolAdmin.includes(ROLL_CALL_PERMISSION),
      schoolAdmin.includes("Présences:CREATE") || schoolAdmin.includes("Présences:UPDATE"),
      "admin établissement sans grant : droit d'appel = écriture Présences de son rôle historique",
    );
    console.log("rollCallRbacCompat.pg.test.js OK");
  } finally {
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
