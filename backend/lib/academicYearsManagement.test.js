"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FallbackRepository } = require("../db/fallbackRepository");
const { PostgresRepository } = require("../db/postgresRepository");

test("crée une première année scolaire courante utilisable par Classes", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  const created = await repository.createAcademicYearV2({
    schoolCode: "SCH-001",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: true,
  });
  assert.equal(created.name, "2026-2027");
  assert.equal(created.schoolCode, "SCH-001");
  assert.equal(created.isCurrent, true);
  assert.equal((await repository.getAcademicYearsV2()).length, 1);
});

test("refuse une année dupliquée dans le même établissement", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  const payload = {
    schoolCode: "SCH-001",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: true,
  };
  await repository.createAcademicYearV2(payload);
  await assert.rejects(() => repository.createAcademicYearV2(payload), (error) => error.statusCode === 409);
});

test("une nouvelle année courante désactive la précédente", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  await repository.createAcademicYearV2({ schoolCode: "SCH-001", name: "2025-2026", startDate: "2025-09-01", endDate: "2026-08-31", isCurrent: true });
  await repository.createAcademicYearV2({ schoolCode: "SCH-001", name: "2026-2027", startDate: "2026-09-01", endDate: "2027-08-31", isCurrent: true });
  const years = await repository.getAcademicYearsV2();
  assert.equal(years.filter((year) => year.isCurrent).length, 1);
  assert.equal(years.find((year) => year.isCurrent).name, "2026-2027");
});

/**
 * Hotfix — établissement créé via BackOffice JSON, absent de la table schools.
 * createAcademicYearV2 doit le matérialiser via ensureSchoolFromBackOfficeRecord.
 */
function createInjectableAcademicYearsRepository() {
  const tables = {
    schools: [],
    countries: [],
    academic_years: [],
    backoffice_state: [
      {
        state_key: "default",
        state_payload: {
          schools: [
            {
              code: "cd-2026-0099",
              name: "École Post-Purge",
              countryCode: "CD",
              status: "Actif",
              type: "Collège",
            },
          ],
        },
      },
    ],
  };
  let seq = 1;
  const nextId = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
  const eq = (left, right) => String(left ?? "") === String(right ?? "");

  const repo = Object.create(PostgresRepository.prototype);
  repo.ready = true;
  repo.cachedDataset = null;
  repo.engine = "postgresql";
  repo.tables = tables;
  repo.init = async () => {
    repo.ready = true;
  };
  repo.withTransaction = async (fn) => fn(null);

  async function execute(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    const upper = text.toUpperCase();

    if (upper.includes("FROM SCHOOLS") && upper.includes("SCHOOL_CODE")) {
      return tables.schools.filter((row) => eq(row.school_code, params[0]));
    }
    if (upper.includes("FROM COUNTRIES WHERE ISO_CODE")) {
      return tables.countries.filter((row) => eq(row.iso_code, params[0]));
    }
    if (upper.startsWith("INSERT INTO COUNTRIES")) {
      const row = {
        id: nextId(),
        name: params[0],
        iso_code: params[1],
      };
      const existing = tables.countries.find((item) => eq(item.iso_code, row.iso_code));
      if (existing) return [existing];
      tables.countries.push(row);
      return [row];
    }
    if (upper.startsWith("INSERT INTO SCHOOLS")) {
      const row = {
        id: nextId(),
        country_id: params[0],
        school_code: params[1],
        name: params[2],
        logo_url: params[3],
        address: params[4],
        city: params[5],
        phone: params[6],
        email: params[7],
        school_type: params[8],
        status: params[9],
      };
      const existing = tables.schools.find((item) => eq(item.school_code, row.school_code));
      if (existing) {
        existing.name = row.name;
        return [existing];
      }
      tables.schools.push(row);
      return [row];
    }
    if (upper.includes("FROM ACADEMIC_YEARS") && upper.includes("LOWER(BTRIM(NAME))")) {
      return tables.academic_years.filter(
        (row) =>
          eq(row.school_id, params[0]) &&
          String(row.name ?? "").trim().toLowerCase() === String(params[1] ?? "").trim().toLowerCase(),
      );
    }
    if (upper.startsWith("UPDATE ACADEMIC_YEARS SET IS_CURRENT")) {
      for (const row of tables.academic_years) {
        if (eq(row.school_id, params[0])) row.is_current = false;
      }
      return [];
    }
    if (upper.startsWith("INSERT INTO ACADEMIC_YEARS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        name: params[1],
        start_date: params[2],
        end_date: params[3],
        is_current: params[4],
        status: "open",
      };
      tables.academic_years.push(row);
      return [row];
    }
    if (upper.includes("FROM BACKOFFICE_STATE")) {
      return tables.backoffice_state
        .filter((row) => eq(row.state_key, "default"))
        .map((row) => ({ state_payload: row.state_payload }));
    }
    throw new Error(`SQL non supporté: ${text.slice(0, 160)}`);
  }

  repo.query = async (sql, params = []) => {
    const rows = await execute(sql, params);
    return { rows, rowCount: rows.length };
  };
  repo.one = async (sql, params = []) => (await execute(sql, params))[0] ?? null;
  repo.all = async (sql, params = []) => execute(sql, params);
  repo.getSchoolByCode = async (code) => {
    const normalized = String(code ?? "").trim().toUpperCase();
    return tables.schools.find((row) => eq(row.school_code, normalized)) ?? null;
  };
  repo.getBackOfficeState = async () => {
    const row = tables.backoffice_state.find((item) => eq(item.state_key, "default"));
    return row?.state_payload ?? null;
  };

  return repo;
}

test("PostgreSQL: matérialise un établissement BackOffice-only puis crée la 1re année", async () => {
  const repo = createInjectableAcademicYearsRepository();
  assert.equal(repo.tables.schools.length, 0, "précondition: schools PG vide");

  const created = await repo.createAcademicYearV2({
    schoolCode: "cd-2026-0099",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: true,
  });

  assert.equal(repo.tables.schools.length, 1, "établissement matérialisé dans schools");
  assert.equal(repo.tables.schools[0].school_code, "CD-2026-0099", "code normalisé en majuscules");
  assert.equal(created.schoolCode, "CD-2026-0099");
  assert.equal(created.schoolId, repo.tables.schools[0].id);
  assert.equal(created.name, "2026-2027");
  assert.equal(created.isCurrent, true);
  assert.equal(repo.tables.academic_years.length, 1);
});
