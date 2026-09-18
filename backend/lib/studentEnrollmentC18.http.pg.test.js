"use strict";

/**
 * LOT 2 — C18 + responsables + RBAC/tenant HTTP PostgreSQL.
 *   node --test backend/lib/studentEnrollmentC18.http.pg.test.js
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { test } = require("node:test");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
if (process.env.GITHUB_ACTIONS && !DATABASE_URL) {
  throw new Error("LOT 2: DATABASE_URL requis en GitHub Actions");
}

const IT_DATABASE = String(process.env.SOMAFRIK_LOT2_C18_IT_DATABASE ?? "somafrik_lot2_c18_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_LOT2_C18_HTTP_PORT ?? 19892);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const CLASS_A = "CLS-LAC-6A";
const CLASS_A2 = "CLS-LAC-6B";
const CLASS_OLD = "CLS-LAC-OLD";
const CLASS_B = "CLS-BUJ-6A";

const USER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const USER_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const USER_TEACHER = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const USER_PARENT = "cccccccc-cccc-4ccc-8ccc-cccccccccc04";
const USER_STUDENT = "cccccccc-cccc-4ccc-8ccc-cccccccccc05";
const STUDENT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc11";
const STUDENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc12";
const STUDENT_C18 = "cccccccc-cccc-4ccc-8ccc-cccccccccc13";
const STUDENT_RACE = "cccccccc-cccc-4ccc-8ccc-cccccccccc14";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
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

test("LOT 2 C18 + relations HTTP PG RBAC/tenant fail-closed", { timeout: 90_000 }, async (t) => {
  if (!DATABASE_URL) {
    t.skip("DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const mint = (payload) => tokens.createAccessToken({ mustChangePassword: false, ...payload });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);

    const cd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const bi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active') RETURNING id`,
      [cd.rows[0].id, LEFTOVER_A, LOGIN_A],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active') RETURNING id`,
      [bi.rows[0].id, LEFTOVER_B, LOGIN_B],
    );
    const schoolAId = schoolA.rows[0].id;
    const schoolBId = schoolB.rows[0].id;
    const yearA = await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
      [schoolAId],
    );
    const yearB = await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
      [schoolBId],
    );
    const yearOld = await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2025-2026', FALSE, 'closed') RETURNING id`,
      [schoolAId],
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, $3, '6ème A Lac', 'active'), ($4, $5, $6, '6ème A Buj', 'active'),
              ($1, $2, $7, '6ème B Lac', 'active'), ($1, $8, $9, 'Ancienne Lac', 'active')`,
      [schoolAId, yearA.rows[0].id, CLASS_A, schoolBId, yearB.rows[0].id, CLASS_B, CLASS_A2, yearOld.rows[0].id, CLASS_OLD],
    );
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES
         ($1, $4, 'STU-A-001', 'Eleve', 'A', 'active'),
         ($2, $5, 'STU-B-001', 'Eleve', 'B', 'active'),
         ($3, $4, 'STU-A-C18', 'Cedric', 'C18', 'active'),
         ($6, $4, 'STU-A-RACE', 'Race', 'C18', 'active')`,
      [STUDENT_A, STUDENT_B, STUDENT_C18, schoolAId, schoolBId, STUDENT_RACE],
    );
    // Le trigger d'identité réécrit tout student_code client en matricule canonique.
    const insertedStudents = await pool.query(
      `SELECT id::text AS id, student_code FROM students WHERE id = ANY($1::uuid[])`,
      [[STUDENT_A, STUDENT_B, STUDENT_C18, STUDENT_RACE]],
    );
    const codeById = Object.fromEntries(insertedStudents.rows.map((row) => [row.id, row.student_code]));
    const codeA = codeById[STUDENT_A];
    const codeB = codeById[STUDENT_B];
    const codeC18 = codeById[STUDENT_C18];
    const codeRace = codeById[STUDENT_RACE];
    assert.ok(codeA && codeB && codeC18 && codeRace, `codes=${JSON.stringify(codeById)}`);
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES
         ($1, $6, 'ADM-A', 'Aline', 'A', 'a@lot2.test', 'Admin School', 'active', FALSE),
         ($2, $7, 'ADM-B', 'Binta', 'B', 'b@lot2.test', 'Admin School', 'active', FALSE),
         ($3, $6, 'ENS-A', 'Marc', 'Prof', 't@lot2.test', 'Enseignant', 'active', FALSE),
         ($4, $6, 'PAR-A', 'Parent', 'A', 'p@lot2.test', 'Parent', 'active', FALSE),
         ($5, $6, 'USR-STU-A', 'Eleve', 'User', 's@lot2.test', NULL, 'active', FALSE)`,
      [USER_A, USER_B, USER_TEACHER, USER_PARENT, USER_STUDENT, schoolAId, schoolBId],
    );
    const classA = await pool.query(`SELECT id FROM classes WHERE class_code = $1`, [CLASS_A]);
    const classB = await pool.query(`SELECT id FROM classes WHERE class_code = $1`, [CLASS_B]);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'ENROLLED'), ($5, $6, $7, $8, 'ENROLLED'),
              ($1, $9, NULL, $4, 'PENDING_REVIEW'), ($1, $10, $3, $4, 'ENROLLED')`,
      [
        schoolAId,
        STUDENT_A,
        classA.rows[0].id,
        yearA.rows[0].id,
        schoolBId,
        STUDENT_B,
        classB.rows[0].id,
        yearB.rows[0].id,
        STUDENT_C18,
        STUDENT_RACE,
      ],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES
         ($1, $6, 'SCHOOL_ADMIN', 'active'),
         ($2, $7, 'SCHOOL_ADMIN', 'active'),
         ($3, $6, 'TEACHER', 'active'),
         ($4, $6, 'PARENT', 'active'),
         ($5, $6, 'STUDENT', 'active')`,
      [USER_A, USER_B, USER_TEACHER, USER_PARENT, USER_STUDENT, schoolAId, schoolBId],
    );

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    await waitForHealth(child, stderrRef);

    const adminPerms = ["ALL_PRIVILEGES", "Élèves:UPDATE", "Élèves:READ", "Relations:CREATE", "Relations:READ"];
    const tokenA = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: adminPerms,
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: adminPerms,
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Voir élèves", "Élèves:READ"],
      classCodes: [CLASS_A],
      assignments: [{ classCode: CLASS_A, status: "active" }],
    });
    const tokenParent = mint({
      sub: USER_PARENT,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Voir enfant", "Élèves:READ"],
      studentIds: [STUDENT_A, codeA],
    });
    const tokenStudent = mint({
      sub: USER_STUDENT,
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ"],
      studentIds: [STUDENT_A, codeA],
    });

    const listed = await request(`/students/${encodeURIComponent(codeC18)}/enrollments`, { token: tokenA });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const enrollmentId = listed.data.items[0].id;
    assert.equal(listed.data.items[0].status, "PENDING_REVIEW");
    const listedByUuid = await request(`/students/${STUDENT_C18}/enrollments`, { token: tokenA });
    assert.equal(listedByUuid.status, 200, JSON.stringify(listedByUuid.data));
    const listedOwn = await request(`/students/${encodeURIComponent(codeA)}/enrollments`, { token: tokenA });
    assert.equal(listedOwn.status, 200, JSON.stringify(listedOwn.data));
    const ownEnrollmentId = listedOwn.data.items[0].id;

    const otherTenant = await request(`/students/${encodeURIComponent(codeC18)}/enrollments`, { token: tokenB });
    assert.ok(otherTenant.status === 403 || otherTenant.status === 404, `tenant B status=${otherTenant.status}`);

    const headerWiden = await request(`/students/${encodeURIComponent(codeB)}/enrollments`, {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    assert.ok(headerWiden.status === 403 || headerWiden.status === 404, `header widen status=${headerWiden.status}`);

    const validated = await request(`/students/${encodeURIComponent(codeC18)}/enrollments/${enrollmentId}/validate`, {
      method: "POST",
      token: tokenA,
      body: {},
    });
    assert.equal(validated.status, 200, JSON.stringify(validated.data));
    assert.equal(validated.data.status, "APPROVED");

    const assigned = await request(`/students/${encodeURIComponent(codeC18)}/enrollments/${enrollmentId}/assign-class`, {
      method: "POST",
      token: tokenA,
      body: { classCode: CLASS_A },
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    assert.equal(assigned.data.status, "ENROLLED");

    const transferred = await request(`/students/${encodeURIComponent(codeC18)}/enrollments/${enrollmentId}/transfer`, {
      method: "POST",
      token: tokenA,
      body: { destinationSchoolName: "Lycée Horizon" },
    });
    assert.equal(transferred.status, 200, JSON.stringify(transferred.data));
    assert.equal(transferred.data.status, "TRANSFERRED");

    const reverse = await request(`/students/${encodeURIComponent(codeC18)}/enrollments/${enrollmentId}/validate`, {
      method: "POST",
      token: tokenA,
      body: {},
    });
    assert.equal(reverse.status, 409, "terminal: pas de retour arrière");

    async function latestAudit(action) {
      const rows = await pool.query(
        `SELECT action, entity_type, entity_id, old_value, new_value
           FROM audit_logs WHERE action = $1 ORDER BY created_at DESC LIMIT 1`,
        [action],
      );
      assert.equal(rows.rowCount, 1, `audit ${action} manquant`);
      const row = rows.rows[0];
      const parsed = typeof row.new_value === "string" ? JSON.parse(row.new_value) : row.new_value;
      return { ...row, parsed };
    }
    const auditValidate = await latestAudit("c18_validate");
    assert.equal(auditValidate.entity_type, "enrollment");
    assert.equal(auditValidate.parsed.action, "validate");
    assert.equal(auditValidate.parsed.fromStatus, "PENDING_REVIEW");
    assert.equal(auditValidate.parsed.toStatus, "APPROVED");
    assert.equal(String(auditValidate.parsed.actorId), USER_A);
    const auditAssignFirst = await latestAudit("c18_assign-class");
    assert.equal(auditAssignFirst.parsed.action, "assign-class");
    assert.equal(auditAssignFirst.parsed.toStatus, "ENROLLED");
    const auditTransfer = await latestAudit("c18_transfer");
    assert.equal(auditTransfer.parsed.action, "transfer");
    assert.equal(auditTransfer.parsed.toStatus, "TRANSFERRED");
    assert.equal(auditTransfer.parsed.destination, "Lycée Horizon");

    const teacherOwn = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenTeacher });
    assert.equal(teacherOwn.status, 200, JSON.stringify(teacherOwn.data));
    const teacherOther = await request(`/students/${encodeURIComponent(codeB)}`, { token: tokenTeacher });
    assert.ok(teacherOther.status === 403 || teacherOther.status === 404);
    const teacherMut = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/close`, {
      method: "POST",
      token: tokenTeacher,
      body: {},
    });
    assert.equal(teacherMut.status, 403);

    const parentOwn = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenParent });
    assert.equal(parentOwn.status, 200, JSON.stringify(parentOwn.data));
    const parentOther = await request(`/students/${encodeURIComponent(codeC18)}`, { token: tokenParent });
    assert.ok(parentOther.status === 403 || parentOther.status === 404);
    const parentMut = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/close`, {
      method: "POST",
      token: tokenParent,
      body: {},
    });
    assert.equal(parentMut.status, 403);

    const studentOwn = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenStudent });
    assert.equal(studentOwn.status, 200, JSON.stringify(studentOwn.data));
    const studentMut = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/close`, {
      method: "POST",
      token: tokenStudent,
      body: {},
    });
    assert.equal(studentMut.status, 403);

    const noDate = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/assign-class`, {
      method: "POST",
      token: tokenA,
      body: { classCode: CLASS_A2 },
    });
    assert.equal(noDate.status, 409, JSON.stringify(noDate.data));
    const wrongYear = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/assign-class`, {
      method: "POST",
      token: tokenA,
      body: { classCode: CLASS_OLD, effectiveDate: "2026-09-18" },
    });
    assert.equal(wrongYear.status, 409, JSON.stringify(wrongYear.data));
    const tenantAssign = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/assign-class`, {
      method: "POST",
      token: tokenB,
      body: { classCode: CLASS_A2, effectiveDate: "2026-09-18" },
    });
    assert.ok(tenantAssign.status === 403 || tenantAssign.status === 404, `tenant assign status=${tenantAssign.status}`);
    const moved = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/assign-class`, {
      method: "POST",
      token: tokenA,
      body: { classCode: CLASS_A2, effectiveDate: "2026-09-18" },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.equal(moved.data.status, "ENROLLED");
    assert.equal(moved.data.classCode, CLASS_A2);
    const auditMoved = await latestAudit("c18_assign-class");
    assert.equal(auditMoved.parsed.effectiveDate, "2026-09-18");
    assert.equal(auditMoved.parsed.toStatus, "ENROLLED");
    assert.equal(auditMoved.parsed.classCode, CLASS_A2);
    const closed = await request(`/students/${encodeURIComponent(codeA)}/enrollments/${ownEnrollmentId}/close`, {
      method: "POST",
      token: tokenA,
      body: { reason: "fin d'année" },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.status, "CLOSED");
    const auditClose = await latestAudit("c18_close");
    assert.equal(auditClose.parsed.action, "close");
    assert.equal(auditClose.parsed.fromStatus, "ENROLLED");
    assert.equal(auditClose.parsed.toStatus, "CLOSED");

    const raceListed = await request(`/students/${encodeURIComponent(codeRace)}/enrollments`, { token: tokenA });
    assert.equal(raceListed.status, 200, JSON.stringify(raceListed.data));
    const raceEnrollmentId = raceListed.data.items[0].id;
    const [xferRace, closeRace] = await Promise.all([
      request(`/students/${encodeURIComponent(codeRace)}/enrollments/${raceEnrollmentId}/transfer`, {
        method: "POST",
        token: tokenA,
        body: { destinationSchoolName: "Lycée Horizon" },
      }),
      request(`/students/${encodeURIComponent(codeRace)}/enrollments/${raceEnrollmentId}/close`, {
        method: "POST",
        token: tokenA,
        body: { reason: "clôture concurrente" },
      }),
    ]);
    const raceStatuses = [xferRace.status, closeRace.status].sort((left, right) => left - right);
    assert.deepEqual(raceStatuses, [200, 409], JSON.stringify({ xferRace, closeRace }));
    const raceWinner = xferRace.status === 200 ? xferRace.data : closeRace.data;
    assert.ok(raceWinner.status === "TRANSFERRED" || raceWinner.status === "CLOSED");
    const raceAfter = await request(`/students/${encodeURIComponent(codeRace)}/enrollments`, { token: tokenA });
    assert.equal(raceAfter.status, 200, JSON.stringify(raceAfter.data));
    assert.equal(raceAfter.data.items[0].status, raceWinner.status);
    const raceAudits = await pool.query(
      `SELECT action FROM audit_logs
        WHERE entity_id = $1 AND action IN ('c18_transfer', 'c18_close')`,
      [raceEnrollmentId],
    );
    assert.equal(raceAudits.rowCount, 1, JSON.stringify(raceAudits.rows));

    const relationsMissing = await request("/parents/relations", { token: tokenA });
    assert.equal(relationsMissing.status, 400);
    const relationsA = await request(`/parents/relations?studentId=${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(relationsA.status, 200, JSON.stringify(relationsA.data));
    const relationsB = await request(`/parents/relations?studentId=${encodeURIComponent(codeA)}`, { token: tokenB });
    assert.ok(relationsB.status === 403 || relationsB.status === 404);
  } finally {
    await stopChild(child);
    await pool.end();
    await repo.close?.();
  }
});
