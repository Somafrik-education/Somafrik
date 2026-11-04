"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { createFinancePgStore } = require("../db/financePgStore");
const {
  injectPredicate,
  projectionQuery,
  filterProjectionRecord,
  hasProjectionScope,
} = require("../db/projectionSchoolScope");
const {
  resolvePedagogyProjectionScope,
  resolveFinanceProjectionScope,
} = require("./projectionReadScope");

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";

test("le prédicat d'établissement reste hors des sous-requêtes", () => {
  const sql = `
    SELECT g.id,
      (SELECT sc.coefficient FROM school_courses sc WHERE sc.school_id = g.school_id AND sc.status = 'active' LIMIT 1) AS subject_coefficient
    FROM grades g
    ORDER BY g.updated_at DESC
  `;
  const query = projectionQuery(sql, "g", { schoolId: SCHOOL_A });
  assert.deepEqual(query.params, [SCHOOL_A]);
  assert.match(query.text, /g\.school_id = \$1::uuid/);
  const inner = query.text.slice(query.text.indexOf("SELECT sc.coefficient"), query.text.indexOf("LIMIT 1"));
  assert.equal(inner.includes("$1"), false);
  assert.match(inner, /sc\.school_id = g\.school_id/);
  const bare = injectPredicate("SELECT * FROM payment_allocations", "school_id = $1::uuid");
  assert.match(bare, /payment_allocations\s+WHERE \(school_id = \$1::uuid\)/);
});

test("aucun school_id client n'est concaténé et l'absence de périmètre est refusée", () => {
  assert.throws(
    () => projectionQuery("SELECT 1 FROM attendance a", "a", null),
    (error) => error.code === "PROJECTION_SCHOOL_REQUIRED" && error.statusCode === 403,
  );
  assert.throws(
    () => projectionQuery("SELECT 1 FROM attendance a", "a", { schoolId: "CD-2026-0001" }),
    (error) => error.code === "PROJECTION_SCHOOL_INVALID",
  );
  assert.throws(
    () => projectionQuery("SELECT 1 FROM attendance a", "a", { countryCode: "C'; DROP TABLE attendance;--" }),
    (error) => error.code === "PROJECTION_SCOPE_INVALID",
  );
  const country = projectionQuery("SELECT 1 FROM attendance a ORDER BY a.id", "a", { countryCode: "cd" });
  assert.deepEqual(country.params, ["CD"]);
  assert.equal(country.text.includes("DROP TABLE"), false);
  assert.match(country.text, /\$1/);
  const platform = projectionQuery("SELECT 1 FROM attendance a", "a", { platform: true });
  assert.equal(platform.text, "SELECT 1 FROM attendance a");
  assert.deepEqual(platform.params, []);
});

test("la projection pédagogique ne part pas en lecture globale si le périmètre manque ou si PostgreSQL échoue", async () => {
  const calls = [];
  const repo = {
    async all(sql, params) {
      calls.push({ sql, params });
      return [];
    },
    buildCourses() {
      return [];
    },
  };
  const store = createPedagogyPgStore(repo);
  await assert.rejects(() => store.listProjection(), (error) => error.code === "PROJECTION_SCHOOL_REQUIRED");
  await assert.rejects(
    () => store.listProjection({ schoolId: "pas-un-uuid" }),
    (error) => error.code === "PROJECTION_SCHOOL_INVALID",
  );
  assert.equal(calls.length, 0);

  const scoped = createPedagogyPgStore({
    async all(sql, params) {
      calls.push({ sql, params });
      return [];
    },
    buildCourses() {
      return [];
    },
  });
  await scoped.listProjection({ schoolId: SCHOOL_A });
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.match(call.sql, /\$1::uuid/);
    assert.deepEqual(call.params, [SCHOOL_A]);
  }
  const grades = calls.find((call) => call.sql.includes("FROM grades"));
  const inner = grades.sql.slice(grades.sql.indexOf("SELECT sc.coefficient"), grades.sql.indexOf("LIMIT 1"));
  assert.equal(inner.includes("$1"), false);

  calls.length = 0;
  const failing = createPedagogyPgStore({
    async all() {
      calls.push("query");
      const error = new Error("relation absente");
      error.code = "42P01";
      throw error;
    },
    buildCourses() {
      return [{ id: "should-not-be-used" }];
    },
  });
  await assert.rejects(() => failing.listProjection({ schoolId: SCHOOL_A }), (error) => error.code === "42P01");
  assert.ok(calls.length >= 1);
});

