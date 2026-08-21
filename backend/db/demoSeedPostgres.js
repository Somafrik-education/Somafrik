"use strict";

const seedData = require("../data");
const { hashSecret } = require("../services/credentialService");

const ROLE_TO_DB = {
  "Super Administrateur Somafrik": "SUPER_ADMIN",
  "Super Administrateur OKAFRIK": "SUPER_ADMIN",
  "Admin Pays": "COUNTRY_ADMIN",
  "Admin School": "SCHOOL_ADMIN",
  Proviseur: "PROVISEUR",
  Directeur: "PRINCIPAL",
  "Préfet des études": "PREFET_ETUDES",
  Enseignant: "TEACHER",
  Secrétaire: "SECRETARY",
  Comptable: "ACCOUNTANT",
  Parent: "PARENT",
  "Élève / Étudiant": "STUDENT",
  Surveillant: "SUPERVISOR",
};

function normalizeRole(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isStudentSeedUser(user) {
  return ["STUDENT", "ÉLÈVE / ÉTUDIANT", "ELEVE / ETUDIANT"].includes(normalizeRole(user?.role));
}

function extractFixtureSchoolShortCode(school) {
  const candidate = String(school?.loginCode ?? school?.publicId ?? "").trim().toUpperCase();
  const match = /^[A-Z]{2}-([A-Z0-9]{2,5})-[0-9]{2}-[0-9]{3}$/.exec(candidate);
  return match ? match[1] : null;
}

/**
 * Correctif de seed PostgreSQL uniquement.
 *
 * Deux invariants :
 * 1. Le short_code explicite du fixture est transmis à PostgreSQL pour que le
 *    login_code public soit alloué par le trigger à partir de la même source.
 * 2. Les comptes STUDENT ne sont jamais insérés avant les lignes students.
 *    PostgresRepository.ensureStudentUsers() les crée ensuite depuis la table
 *    students canonique, après seedAcademicData().
 */
function attachCanonicalDemoSeedPostgres(repository) {
  if (!repository || typeof repository.seedReferenceData !== "function") {
    return repository;
  }
  if (repository.__canonicalDemoSeedPostgresAttached) {
    return repository;
  }

  repository.seedReferenceData = async function seedReferenceDataCanonical(client) {
    const countryIds = new Map();
    const schoolIds = new Map();
    const userIds = new Map();

    for (const country of seedData.countries) {
      const row = await this.insertOne(
        client,
        `INSERT INTO countries (name, iso_code, phone_code, currency, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [country.name, country.code, country.phonePrefix, country.currency, country.status !== "Suspendu"],
      );
      countryIds.set(country.code, row.id);
      if (country.name === "République Démocratique du Congo") {
        countryIds.set("RDC", row.id);
      }
    }

    for (const school of seedData.platformSchools) {
      const countryId =
        countryIds.get(this.getCountryCodeForSchool(school))
        ?? countryIds.get("CD")
        ?? [...countryIds.values()][0];
      const row = await this.insertOne(
        client,
        `INSERT INTO schools (
           country_id, school_code, short_code, name, logo_url, address, city,
           phone, email, school_type, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
         ON CONFLICT (school_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          countryId,
          school.code,
          extractFixtureSchoolShortCode(school),
          school.name,
          school.logoUrl ?? "",
          school.address ?? "",
          school.city ?? "",
          school.phone ?? "",
          school.email ?? "",
          school.type ?? "Établissement",
          this.toDbStatus(school.status),
        ],
      );
      schoolIds.set(school.code, row.id);
    }

    for (const subscription of seedData.subscriptions) {
      const schoolId = schoolIds.get(subscription.schoolCode);
      if (!schoolId) continue;
      await client.query(
        `INSERT INTO subscriptions (
           school_id, plan_name, price_per_student, billing_currency,
           billing_cycle, status, start_date, end_date
         )
         VALUES ($1, $2, $3, $4, 'monthly', $5, $6, $7)`,
        [
          schoolId,
          subscription.plan,
          subscription.monthlyPrice ?? 0,
          subscription.currency,
          this.toSubscriptionStatus(subscription.status, subscription.paymentStatus),
          this.parseDate(subscription.startDate),
          this.parseDate(subscription.endDate),
        ],
      );
    }

    for (const user of seedData.userAccounts.filter((item) => !isStudentSeedUser(item))) {
      const schoolId = user.schoolCode === "*" ? null : schoolIds.get(user.schoolCode);
      const row = await this.insertOne(
        client,
        `INSERT INTO users (
           school_id, user_code, first_name, last_name, email, phone,
           password_hash, pin_hash, role, status, last_login_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_code) DO UPDATE SET first_name = EXCLUDED.first_name
         RETURNING id`,
        [
          schoolId,
          user.publicId,
          user.firstName,
          user.lastName,
          user.email ?? "",
          user.phone ?? "",
          hashSecret(user.password),
          hashSecret(user.temporaryPassword || "1234"),
          ROLE_TO_DB[user.role] ?? user.role,
          this.toDbStatus(user.status),
          this.parseDate(user.lastLoginAt),
        ],
      );
      userIds.set(user.id, row.id);
      userIds.set(user.phone, row.id);
    }

    return { countryIds, schoolIds, userIds };
  };

  Object.defineProperty(repository, "__canonicalDemoSeedPostgresAttached", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return repository;
}

module.exports = {
  attachCanonicalDemoSeedPostgres,
  extractFixtureSchoolShortCode,
  isStudentSeedUser,
};
