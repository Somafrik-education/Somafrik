"use strict";

/**
 * GP-005 — leftover JWT ≠ login_code du même tenant.
 * L'autorité Finance est membership UUID → schools.login_code, pas le JWT leftover.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { FINANCE_ERROR } = require("./financeManagement");
const { createTxAdapter } = require("../db/txAdapter");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const FINANCE_IT_DATABASE = String(process.env.SOMAFRIK_FINANCE_GP005_IT_DATABASE ?? "somafrik_finance_gp005_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const LEFTOVER = "CD-2026-0001";
const LOGIN_CODE = "CD-LAC-26-001";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) {
      await pool.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  return {
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    createTxScope(tx) {
      return {
        query: (sql, params) => tx.query(sql, params),
        one: (sql, params) => tx.one(sql, params),
        all: (sql, params) => tx.all(sql, params),
      };
    },
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("financeMembershipScope.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, FINANCE_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(FINANCE_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, $2, NULL, 'Lycée Lac', 'active') RETURNING id, school_code, login_code`,
      [country.rows[0].id, LEFTOVER],
    );
    assert.equal(school.rows[0].school_code, LEFTOVER);
    assert.equal(school.rows[0].login_code, null);

    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active')`,
      [school.rows[0].id, year.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-GP005', 'Compta', 'Lac', 'gp005@somafrik.test', 'ACCOUNTANT', 'active')
       RETURNING id`,
      [school.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createFinancePgStore(repo);
    const leftoverJwt = {
      role: "Comptable",
      schoolCode: LEFTOVER,
      sub: user.rows[0].id,
      firstName: "Compta",
      lastName: "Lac",
      permissions: ["Paiements:UPDATE", "Frais & tarifs:CREATE", "Frais & tarifs:UPDATE"],
    };
    const leftoverOnly = {
      role: "Comptable",
      schoolCode: LEFTOVER,
      firstName: "Orphelin",
      lastName: "Jwt",
    };

    const { attachFinanceMembershipScope, resolveFinanceSchoolScope } = require("./financeSchoolScope");
    const attachedEmpty = await attachFinanceMembershipScope(leftoverJwt, (sql, params) => repo.one(sql, params));
    assert.equal(attachedEmpty.financeLoginCode, "", "P0-4: login_code NULL ⇒ financeLoginCode vide");
    assert.notEqual(attachedEmpty.financeLoginCode, LEFTOVER, "P0-4: leftover jamais promu");
    assert.equal(resolveFinanceSchoolScope(attachedEmpty).mode, "none");

    const emptyGrids = await store.listFinanceFeeGrids(leftoverJwt);
    assert.equal(emptyGrids.length, 0, "P0-4: aucune grille si login_code manque");
    const emptyCatalog = await store.getFinanceCatalog(leftoverJwt);
    assert.equal(emptyCatalog.currency, "", "P0-4: aucun catalogue si login_code manque");
    await assert.rejects(
      () =>
        store.upsertFinanceFeeGrid(
          {
            className: "6ème A",
            academicYear: "2025-2026",
            currency: "CDF",
            status: "Active",
            items: [{ feeType: "Inscription", label: "Inscription", amount: 1, status: "Actif" }],
          },
          leftoverJwt,
        ),
      (error) => error.code === FINANCE_ERROR.TENANT_MISMATCH || error.statusCode === 403,
      "P0-4: aucune écriture si login_code manque",
    );

    const scopeSrc = fs.readFileSync(path.join(__dirname, "financeSchoolScope.js"), "utf8");
    const predFn = scopeSrc.slice(
      scopeSrc.indexOf("function sqlSchoolPredicate"),
      scopeSrc.indexOf("function countryIsoFromRecord"),
    );
    assert.doesNotMatch(predFn, /school_code/, "prédicat de scope PG sans fallback leftover");
    assert.doesNotMatch(
      scopeSrc.slice(
        scopeSrc.indexOf("async function attachFinanceMembershipScope"),
        scopeSrc.indexOf("function attachFinanceFixtureScope"),
      ),
      /coalesce\(nullif\(btrim\(s\.login_code\)/,
      "attach n'émet pas leftover via coalesce",
    );
    const pgStoreSrc = fs.readFileSync(path.join(__dirname, "../db/financePgStore.js"), "utf8");
    const getSchoolFn = pgStoreSrc.slice(pgStoreSrc.indexOf("async getSchoolByCode"), pgStoreSrc.indexOf("async mapSchoolRow"));
    assert.doesNotMatch(getSchoolFn, /school_code/, "getSchoolByCode Finance = login_code only");
    const resolveWriteFn = pgStoreSrc.slice(
      pgStoreSrc.indexOf("async resolveSchoolForScopedWrite"),
      pgStoreSrc.indexOf("async findStudent"),
    );
    assert.match(resolveWriteFn, /login_code/);
    assert.doesNotMatch(resolveWriteFn, /\sOR\s/i, "Admin Pays write lookup sans OR leftover");
    assert.doesNotMatch(resolveWriteFn, /coalesce/i);
    const listClassFn = pgStoreSrc.slice(
      pgStoreSrc.indexOf("async listStudentsInClass"),
      pgStoreSrc.indexOf("async listPaymentCodes"),
    );
    assert.doesNotMatch(listClassFn, /OR upper\(btrim\(s\.school_code\)\)/);

    await pool.query(`UPDATE schools SET login_code = $2 WHERE id = $1`, [school.rows[0].id, LOGIN_CODE]);
    const dual = await pool.query(`SELECT school_code, login_code FROM schools WHERE id = $1`, [school.rows[0].id]);
    assert.equal(dual.rows[0].school_code, LEFTOVER);
    assert.equal(dual.rows[0].login_code, LOGIN_CODE);
    assert.notEqual(dual.rows[0].school_code, dual.rows[0].login_code);

    const grid = await store.upsertFinanceFeeGrid(
      {
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 10_000, dueDate: "2026-01-01", status: "Actif" }],
      },
      leftoverJwt,
    );
    assert.equal(grid.schoolCode, LOGIN_CODE, "projection grille = login_code, pas leftover");

    const gridsMembership = await store.listFinanceFeeGrids(leftoverJwt);
    assert.equal(gridsMembership.length, 1, "membership UUID voit les grilles du tenant");
    assert.equal(gridsMembership[0].schoolCode, LOGIN_CODE);

    const gridsLeftoverOnly = await store.listFinanceFeeGrids(leftoverOnly);
    assert.equal(gridsLeftoverOnly.length, 0, "leftover JWT n'est pas l'autorité Finance");

    const catalogMembership = await store.getFinanceCatalog(leftoverJwt);
    assert.equal(catalogMembership.currency, "CDF");
    const catalogLeftoverOnly = await store.getFinanceCatalog(leftoverOnly);
    assert.equal(catalogLeftoverOnly.currency, "", "catalogue leftover-only fail-closed");

    await assert.rejects(
      () =>
        store.upsertFinanceFeeGrid(
          {
            className: "6ème B",
            academicYear: "2025-2026",
            currency: "CDF",
            status: "Active",
            items: [{ feeType: "Inscription", label: "Inscription", amount: 1, status: "Actif" }],
          },
          leftoverOnly,
        ),
      (error) => error.code === FINANCE_ERROR.TENANT_MISMATCH || error.statusCode === 403,
    );

    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6AP', '6ème AP', 'active')`,
      [school.rows[0].id, year.rows[0].id],
    );
    const adminPaysCd = {
      role: "Admin Pays",
      countryCode: "CD",
      firstName: "Admin",
      lastName: "Pays",
      permissions: ["Frais & tarifs:CREATE", "Frais & tarifs:UPDATE"],
    };
    const countryGrid = await store.upsertFinanceFeeGrid(
      {
        schoolCode: LEFTOVER,
        className: "6ème AP",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Scolarité", label: "Scolarité", amount: 5_000, dueDate: "2026-02-01", status: "Actif" }],
      },
      adminPaysCd,
    );
    assert.equal(countryGrid.schoolCode, LOGIN_CODE, "Admin Pays write émet login_code");
    assert.notEqual(countryGrid.schoolCode, LEFTOVER);

    const biCountry = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'BI-2026-0001', 'BI-LAC-26-001', 'Lycée Bujumbura', 'active')`,
      [biCountry.rows[0].id],
    );
    const gridsBeforeBi = await pool.query(`SELECT count(*)::int AS c FROM fee_grids`);
    await assert.rejects(
      () =>
        store.upsertFinanceFeeGrid(
          {
            schoolCode: "BI-LAC-26-001",
            className: "6ème A",
            academicYear: "2025-2026",
            currency: "BIF",
            status: "Active",
            items: [{ feeType: "Inscription", label: "Inscription", amount: 1, status: "Actif" }],
          },
          adminPaysCd,
        ),
      (error) =>
        error.code === FINANCE_ERROR.TENANT_MISMATCH || error.statusCode === 403 || error.statusCode === 404,
      "Admin Pays CD ne peut pas écrire école BI",
    );
    const gridsAfterBi = await pool.query(`SELECT count(*)::int AS c FROM fee_grids`);
    assert.equal(gridsAfterBi.rows[0].c, gridsBeforeBi.rows[0].c, "aucune mutation école BI");

    await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'CD-NULL-WRITE', NULL, 'École sans login', 'active')`,
      [country.rows[0].id],
    );
    await assert.rejects(
      () =>
        store.upsertFinanceFeeGrid(
          {
            schoolCode: "CD-NULL-WRITE",
            className: "6ème C",
            academicYear: "2025-2026",
            currency: "CDF",
            status: "Active",
            items: [{ feeType: "Inscription", label: "Inscription", amount: 1, status: "Actif" }],
          },
          adminPaysCd,
        ),
      (error) =>
        error.code === FINANCE_ERROR.TENANT_MISMATCH || error.statusCode === 403 || error.statusCode === 404,
      "Admin Pays refuse école CD sans login_code",
    );

    const sqlLeftover = await pool.query(
      `SELECT count(*)::int AS c FROM fee_grids g
       JOIN schools s ON s.id = g.school_id
       WHERE s.school_code = $1`,
      [LOGIN_CODE],
    );
    assert.equal(sqlLeftover.rows[0].c, 0, "WHERE school_code = login_code → 0 ligne");

    console.log("financeMembershipScope.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
