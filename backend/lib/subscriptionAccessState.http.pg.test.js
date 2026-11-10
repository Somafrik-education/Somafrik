"use strict";

/**
 * P0-WEB-01 — contrôle d'abonnement par requête : état ciblé, équivalent et en direct.
 *
 * 1. `listSubscriptionAccessState()` renvoie exactement les écoles de `getDataset().platformSchools`
 *    et les abonnements de `listPlatformProjection()` (même SQL, même transformation).
 * 2. Le verdict `assertSchoolCanConnect` est identique sur l'état ciblé et sur l'état autoritatif.
 * 3. HTTP réel : une école suspendue est refusée (403) sur une route métier et sur
 *    effective-permissions ; une suspension posée pendant que le serveur tourne s'applique
 *    à la requête suivante (aucun cache) ; une école active passe.
 * 4. Le contrôle et la fiche établissement ne rechargent plus l'état back-office complet.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { mintSessionAccessToken } = require("./testAccessSession");
const { assertSchoolCanConnect } = require("../services/schoolSubscriptionAccessService");
const {
  assertOwnedDisposable,
  createOwnedDisposableDatabase,
  dropOwnedDisposableDatabase,
} = require("./perfPr1DisposableDatabase");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_P0_WEB_01_HTTP_PORT ?? 19961);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const ADMIN_A = "f0000000-0000-4000-8000-0000000000a1";
const ADMIN_B = "f0000000-0000-4000-8000-0000000000b1";

function staticChecks() {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const loader = server.slice(
    server.indexOf("async function getSubscriptionAccessState"),
    server.indexOf("async function listResidualDomainForPrincipal"),
  );
  assert.ok(loader.length > 0, "fonction getSubscriptionAccessState trouvée");
  assert.match(loader, /repository\.listSubscriptionAccessState\(\)/);
  // Seul le repli des dépôts sans lecture ciblée peut recharger l'état complet.
  assert.doesNotMatch(loader.replace(/if \(typeof repository\.listSubscriptionAccessState !== "function"\) \{[^}]*\}/, ""), /Projection|getRuntime|getDataset|getAuthoritativeBackOfficeState/, "aucune projection dans le contrôle ciblé");
  assert.match(server, /assertActiveSchoolRequest\(req\.principal, req\.path, getSubscriptionAccessState\)/);
  assert.doesNotMatch(server, /assertActiveSchoolRequest\([^)]*getAuthoritativeBackOfficeState/);
  const establishment = server.slice(
    server.indexOf('app.get("/api/backoffice/establishments/:code", requireAuth'),
    server.indexOf('app.post("/api/backoffice/establishments", requireAuth'),
  );
  assert.match(establishment, /getSubscriptionAccessState\(\)/);
  assert.doesNotMatch(establishment, /getAuthoritativeBackOfficeState/);
  const refresh = server.slice(
    server.indexOf("async function issueRefreshedAccessToken"),
    server.indexOf("let permissions = mergePermissionsForRoles(roleKeys, rolePermissionsMap);"),
  );
  assert.match(refresh, /getSubscriptionAccessState\(\)/);
}

async function request(pathname, token) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await response.text();
  return response.status;
}

async function waitForHealth(child, stderr) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderr.value}`);
    try {
      if ((await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderr.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function seedSchool(pool, country, code, status, admin) {
  const school = (
    await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [country, code, `${code}-L`, `Ecole ${code}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
     VALUES ($1, 'standard', 'XOF', $2, CURRENT_DATE - 30, CURRENT_DATE + 300)`,
    [school, status],
  );
  const year = (
    await pool.query(`INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2026-2027', true, 'open') RETURNING id`, [school])
  ).rows[0].id;
  const klass = (
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1, $2, $3, '6e A', 'active') RETURNING id`,
      [school, year, `${code}-6A`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     SELECT $1, $2 || '-S' || g, 'Prenom', 'Nom' || g, 'active' FROM generate_series(1, 5) g`,
    [school, code],
  );
  await pool.query(
    `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
     SELECT $1, st.id, $2, CURRENT_DATE - d, 'present' FROM students st CROSS JOIN generate_series(1, 3) d WHERE st.school_id = $1`,
    [school, klass],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES ($1, $2, $3, 'Ada', 'Admin', $4, NULL, 'active', FALSE)`,
    [admin, school, `${code}-ADMIN`, `${code.toLowerCase()}-admin@test.local`],
  );
  await pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, 'SCHOOL_ADMIN', 'active')`, [admin, school]);
  return school;
}

async function main() {
  staticChecks();
  if (!DATABASE_URL) {
    console.log("subscriptionAccessState.http.pg.test.js: contrôles statiques OK ; SKIP PostgreSQL (DATABASE_URL absent)");
    return;
  }
  const owned = await createOwnedDisposableDatabase(DATABASE_URL);
  await assertOwnedDisposable(owned.pool, owned.databaseName, owned.token);
  await owned.pool.end();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(owned.connectionString);
  const tokens = new TokenService({ secret: JWT_SECRET });
  let child = null;
  try {
    await repo.init();
    const pool = repo.pool;
    const country = (
      await pool.query(`INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Testland', 'TL', '+000', 'XOF') RETURNING id`)
    ).rows[0].id;
    const schoolA = await seedSchool(pool, country, "P0W-A", "active", ADMIN_A);
    await seedSchool(pool, country, "P0W-B", "suspended", ADMIN_B);

    // 1. Équivalence stricte avec les sources de l'état autoritatif.
    const targeted = await repo.listSubscriptionAccessState();
    const dataset = await repo.getDataset();
    const platform = await repo.listPlatformProjection();
    assert.deepEqual(targeted.schools, dataset.platformSchools, "écoles identiques à getDataset().platformSchools");
    assert.deepEqual(targeted.subscriptions, platform.subscriptions, "abonnements identiques à listPlatformProjection()");
    assert.ok(!("presences" in targeted) && !("notes" in targeted) && !("payments" in targeted) && !("students" in targeted));

    // 2. Même verdict d'accès sur les deux états.
    const authoritative = { schools: dataset.platformSchools, subscriptions: platform.subscriptions };
    for (const code of ["P0W-A", "P0W-B", "INCONNU"]) {
      const verdict = (state) => {
        try {
          assertSchoolCanConnect(code, state);
          return "ok";
        } catch (error) {
          return `refus ${error.statusCode}`;
        }
      };
      assert.equal(verdict(targeted), verdict(authoritative), `verdict identique pour ${code}`);
    }

    // 3. HTTP réel.
    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: owned.connectionString,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderr.value += String(chunk);
    });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderr);

    const claims = (sub, schoolCode) => ({ sub, schoolCode, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], mustChangePassword: false });
    const tokenA = await mintSessionAccessToken({ tokens, repository: repo, payload: claims(ADMIN_A, "P0W-A") });
    const tokenB = await mintSessionAccessToken({ tokens, repository: repo, payload: claims(ADMIN_B, "P0W-B") });

    for (const route of ["/auth/effective-permissions", "/students", "/classes", "/backoffice/establishments/P0W-A"]) {
      assert.equal(await request(route, tokenA), 200, `${route} école active`);
    }
    for (const route of ["/auth/effective-permissions", "/students", "/classes"]) {
      assert.equal(await request(route, tokenB), 403, `${route} école suspendue refusée`);
    }
    // Isolation : la fiche d'un autre établissement reste refusée.
    assert.notEqual(await request("/backoffice/establishments/P0W-B", tokenA), 200, "fiche d'un autre établissement refusée");

    // Suspension posée en base pendant que le serveur tourne : effet à la requête suivante.
    await pool.query(`UPDATE subscriptions SET status = 'suspended', updated_at = NOW() WHERE school_id = $1`, [schoolA]);
    assert.equal(await request("/students", tokenA), 403, "suspension appliquée en direct");
    assert.equal(await request("/auth/effective-permissions", tokenA), 403, "permissions refusées après suspension");
    await pool.query(`UPDATE subscriptions SET status = 'active', updated_at = NOW() WHERE school_id = $1`, [schoolA]);
    assert.equal(await request("/students", tokenA), 200, "réactivation appliquée en direct");

    console.log("OK subscriptionAccessState.http.pg.test.js — état ciblé équivalent, contrôle en direct, aucune projection");
  } finally {
    await stopChild(child);
    await repo.close().catch(() => {});
    await dropOwnedDisposableDatabase(DATABASE_URL, owned.databaseName, owned.token);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
