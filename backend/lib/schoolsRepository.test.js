"use strict";

/**
 * Preuve repository établissements (mémoire JS) :
 * persist → list → relecture profil → mise à jour.
 */
const assert = require("node:assert/strict");
const { createSchoolsRepository } = require("../db/schoolsRepository");

function createMemoryDb() {
  const countries = [
    {
      id: "country-cd",
      name: "RDC",
      iso_code: "CD",
      currency: "CDF",
    },
  ];
  /** @type {any[]} */
  const schools = [];
  let seq = 1;
  const nextId = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

  return {
    async one(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.includes("FROM COUNTRIES") && text.includes("ISO_CODE")) {
        return countries.find((row) => row.iso_code === params[0]) ?? null;
      }
      if (text.startsWith("INSERT INTO COUNTRIES")) {
        const row = {
          id: nextId(),
          name: params[0],
          iso_code: params[1],
          currency: "CDF",
        };
        countries.push(row);
        return row;
      }
      if (text.includes("FROM SCHOOLS S") && text.includes("WHERE S.ID")) {
        const school = schools.find((row) => row.id === params[0]);
        if (!school) return null;
        const country = countries.find((row) => row.id === school.country_id);
        return {
          ...school,
          country_name: country?.name,
          iso_code: country?.iso_code,
          country_currency: country?.currency,
        };
      }
      if (text.includes("FROM SCHOOLS S") && text.includes("WHERE S.SCHOOL_CODE")) {
        const school = schools.find((row) => row.school_code === params[0]);
        if (!school) return null;
        const country = countries.find((row) => row.id === school.country_id);
        return {
          ...school,
          country_name: country?.name,
          iso_code: country?.iso_code,
          country_currency: country?.currency,
        };
      }
      if (text.startsWith("INSERT INTO SCHOOLS")) {
        const existing = schools.find((row) => row.school_code === params[1]);
        const now = new Date().toISOString();
        if (existing) {
          Object.assign(existing, {
            country_id: params[0],
            name: params[2],
            logo_url: params[3],
            address: params[4],
            city: params[5],
            phone: params[6],
            email: params[7],
            school_type: params[8],
            status: params[9],
            profile_payload: JSON.parse(params[10]),
            deleted_at: params[11],
            updated_at: now,
          });
          return { id: existing.id };
        }
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
          profile_payload: JSON.parse(params[10]),
          deleted_at: params[11],
          created_at: now,
          updated_at: now,
        };
        schools.push(row);
        return { id: row.id };
      }
      return null;
    },
    async all(sql) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.includes("FROM SCHOOLS S")) {
        return schools.map((school) => {
          const country = countries.find((row) => row.id === school.country_id);
          return {
            ...school,
            country_name: country?.name,
            iso_code: country?.iso_code,
            country_currency: country?.currency,
          };
        });
      }
      return [];
    },
    async query() {
      return { rows: [] };
    },
    schools,
  };
}

async function main() {
  const db = createMemoryDb();
  const repo = createSchoolsRepository(db);

  const created = await repo.persist({
    code: "CD-2026-0401",
    name: "Lycée Lot 1",
    type: "Lycée",
    country: "RDC",
    countryCode: "CD",
    city: "Kinshasa",
    phone: "+243 990 111 222",
    email: "lot1@test.cd",
    principalName: "Awa Kabila",
    status: "En attente",
    validationStatus: "En attente de validation",
  });
  assert.equal(created.code, "CD-2026-0401");
  assert.equal(created.status, "En attente");
  assert.equal(created.principalName, "Awa Kabila");
  assert.equal(created.countryCode, "CD");

  const listed = await repo.listAll();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].code, "CD-2026-0401");

  const updated = await repo.persist({
    ...created,
    name: "Lycée Lot 1 Persisté",
    status: "Actif",
    validationStatus: "Validé",
  });
  assert.equal(updated.name, "Lycée Lot 1 Persisté");
  assert.equal(updated.status, "Actif");

  const reread = await repo.getByCode("cd-2026-0401");
  assert.equal(reread.name, "Lycée Lot 1 Persisté");
  assert.equal(reread.principalName, "Awa Kabila");
  assert.equal(db.schools.length, 1);

  console.log("OK schoolsRepository mémoire: persist / list / update");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
