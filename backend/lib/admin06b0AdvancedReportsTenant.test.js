"use strict";

/**
 * ADMIN-06B0 — isolation tenant GET /api/v2/reports/advanced.
 * R06B0-01 → R06B0-18. Pas d'ouverture plateforme. Pas de /api/audit.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FallbackRepository } = require("../db/fallbackRepository");
const { RbacService } = require("../services/rbacService");
const { CacheService } = require("../services/cacheService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  isPlatformPersonalDataForbiddenHttp,
} = require("./platformPersonalDataGuard");
const {
  ADVANCED_REPORTS_ERROR,
  assertAdvancedReportsSchoolId,
  advancedReportsCacheKey,
  resolveAdvancedReportsSchoolId,
  getAdvancedReportsForPrincipal,
  buildMemoryAdvancedReports,
} = require("./advancedReportsScope");

const rbac = new RbacService();
const seedData = require("../data");

const SUPER = {
  sub: "super-1",
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};

const COUNTRY = {
  sub: "pays-1",
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
  countryCode: "CD",
};

const SCHOOL_A = {
  sub: "admin-a",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Rapports:READ"],
  schoolCode: "CD-2026-0001",
};

const SCHOOL_B = {
  sub: "admin-b",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Rapports:READ"],
  schoolCode: "BI-2026-0002",
};

const SCHOOL_A_ID = "550e8400-e29b-41d4-a716-446655440001";
const SCHOOL_B_ID = "SCHOOL-BI-2026-0002";

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function datasetA() {
  return {
    schoolId: SCHOOL_A_ID,
    school: { id: SCHOOL_A_ID, code: "CD-2026-0001", schoolCode: "CD-2026-0001" },
    students: [
      { id: "sa1", schoolCode: "CD-2026-0001" },
      { id: "sa2", schoolCode: "CD-2026-0001" },
    ],
    teachers: [{ id: "ta1", schoolCode: "CD-2026-0001" }],
    classes: [{ id: "ca1", name: "6ème A", schoolCode: "CD-2026-0001" }],
    notes: [{ id: "na1", studentId: "sa1", schoolCode: "CD-2026-0001", value: 14 }],
    payments: [{ id: "pa1", studentId: "sa1", schoolCode: "CD-2026-0001", amount: 1000, status: "PAYE" }],
    presences: [{ id: "pra1", studentId: "sa1", schoolCode: "CD-2026-0001", present: true, status: "Present" }],
    exams: [{ id: "ea1", schoolCode: "CD-2026-0001", examType: "Contrôle A" }],
    subscriptions: [{ id: "suba", schoolCode: "CD-2026-0001", status: "Actif" }],
  };
}

function datasetB() {
  return {
    schoolId: "11111111-2222-4333-a444-555555555555",
    school: { id: "11111111-2222-4333-a444-555555555555", code: "BI-2026-0002", schoolCode: "BI-2026-0002" },
    students: [{ id: "sb1", schoolCode: "BI-2026-0002" }],
    teachers: [
      { id: "tb1", schoolCode: "BI-2026-0002" },
      { id: "tb2", schoolCode: "BI-2026-0002" },
    ],
    classes: [{ id: "cb1", name: "5ème B", schoolCode: "BI-2026-0002" }],
    notes: [{ id: "nb1", studentId: "sb1", schoolCode: "BI-2026-0002", value: 8 }],
    payments: [{ id: "pb1", studentId: "sb1", schoolCode: "BI-2026-0002", amount: 777, status: "PAYE" }],
    presences: [{ id: "prb1", studentId: "sb1", schoolCode: "BI-2026-0002", present: false, status: "Absent" }],
    exams: [{ id: "eb1", schoolCode: "BI-2026-0002", examType: "Examen B" }],
    subscriptions: [{ id: "subb", schoolCode: "BI-2026-0002", status: "Actif" }],
  };
}

test("R06B0-01 SUPER_ADMIN advanced reports → 403 guard", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/v2/reports/advanced"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/v2/reports/advanced"), false);
});

test("R06B0-02 COUNTRY_ADMIN advanced reports → 403 guard", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/v2/reports/advanced"), true);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/v2/reports/advanced"), false);
});

test("R06B0-03 / R06B0-05 / R06B0-06 / R06B0-07 / R06B0-08 école A uniquement", () => {
  const a = buildMemoryAdvancedReports(datasetA());
  const b = buildMemoryAdvancedReports(datasetB());
  assert.equal(a.academic[0].label, "6ème A");
  assert.equal(a.financial.paid, 1000);
  assert.equal(a.attendance.total, 1);
  assert.equal(a.exams[0].label, "Contrôle A");
  assert.notEqual(a.academic[0].label, b.academic[0].label);
  assert.notEqual(a.financial.paid, b.financial.paid);
  assert.equal(a.exams.some((row) => row.label === "Examen B"), false);
  assert.equal(b.academic.some((row) => row.label === "6ème A"), false);
  assert.equal(b.financial.paid, 777);
});

test("R06B0-04 / R06B0-09 / R06B0-10 école B uniquement + counts tenant", () => {
  const a = buildMemoryAdvancedReports(datasetA());
  const b = buildMemoryAdvancedReports(datasetB());
  assert.equal(a.global.countries, 1);
  assert.equal(a.global.schools, 1);
  assert.equal(a.global.students, 2);
  assert.equal(a.global.teachers, 1);
  assert.equal(a.global.activeSubscriptions, 1);
  assert.equal(b.global.students, 1);
  assert.equal(b.global.teachers, 2);
  assert.equal(b.global.activeSubscriptions, 1);
  assert.notEqual(a.global.students, b.global.students);
  assert.notEqual(a.global.teachers, b.global.teachers);
});

test("R06B0-11 schoolId obligatoire repository/service", async () => {
  const repo = new FallbackRepository();
  await assert.rejects(
    () => repo.getAdvancedReportsV2(),
    (error) => error.statusCode === 400 && error.code === ADVANCED_REPORTS_ERROR.SCHOOL_ID_REQUIRED,
  );
  await assert.rejects(
    () => repo.getAdvancedReportsV2("*"),
    (error) => error.code === ADVANCED_REPORTS_ERROR.SCHOOL_ID_REQUIRED,
  );
  assert.throws(
    () => assertAdvancedReportsSchoolId("CD-2026-0001"),
    (error) => error.code === ADVANCED_REPORTS_ERROR.SCHOOL_ID_REQUIRED,
  );
  assert.throws(
    () => assertAdvancedReportsSchoolId("CD-IN-26-001"),
    (error) => error.code === ADVANCED_REPORTS_ERROR.SCHOOL_ID_REQUIRED,
  );
});

test("R06B0-12 schoolCode query ne peut pas override JWT", async () => {
  const repo = {
    async getSchoolByCode(code) {
      if (String(code).toUpperCase() === "CD-2026-0001") {
        return { id: SCHOOL_A_ID, school_code: "CD-2026-0001" };
      }
      if (String(code).toUpperCase() === "BI-2026-0002") {
        return { id: SCHOOL_B_ID, school_code: "BI-2026-0002" };
      }
      return null;
    },
    async getAdvancedReportsV2(schoolId) {
      return { schoolId };
    },
  };
  const schoolId = await resolveAdvancedReportsSchoolId(repo, {
    ...SCHOOL_A,
    schoolCode: "CD-2026-0001",
  });
  assert.equal(schoolId, SCHOOL_A_ID);
  assert.notEqual(schoolId, SCHOOL_B_ID);
  const payload = await getAdvancedReportsForPrincipal({
    repository: repo,
    principal: SCHOOL_A,
  });
  assert.equal(payload.schoolId, SCHOOL_A_ID);
});

test("R06B0-13 / R06B0-14 cache A puis B et B puis A isolé", async () => {
  const hits = [];
  const repo = {
    async getSchoolByCode(code) {
      return code === "CD-2026-0001"
        ? { id: SCHOOL_A_ID, school_code: code }
        : { id: "11111111-2222-4333-a444-555555555555", school_code: code };
    },
    async getAdvancedReportsV2(schoolId) {
      hits.push(schoolId);
      return { schoolId, token: schoolId === SCHOOL_A_ID ? "A" : "B" };
    },
  };
  const cache = new CacheService({ ttlMs: 60_000 });
  const firstA = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: SCHOOL_A });
  const firstB = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: SCHOOL_B });
  const secondA = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: SCHOOL_A });
  const secondB = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: SCHOOL_B });
  assert.equal(firstA.token, "A");
  assert.equal(firstB.token, "B");
  assert.equal(secondA.token, "A");
  assert.equal(secondB.token, "B");
  assert.equal(secondA.token === firstB.token, false);
  assert.equal(secondB.token === firstA.token, false);

  const cacheBa = new CacheService({ ttlMs: 60_000 });
  const baFirstB = await getAdvancedReportsForPrincipal({ repository: repo, cache: cacheBa, principal: SCHOOL_B });
  const baFirstA = await getAdvancedReportsForPrincipal({ repository: repo, cache: cacheBa, principal: SCHOOL_A });
  assert.equal(baFirstB.token, "B");
  assert.equal(baFirstA.token, "A");
});

test("R06B0-15 cache key contient l'identité tenant canonique", () => {
  const key = advancedReportsCacheKey(SCHOOL_A_ID);
  assert.equal(key, `v2:reports:advanced:${SCHOOL_A_ID}`);
  assert.match(key, new RegExp(SCHOOL_A_ID));
  assert.notEqual(key, "v2:reports:advanced");
  assert.throws(() => advancedReportsCacheKey("CD-2026-0001"));
  const handler = readUtf8("../server.js");
  assert.match(handler, /getAdvancedReportsForPrincipal/);
  assert.doesNotMatch(
    handler.slice(handler.indexOf('app.get("/api/v2/reports/advanced"'), handler.indexOf('app.get("/api/mvp/readiness"')),
    /remember\("v2:reports:advanced"/,
  );
});

test("R06B0-18 guard plateforme inchangé sur advanced reports", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/v2/reports/advanced"), true);
  const guard = readUtf8("./platformPersonalDataGuard.js");
  assert.match(guard, /GET \/api\/v2\/reports\/advanced/);
  const audit = readUtf8("../server.js");
  assert.match(audit, /Seuls les administrateurs habilités peuvent consulter l'audit/);
});

test("R06B0 fallback seed Unikin ne fuit pas vers Burundi", async () => {
  const repo = new FallbackRepository();
  const unikin = await repo.getAdvancedReportsV2(SCHOOL_A_ID);
  const burundi = await repo.getAdvancedReportsV2(SCHOOL_B_ID);
  assert.ok(unikin.global.students > 0);
  assert.equal(
    unikin.global.students,
    seedData.students.filter((row) => String(row.schoolCode).toUpperCase() === "CD-2026-0001").length,
  );
  assert.equal(burundi.global.students, 0);
  assert.equal(burundi.financial.payments, 0);
  assert.equal(burundi.exams.length, 0);
  assert.equal(unikin.global.countries, 1);
  assert.equal(unikin.global.schools, 1);
  assert.notEqual(unikin.global.schools, seedData.platformSchools.length);
});
