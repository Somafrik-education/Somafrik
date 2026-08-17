/**
 * Alimente PostgreSQL avec le jeu de données bulk (3 pays, 3 établissements, 300 élèves/école, etc.).
 *
 * Usage :
 *   node backend/scripts/seed-platform-bulk.js
 *   node backend/scripts/seed-platform-bulk.js --fresh
 *   node backend/scripts/seed-platform-bulk.js --fresh --bootstrap
 *
 * Prérequis : PostgreSQL accessible (DATABASE_URL ou POSTGRES_*).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { buildEmptyBackOfficeState } = require("../lib/emptyBackOfficeState");
const { buildBulkPlatformSeed } = require("../lib/bulkPlatformSeed");
const { hashSecret } = require("../services/credentialService");

const ROLE_TO_DB = {
  "Super Administrateur Somafrik": "SUPER_ADMIN",
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

const TABLES = [
  "sessions",
  "audit_logs",
  "backoffice_state",
  "notifications",
  "announcements",
  "payments",
  "attendance",
  "promotion_decisions",
  "student_documents",
  "exam_results",
  "exams",
  "grades",
  "teacher_assignments",
  "enrollments",
  "students",
  "teachers",
  "subject_class_assignments",
  "subjects",
  "classes",
  "terms",
  "academic_years",
  "users",
  "subscriptions",
  "schools",
  "countries",
];

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const match = String(value).match(/^(\d{2})-(\d{2})-(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function toAttendanceStatus(status, present) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (["present", "présent"].includes(normalized)) return "present";
  if (["late", "retard"].includes(normalized)) return "late";
  if (["excused", "justifié", "justifie"].includes(normalized)) return "excused";
  if (["absent", "absence"].includes(normalized)) return "absent";
  return present ? "present" : "absent";
}

function subjectCode(name) {
  return `SUB-${String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()}`;
}

async function one(client, sql, params) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

async function wipeDatabase(pool) {
  await pool.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  const payload = buildEmptyBackOfficeState();
  await pool.query(
    `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
    [JSON.stringify(payload)],
  );
}

async function insertCountries(client, countries) {
  const ids = new Map();
  for (const country of countries) {
    const row = await one(
      client,
      `INSERT INTO countries (name, iso_code, phone_code, currency, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, iso_code`,
      [country.name, country.code, country.phonePrefix, country.currency],
    );
    ids.set(country.code, row.id);
    if (country.code === "CD") ids.set("RDC", row.id);
  }
  return ids;
}

async function insertSchools(client, platformSchools, countryIds) {
  const ids = new Map();
  for (const school of platformSchools) {
    const iso = school.code.slice(0, 2);
    const countryId = countryIds.get(iso);
    const row = await one(
      client,
      `INSERT INTO schools (country_id, school_code, name, logo_url, address, city, phone, email, school_type, status, created_at, updated_at)
       VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, 'active', NOW(), NOW())
       ON CONFLICT (school_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, school_code`,
      [countryId, school.code, school.name, school.address, school.city, school.phone, school.email, school.type],
    );
    ids.set(school.code, row.id);
  }
  return ids;
}

async function insertSubscriptions(client, subscriptions, schoolIds) {
  for (const subscription of subscriptions) {
    const schoolId = schoolIds.get(subscription.schoolCode);
    if (!schoolId) continue;
    await client.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date, end_date)
       VALUES ($1, $2, $3, $4, 'monthly', 'active', $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        schoolId,
        subscription.plan,
        subscription.monthlyPrice ?? 0,
        subscription.currency ?? "USD",
        parseDate(subscription.startDate),
        parseDate(subscription.endDate),
      ],
    );
  }
}

async function insertUsers(client, userAccounts, schoolIds) {
  const passwordHash = hashSecret("1234");
  for (const user of userAccounts) {
    const schoolId = user.schoolCode === "*" ? null : schoolIds.get(user.schoolCode) ?? null;
    await client.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW())
       ON CONFLICT (user_code) DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         password_hash = EXCLUDED.password_hash,
         pin_hash = EXCLUDED.pin_hash,
         role = EXCLUDED.role,
         school_id = EXCLUDED.school_id`,
      [
        schoolId,
        user.publicId,
        user.firstName,
        user.lastName,
        user.email ?? "",
        user.phone ?? "",
        user.password ? hashSecret(user.password) : passwordHash,
        hashSecret(user.password ?? "1234"),
        ROLE_TO_DB[user.role] ?? "SCHOOL_ADMIN",
      ],
    );
  }
}

async function insertSchoolBundle(client, bundle, schoolId) {
  const { school, classes, courses, teachers, students, assignments, notes, presences, payments, announcements, exams, documents } =
    bundle;

  const academicYear = await one(
    client,
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', TRUE, 'open')
     ON CONFLICT (school_id, name) DO UPDATE SET is_current = TRUE
     RETURNING id`,
    [schoolId],
  );

  const term = await one(
    client,
    `INSERT INTO terms (academic_year_id, name, start_date, end_date, status)
     VALUES ($1, 'Trimestre 1', '2025-09-01', '2025-12-31', 'published')
     ON CONFLICT (academic_year_id, name) DO UPDATE SET status = 'published'
     RETURNING id`,
    [academicYear.id],
  );

  const classIds = new Map();
  for (const schoolClass of classes) {
    const row = await one(
      client,
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, level, section, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (class_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [schoolId, academicYear.id, schoolClass.publicId, schoolClass.name, schoolClass.level, schoolClass.track],
    );
    classIds.set(schoolClass.id, row.id);
    classIds.set(schoolClass.name, row.id);
  }

  const subjectIds = new Map();
  for (const course of courses) {
    const code = `${school.code}-${subjectCode(course.name)}`.slice(0, 64);
    const row = await one(
      client,
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (subject_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [schoolId, code, course.name, course.coefficient ?? 1],
    );
    subjectIds.set(course.name, row.id);
  }

  const teacherIds = new Map();
  const pinHash = hashSecret("1234");
  for (const teacher of teachers) {
    const user = await one(
      client,
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'TEACHER', 'active')
       ON CONFLICT (user_code) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id`,
      [
        schoolId,
        `USR-${teacher.publicId}`.slice(0, 64),
        teacher.firstName,
        teacher.name.replace(teacher.firstName, "").trim() || teacher.name,
        teacher.email,
        teacher.phone,
        pinHash,
      ],
    );
    const row = await one(
      client,
      `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, hire_date, status)
       VALUES ($1, $2, $3, $4, '2025-09-01', 'active')
       ON CONFLICT (teacher_code) DO UPDATE SET speciality = EXCLUDED.speciality, user_id = EXCLUDED.user_id
       RETURNING id`,
      [schoolId, user.id, teacher.publicId, teacher.mainSubject],
    );
    teacherIds.set(teacher.id, row.id);
  }

  const studentIds = new Map();
  for (const student of students) {
    const row = await one(
      client,
      `INSERT INTO students (school_id, student_code, first_name, last_name, gender, birth_date, birth_place, photo_url, parent_phone, parent_email, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, 'active')
       ON CONFLICT (student_code) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id`,
      [
        schoolId,
        student.matricule,
        student.firstName,
        student.name.replace(student.firstName, "").trim() || student.name,
        student.gender,
        parseDate(student.birthDate),
        student.parentPhone,
        student.parentEmail,
      ],
    );
    studentIds.set(student.id, row.id);

    await client.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'STUDENT', 'active')
       ON CONFLICT (user_code) DO UPDATE SET pin_hash = EXCLUDED.pin_hash`,
      [
        schoolId,
        student.matricule,
        student.firstName,
        student.name.replace(student.firstName, "").trim() || student.name,
        student.parentEmail,
        student.parentPhone,
        pinHash,
      ],
    );

    const classId = classIds.get(student.className);
    if (classId) {
      await client.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
         VALUES ($1, $2, $3, $4, '2025-09-01', 'active')
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET class_id = EXCLUDED.class_id`,
        [schoolId, row.id, classId, academicYear.id],
      );
    }
  }

  for (const assignment of assignments) {
    const teacherId = teacherIds.get(assignment.teacherId);
    const classId = classIds.get(assignment.className);
    const subjectId = subjectIds.get(assignment.subject);
    if (!teacherId || !classId || !subjectId) continue;
    await client.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status)
       VALUES ($1, $2, $3, $4, $5, 'primary', 'active')
       ON CONFLICT DO NOTHING`,
      [schoolId, teacherId, classId, subjectId, academicYear.id],
    );
  }

  for (const note of notes) {
    const student = students.find((item) => item.id === note.studentId);
    const studentId = studentIds.get(note.studentId);
    const classId = student ? classIds.get(student.className) : null;
    const subjectId = subjectIds.get(note.subject);
    const teacherId = teacherIds.get(note.authorId) ?? [...teacherIds.values()][0];
    if (!studentId || !classId || !subjectId || !teacherId) continue;
    await client.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type, score, max_score, coefficient, comment)
       VALUES ($1, $2, $3, $4, $5, $6, 'devoir', $7, $8, $9, '')`,
      [schoolId, studentId, classId, subjectId, teacherId, term.id, note.value, note.scale ?? 20, note.coefficient ?? 1],
    );
  }

  for (const presence of presences) {
    const student = students.find((item) => item.id === presence.studentId);
    const studentId = studentIds.get(presence.studentId);
    const classId = student ? classIds.get(student.className) : null;
    if (!studentId || !classId) continue;
    await client.query(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status, reason)
       VALUES ($1, $2, $3, NULL, $4, $5, '')`,
      [schoolId, studentId, classId, parseDate(presence.date), toAttendanceStatus(presence.status, presence.present)],
    );
  }

  for (const payment of payments) {
    const studentId = studentIds.get(payment.studentId);
    if (!studentId) continue;
    await client.query(
      `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Frais scolaires')`,
      [
        schoolId,
        studentId,
        payment.publicId,
        payment.amount,
        "CDF",
        payment.method === "Especes" ? "cash" : "mobile_money",
        payment.status === "PAYE" ? "paid" : "pending",
        parseDate(payment.date),
      ],
    );
  }

  const adminUser = await one(
    client,
    `SELECT id FROM users WHERE school_id = $1 AND role = 'SCHOOL_ADMIN' ORDER BY created_at LIMIT 1`,
    [schoolId],
  );

  for (const announcement of announcements) {
    await client.query(
      `INSERT INTO announcements (school_id, title, message, target_role, created_by, published_at, status)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'published')`,
      [schoolId, announcement.title, announcement.message, announcement.audience, adminUser?.id ?? null],
    );
  }

  for (const [index, exam] of exams.entries()) {
    const classId = classIds.get(exam.className);
    const subjectId = subjectIds.get(exam.subject);
    if (!classId) continue;
    const examCode = `${school.code}-EXA-${String(index + 1).padStart(4, "0")}`.slice(0, 64);
    const examRow = await one(
      client,
      `INSERT INTO exams (school_id, class_id, subject_id, term_id, exam_code, name, exam_type, exam_date, status, created_by, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (exam_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        schoolId,
        classId,
        subjectId ?? null,
        term.id,
        examCode,
        exam.name,
        exam.examType,
        parseDate(exam.date),
        index % 2 === 0 ? "published" : "validated",
        adminUser?.id ?? null,
      ],
    );

    const studentList = students.slice(0, Math.min(5, students.length));
    for (const [studentIndex, student] of studentList.entries()) {
      const studentId = studentIds.get(student.id);
      if (!studentId) continue;
      const score = 10 + ((studentIndex + index) % 9);
      await client.query(
        `INSERT INTO exam_results (school_id, exam_id, student_id, score, max_score, mention, observation, status, created_by)
         VALUES ($1, $2, $3, $4, 20, $5, $6, 'published', $7)
         ON CONFLICT (exam_id, student_id) DO UPDATE SET score = EXCLUDED.score`,
        [
          schoolId,
          examRow.id,
          studentId,
          score,
          score >= 10 ? "Admis" : "À surveiller",
          "Résultat seed bulk",
          adminUser?.id ?? null,
        ],
      );
    }
  }

  for (const [index, document] of documents.entries()) {
    const studentId = studentIds.get(document.studentId);
    if (!studentId) continue;
    const docCode = `${school.code}-DOC-${String(index + 1).padStart(4, "0")}`.slice(0, 64);
    await client.query(
      `INSERT INTO student_documents (school_id, student_id, document_code, document_type, title, format, version, storage_key, generated_by, metadata, status)
       VALUES ($1, $2, $3, $4, $5, 'PDF', 1, $6, $7, $8, $9)
       ON CONFLICT (document_code) DO NOTHING`,
      [
        schoolId,
        studentId,
        docCode,
        document.documentType.toUpperCase().replace(/\s+/g, "_"),
        document.title,
        `documents/${document.studentId}/${docCode}.pdf`,
        adminUser?.id ?? null,
        JSON.stringify({ source: "bulk-platform-seed" }),
        document.status === "Disponible" ? "available" : "pending",
      ],
    );
  }
}

function buildBackOfficePayload(seed) {
  return {
    schools: seed.platformSchools,
    users: seed.userAccounts,
    countries: seed.countries,
    subscriptions: seed.subscriptions,
    notifications: seed.platformNotifications,
    students: seed.students,
    teachers: seed.teachers,
    classes: seed.classes,
    courses: seed.courses,
    assignments: seed.assignments,
    payments: seed.payments,
    paymentStatuses: [],
    presences: seed.presences,
    notes: seed.notes,
    exams: seed.exams,
    bulletins: seed.bulletins,
    courseSchedules: seed.courseSchedules ?? [],
    documents: seed.documents,
    academicConfigs: seed.academicConfigs ?? {},
    announcements: seed.announcements,
    messages: seed.messages,
    contacts: seed.contacts ?? [],
    relations: seed.relations ?? [],
    auditLog: [],
    rolePermissions: seed.rolePermissions,
    deletedRows: {},
    updatedAt: new Date().toISOString(),
  };
}

async function bootstrapSuperAdminOnly(pool) {
  const identifier = String(process.env.BOOTSTRAP_SUPERADMIN_ID ?? "superadmin").trim();
  const password = String(process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "change-me-now").trim();
  const email = String(process.env.BOOTSTRAP_SUPERADMIN_EMAIL ?? "superadmin@somafrik.app").trim();
  const userCode = String(process.env.BOOTSTRAP_SUPERADMIN_CODE ?? "USR-2026-000002").trim();
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status, must_change_password)
     VALUES (NULL, $1, 'Super', 'Admin', $2, '', $3, $3, 'SUPER_ADMIN', 'active', TRUE)
     ON CONFLICT (user_code) DO NOTHING`,
    [userCode, email, hashSecret(password)],
  );
  return { identifier, password };
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const bootstrapOnly = process.argv.includes("--bootstrap") && !process.argv.includes("--no-seed");
  const seed = buildBulkPlatformSeed();
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });

  try {
    await pool.query("SELECT 1");
    console.log("Connexion PostgreSQL OK");

    if (fresh) {
      console.log("Suppression des données existantes…");
      await wipeDatabase(pool);
    } else {
      const existing = await pool.query("SELECT COUNT(*)::int AS count FROM countries");
      if (existing.rows[0].count > 0 && !process.argv.includes("--force")) {
        console.error(
          "La base contient déjà des pays. Relancez avec --fresh pour réinitialiser, ou --force pour ajouter/mettre à jour.",
        );
        process.exit(1);
      }
    }

    if (bootstrapOnly && fresh && process.argv.includes("--bootstrap")) {
      const creds = await bootstrapSuperAdminOnly(pool);
      console.log(`Super admin bootstrap : ${creds.identifier} / ${creds.password}`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      console.log("Insertion des pays et établissements…");
      const countryIds = await insertCountries(client, seed.countries);
      const schoolIds = await insertSchools(client, seed.platformSchools, countryIds);
      await insertSubscriptions(client, seed.subscriptions, schoolIds);
      await insertUsers(client, seed.userAccounts, schoolIds);

      console.log(`Alimentation académique de ${seed.schoolBundles.length} établissements…`);
      for (const [index, bundle] of seed.schoolBundles.entries()) {
        const schoolId = schoolIds.get(bundle.school.code);
        await insertSchoolBundle(client, bundle, schoolId);
        if ((index + 1) % 5 === 0 || index + 1 === seed.schoolBundles.length) {
          console.log(`  ${index + 1}/${seed.schoolBundles.length} établissements traités`);
        }
      }

      const payload = buildBackOfficePayload(seed);
      await client.query(
        `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
         VALUES ('default', $1::jsonb, NOW())
         ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
        [JSON.stringify(payload)],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log("\nSeed bulk terminé avec succès.");
    console.log(`  Pays : ${seed.meta.countries}`);
    console.log(`  Établissements : ${seed.meta.schools}`);
    console.log(`  Classes / établissement : ${seed.meta.classesPerSchool}`);
    console.log(`  Élèves / établissement : ${seed.meta.studentsPerSchool} (${seed.meta.studentsPerClass} / classe)`);
    console.log(`  Enseignants / établissement : ${seed.meta.teachersPerSchool}`);
    console.log(`  Matières / établissement : ${seed.meta.subjectsPerSchool}`);
    console.log(`  Enregistrements démo / autre fonctionnalité : ${seed.meta.recordsPerFeature}`);
    console.log(`  Utilisateurs / rôle : ${seed.meta.usersPerRole}`);
    console.log(`  Comptes utilisateurs (hors élèves/enseignants PG) : ${seed.userAccounts.length}`);
    console.log("  Répartition par rôle :");
    for (const [role, count] of Object.entries(seed.meta.usersByRole).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    - ${role} : ${count}`);
    }
    console.log("\nComptes de démonstration (mot de passe / PIN : 1234) :");
    console.log("  Super admin : superadmin");
    console.log("  Admins pays : admin-rdc | admin-cg | admin-bi");
    console.log("  Admin école démo : admin (CD-2026-0001)");
    console.log("  Préfet démo : prefet (CD-2026-0001)");
    console.log("  Secrétaire démo : secretaire (CD-2026-0001)");
    console.log("  Enseignant démo : ENS-0001 (CD-2026-0001)");
    console.log("  Élève démo : CD-IN-EL-26-001 (CD-2026-0001)");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
