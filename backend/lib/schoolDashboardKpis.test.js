"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  accessFor,
  attendanceFromCounts,
  isCountedCashStatus,
  listSchoolDashboardKpis,
  paymentRateFromAggregate,
  periodBounds,
  resolveSchoolKpiPrincipal,
  revenueFromRows,
} = require("./schoolDashboardKpis");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-04T10:00:00.000Z");

function principal(overrides = {}) {
  return {
    role: "Admin School",
    schoolId: SCHOOL,
    permissions: ["Élèves:READ", "Enseignants:READ", "Classes:READ", "Paiements:READ", "Présences:READ"],
    ...overrides,
  };
}

test("le module KPI n'appelle pas la projection globale", () => {
  const source = fs.readFileSync(path.join(__dirname, "schoolDashboardKpis.js"), "utf8");
  assert.equal(source.includes("getAuthoritativeBackOfficeState"), false);
  assert.equal(source.includes("platform: true"), false);
});

test("Superadmin et Admin Pays sont refusés avant toute lecture", async () => {
  const lookup = async () => {
    throw new Error("lookup interdit");
  };
  await assert.rejects(
    resolveSchoolKpiPrincipal(
      { role: "Super Administrateur Somafrik", permissions: ["ALL_PRIVILEGES"], schoolId: SCHOOL },
      lookup,
    ),
    { statusCode: 403 },
  );
  await assert.rejects(
    resolveSchoolKpiPrincipal({ role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolId: SCHOOL }, lookup),
    { statusCode: 403 },
  );
});

test("un personnel sans droit de lecture ne reçoit aucun agrégat", async () => {
  let called = false;
  const repository = {
    all: async () => {
      called = true;
      return [];
    },
  };
  await assert.rejects(listSchoolDashboardKpis(repository, principal({ permissions: [] }), {}, NOW), {
    statusCode: 403,
  });
  assert.equal(called, false);
});

test("période invalide et école absente échouent fermé", async () => {
  const repository = { all: async () => { throw new Error("ne doit pas lire"); } };
  await assert.rejects(listSchoolDashboardKpis(repository, principal(), { period: "forever" }, NOW), {
    statusCode: 400,
  });
  await assert.rejects(listSchoolDashboardKpis(repository, principal({ schoolId: "" }), {}, NOW), {
    statusCode: 403,
  });
  await assert.rejects(listSchoolDashboardKpis(repository, principal({ role: "Parent" }), {}, NOW), {
    statusCode: 403,
  });
});

test("une erreur PostgreSQL n'est pas remplacée par une projection", async () => {
  const failure = new Error("connexion interrompue");
  failure.code = "57P01";
  const repository = { all: async () => { throw failure; } };
  await assert.rejects(listSchoolDashboardKpis(repository, principal(), { period: "monthly" }, NOW), failure);
});

test("le school_id de la requête n'est pas l'autorité, et la finance est omise sans droit", async () => {
  const sql = [];
  const repository = {
    all: async (text, params) => {
      sql.push({ text, params });
      if (/FROM payments|student_fee_obligations/i.test(text)) {
        throw new Error("lecture finance interdite");
      }
      return [];
    },
  };
  const teacherId = "33333333-3333-4333-8333-333333333333";
  const payload = await listSchoolDashboardKpis(
    repository,
    principal({
      role: "Enseignant",
      id: teacherId,
      permissions: ["Élèves:READ", "Présences:READ"],
    }),
    { period: "monthly", schoolId: OTHER },
    NOW,
  );
  assert.equal(payload.schoolId, SCHOOL);
  assert.equal(payload.cards.revenue, null);
  assert.equal(payload.cards.paymentRate, null);
  assert.equal(payload.series.paymentStatus, null);
  assert.equal(sql.some((entry) => String(entry.params).includes(OTHER)), false);
  assert.ok(sql.every((entry) => entry.params[0] === SCHOOL));
  assert.equal(sql.some((entry) => /FROM payments/i.test(entry.text)), false);
});

test("les fenêtres de période suivent le calendrier de l'établissement", () => {
  assert.deepEqual(periodBounds("monthly", NOW), {
    period: "monthly",
    startDate: "2026-11-01",
    endDate: "2026-11-04",
    today: "2026-11-04",
    timeZone: "Africa/Kinshasa",
  });
  assert.equal(periodBounds("weekly", NOW).startDate, "2026-10-29");
  assert.equal(periodBounds("annual", NOW).startDate, "2026-01-01");
  assert.equal(periodBounds("quarterly", NOW).startDate, "2026-10-01");
});

test("encaissement, taux et présence reprennent les règles déjà affichées", () => {
  assert.equal(isCountedCashStatus("Payé"), true);
  assert.equal(isCountedCashStatus("Annulé"), false);
  assert.equal(isCountedCashStatus("pending"), false);
  assert.equal(revenueFromRows([{ currency: "CDF", collected: 40 }, { currency: "USD", collected: 5 }]).display, "—");
  assert.equal(revenueFromRows([{ currency: "FC", collected: 40 }]).display, "40 CDF");
  assert.deepEqual(
    paymentRateFromAggregate({ rows: 2, currencies: 1, missing: false, expected: 150, collected: 90 }),
    { label: "Taux de paiement", value: "60 %", rate: 60, expectedAmount: 150, collectedAmount: 90 },
  );
  assert.equal(paymentRateFromAggregate({ rows: 2, currencies: 2, missing: false, expected: 10, collected: 5 }).value, "—");
  assert.equal(paymentRateFromAggregate({ rows: 1, currencies: 1, missing: false, expected: 90, collected: 40 }).value, "44 %");
  assert.equal(attendanceFromCounts({ expected: 2, recorded: 1, attended: 1 }).value, "—");
  assert.equal(attendanceFromCounts({ expected: 2, recorded: 2, attended: 2 }).value, "100 %");
  assert.equal(attendanceFromCounts({ expected: 0, recorded: 0, attended: 0 }).value, "—");
});

test("un droit Élèves ne débloque pas les autres modules", () => {
  const access = accessFor(principal({ permissions: ["Voir élèves"] }));
  assert.equal(access.students, true);
  assert.equal(access.payments, false);
  assert.equal(access.presences, false);
});
