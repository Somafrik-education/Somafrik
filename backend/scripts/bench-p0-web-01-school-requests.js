"use strict";
/**
 * P0-WEB-01 — banc local : vrai backend/server.js + PostgreSQL 16 jetable.
 * Établissement cible P0-A (modeste) + N autres établissements volumineux.
 * Mesure une rafale « ouverture de Mon établissement » : effective-permissions + 8 domaines.
 * DATABASE_URL=<cluster jetable marqué> node backend/scripts/bench-p0-web-01-school-requests.js <label>
 * Volume : OTHER_SCHOOLS (9), STUDENTS par école (500), DAYS de présences (120).
 * Prérequis : extension pg_stat_statements chargée (shared_preload_libraries).
 * Mesures locales uniquement ; ce ne sont pas des mesures de préproduction.
 */
const path = require("node:path");
const { spawn } = require("node:child_process");
const backend = path.resolve(__dirname, "..");
const ROOT = path.resolve(backend, "..");
const { createPostgresRepository } = require(path.join(backend, "db/repositoryFactory"));
const { TokenService } = require(path.join(backend, "services/tokenService"));
const { mintSessionAccessToken } = require(path.join(backend, "lib/testAccessSession"));
const { createOwnedDisposableDatabase, dropOwnedDisposableDatabase } = require(path.join(backend, "lib/perfPr1DisposableDatabase"));

const label = process.argv[2] || "run";
const URL0 = process.env.DATABASE_URL;
const PORT = 19977;
const JWT_SECRET = "ci-test-secret-with-enough-length-for-production-checks";
const OTHER = Number(process.env.OTHER_SCHOOLS ?? 9);
const STUDENTS = Number(process.env.STUDENTS ?? 500);
const DAYS = Number(process.env.DAYS ?? 120);
const ADMIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";

