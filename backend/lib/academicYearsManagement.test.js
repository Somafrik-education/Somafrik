"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
 * Le pays CD est préchargé : le contrat fail-closed refuse d’inventer un pays.
 */
const CANONICAL_CD_COUNTRY = Object.freeze({
  id: "00000000-0000-4000-8000-0000000000cd",
  name: "République Démocratique du Congo",
  iso_code: "CD",
  phone_code: "+243",
  currency: "CDF",
});

function createInjectableAcademicYearsRepository() {
  const tables = {
    schools: [],
    countries: [{ ...CANONICAL_CD_COUNTRY }],
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
    if (upper.includes("FROM COUNTRIES WHERE LOWER(NAME)")) {
      return tables.countries.filter(
        (row) => String(row.name ?? "").trim().toLowerCase() === String(params[0] ?? "").trim().toLowerCase(),
      );
    }
    if (upper.startsWith("INSERT INTO COUNTRIES")) {
      throw new Error("INSERT INTO countries interdit : le référentiel pays est fail-closed");
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
    if (upper.includes("FROM ACADEMIC_YEARS") && upper.includes("FOR UPDATE")) {
      return tables.academic_years.filter((row) => eq(row.school_id, params[0])).map((row) => ({ id: row.id }));
    }
    if (upper.includes("FROM ACADEMIC_YEARS") && upper.includes("LOWER(BTRIM(NAME))")) {
      return tables.academic_years.filter(
        (row) =>
          eq(row.school_id, params[0]) &&
          String(row.name ?? "").trim().toLowerCase() === String(params[1] ?? "").trim().toLowerCase() &&
          (params[2] == null || !eq(row.id, params[2])),
      );
    }
    if (upper.includes("FROM ACADEMIC_YEARS") && upper.includes("STATUS IN")) {
      return tables.academic_years
        .filter((row) => eq(row.school_id, params[0]) && ["active", "open"].includes(row.status))
        .sort((a, b) => Number(b.is_current) - Number(a.is_current));
    }
    if (upper.includes("FROM ACADEMIC_YEARS AY") && upper.includes("WHERE AY.ID")) {
      const year = tables.academic_years.find((row) => eq(row.id, params[0]));
      if (!year) return [];
      const school = tables.schools.find((row) => eq(row.id, year.school_id));
      const country = tables.countries.find((row) => eq(row.id, school?.country_id));
      return [{ ...year, school_code: school?.school_code, country_code: country?.iso_code }];
    }
    if (upper.startsWith("UPDATE ACADEMIC_YEARS SET IS_CURRENT")) {
      for (const row of tables.academic_years) {
        if (eq(row.school_id, params[0])) row.is_current = false;
      }
      return [];
    }
    if (upper.startsWith("UPDATE ACADEMIC_YEARS") && upper.includes("SET NAME")) {
      const row = tables.academic_years.find((item) => eq(item.id, params[0]));
      if (!row) return [];
      row.name = params[1];
      row.start_date = params[2];
      row.end_date = params[3];
      row.is_current = params[4];
      return [row];
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
  assert.equal(repo.tables.countries.length, 1, "précondition: pays CD canonique préchargé");
  const countryIdBefore = repo.tables.countries[0].id;

  const created = await repo.createAcademicYearV2({
    schoolCode: "cd-2026-0099",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: true,
  });

  assert.equal(repo.tables.schools.length, 1, "établissement matérialisé dans schools");
  assert.equal(repo.tables.schools[0].school_code, "CD-2026-0099", "code normalisé en majuscules");
  assert.equal(repo.tables.schools[0].country_id, countryIdBefore, "FK pays = CD préchargé");
  assert.equal(created.schoolCode, "CD-2026-0099");
  assert.equal(created.schoolId, repo.tables.schools[0].id);
  assert.equal(created.name, "2026-2027");
  assert.equal(created.isCurrent, true);
  assert.equal(repo.tables.academic_years.length, 1);
  assert.equal(repo.tables.countries.length, 1, "aucun pays créé pendant la matérialisation");
  assert.equal(repo.tables.countries[0].id, countryIdBefore);
  assert.equal(repo.tables.countries[0].iso_code, "CD");
});

test("ensureCurrentAcademicYearForSchool ne crée plus d'année 01/09–31/08", async () => {
  const repo = createInjectableAcademicYearsRepository();
  repo.tables.schools.push({
    id: "00000000-0000-4000-8000-000000000001",
    school_code: "SCH-001",
    country_id: CANONICAL_CD_COUNTRY.id,
  });
  assert.equal(repo.tables.academic_years.length, 0);
  const missing = await repo.ensureCurrentAcademicYearForSchool(repo.tables.schools[0].id);
  assert.equal(missing, null);
  assert.equal(repo.tables.academic_years.length, 0);
  const stillMissing = await repo.getCurrentAcademicYear(repo.tables.schools[0].id);
  assert.equal(stillMissing, null);

  repo.tables.academic_years.push({
    id: "00000000-0000-4000-8000-0000000000aa",
    school_id: repo.tables.schools[0].id,
    name: "2025-2026",
    start_date: "2025-09-01",
    end_date: "2026-08-31",
    is_current: true,
    status: "open",
    created_at: new Date().toISOString(),
  });
  const found = await repo.ensureCurrentAcademicYearForSchool(repo.tables.schools[0].id);
  assert.equal(found.name, "2025-2026");
  assert.equal(repo.tables.academic_years.length, 1);
});

test("PATCH bascule l'année courante sans clôturer", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  const first = await repository.createAcademicYearV2({
    schoolCode: "SCH-001",
    name: "2025-2026",
    startDate: "2025-09-01",
    endDate: "2026-08-31",
    isCurrent: true,
  });
  const second = await repository.createAcademicYearV2({
    schoolCode: "SCH-001",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: false,
  });
  await assert.rejects(
    () => repository.updateAcademicYearV2(second.id, { status: "closed" }),
    (error) => error.statusCode === 400,
  );
  const updated = await repository.updateAcademicYearV2(second.id, { isCurrent: true });
  assert.equal(updated.isCurrent, true);
  const years = await repository.getAcademicYearsV2();
  assert.equal(years.filter((year) => year.isCurrent).length, 1);
  assert.equal(years.find((year) => year.id === first.id).isCurrent, false);
});

test("postgresRepository n'insère plus de dates 01/09–31/08 par défaut", () => {
  const src = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  assert.equal(src.includes("${year}-09-01"), false);
  assert.equal(src.includes("${year + 1}-08-31"), false);
  assert.match(src, /N'invente jamais de millésime/);
  const start = src.indexOf("async updateAcademicYearV2");
  const end = src.indexOf("mapAcademicYearV2", start);
  const block = src.slice(start, end);
  assert.match(block, /withTransaction/);
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /is_current = FALSE/);
});