test("la projection financière filtre obligations, items et allocations par établissement", async () => {
  const calls = [];
  const store = createFinancePgStore({
    async all(sql, params) {
      calls.push({ sql, params });
      return [];
    },
  });
  await assert.rejects(() => store.listProjection(), (error) => error.code === "PROJECTION_SCHOOL_REQUIRED");
  assert.equal(calls.length, 0);
  await store.listProjection({ schoolId: SCHOOL_A });
  assert.equal(calls.length, 9);
  const obligations = calls.find((call) => call.sql.includes("student_fee_obligations"));
  assert.match(obligations.sql, /e\.school_id = o\.school_id/);
  assert.match(obligations.sql, /o\.school_id = \$1::uuid/);
  const allocations = calls.find((call) => call.sql.includes("payment_allocations"));
  assert.match(allocations.sql, /payment_allocations\s+WHERE \(school_id = \$1::uuid\)/);
  const items = calls.find((call) => call.sql.includes("payment_items"));
  assert.match(items.sql, /school_id = \$1::uuid/);
  for (const call of calls) assert.deepEqual(call.params, [SCHOOL_A]);
});

test("le filtre mémoire ne renvoie pas l'autre établissement et n'a pas de repli global", () => {
  const rows = {
    payments: [
      { id: "a", schoolCode: "CD-2026-0001", schoolId: SCHOOL_A },
      { id: "b", schoolCode: "BI-2026-0001", schoolId: SCHOOL_B },
    ],
    notes: [
      { id: "na", schoolCode: "CD-2026-0001" },
      { id: "nb", schoolCode: "BI-2026-0001" },
    ],
  };
  assert.equal(hasProjectionScope(undefined), false);
  assert.deepEqual(filterProjectionRecord(rows, null).payments, []);
  assert.deepEqual(
    filterProjectionRecord(rows, { loginCode: "CD-2026-0001" }).payments.map((row) => row.id),
    ["a"],
  );
  assert.deepEqual(
    filterProjectionRecord(rows, { schoolId: SCHOOL_B }).notes.map((row) => row.id),
    [],
  );
  assert.deepEqual(
    filterProjectionRecord(rows, { schoolId: SCHOOL_B }).payments.map((row) => row.id),
    ["b"],
  );
  assert.equal(filterProjectionRecord(rows, { platform: true }).payments.length, 2);
});

