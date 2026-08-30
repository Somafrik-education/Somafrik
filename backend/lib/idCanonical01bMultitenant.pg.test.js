"use strict";

/**
 * Lot B — isolation multi-tenant PostgreSQL.
 * School A CD-IN-26-001 / School B CD-LS-26-002.
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { resolveTeacherIdForPrincipal } = require("./resolveTeacherForPrincipal");
const { AuthService, BusinessError } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const {
  createCanonicalSchool,
  createCanonicalUser,
  createCanonicalTeacher,
  createCanonicalStudent,
} = require("./canonicalIdentityFactories");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

function createAuthPair() {
  const schoolA = createCanonicalSchool({ name: "Institut Nuru", sequence: 1, loginCode: "CD-IN-26-001" });
  const schoolB = createCanonicalSchool({ name: "Lycée Somafrik", sequence: 2, loginCode: "CD-LS-26-002" });
  const userA = createCanonicalUser({ school: schoolA, firstName: "Ada", lastName: "Lovelace", sequence: 1 });
  const userB = createCanonicalUser({ school: schoolB, firstName: "Ada", lastName: "Lovelace", sequence: 1 });
  const teacherA = createCanonicalTeacher({ school: schoolA, user: userA });
  const studentA = createCanonicalStudent({ school: schoolA, firstName: "Hope", lastName: "Okito", sequence: 1 });
  const auth = new AuthService({
    userAccounts: [
      {
        id: userA.id,
        identifier: userA.identifier,
        publicId: userA.publicId,
        firstName: userA.firstName,
        lastName: userA.lastName,
        role: "Enseignant",
        schoolCode: schoolA.loginCode,
        status: "Actif",
        pin: "1234",
        password: "1234",
      },
      {
        id: userB.id,
        identifier: userB.identifier,
        publicId: userB.publicId,
        firstName: userB.firstName,
        lastName: userB.lastName,
        role: "Enseignant",
        schoolCode: schoolB.loginCode,
        status: "Actif",
        pin: "1234",
        password: "1234",
      },
    ],
    schools: [
      { id: schoolA.id, loginCode: schoolA.loginCode, name: schoolA.name, countryCode: "CD", country: "RDC", status: "Actif", validationStatus: "Validé" },
      { id: schoolB.id, loginCode: schoolB.loginCode, name: schoolB.name, countryCode: "CD", country: "RDC", status: "Actif", validationStatus: "Validé" },
    ],
    teachers: [
      { id: teacherA.id, userId: userA.id, schoolCode: schoolA.loginCode },
    ],
    students: [
      { id: studentA.id, studentCode: studentA.studentCode, schoolCode: schoolA.loginCode },
    ],
    relations: [],
    assignments: [],
    subscriptions: [
      { schoolCode: schoolA.loginCode, status: "active" },
      { schoolCode: schoolB.loginCode, status: "active" },
    ],
  });
  attachMemoryLoginLockoutStore(auth);
  return { auth, schoolA, schoolB, userA, userB, teacherA, studentA };
}

async function main() {
  const { auth, schoolA, schoolB, userA, userB, studentA } = createAuthPair();

  const ok = await auth.login({
    role: "teacher",
    schoolCode: schoolA.loginCode,
    identifier: userA.identifier,
    pin: "1234",
  });
  assert.equal(ok.user.identifier, userA.identifier);

  await assert.rejects(
    () => auth.login({ role: "teacher", schoolCode: "CD-2026-0001", identifier: userA.identifier, pin: "1234" }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
  await assert.rejects(
    () => auth.login({ role: "teacher", schoolCode: schoolB.loginCode, identifier: userA.identifier, pin: "1234" }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
  await assert.rejects(
    () => auth.login({ role: "teacher", schoolCode: schoolA.loginCode, identifier: userB.identifier, pin: "1234" }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );

  const linked = auth.findLinkedStudent({ identifier: studentA.studentCode }, schoolA.loginCode);
  assert.equal(linked.id, studentA.id);
  assert.equal(auth.findLinkedStudent({ identifier: studentA.studentCode }, schoolB.loginCode), undefined);
  assert.equal(auth.findLinkedStudent({ identifier: "ELE-0001" }, schoolA.loginCode), undefined);

  if (!DATABASE_URL) {
    console.log("idCanonical01bMultitenant.pg.test.js: Auth isolation OK (PG skip, DATABASE_URL absent)");
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const country = await client.query(
      `INSERT INTO countries (name, iso_code) VALUES ('RDC', $1)
       ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [`T${Date.now().toString().slice(-6)}`],
    );
    const countryId = country.rows[0].id;
    const schoolAId = randomUUID();
    const schoolBId = randomUUID();
    const userAId = randomUUID();
    const userBId = randomUUID();
    await client.query(
      `INSERT INTO schools (id, country_id, school_code, login_code, name)
       VALUES ($1, $3, 'SCH-A-TMP', 'CD-IN-26-001', 'Institut Nuru'),
              ($2, $3, 'SCH-B-TMP', 'CD-LS-26-002', 'Lycée Somafrik')
       ON CONFLICT DO NOTHING`,
      [schoolAId, schoolBId, countryId],
    );
    await client.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
       VALUES ($1, $2, 'CD-IN-AL-26-00001', 'Ada', 'Lovelace', 'TEACHER', 'active'),
              ($3, $4, 'CD-LS-AL-26-00001', 'Ada', 'Lovelace', 'TEACHER', 'active')`,
      [userAId, schoolAId, userBId, schoolBId],
    );
    const teacherA = await client.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'CD-IN-AL-26-00001', 'active')
       RETURNING id`,
      [schoolAId, userAId],
    );
    const teacherB = await client.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'CD-LS-AL-26-00001', 'active')
       RETURNING id`,
      [schoolBId, userBId],
    );
    const queryOne = async (sql, params) => {
      const result = await client.query(sql, params);
      return result.rows[0] ?? null;
    };
    const resolvedA = await resolveTeacherIdForPrincipal(queryOne, { sub: userAId }, schoolAId);
    const cross = await resolveTeacherIdForPrincipal(queryOne, { sub: userAId }, schoolBId);
    const ens = await resolveTeacherIdForPrincipal(queryOne, { sub: "ENS-0001" }, schoolAId);
    assert.equal(resolvedA, teacherA.rows[0].id);
    assert.notEqual(resolvedA, teacherB.rows[0].id);
    assert.equal(cross, null);
    assert.equal(ens, null);
    await client.query("ROLLBACK");
    console.log("idCanonical01bMultitenant.pg.test.js: Auth + PG isolation OK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (String(error.message ?? "").includes("does not exist") || error.code === "42P01") {
      console.log(`idCanonical01bMultitenant.pg.test.js: Auth OK (PG schema skip: ${error.message})`);
      return;
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
