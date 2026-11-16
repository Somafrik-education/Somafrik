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
  assert.equal(source.includes("Africa/Kinshasa"), false);
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
  const crossing = new Date("2026-11-04T23:30:00.000Z");
  assert.equal(periodBounds("daily", crossing, "Africa/Kinshasa").today, "2026-11-05");
  assert.equal(periodBounds("daily", crossing, "America/New_York").today, "2026-11-04");
  assert.equal(periodBounds("monthly", crossing, "America/New_York").endDate, "2026-11-04");
  assert.equal(periodBounds("monthly", crossing, "Pacific/Auckland").startDate, "2026-11-01");
  assert.equal(periodBounds("monthly", crossing, "Pacific/Auckland").endDate, "2026-11-05");
  assert.equal(periodBounds("daily", new Date("2026-11-04T22:30:00.000Z"), "Pacific/Auckland").today, "2026-11-05");
  assert.equal(periodBounds("daily", new Date("2026-11-04T22:30:00.000Z"), "Africa/Kinshasa").today, "2026-11-04");
});

test("un enseignant sans affectation ne reçoit pas les agrégats de l'établissement", async () => {
  const teacherId = "33333333-3333-4333-8333-333333333333";
  const sql = [];
  const repository = {
    all: async (text, params) => {
      sql.push({ text, params });
      if (/profile_payload/.test(text)) return [{ timezone: "Europe/Paris" }];
      if (/teacher_assignments/.test(text)) return [];
      if (/AS students/.test(text)) return [{ students: 0, expected: 0, recorded: 0, attended: 0 }];
      if (/AS teachers/.test(text)) return [{ teachers: 0 }];
      if (/AS classes/.test(text)) return [{ classes: 0 }];
      if (/SUM\(amount\)/.test(text)) return [];
      if (/amount_due/.test(text)) return [{ rows: 0, currencies: 0, missing: false, expected: 0, collected: 0 }];
      if (/AS announcements/.test(text)) {
        return [{
          notes: 0,
          exams: 0,
          bulletins: 0,
          pending_bulletins: 0,
          documents: 0,
          active_users: 0,
          announcements: 0,
          active_students: 0,
          period_classes: 0,
        }];
      }
      return [];
    },
  };
  const payload = await listSchoolDashboardKpis(
    repository,
    principal({
      role: "Enseignant",
      id: teacherId,
      permissions: [
        "Élèves:READ",
        "Enseignants:READ",
        "Classes:READ",
        "Paiements:READ",
        "Présences:READ",
        "Utilisateurs:READ",
        "Annonces:READ",
      ],
    }),
    { period: "monthly" },
    NOW,
  );
  const scoped = sql.filter((entry) => /\$2::uuid\[\]/.test(entry.text));
  assert.ok(scoped.length > 0);
  assert.ok(scoped.every((entry) => Array.isArray(entry.params[1]) && entry.params[1].length === 0));
  assert.equal(sql.some((entry) => entry.text.includes("Africa/Kinshasa")), false);
  assert.equal(sql.some((entry) => entry.text.includes("AT TIME ZONE 'Europe/Paris'")), true);
  assert.equal(payload.timeZone, "Europe/Paris");
  assert.equal(payload.cards.students, 0);
  assert.equal(payload.cards.teachers, 0);
  assert.equal(payload.cards.classes, 0);
  assert.equal(payload.cards.revenue.display, "—");
  assert.equal(payload.cards.paymentRate.value, "—");
  assert.equal(payload.series.activeUsers, 0);
  assert.equal(payload.series.announcements, 0);
});