test("permissions : le périmètre suit la politique existante et ignore un school_id forgé", async () => {
  const memory = { memory: true, one: null };
  const admin = await resolvePedagogyProjectionScope(
    { role: "Admin School", schoolCode: "CD-2026-0001", schoolId: SCHOOL_B },
    memory,
  );
  const teacher = await resolvePedagogyProjectionScope(
    { role: "Enseignant", schoolCode: "CD-2026-0001", schoolId: SCHOOL_B },
    memory,
  );
  const parent = await resolveFinanceProjectionScope(
    { role: "Parent", schoolCode: "CD-2026-0001", schoolId: SCHOOL_B },
    memory,
  );
  const outsider = await resolvePedagogyProjectionScope(
    { role: "Enseignant", schoolCode: "", schoolId: SCHOOL_B },
    memory,
  );
  assert.deepEqual(admin, { loginCode: "CD-2026-0001" });
  assert.deepEqual(teacher, { loginCode: "CD-2026-0001" });
  assert.deepEqual(parent, { loginCode: "CD-2026-0001" });
  assert.equal(outsider, null);

  const superFinance = await resolveFinanceProjectionScope(
    { role: "Super Administrateur Somafrik", schoolCode: "*", schoolId: SCHOOL_A, sub: "sa" },
    memory,
  );
  const superPedagogy = await resolvePedagogyProjectionScope(
    { role: "Super Administrateur Somafrik", schoolCode: "*", sub: "sa" },
    memory,
  );
  const country = await resolveFinanceProjectionScope(
    { role: "Admin Pays", countryCode: "CD", schoolId: SCHOOL_B },
    memory,
  );
  assert.equal(superFinance, null);
  assert.deepEqual(superPedagogy, { platform: true });
  assert.deepEqual(country, { countryCode: "CD" });

  const calls = [];
  const one = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("FROM users")) {
      return { login_code: "CD-LAC-26-001", school_id: SCHOOL_A };
    }
    if (sql.includes("FROM schools")) {
      assert.equal(params[0], "CD-LAC-26-001");
      return { id: SCHOOL_A };
    }
    return null;
  };
  const forged = await resolveFinanceProjectionScope(
    { role: "Admin School", sub: "user-a", schoolId: SCHOOL_B, schoolCode: "BI-2026-0001" },
    { memory: false, one },
  );
  assert.deepEqual(forged, { schoolId: SCHOOL_A });
  assert.equal(calls.some((call) => call.params?.includes(SCHOOL_B)), false);

  const missing = await resolvePedagogyProjectionScope(null, { memory: false, one });
  assert.equal(missing, null);
  const noSchool = await resolvePedagogyProjectionScope(
    { role: "Admin School", sub: "user-a" },
    {
      memory: false,
      one: async () => ({ login_code: "", school_id: "" }),
    },
  );
  assert.equal(noSchool, null);
});

test("les routes scolaires passent un périmètre et conservent les filtres de rôle", () => {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const pedagogyLoader = server.slice(
    server.indexOf("async function loadCanonicalPedagogyForPrincipal"),
    server.indexOf("async function loadCanonicalFinanceForPrincipal"),
  );
  const financeLoader = server.slice(
    server.indexOf("async function loadCanonicalFinanceForPrincipal"),
    server.indexOf("async function getAuthoritativeBackOfficeState"),
  );
  const courses = server.slice(server.indexOf('app.get("/api/courses"'), server.indexOf('app.get("/api/course-schedules"'));
  const notes = server.slice(server.indexOf('app.get("/api/notes"'), server.indexOf('app.get("/api/presences"'));
  const presences = server.slice(server.indexOf('app.get("/api/presences"'), server.indexOf('app.post("/api/notes"'));
  const payments = server.slice(server.indexOf('app.get("/api/payments"'), server.indexOf('app.post("/api/payments"'));
  assert.match(pedagogyLoader, /listPedagogyProjection\(scope\)/);
  assert.doesNotMatch(pedagogyLoader, /listPedagogyProjection\(\)/);
  assert.match(financeLoader, /listFinanceProjection\(scope\)/);
  assert.doesNotMatch(financeLoader, /listFinanceProjection\(\)/);
  assert.match(server, /listPedagogyProjection\(\{ platform: true \}\)/);
  assert.match(server, /listFinanceProjection\(\{ platform: true \}\)/);
  assert.match(courses, /resolvePedagogyProjectionScope/);
  assert.match(courses, /filterRows/);
  assert.match(notes, /filterNotesForPrincipal/);
  assert.match(presences, /requireAuth/);
  assert.match(presences, /filterPresenceRows/);
  assert.match(payments, /requireAuth/);
  assert.match(payments, /filterRows/);
  assert.match(server, /Authentification JWT requise/);
});