async function seedSchool(pool, country, code, students, days, withAdmin) {
  const school = (await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
    [country, code, `${code}-L`, `Ecole ${code}`])).rows[0].id;
  await pool.query(`INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
    VALUES ($1,'standard','XOF','active', CURRENT_DATE - 30, CURRENT_DATE + 300)`, [school]);
  const year = (await pool.query(`INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027',true,'open') RETURNING id`, [school])).rows[0].id;
  const classes = [];
  for (let c = 0; c < 10; c += 1) {
    classes.push((await pool.query(`INSERT INTO classes (school_id, academic_year_id, class_code, name, level, status)
      VALUES ($1,$2,$3,$4,'6e','active') RETURNING id`, [school, year, `${code}-C${c}`, `6e ${code} ${c}`])).rows[0].id);
  }
  await pool.query(`INSERT INTO students (school_id, student_code, first_name, last_name, status, created_at)
    SELECT $1, $2 || '-S' || g, 'Prenom' || g, 'Nom', 'active', make_date(2020 + g % 6, 1, 1) FROM generate_series(1, $3::int) g`,
    [school, code, students]);
  await pool.query(`INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
    SELECT $1, st.id, ($2::uuid[])[1 + (row_number() OVER (ORDER BY st.id))::int % 10], $3, 'enrolled' FROM students st WHERE st.school_id = $1`,
    [school, classes, year]);
  if (days > 0) {
    await pool.query(`INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
      SELECT $1, e.student_id, e.class_id, CURRENT_DATE - d, (ARRAY['present','absent','late'])[1 + d % 3]
      FROM enrollments e CROSS JOIN generate_series(1, $2::int) d WHERE e.school_id = $1`, [school, days]);
    await pool.query(`INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date)
      SELECT $1, st.id, $2 || '-P' || row_number() OVER (), 100, 'XOF', 'cash', 'paid', CURRENT_DATE FROM students st WHERE st.school_id = $1`, [school, code]);
  }
  if (withAdmin) {
    await pool.query(`INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
      VALUES ($1,$2,'P0-ADMIN','Ada','Admin','p0-admin@test.local',NULL,'active',FALSE)`, [ADMIN, school]);
    await pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,'SCHOOL_ADMIN','active')`, [ADMIN, school]);
  }
  return school;
}

async function waitHealth(child, err) {
  for (let i = 0; i < 240; i += 1) {
    if (child.exitCode != null) throw new Error(`exit ${child.exitCode}\n${err.v}`);
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("health timeout\n" + err.v);
}

async function timed(pathname, token) {
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/api${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  return { path: pathname, status: res.status, ms: Math.round(performance.now() - t0), bytes: body.length };
}

const BURST = [
  "/auth/effective-permissions",
  "/students", "/teachers", "/classes", "/backoffice/users", "/assignments", "/backoffice/relations",
  "/backoffice/establishments/P0-A", "/backoffice/establishments/P0-A/academic-config",
];

(async () => {
  const owned = await createOwnedDisposableDatabase(URL0);
  await owned.pool.end();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  const repo = createPostgresRepository(owned.connectionString);
  let child;
  const out = { label, volume: { otherSchools: OTHER, studentsPerSchool: STUDENTS, days: DAYS } };
  try {
    await repo.init();
    const pool = repo.pool;
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
    const country = (await pool.query(`INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Testland','TL','+000','XOF') RETURNING id`)).rows[0].id;
    await seedSchool(pool, country, "P0-A", 200, 20, true);
    for (let s = 0; s < OTHER; s += 1) await seedSchool(pool, country, `P0-O${s}`, STUDENTS, DAYS, false);
    out.rows = (await pool.query(`SELECT (SELECT count(*) FROM attendance)::int attendance, (SELECT count(*) FROM students)::int students, (SELECT count(*) FROM payments)::int payments`)).rows[0];
    await pool.query("ANALYZE");

    const err = { v: "" };
    child = spawn(process.execPath, [...(process.env.NODE_HEAP ? [`--max-old-space-size=${process.env.NODE_HEAP}`] : []), "backend/server.js"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "test", PORT: String(PORT), DATABASE_URL: owned.connectionString, JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true", SOMAFRIK_SKIP_DEMO_SEED: "true", SOMAFRIK_API_ONLY: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (c) => { err.v += String(c); });
    child.stdout.on("data", () => {});
    await waitHealth(child, err);

    const tokens = new TokenService({ secret: JWT_SECRET });
    const token = await mintSessionAccessToken({ tokens, repository: repo, payload: {
      sub: ADMIN, schoolCode: "P0-A", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], mustChangePassword: false,
    } });

    const fs = require("node:fs");
    const rssMiB = () => {
      try {
        const m = fs.readFileSync(`/proc/${child.pid}/status`, "utf8").match(/VmRSS:\s+(\d+) kB/);
        return m ? Math.round(Number(m[1]) / 1024) : null;
      } catch { return null; }
    };
    out.idleRssMiB = rssMiB();
    const burst = async () => {
      let peak = rssMiB() ?? 0;
      const sampler = setInterval(() => { peak = Math.max(peak, rssMiB() ?? 0); }, 50);
      await pool.query("SELECT pg_stat_statements_reset()");
      const t0 = performance.now();
      const results = await Promise.all(BURST.map((p) => timed(p, token)));
      const wall = Math.round(performance.now() - t0);
      const stats = (await pool.query(`SELECT calls::int, round(total_exec_time)::int ms, rows::bigint, left(regexp_replace(query, '\\s+', ' ', 'g'), 90) q
        FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' ORDER BY total_exec_time DESC LIMIT 6`)).rows;
      const totals = (await pool.query(`SELECT coalesce(sum(calls),0)::int calls, coalesce(round(sum(total_exec_time)),0)::int ms, coalesce(sum(rows),0)::bigint rows FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'`)).rows[0];
      clearInterval(sampler);
      return { wallMs: wall, peakRssMiB: peak, requests: results, sql: totals, topSql: stats };
    };
    try {
      out.firstBurst = await burst();
    } catch (error) {
      await new Promise((r) => setTimeout(r, 500));
      out.crash = { message: String(error?.cause?.message ?? error.message), serverExit: child.exitCode, signal: child.signalCode, stderrTail: err.v.slice(-600) };
      console.log("P0BENCH " + JSON.stringify(out));
      return;
    }
    out.secondBurst = await burst();
    await pool.query("SELECT pg_stat_statements_reset()");
    const single = await timed("/auth/effective-permissions", token);
    out.singleEffectivePermissions = { ...single, sql: (await pool.query(`SELECT coalesce(sum(calls),0)::int calls, coalesce(sum(rows),0)::bigint rows FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'`)).rows[0] };
    console.log("P0BENCH " + JSON.stringify(out));
  } finally {
    if (child && child.exitCode == null) child.kill("SIGKILL");
    await repo.close().catch(() => {});
    await dropOwnedDisposableDatabase(URL0, owned.databaseName, owned.token);
  }
})().catch((e) => { console.error(e); process.exit(1); });