test("un identifiant enseignant illisible ferme le périmètre sans lecture d'affectation", async () => {
  const sql = [];
  const repository = {
    all: async (text, params) => {
      sql.push({ text, params });
      if (/profile_payload/.test(text)) return [{ timezone: "" }];
      return [{ students: 0, expected: 0, recorded: 0, attended: 0 }];
    },
  };
  await listSchoolDashboardKpis(
    repository,
    principal({ role: "Teacher", id: "pas-un-uuid", permissions: ["Élèves:READ"] }),
    { period: "daily" },
    NOW,
  );
  assert.equal(sql.some((entry) => /teacher_assignments/.test(entry.text)), false);
  const scoped = sql.filter((entry) => /\$2::uuid\[\]/.test(entry.text));
  assert.ok(scoped.every((entry) => Array.isArray(entry.params[1]) && entry.params[1].length === 0));
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

function recordingRepository(classRows) {
  const sql = [];
  return {
    sql,
    all: async (text, params) => {
      sql.push({ text, params });
      if (/profile_payload/.test(text)) return [{ timezone: "Africa/Dakar" }];
      if (/teacher_assignments/.test(text)) return classRows;
      return [];
    },
  };
}

const FINANCE_SQL = /FROM payments|FROM student_fee_obligations/;
const TEACHER_FINANCE_RIGHTS = ["Élèves:READ", "Paiements:READ"];

test("un enseignant avec une classe ne voit que la finance des élèves de cette classe", async () => {
  const classId = "44444444-4444-4444-8444-444444444444";
  const repository = recordingRepository([{ class_id: classId }]);
  await listSchoolDashboardKpis(
    repository,
    principal({ role: "Enseignant", id: "33333333-3333-4333-8333-333333333333", permissions: TEACHER_FINANCE_RIGHTS }),
    { period: "monthly" },
    NOW,
  );
  const finance = repository.sql.filter((entry) => FINANCE_SQL.test(entry.text));
  assert.ok(finance.length >= 3);
  for (const entry of finance) {
    assert.deepEqual(entry.params[1], [classId]);
    assert.match(entry.text, /FROM enrollments e/);
    assert.match(entry.text, /e\.class_id = ANY\(\$2::uuid\[\]\)/);
  }
  const directFinance = repository.sql.filter((entry) => /^\s*SELECT (currency|COUNT\(\*\)::int AS rows|payment_status)/.test(entry.text));
  assert.equal(directFinance.length, 3);
  assert.equal(directFinance.some((entry) => /cardinality/.test(entry.text)), false);
});

test("l'administration garde la finance de toute l'école", async () => {
  const repository = recordingRepository([]);
  await listSchoolDashboardKpis(
    repository,
    principal({ permissions: TEACHER_FINANCE_RIGHTS }),
    { period: "monthly" },
    NOW,
  );
  assert.equal(repository.sql.some((entry) => /teacher_assignments/.test(entry.text)), false);
  const finance = repository.sql.filter((entry) => FINANCE_SQL.test(entry.text));
  assert.ok(finance.length >= 3);
  assert.ok(finance.every((entry) => entry.params[1] === null));
});

test("le sub du jeton suffit à retrouver les affectations de l'enseignant", async () => {
  const userId = "55555555-5555-4555-8555-555555555555";
  const repository = recordingRepository([]);
  await listSchoolDashboardKpis(
    repository,
    principal({ role: "Enseignant", sub: userId, permissions: ["Élèves:READ"] }),
    { period: "daily" },
    NOW,
  );
  const lookup = repository.sql.find((entry) => /teacher_assignments/.test(entry.text));
  assert.ok(lookup);
  assert.deepEqual(lookup.params, [SCHOOL, userId]);
});

test("les droits KPI sont relus en base, jamais ceux du JWT", async () => {
  const { withLiveKpiPermissions } = require("./schoolDashboardKpis");
  const jwt = principal({ permissions: ["Élèves:READ", "Paiements:READ"] });
  const live = await withLiveKpiPermissions(
    {
      resolveEffectivePermissions: async () => ({ permissions: ["Élèves:READ"] }),
      resolveFinanceLivePermissions: async () => ({ permissions: [] }),
    },
    jwt,
  );
  assert.deepEqual(live.permissions, ["Élèves:READ"]);
  assert.deepEqual(live.financePermissions, []);
  assert.equal(accessFor(live).students, true);
  assert.equal(accessFor(live).payments, false);
});

test("une résolution illisible des droits ne retombe pas sur le JWT", async () => {
  const { withLiveKpiPermissions } = require("./schoolDashboardKpis");
  const live = await withLiveKpiPermissions(
    {
      resolveEffectivePermissions: async () => ({ permissions: null }),
      resolveFinanceLivePermissions: async () => ({}),
    },
    principal({ permissions: ["ALL_PRIVILEGES"] }),
  );
  assert.deepEqual(live.permissions, []);
  assert.deepEqual(live.financePermissions, []);
  assert.equal(Object.values(accessFor(live)).some(Boolean), false);
});

test("la finance suit la primitive live stricte des routes finance", async () => {
  const { withLiveKpiPermissions } = require("./schoolDashboardKpis");
  const live = await withLiveKpiPermissions(
    {
      resolveEffectivePermissions: async () => ({ permissions: ["Paiements:READ", "Élèves:READ"] }),
      resolveFinanceLivePermissions: async () => ({ permissions: [] }),
    },
    principal({ permissions: ["Paiements:READ"] }),
  );
  assert.equal(accessFor(live).payments, false);
  assert.equal(accessFor(live).students, true);
});

test("sans champ pédagogique lisible, la requête pédagogique n'est pas envoyée", async () => {
  const repository = recordingRepository([]);
  const payload = await listSchoolDashboardKpis(
    repository,
    principal({ permissions: ["Paiements:READ", "Présences:READ", "Enseignants:READ", "Classes:READ"] }),
    { period: "monthly" },
    NOW,
  );
  assert.equal(repository.sql.some((entry) => /AS notes/.test(entry.text)), false);
  for (const entry of repository.sql) {
    const highest = Math.max(0, ...[...entry.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(entry.params.length, highest, `requête avec ${entry.params.length} paramètres pour ${highest} emplacements`);
  }
  assert.equal(payload.series.notes, null);
  assert.equal(payload.series.activeStudents, null);
});
