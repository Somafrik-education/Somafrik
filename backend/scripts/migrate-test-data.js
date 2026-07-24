const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const seedData = require("../data");
const { resolveDatabaseUrl } = require("../db/connectionConfig");

const databaseUrl = resolveDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl });
const defaultStudentPinHash = hashSecret("1234");
const teacherPasswordHashes = new Map(
  seedData.teachers.map((teacher) => [teacher.id, hashSecret(teacher.password ?? "1234")])
);

async function main() {
  try {
    const { rows: schools } = await pool.query("SELECT * FROM schools ORDER BY created_at, school_code");
    let migratedSchools = 0;

    for (const school of schools) {
      const { rows: countRows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM students WHERE school_id = $1",
        [school.id]
      );
      if (countRows[0].count > 0) {
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await migrateSchool(client, school);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      migratedSchools += 1;
    }

    console.log(`Migration terminee: ${migratedSchools} etablissement(s) alimentes.`);
  } catch (error) {
    throw error;
  } finally {
    await pool.end();
  }
}

async function migrateSchool(client, school) {
  const academicYear = await one(
    client,
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, $2, '2025-09-01', '2026-08-31', TRUE, 'open')
     ON CONFLICT (school_id, name) DO UPDATE SET is_current = TRUE, status = 'open'
     RETURNING id`,
    [school.id, "2025-2026"]
  );
  const term = await one(
    client,
    `INSERT INTO terms (academic_year_id, name, start_date, end_date, status)
     VALUES ($1, 'Trimestre 1', '2025-09-01', '2025-12-31', 'published')
     ON CONFLICT (academic_year_id, name) DO UPDATE SET status = 'published'
     RETURNING id`,
    [academicYear.id]
  );

  const classIds = new Map();
  for (const schoolClass of seedData.classes) {
    const classCode = scopedCode(school.school_code, schoolClass.publicId);
    const row = await one(
      client,
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, level, section, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (class_code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, section = EXCLUDED.section
       RETURNING id`,
      [school.id, academicYear.id, classCode, schoolClass.name, schoolClass.level, schoolClass.track]
    );
    classIds.set(schoolClass.id, row.id);
    classIds.set(schoolClass.name, row.id);
  }

  const subjectIds = new Map();
  for (const course of seedData.courses) {
    if (subjectIds.has(course.name)) continue;
    const row = await one(
      client,
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (subject_code) DO UPDATE SET name = EXCLUDED.name, coefficient = EXCLUDED.coefficient
       RETURNING id`,
      [school.id, scopedCode(school.school_code, subjectCode(course.name)), course.name, course.coefficient ?? 1]
    );
    subjectIds.set(course.name, row.id);
  }

  const teacherIds = new Map();
  for (const teacher of seedData.teachers) {
    const teacherCode = scopedCode(school.school_code, teacher.publicId);
    const user = await one(
      client,
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'TEACHER', 'active')
       ON CONFLICT (user_code) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
       RETURNING id`,
      [
        school.id,
        `USR-${teacherCode}`,
        teacher.firstName,
        teacher.name.replace(teacher.firstName, "").trim() || teacher.name,
        scopedEmail(school.school_code, teacher.email),
        teacher.phone,
        teacherPasswordHashes.get(teacher.id) ?? defaultStudentPinHash,
      ]
    );
    const row = await one(
      client,
      `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, hire_date, status)
       VALUES ($1, $2, $3, $4, '2025-09-01', 'active')
       ON CONFLICT (teacher_code) DO UPDATE SET speciality = EXCLUDED.speciality, user_id = EXCLUDED.user_id
       RETURNING id`,
      [school.id, user.id, teacherCode, teacher.mainSubject]
    );
    teacherIds.set(teacher.id, row.id);
    teacherIds.set(teacher.publicId, row.id);
  }

  const studentIds = new Map();
  for (const student of seedData.students) {
    const studentCode = scopedCode(school.school_code, student.matricule);
    const [firstName, ...lastNameParts] = String(student.name).split(" ");
    const row = await one(
      client,
      `INSERT INTO students (school_id, student_code, first_name, last_name, gender, birth_date, birth_place, photo_url, parent_phone, parent_email, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, $9)
       ON CONFLICT (student_code) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
       RETURNING id`,
      [
        school.id,
        studentCode,
        student.firstName ?? firstName,
        lastNameParts.join(" ") || student.name,
        student.gender,
        parseDate(student.birthDate),
        student.parentPhone,
        scopedEmail(school.school_code, student.parentEmail),
        student.archived ? "archived" : "active",
      ]
    );
    studentIds.set(student.id, row.id);
    studentIds.set(student.matricule, row.id);

    await client.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'STUDENT', $8)
       ON CONFLICT (user_code) DO UPDATE SET pin_hash = EXCLUDED.pin_hash`,
      [
        school.id,
        studentCode,
        student.firstName ?? firstName,
        lastNameParts.join(" ") || student.name,
        scopedEmail(school.school_code, student.parentEmail),
        student.parentPhone,
        defaultStudentPinHash,
        student.archived ? "archived" : "active",
      ]
    );

    const classId = classIds.get(student.className);
    if (classId) {
      await client.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
         VALUES ($1, $2, $3, $4, '2025-09-01', 'active')
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET class_id = EXCLUDED.class_id`,
        [school.id, row.id, classId, academicYear.id]
      );
    }
  }

  for (const teacher of seedData.teachers) {
    const teacherId = teacherIds.get(teacher.id);
    for (const assignment of teacher.assignments ?? []) {
      const classId = classIds.get(assignment.className);
      const subjectId = subjectIds.get(assignment.course);
      if (!teacherId || !classId || !subjectId) continue;
      await client.query(
        `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status)
         VALUES ($1, $2, $3, $4, $5, 'primary', 'active')
         ON CONFLICT DO NOTHING`,
        [school.id, teacherId, classId, subjectId, academicYear.id]
      );
    }
  }

  for (const note of seedData.notes) {
    const student = seedData.students.find((item) => item.id === note.studentId);
    const studentId = studentIds.get(note.studentId);
    const classId = student ? classIds.get(student.className) : null;
    const subjectId = subjectIds.get(note.subject);
    const teacherId = teacherIds.get(note.authorId) ?? [...teacherIds.values()][0];
    if (!studentId || !classId || !subjectId || !teacherId) continue;
    await client.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type, score, max_score, coefficient, comment)
       VALUES ($1, $2, $3, $4, $5, $6, 'devoir', $7, $8, $9, '')`,
      [school.id, studentId, classId, subjectId, teacherId, term.id, note.value, note.scale ?? 20, note.evaluationCoefficient ?? 1]
    );
  }

  for (const presence of seedData.presences) {
    const student = seedData.students.find((item) => item.id === presence.studentId);
    const studentId = studentIds.get(presence.studentId);
    const classId = student ? classIds.get(student.className) : null;
    if (!studentId || !classId) continue;
    await client.query(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status, reason)
       VALUES ($1, $2, $3, NULL, $4, $5, '')`,
      [school.id, studentId, classId, presence.date, presence.present ? "present" : "absent"]
    );
  }

  for (const payment of seedData.payments) {
    const studentId = studentIds.get(payment.studentId);
    if (!studentId) continue;
    await client.query(
      `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Frais scolaires')`,
      [
        school.id,
        studentId,
        scopedCode(school.school_code, payment.publicId),
        payment.amount,
        "CDF",
        payment.method === "Especes" ? "cash" : "mobile_money",
        payment.status === "PAYE" ? "paid" : "pending",
        payment.date,
      ]
    );
  }

  console.log(`- ${school.school_code}: donnees de test migrees`);
}

function one(client, sql, params) {
  return client.query(sql, params).then((result) => result.rows[0]);
}

function scopedCode(schoolCode, value) {
  return `${schoolCode}-${value}`.replace(/[^A-Za-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

function subjectCode(name) {
  return `SUB-${String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase()}`;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const match = String(value).match(/^(\d{2})-(\d{2})-(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function scopedEmail(schoolCode, email) {
  const [name, domain = "example.com"] = String(email ?? "demo@example.com").split("@");
  return `${name}+${schoolCode.toLowerCase()}@${domain}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
