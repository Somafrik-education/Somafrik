const { applySystemActivePeriod } = require("../lib/academicPeriods");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { shouldSeedDemoData } = require("../lib/demoSeedPolicy");
const seedData = require("../data");

const roleToDb = {
  "Super Administrateur Somafrik": "SUPER_ADMIN",
  "Super Administrateur OKAFRIK": "SUPER_ADMIN",
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

const roleFromDb = Object.fromEntries(
  Object.entries(roleToDb).map(([label, code]) => [code, label]),
);
roleFromDb.SUPER_ADMIN = "Super Administrateur Somafrik";
roleFromDb.SUPERVISOR = "Surveillant";

function normalizeUserLookup(value) {
  return String(value ?? "").trim();
}

function userMatchesLookup(account, lookups = []) {
  const keys = new Set(
    (Array.isArray(lookups) ? lookups : [lookups])
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!keys.size) {
    return false;
  }
  return [account?.id, account?.publicId, account?.identifier].some((value) =>
    keys.has(String(value ?? "").trim().toLowerCase()),
  );
}

function buildResetPasswordUser(account, secretHash, temporaryPassword) {
  const next = {
    ...account,
    passwordHash: secretHash,
    pinHash: secretHash,
    temporaryPassword,
    mustChangePassword: true,
    history: [
      ...(Array.isArray(account.history) ? account.history : []),
      `Mot de passe temporaire régénéré le ${new Date().toLocaleDateString("fr-FR")}. Ancien mot de passe invalidé.`,
    ],
  };
  delete next.password;
  delete next.pin;
  return next;
}

class PostgresRepository {
  constructor(databaseConfig) {
    const poolConfig =
      typeof databaseConfig === "string" ? { connectionString: databaseConfig } : databaseConfig;
    this.pool = new Pool(poolConfig);
    this.ready = false;
    this.cachedDataset = null;
  }

  async init() {
    if (this.ready) {
      return;
    }

    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await this.pool.query(schema);
    if (shouldSeedDemoData()) {
      await this.seedIfEmpty();
      await this.ensurePlatformReferenceData();
      await this.ensureStudentUsers();
      await this.ensureDemoWebAccounts();
      await this.ensureV2Data();
    }
    this.ready = true;
  }

  async getDataset() {
    await this.init();

    if (this.cachedDataset) {
      return this.cachedDataset;
    }

    const [
      countryRows,
      schoolRows,
      subscriptionRows,
      userRows,
      classRows,
      subjectRows,
      teacherRows,
      teacherAssignmentRows,
      studentRows,
      gradeRows,
      attendanceRows,
      paymentRows,
      announcementRows,
      notificationRows,
    ] = await Promise.all([
      this.all("SELECT * FROM countries ORDER BY created_at, iso_code"),
      this.all(`
        SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency, c.phone_code
        FROM schools s
        JOIN countries c ON c.id = s.country_id
        ORDER BY s.created_at, s.school_code
      `),
      this.all(`
        SELECT sub.*, s.school_code, c.iso_code AS country_code, c.name AS country_name
        FROM subscriptions sub
        JOIN schools s ON s.id = sub.school_id
        JOIN countries c ON c.id = s.country_id
        ORDER BY sub.created_at
      `),
      this.all(`
        SELECT u.*, s.school_code, c.name AS country_name
        FROM users u
        LEFT JOIN schools s ON s.id = u.school_id
        LEFT JOIN countries c ON c.id = s.country_id
        ORDER BY u.created_at, u.user_code
      `),
      this.all(`
        SELECT cl.*, ay.name AS academic_year_name, u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM classes cl
        JOIN academic_years ay ON ay.id = cl.academic_year_id
        LEFT JOIN teacher_assignments ta ON ta.class_id = cl.id
        LEFT JOIN teachers t ON t.id = ta.teacher_id
        LEFT JOIN users u ON u.id = t.user_id
        ORDER BY cl.created_at, cl.class_code
      `),
      this.all("SELECT * FROM subjects ORDER BY created_at, subject_code"),
      this.all(`
        SELECT t.*, s.school_code, u.first_name, u.last_name, u.email, u.phone, u.password_hash, u.pin_hash
        FROM teachers t
        JOIN schools s ON s.id = t.school_id
        LEFT JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at, t.teacher_code
      `),
      this.all(`
        SELECT t.teacher_code, cl.name AS class_name, sub.name AS subject_name
        FROM teacher_assignments ta
        JOIN teachers t ON t.id = ta.teacher_id
        JOIN classes cl ON cl.id = ta.class_id
        JOIN subjects sub ON sub.id = ta.subject_id
        WHERE ta.status = 'active'
        ORDER BY t.teacher_code, cl.name, sub.name
      `),
      this.all(`
        SELECT st.*, s.school_code, e.class_id, cl.name AS class_name, u.pin_hash AS student_pin_hash
        FROM students st
        JOIN schools s ON s.id = st.school_id
        LEFT JOIN users u ON u.school_id = st.school_id AND u.user_code = st.student_code
        LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
        LEFT JOIN classes cl ON cl.id = e.class_id
        ORDER BY st.created_at, st.student_code
      `),
      this.all(`
        SELECT g.*, st.student_code, s.school_code, cl.class_code, cl.name AS class_name, sub.name AS subject_name,
               sub.coefficient AS subject_coefficient, t.teacher_code, term.name AS term_name
        FROM grades g
        JOIN schools s ON s.id = g.school_id
        JOIN students st ON st.id = g.student_id
        JOIN classes cl ON cl.id = g.class_id
        JOIN subjects sub ON sub.id = g.subject_id
        JOIN teachers t ON t.id = g.teacher_id
        JOIN terms term ON term.id = g.term_id
        ORDER BY g.created_at
      `),
      this.all(`
        SELECT a.*, st.student_code, s.school_code, cl.name AS class_name
        FROM attendance a
        JOIN schools s ON s.id = a.school_id
        JOIN students st ON st.id = a.student_id
        LEFT JOIN classes cl ON cl.id = a.class_id
        ORDER BY a.attendance_date, a.created_at
      `),
      this.all(`
        SELECT p.*, st.student_code, s.school_code
        FROM payments p
        JOIN schools s ON s.id = p.school_id
        JOIN students st ON st.id = p.student_id
        ORDER BY p.payment_date, p.created_at
      `),
      this.all(`
        SELECT a.*, s.school_code
        FROM announcements a
        LEFT JOIN schools s ON s.id = a.school_id
        ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
      `),
      this.all(`
        SELECT n.*, s.school_code
        FROM notifications n
        LEFT JOIN schools s ON s.id = n.school_id
        ORDER BY n.created_at DESC
      `),
    ]);

    const schoolByCode = new Map(schoolRows.map((school) => [school.school_code, school]));
    const students = studentRows.map((student) => this.mapStudent(student));
    const classes = this.uniqueBy(
      classRows.map((schoolClass) => ({
      id: schoolClass.class_code,
      publicId: schoolClass.class_code,
      schoolId: schoolClass.school_id,
      schoolCode: schoolRows.find((school) => school.id === schoolClass.school_id)?.school_code ?? "",
      name: schoolClass.name,
      level: schoolClass.level,
      track: schoolClass.section,
        teacherId: teacherRows.find((teacher) => teacher.school_id === schoolClass.school_id)?.teacher_code ?? "",
      })),
      "id"
    );
    const courses = this.buildCourses(classRows, subjectRows, gradeRows);
    const teacherLoginByUserId = new Map(
      teacherRows
        .filter((teacher) => teacher.user_id)
        .map((teacher) => [teacher.user_id, this.extractTeacherLoginId(teacher.teacher_code)])
    );
    const teachers = teacherRows.map((teacher) => this.mapTeacher(teacher, gradeRows, teacherAssignmentRows));
    const notes = gradeRows.map((grade) => this.mapGrade(grade));
    const payments = paymentRows.map((payment) => this.mapPayment(payment));
    const primarySchoolRow = schoolRows.find((row) => row.school_code === seedData.school.code) ?? schoolRows[0];
    const school = primarySchoolRow
      ? this.mapSchool(
          primarySchoolRow,
          subscriptionRows.find((sub) => sub.school_code === primarySchoolRow.school_code)
        )
      : null;

    this.cachedDataset = {
      school,
      platformSchools: schoolRows.map((row) => this.mapSchool(row, subscriptionRows.find((sub) => sub.school_code === row.school_code))),
      countries: countryRows.map((country) => this.mapCountry(country)),
      subscriptions: subscriptionRows.map((subscription) => this.mapSubscription(subscription)),
      userAccounts: userRows.map((user) => this.mapUser(user, schoolByCode, teacherLoginByUserId)),
      teachers,
      classes,
      courses,
      students,
      notes,
      presences: attendanceRows.map((attendance) => this.mapAttendance(attendance)),
      payments,
      announcements: announcementRows.map((announcement) => this.mapAnnouncement(announcement)),
      platformNotifications: notificationRows.map((notification) => this.mapNotification(notification)),
    };

    return this.cachedDataset;
  }

  async all(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async one(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows[0];
  }

  async close() {
    await this.pool.end();
  }

  async createSession({ sessionId, refreshTokenHash, userId, schoolCode, role, expiresAt, ipAddress, userAgent }) {
    await this.init();
    const school = schoolCode && schoolCode !== "*" ? await this.getSchoolByCode(schoolCode) : null;
    const dbUserId = await this.resolveDbUserId(userId);
    await this.pool.query(
      `INSERT INTO sessions (session_code, refresh_token_hash, user_id, school_id, role, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sessionId, refreshTokenHash, dbUserId, school?.id ?? null, role, expiresAt, ipAddress ?? "", userAgent ?? ""]
    );
  }

  async resolveDbUserId(userId) {
    const normalized = String(userId ?? "").trim();
    if (!normalized) {
      return null;
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
      const row = await this.one("SELECT id FROM users WHERE id = $1::uuid", [normalized]);
      return row?.id ?? null;
    }

    const byCode = await this.one("SELECT id FROM users WHERE user_code = $1", [normalized]);
    return byCode?.id ?? null;
  }

  async findActiveSession(sessionId, refreshTokenHash) {
    await this.init();
    return this.one(
      `SELECT sess.*, u.user_code, u.role, s.school_code, c.iso_code AS country_code
       FROM sessions sess
       LEFT JOIN users u ON u.id = sess.user_id
       LEFT JOIN schools s ON s.id = sess.school_id
       LEFT JOIN countries c ON c.id = s.country_id
       WHERE sess.session_code = $1
         AND sess.refresh_token_hash = $2
         AND sess.revoked_at IS NULL
         AND sess.expires_at > NOW()`,
      [sessionId, refreshTokenHash]
    );
  }

  async revokeSession(sessionId, reason = "logout") {
    await this.init();
    await this.pool.query(
      "UPDATE sessions SET revoked_at = NOW(), revoke_reason = $2 WHERE session_code = $1 AND revoked_at IS NULL",
      [sessionId, reason]
    );
  }

  async recordAudit({ schoolCode, userId, action, entityType, entityId, oldValue, newValue, ipAddress, userAgent }) {
    await this.init();
    const school = schoolCode && schoolCode !== "*" ? await this.getSchoolByCode(schoolCode) : null;
    const dbUserId = await this.resolveDbUserId(userId);
    await this.pool.query(
      `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        school?.id ?? null,
        dbUserId,
        action,
        entityType,
        entityId ?? null,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        ipAddress ?? "",
        userAgent ?? "",
      ]
    );
  }

  async getAuditLogs({ schoolCode, userId, action, from, to, limit = 100 } = {}) {
    await this.init();
    const filters = [];
    const params = [];
    const addFilter = (sql, value) => {
      params.push(value);
      filters.push(sql.replace("?", `$${params.length}`));
    };

    if (schoolCode) addFilter("s.school_code = ?", schoolCode);
    if (userId) addFilter("a.user_id = ?", userId);
    if (action) addFilter("a.action = ?", action);
    if (from) addFilter("a.created_at >= ?", from);
    if (to) addFilter("a.created_at <= ?", to);

    params.push(Math.min(Number(limit) || 100, 500));
    const rows = await this.all(
      `SELECT a.*, s.school_code, u.user_code, u.first_name, u.last_name
       FROM audit_logs a
       LEFT JOIN schools s ON s.id = a.school_id
       LEFT JOIN users u ON u.id = a.user_id
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY a.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      schoolCode: row.school_code,
      userId: row.user_id,
      userCode: row.user_code,
      actor: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.user_code || "system",
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldValue: row.old_value,
      newValue: row.new_value,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      date: this.formatDate(row.created_at),
    }));
  }

  async getBackOfficeState() {
    await this.init();
    const row = await this.one("SELECT state_payload FROM backoffice_state WHERE state_key = 'default'");
    return row?.state_payload ?? null;
  }

  async saveBackOfficeState(payload) {
    await this.init();
    await this.pool.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1, NOW())
       ON CONFLICT (state_key) DO UPDATE SET
         state_payload = EXCLUDED.state_payload,
         updated_at = NOW()`,
      [JSON.stringify(payload ?? {})]
    );
    this.cachedDataset = null;
    return this.getBackOfficeState();
  }

  async getAcademicConfig(schoolCode) {
    await this.init();
    const normalizedSchoolCode = String(schoolCode && schoolCode !== "*" ? schoolCode : seedData.school.code).trim().toUpperCase();
    const state = (await this.getBackOfficeState()) ?? {};
    const storedConfig = state.academicConfigs?.[normalizedSchoolCode];
    const school = await this.getSchoolByCode(normalizedSchoolCode);
    const termRows = school
      ? await this.all(
          `SELECT t.*
           FROM terms t
           JOIN academic_years ay ON ay.id = t.academic_year_id
           WHERE ay.school_id = $1
           ORDER BY t.start_date NULLS LAST, t.created_at`,
          [school.id]
        )
      : [];
    const periods = termRows.length
      ? termRows.map((term, index) => ({
          name: term.name,
          type: term.name.toLowerCase().includes("semestre") ? "Semestre" : term.name.toLowerCase().includes("trimestre") ? "Trimestre" : "Période",
          startDate: this.formatDate(term.start_date),
          endDate: this.formatDate(term.end_date),
          active: index === 0,
        }))
      : defaultAcademicPeriods();

    return withSystemActivePeriods({
      schoolCode: normalizedSchoolCode,
      periodMode: storedConfig?.periodMode ?? inferPeriodMode(periods),
      periods: Array.isArray(storedConfig?.periods) && storedConfig.periods.length ? storedConfig.periods : periods,
      evaluationTypes: Array.isArray(storedConfig?.evaluationTypes) && storedConfig.evaluationTypes.length
        ? storedConfig.evaluationTypes
        : ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
      defaultScale: Number(storedConfig?.defaultScale ?? 20),
      reportCardMode: storedConfig?.reportCardMode ?? "period",
      allowCustomClasses: storedConfig?.allowCustomClasses !== false,
      allowCustomCourses: storedConfig?.allowCustomCourses !== false,
      allowCustomReportCards: storedConfig?.allowCustomReportCards !== false,
      levels: Array.isArray(storedConfig?.levels) && storedConfig.levels.length
        ? storedConfig.levels
        : seedData.demoLevels,
      tracks: Array.isArray(storedConfig?.tracks) && storedConfig.tracks.length
        ? storedConfig.tracks
        : seedData.demoTracks,
      classNames: Array.isArray(storedConfig?.classNames) && storedConfig.classNames.length
        ? storedConfig.classNames
        : seedData.demoClassNames,
      subjects: Array.isArray(storedConfig?.subjects) && storedConfig.subjects.length
        ? storedConfig.subjects
        : seedData.demoSubjects,
    });
  }

  async saveAcademicConfig(schoolCode, config) {
    await this.init();
    const normalizedSchoolCode = String(config.schoolCode ?? (schoolCode && schoolCode !== "*" ? schoolCode : seedData.school.code)).trim().toUpperCase();
    const currentState = (await this.getBackOfficeState()) ?? {};
    const academicConfigs = currentState.academicConfigs && typeof currentState.academicConfigs === "object"
      ? currentState.academicConfigs
      : {};
    const savedConfig = withSystemActivePeriods({
      schoolCode: normalizedSchoolCode,
      periodMode: config.periodMode ?? "trimestre",
      periods: Array.isArray(config.periods) && config.periods.length ? config.periods : defaultAcademicPeriods(),
      evaluationTypes: Array.isArray(config.evaluationTypes) && config.evaluationTypes.length
        ? config.evaluationTypes
        : ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
      defaultScale: Number(config.defaultScale ?? 20),
      reportCardMode: config.reportCardMode ?? "period",
      allowCustomClasses: config.allowCustomClasses !== false,
      allowCustomCourses: config.allowCustomCourses !== false,
      allowCustomReportCards: config.allowCustomReportCards !== false,
      levels: Array.isArray(config.levels) && config.levels.length ? config.levels : seedData.demoLevels,
      tracks: Array.isArray(config.tracks) && config.tracks.length ? config.tracks : seedData.demoTracks,
      classNames: Array.isArray(config.classNames) && config.classNames.length ? config.classNames : seedData.demoClassNames,
      subjects: Array.isArray(config.subjects) && config.subjects.length ? config.subjects : seedData.demoSubjects,
    });
    await this.saveBackOfficeState({
      ...currentState,
      academicConfigs: {
        ...academicConfigs,
        [normalizedSchoolCode]: savedConfig,
      },
    });
    return savedConfig;
  }

  async findPasswordAccountTargets(lookupKeys) {
    const state = (await this.getBackOfficeState()) ?? {};
    const storedUsers = Array.isArray(state.users) ? state.users : [];
    const dataset = await this.getDataset();
    const runtimeUsers = dataset.userAccounts ?? [];
    const targets = [];
    const seen = new Set();

    const register = (account) => {
      const key = [account?.id, account?.publicId, account?.identifier]
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join("|");
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      targets.push(account);
    };

    for (const account of [...storedUsers, ...runtimeUsers]) {
      if (userMatchesLookup(account, lookupKeys)) {
        register(account);
      }
    }

    return { state, storedUsers, targets };
  }

  async persistBackOfficeUserPasswordUpdates(lookupKeys, transformAccount) {
    const { state, storedUsers, targets } = await this.findPasswordAccountTargets(lookupKeys);
    if (!targets.length) {
      return null;
    }

    const users = [...storedUsers];
    let updatedAccount = null;

    for (const target of targets) {
      const nextAccount = transformAccount(target);
      updatedAccount = nextAccount;
      const index = users.findIndex((account) =>
        userMatchesLookup(account, [target.id, target.publicId, target.identifier]),
      );
      if (index >= 0) {
        users[index] = nextAccount;
      } else {
        users.unshift(nextAccount);
      }
    }

    await this.saveBackOfficeState({
      ...state,
      users,
      updatedAt: new Date().toISOString(),
    });
    this.cachedDataset = null;
    return updatedAccount;
  }

  async resetUserPassword(userRef, temporaryPassword) {
    await this.init();
    const secretHash = hashSecret(temporaryPassword);
    const lookupKeys = (Array.isArray(userRef) ? userRef : [userRef])
      .map(normalizeUserLookup)
      .filter(Boolean);

    for (const key of lookupKeys) {
      const updated = await this.one(
        `UPDATE users
         SET password_hash = $1, pin_hash = $1, must_change_password = TRUE, updated_at = NOW()
         WHERE id::text = $2 OR user_code = $2
         RETURNING *`,
        [secretHash, key],
      );
      if (updated) {
        this.cachedDataset = null;
        const schoolRows = await this.all(`
          SELECT s.*, c.name AS country_name, c.iso_code
          FROM schools s
          LEFT JOIN countries c ON c.id = s.country_id
        `);
        const schoolByCode = new Map(schoolRows.map((school) => [school.school_code, school]));
        const row = await this.one(
          `SELECT u.*, s.school_code
           FROM users u
           LEFT JOIN schools s ON s.id = u.school_id
           WHERE u.id = $1`,
          [updated.id],
        );
        return this.mapUser(row, schoolByCode);
      }
    }

    const updatedAccount = await this.persistBackOfficeUserPasswordUpdates(
      lookupKeys,
      (account) => buildResetPasswordUser(account, secretHash, temporaryPassword),
    );

    if (!updatedAccount) {
      const error = new Error("Utilisateur introuvable");
      error.statusCode = 404;
      throw error;
    }

    return updatedAccount;
  }

  async changeUserPassword(userRef, newPassword) {
    await this.init();
    const secretHash = hashSecret(newPassword);
    const lookupKeys = (Array.isArray(userRef) ? userRef : [userRef])
      .map(normalizeUserLookup)
      .filter(Boolean);

    for (const key of lookupKeys) {
      const updated = await this.one(
        `UPDATE users
         SET password_hash = $1, pin_hash = $1, must_change_password = FALSE, updated_at = NOW()
         WHERE id::text = $2 OR user_code = $2
         RETURNING *`,
        [secretHash, key],
      );
      if (updated) {
        this.cachedDataset = null;
        await this.persistBackOfficeUserPasswordUpdates(lookupKeys, (account) => {
          const next = {
            ...account,
            passwordHash: secretHash,
            pinHash: secretHash,
            temporaryPassword: "",
            mustChangePassword: false,
          };
          delete next.password;
          delete next.pin;
          return next;
        });

        const row = await this.one(
          `SELECT u.*, s.school_code
           FROM users u
           LEFT JOIN schools s ON s.id = u.school_id
           WHERE u.id = $1`,
          [updated.id],
        );
        return this.mapUser(row, new Map());
      }
    }

    const updatedAccount = await this.persistBackOfficeUserPasswordUpdates(
      lookupKeys,
      (account) => {
        const next = {
          ...account,
          passwordHash: secretHash,
          pinHash: secretHash,
          temporaryPassword: "",
          mustChangePassword: false,
        };
        delete next.password;
        delete next.pin;
        return next;
      },
    );

    if (!updatedAccount) {
      const error = new Error("Utilisateur introuvable");
      error.statusCode = 404;
      throw error;
    }

    return updatedAccount;
  }

  async upsertGrade(payload, principal = {}) {
    const value = Number(payload.value);
    const scale = Number(payload.scale ?? 20);
    if (!payload.studentId || !payload.subject || Number.isNaN(value) || value < 0 || value > scale) {
      const error = new Error("Note invalide");
      error.statusCode = 400;
      throw error;
    }

    const student = await this.one(
      `SELECT st.*, s.school_code, e.class_id, cl.name AS class_name
       FROM students st
       JOIN schools s ON s.id = st.school_id
       LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
       LEFT JOIN classes cl ON cl.id = e.class_id
       WHERE st.student_code = $1 OR st.id::text = $1`,
      [String(payload.studentId)]
    );
    if (!student) {
      const error = new Error("Eleve introuvable");
      error.statusCode = 404;
      throw error;
    }

    if (principal.role === "Enseignant" && !(principal.classNames ?? []).includes(student.class_name)) {
      const error = new Error("Accès refusé: élève hors classe affectée.");
      error.statusCode = 403;
      throw error;
    }

    const subject = await this.one(
      `SELECT * FROM subjects WHERE school_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [student.school_id, String(payload.subject)]
    );
    if (!subject || !student.class_id) {
      const error = new Error("Matiere ou classe introuvable");
      error.statusCode = 400;
      throw error;
    }

    const teacher = await this.findTeacherForGrade(student.school_id, principal.sub, student.class_id, subject.id, principal.role);
    const requestedPeriod = String(payload.period ?? payload.term ?? "Trimestre 1").trim() || "Trimestre 1";
    const academicYear = await this.one(
      `SELECT *
       FROM academic_years
       WHERE school_id = $1 AND status IN ('active', 'open')
       ORDER BY is_current DESC, created_at DESC
       LIMIT 1`,
      [student.school_id]
    );
    const term = academicYear ? await this.one(
      `SELECT t.*
       FROM terms t
       WHERE t.academic_year_id = $1 AND t.name = $2
       LIMIT 1`,
      [academicYear.id, requestedPeriod]
    ) : null;
    const usableTerm = term ?? (academicYear ? await this.one(
      `INSERT INTO terms (academic_year_id, name, status)
       VALUES ($1, $2, 'open')
       ON CONFLICT (academic_year_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [academicYear.id, requestedPeriod]
    ) : null);
    if (!teacher || !usableTerm) {
      const error = new Error("Enseignant ou trimestre introuvable");
      error.statusCode = 400;
      throw error;
    }

    const existing = isUuid(payload.id)
      ? await this.one("SELECT * FROM grades WHERE id = $1", [payload.id])
      : null;

    if (existing) {
      await this.pool.query(
        `UPDATE grades
         SET score = $1, max_score = $2, coefficient = $3, teacher_id = $4, grade_type = $5, comment = $6, updated_at = NOW()
         WHERE id = $7`,
        [
          value,
          scale,
          Number(payload.evaluationCoefficient ?? payload.coefficient ?? 1),
          teacher.id,
          toDbEvaluationType(payload.evaluationType),
          payload.evaluationTitle ?? payload.title ?? "",
          existing.id,
        ]
      );
      this.cachedDataset = null;
      return this.getGradeById(existing.id);
    }

    const inserted = await this.one(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type, score, max_score, coefficient, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        student.school_id,
        student.id,
        student.class_id,
        subject.id,
        teacher.id,
        usableTerm.id,
        toDbEvaluationType(payload.evaluationType),
        value,
        scale,
        Number(payload.evaluationCoefficient ?? payload.coefficient ?? 1),
        payload.evaluationTitle ?? payload.title ?? "",
      ]
    );
    this.cachedDataset = null;
    return this.getGradeById(inserted.id);
  }

  async upsertAttendanceBatch(payload = {}, principal = {}) {
    await this.init();
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      return [];
    }

    const saved = [];
    for (const item of items) {
      saved.push(await this.upsertAttendance(item, principal));
    }

    this.cachedDataset = null;
    return saved;
  }

  async upsertAttendance(payload, principal = {}) {
    const attendanceDate = this.parseDate(payload.date);
    if (!payload.studentId || !attendanceDate) {
      const error = new Error("Présence invalide");
      error.statusCode = 400;
      throw error;
    }

    const student = await this.one(
      `SELECT st.*, s.school_code, e.class_id, cl.name AS class_name
       FROM students st
       JOIN schools s ON s.id = st.school_id
       LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
       LEFT JOIN classes cl ON cl.id = e.class_id
       WHERE st.student_code = $1 OR st.id::text = $1`,
      [String(payload.studentId)]
    );
    if (!student || !student.class_id) {
      const error = new Error("Élève ou classe introuvable pour l'appel");
      error.statusCode = 404;
      throw error;
    }

    if (principal.role === "Enseignant" && !(principal.classNames ?? []).includes(student.class_name)) {
      const error = new Error("Accès refusé: élève hors classe affectée.");
      error.statusCode = 403;
      throw error;
    }

    const teacher = await this.findTeacherForAttendance(student.school_id, principal.sub, student.class_id, principal.role);
    const status = this.toAttendanceStatus(payload.status, payload.present);
    const reason = payload.reason ?? (status === "excused" ? "Justifié" : null);
    const existing = await this.one(
      `SELECT id FROM attendance
       WHERE student_id = $1 AND attendance_date = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [student.id, attendanceDate]
    );

    const row = existing
      ? await this.one(
          `UPDATE attendance
           SET status = $1, reason = $2, teacher_id = $3, class_id = $4, updated_at = NOW()
           WHERE id = $5
           RETURNING id`,
          [status, reason, teacher?.id ?? null, student.class_id, existing.id]
        )
      : await this.one(
          `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [student.school_id, student.id, student.class_id, teacher?.id ?? null, attendanceDate, status, reason]
        );

    return this.getAttendanceById(row.id);
  }

  async getAttendanceById(id) {
    const attendance = await this.one(
      `SELECT a.*, st.student_code, s.school_code, cl.name AS class_name
       FROM attendance a
       JOIN schools s ON s.id = a.school_id
       JOIN students st ON st.id = a.student_id
       LEFT JOIN classes cl ON cl.id = a.class_id
       WHERE a.id = $1`,
      [id]
    );
    return attendance ? this.mapAttendance(attendance) : null;
  }

  async seedIfEmpty() {
    if (!shouldSeedDemoData()) {
      return;
    }
    const existing = await this.one("SELECT COUNT(*)::int AS count FROM countries");

    if (existing.count > 0) {
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const maps = await this.seedReferenceData(client);
      await this.seedAcademicData(client, maps);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async seedReferenceData(client) {
    const countryIds = new Map();
    const schoolIds = new Map();
    const userIds = new Map();

    for (const country of seedData.countries) {
      const row = await this.insertOne(
        client,
        `INSERT INTO countries (name, iso_code, phone_code, currency, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [country.name, country.code, country.phonePrefix, country.currency, country.status !== "Suspendu"]
      );
      countryIds.set(country.code, row.id);
      if (country.name === "République Démocratique du Congo") {
        countryIds.set("RDC", row.id);
      }
    }

    for (const school of seedData.platformSchools) {
      const countryId = countryIds.get(this.getCountryCodeForSchool(school)) ?? countryIds.get("CD") ?? [...countryIds.values()][0];
      const row = await this.insertOne(
        client,
        `INSERT INTO schools (country_id, school_code, name, logo_url, address, city, phone, email, school_type, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (school_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          countryId,
          school.code,
          school.name,
          school.logoUrl ?? "",
          school.address ?? "",
          school.city ?? "",
          school.phone ?? "",
          school.email ?? "",
          school.type ?? "Établissement",
          this.toDbStatus(school.status),
        ]
      );
      schoolIds.set(school.code, row.id);
    }

    for (const subscription of seedData.subscriptions) {
      const schoolId = schoolIds.get(subscription.schoolCode);
      if (!schoolId) continue;
      await client.query(
        `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date, end_date)
         VALUES ($1, $2, $3, $4, 'monthly', $5, $6, $7)`,
        [
          schoolId,
          subscription.plan,
          subscription.monthlyPrice ?? 0,
          subscription.currency,
          this.toSubscriptionStatus(subscription.status, subscription.paymentStatus),
          this.parseDate(subscription.startDate),
          this.parseDate(subscription.endDate),
        ]
      );
    }

    for (const user of seedData.userAccounts) {
      const schoolId = user.schoolCode === "*" ? null : schoolIds.get(user.schoolCode);
      const row = await this.insertOne(
        client,
        `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_code) DO UPDATE SET first_name = EXCLUDED.first_name
         RETURNING id`,
        [
          schoolId,
          user.publicId,
          user.firstName,
          user.lastName,
          user.email ?? "",
          user.phone ?? "",
          hashSecret(user.password),
          hashSecret(user.temporaryPassword || "1234"),
          roleToDb[user.role] ?? user.role,
          this.toDbStatus(user.status),
          this.parseDate(user.lastLoginAt),
        ]
      );
      userIds.set(user.id, row.id);
      userIds.set(user.phone, row.id);
    }

    return { countryIds, schoolIds, userIds };
  }

  async seedAcademicData(client, maps) {
    const schoolId = maps.schoolIds.get(seedData.school.code);
    const academicYear = await this.insertOne(
      client,
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, $2, $3, $4, TRUE, 'open')
       ON CONFLICT (school_id, name) DO UPDATE SET is_current = TRUE
       RETURNING id`,
      [schoolId, seedData.school.schoolYear ?? "2025-2026", "2025-09-01", "2026-08-31"]
    );
    const term = await this.insertOne(
      client,
      `INSERT INTO terms (academic_year_id, name, start_date, end_date, status)
       VALUES ($1, 'Trimestre 1', '2025-09-01', '2025-12-31', 'published')
       ON CONFLICT (academic_year_id, name) DO UPDATE SET status = EXCLUDED.status
       RETURNING id`,
      [academicYear.id]
    );
    const classIds = new Map();
    const subjectIds = new Map();
    const teacherIds = new Map();
    const studentIds = new Map();

    for (const schoolClass of seedData.classes) {
      const row = await this.insertOne(
        client,
        `INSERT INTO classes (school_id, academic_year_id, class_code, name, level, section, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (class_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [schoolId, academicYear.id, schoolClass.publicId, schoolClass.name, schoolClass.level, schoolClass.track]
      );
      classIds.set(schoolClass.name, row.id);
      classIds.set(schoolClass.id, row.id);
    }

    for (const course of seedData.courses) {
      const subjectCode = this.subjectCode(course.name);
      if (subjectIds.has(subjectCode)) continue;
      const row = await this.insertOne(
        client,
        `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (subject_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [schoolId, subjectCode, course.name, course.coefficient ?? 1]
      );
      subjectIds.set(subjectCode, row.id);
      subjectIds.set(course.name, row.id);
    }

    for (const teacher of seedData.teachers) {
      const userId = maps.userIds.get(teacher.phone) ?? null;
      const row = await this.insertOne(
        client,
        `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, hire_date, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (teacher_code) DO UPDATE SET speciality = EXCLUDED.speciality
         RETURNING id`,
        [schoolId, userId, teacher.publicId, teacher.mainSubject, "2025-09-01"]
      );
      teacherIds.set(teacher.id, row.id);
      teacherIds.set(teacher.publicId, row.id);

      if (!userId) {
        const createdUser = await this.insertOne(
          client,
          `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'TEACHER', 'active')
           ON CONFLICT (user_code) DO UPDATE SET phone = EXCLUDED.phone
           RETURNING id`,
          [schoolId, `USR-${teacher.publicId}`, teacher.firstName, teacher.name.replace(teacher.firstName, "").trim() || teacher.name, teacher.email, teacher.phone, hashSecret(teacher.password)]
        );
        await client.query("UPDATE teachers SET user_id = $1 WHERE id = $2", [createdUser.id, row.id]);
      }
    }

    for (const student of seedData.students) {
      const [firstName, ...lastNameParts] = String(student.name).split(" ");
      const row = await this.insertOne(
        client,
        `INSERT INTO students (school_id, student_code, first_name, last_name, gender, birth_date, birth_place, photo_url, parent_phone, parent_email, status)
         VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, $9)
         ON CONFLICT (student_code) DO UPDATE SET first_name = EXCLUDED.first_name
         RETURNING id`,
        [
          schoolId,
          student.matricule,
          student.firstName ?? firstName,
          lastNameParts.join(" ") || student.name,
          student.gender,
          this.parseDate(student.birthDate),
          student.parentPhone,
          student.parentEmail,
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
          schoolId,
          student.matricule,
          student.firstName ?? firstName,
          lastNameParts.join(" ") || student.name,
          student.parentEmail,
          student.parentPhone,
          hashSecret(student.pin ?? "1234"),
          student.archived ? "archived" : "active",
        ]
      );

      const classId = classIds.get(student.className);
      if (classId) {
        await client.query(
          `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
           VALUES ($1, $2, $3, $4, '2025-09-01', 'active')
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET class_id = EXCLUDED.class_id`,
          [schoolId, row.id, classId, academicYear.id]
        );
      }
    }

    for (const teacher of seedData.teachers) {
      const teacherId = teacherIds.get(teacher.id);
      for (const assignment of teacher.assignments ?? []) {
        const classId = classIds.get(assignment.className);
        const subjectId = subjectIds.get(assignment.course) ?? subjectIds.get(this.subjectCode(assignment.course));
        if (!teacherId || !classId || !subjectId) continue;
        await client.query(
          `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status)
           VALUES ($1, $2, $3, $4, $5, 'primary', 'active')
           ON CONFLICT DO NOTHING`,
          [schoolId, teacherId, classId, subjectId, academicYear.id]
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
        [schoolId, studentId, classId, subjectId, teacherId, term.id, note.value, note.scale ?? 20, note.evaluationCoefficient ?? 1]
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
        [schoolId, studentId, classId, presence.date, this.toAttendanceStatus(presence.status, presence.present)]
      );
    }

    for (const payment of seedData.payments) {
      const studentId = studentIds.get(payment.studentId);
      if (!studentId) continue;
      await client.query(
        `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Frais scolaires')`,
        [schoolId, studentId, payment.publicId, payment.amount, seedData.school.currency, this.toPaymentMethod(payment.method), this.toPaymentStatus(payment.status), payment.date]
      );
    }

    for (const announcement of seedData.announcements) {
      await client.query(
        `INSERT INTO announcements (school_id, title, message, target_role, published_at, status)
         VALUES ($1, $2, $3, 'ALL', $4, 'published')`,
        [schoolId, announcement.title, announcement.message, this.parseDate(announcement.date)]
      );
    }

    for (const notification of seedData.platformNotifications) {
      await client.query(
        `INSERT INTO notifications (school_id, title, message, type, channel, status, sent_at)
         VALUES ($1, $2, $3, $4, 'app', $5, $6)`,
        [schoolId, notification.title, notification.message, notification.type, notification.status === "Lu" ? "read" : "sent", this.parseDate(notification.date)]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (school_id, action, entity_type, entity_id, new_value)
       VALUES ($1, 'seed_database', 'system', 'postgres', $2)`,
      [schoolId, JSON.stringify({ source: "backend/data.js", tables: "mvp" })]
    );
  }

  insertOne(client, sql, params) {
    return client.query(sql, params).then((result) => result.rows[0]);
  }

  async ensurePlatformReferenceData() {
    if (!shouldSeedDemoData()) {
      return;
    }
    for (const country of seedData.countries) {
      await this.pool.query(
        `INSERT INTO countries (name, iso_code, phone_code, currency, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (iso_code) DO UPDATE SET
           name = EXCLUDED.name,
           phone_code = EXCLUDED.phone_code,
           currency = EXCLUDED.currency,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        [country.name, country.code, country.phonePrefix, country.currency, country.status !== "Suspendu"]
      );
    }

    const schoolRows = await this.all("SELECT school_code, id FROM schools");
    const schoolIds = new Map(schoolRows.map((school) => [school.school_code, school.id]));
    const platformRoles = new Set([
      "Super Administrateur Somafrik",
      "Admin Pays",
      "Admin School",
      "Proviseur",
      "Directeur",
      "Préfet des études",
      "Secrétaire",
    ]);

    for (const user of seedData.userAccounts.filter((item) => platformRoles.has(item.role))) {
      const schoolId = user.schoolCode === "*" ? null : schoolIds.get(user.schoolCode);
      await this.pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_code) DO UPDATE SET
           school_id = EXCLUDED.school_id,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
           pin_hash = COALESCE(EXCLUDED.pin_hash, users.pin_hash),
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           last_login_at = COALESCE(users.last_login_at, EXCLUDED.last_login_at)`,
        [
          schoolId,
          user.publicId,
          user.firstName,
          user.lastName,
          user.email ?? "",
          user.phone ?? "",
          hashSecret(user.password),
          hashSecret(user.temporaryPassword || "1234"),
          roleToDb[user.role] ?? user.role,
          this.toDbStatus(user.status),
          this.parseDate(user.lastLoginAt),
        ]
      );
    }
  }

  async ensureStudentUsers() {
    if (!shouldSeedDemoData()) {
      return;
    }
    await this.pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       SELECT st.school_id, st.student_code, st.first_name, st.last_name, st.parent_email, st.parent_phone,
              NULL, $1, 'STUDENT', st.status
       FROM students st
       LEFT JOIN users u ON u.school_id = st.school_id AND u.user_code = st.student_code
       WHERE u.id IS NULL
       ON CONFLICT (user_code) DO NOTHING`,
      [hashSecret("1234")]
    );
  }

  async ensureDemoWebAccounts() {
    if (!shouldSeedDemoData()) {
      return;
    }

    const demoSchoolCode = seedData.school.code;
    const demoPasswordHash = hashSecret("1234");
    const schoolRows = await this.all("SELECT school_code, id FROM schools");
    const schoolIds = new Map(schoolRows.map((school) => [school.school_code, school.id]));
    const demoRoles = new Set(["Enseignant", "Parent", "Élève / Étudiant"]);

    for (const user of seedData.userAccounts.filter((item) => demoRoles.has(item.role))) {
      const schoolId = user.schoolCode === "*" ? null : schoolIds.get(user.schoolCode);
      if (!schoolId && user.schoolCode !== "*") {
        continue;
      }

      try {
        await this.pool.query(
          `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status, last_login_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (user_code) DO UPDATE SET
             school_id = EXCLUDED.school_id,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             password_hash = EXCLUDED.password_hash,
             pin_hash = EXCLUDED.pin_hash,
             role = EXCLUDED.role,
             status = EXCLUDED.status`,
          [
            schoolId,
            user.publicId,
            user.firstName,
            user.lastName,
            user.email ?? "",
            user.phone ?? "",
            hashSecret(user.password),
            hashSecret(user.temporaryPassword || user.password || "1234"),
            roleToDb[user.role] ?? user.role,
            this.toDbStatus(user.status),
            this.parseDate(user.lastLoginAt),
          ]
        );
      } catch (error) {
        console.error(`ensureDemoWebAccounts: ${user.publicId} (${user.role})`, error.message);
      }
    }

    const demoSchoolId = schoolIds.get(demoSchoolCode);
    if (demoSchoolId) {
      await this.pool.query(
        `UPDATE users
         SET password_hash = COALESCE(password_hash, $1),
             pin_hash = COALESCE(pin_hash, $1)
         WHERE school_id = $2
           AND role IN ('TEACHER', 'PARENT', 'STUDENT')
           AND (password_hash IS NULL OR pin_hash IS NULL)`,
        [demoPasswordHash, demoSchoolId]
      );
    }

    this.cachedDataset = null;
  }

  async ensureV2Data() {
    if (!shouldSeedDemoData()) {
      return;
    }
    const school = await this.one("SELECT id FROM schools WHERE school_code = $1", [seedData.school.code]);
    if (!school) return;

    const existingExam = await this.one("SELECT id FROM exams WHERE school_id = $1 LIMIT 1", [school.id]);
    await this.ensureV2Roles(school.id);
    await this.ensureSubjectScopes(school.id);

    if (existingExam) {
      return;
    }

    const year = await this.one(
      "SELECT id FROM academic_years WHERE school_id = $1 AND is_current = TRUE ORDER BY created_at DESC LIMIT 1",
      [school.id]
    );
    const term = year
      ? await this.one("SELECT id FROM terms WHERE academic_year_id = $1 ORDER BY created_at LIMIT 1", [year.id])
      : null;
    const classes = await this.all("SELECT id, name FROM classes WHERE school_id = $1 ORDER BY created_at LIMIT 3", [school.id]);
    const subjects = await this.all("SELECT id, name, subject_code FROM subjects WHERE school_id = $1 ORDER BY created_at LIMIT 3", [school.id]);
    const students = await this.all("SELECT id, student_code FROM students WHERE school_id = $1 ORDER BY created_at LIMIT 8", [school.id]);
    const adminUser = await this.one(
      "SELECT id FROM users WHERE school_id = $1 AND role IN ('SCHOOL_ADMIN', 'PROVISEUR', 'PRINCIPAL') ORDER BY created_at LIMIT 1",
      [school.id]
    );

    for (let index = 0; index < Math.min(classes.length, subjects.length); index += 1) {
      const schoolClass = classes[index];
      const subject = subjects[index];
      const examCode = `EXA-2026-${String(index + 1).padStart(4, "0")}`;
      const exam = await this.insertOne(
        this.pool,
        `INSERT INTO exams (school_id, class_id, subject_id, term_id, exam_code, name, exam_type, exam_date, status, created_by, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (exam_code) DO UPDATE SET status = EXCLUDED.status
         RETURNING id`,
        [
          school.id,
          schoolClass.id,
          subject.id,
          term?.id ?? null,
          examCode,
          `${["Interrogation", "Examen blanc", "Examen final"][index]} - ${subject.name}`,
          ["Interrogation", "Examen blanc", "Examen final"][index],
          `2026-06-${String(10 + index).padStart(2, "0")}`,
          index === 0 ? "published" : "validated",
          adminUser?.id ?? null,
        ]
      );

      for (const [studentIndex, student] of students.slice(0, 5).entries()) {
        const score = 10 + ((studentIndex + index) % 9);
        await this.pool.query(
          `INSERT INTO exam_results (school_id, exam_id, student_id, score, max_score, mention, observation, status, created_by)
           VALUES ($1, $2, $3, $4, 20, $5, $6, 'published', $7)
           ON CONFLICT (exam_id, student_id) DO UPDATE SET score = EXCLUDED.score, mention = EXCLUDED.mention`,
          [
            school.id,
            exam.id,
            student.id,
            score,
            this.mentionForScore(score),
            score >= 10 ? "Résultat validé" : "Suivi pédagogique recommandé",
            adminUser?.id ?? null,
          ]
        );
      }
    }

    for (const [index, student] of students.slice(0, 5).entries()) {
      const docs = [
        ["CERTIFICAT_SCOLARITE", "Certificat de scolarité"],
        ["BULLETIN", "Bulletin PDF"],
        ["RELEVE_NOTES", "Relevé de notes"],
      ];
      for (const [docIndex, [type, title]] of docs.entries()) {
        await this.pool.query(
          `INSERT INTO student_documents (school_id, student_id, document_code, document_type, title, format, version, storage_key, generated_by, metadata)
           VALUES ($1, $2, $3, $4, $5, 'PDF', 1, $6, $7, $8)
           ON CONFLICT (document_code) DO NOTHING`,
          [
            school.id,
            student.id,
            `DOC-2026-${String(index + 1).padStart(4, "0")}-${docIndex + 1}`,
            type,
            `${title} - ${student.student_code}`,
            `documents/${student.student_code}/${type.toLowerCase()}-v1.pdf`,
            adminUser?.id ?? null,
            JSON.stringify({ generatedBy: "Somafrik V2", preservedHistory: true }),
          ]
        );
      }
    }

    if (year && students[0]) {
      await this.pool.query(
        `INSERT INTO promotion_decisions (school_id, academic_year_id, student_id, decision, reason, decided_by, decided_at)
         VALUES ($1, $2, $3, 'promoted', 'Moyenne suffisante', $4, NOW())
         ON CONFLICT (academic_year_id, student_id) DO NOTHING`,
        [school.id, year.id, students[0].id, adminUser?.id ?? null]
      );
    }
  }

  async ensureV2Roles(schoolId) {
    const roles = [
      ["USR-PROVISEUR-0001", "Amina", "Proviseur", "proviseur@somafrik.app", "PROVISEUR"],
      ["USR-PREFET-0001", "Samuel", "Préfet", "prefet@somafrik.app", "PREFET_ETUDES"],
    ];

    for (const [code, firstName, lastName, email, role] of roles) {
      await this.pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL, $7, 'active')
         ON CONFLICT (user_code) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email`,
        [schoolId, code, firstName, lastName, email, hashSecret("1234"), role]
      );
    }
  }

  async ensureSubjectScopes(schoolId) {
    await this.pool.query(
      `INSERT INTO subject_class_assignments (school_id, subject_id, class_id, level, status)
       SELECT s.school_id, s.id, cl.id, NULL, 'active'
       FROM subjects s
       JOIN classes cl ON cl.school_id = s.school_id
       WHERE s.school_id = $1
       ON CONFLICT DO NOTHING`,
      [schoolId]
    );
  }

  async getSubjectsV2() {
    await this.init();
    const rows = await this.all(`
      SELECT sub.*, s.school_code, c.iso_code AS country_code,
             COUNT(DISTINCT sca.class_id) AS class_count,
             COUNT(DISTINCT ta.teacher_id) AS teacher_count,
             COUNT(DISTINCT g.id) AS grade_count,
             COALESCE(json_agg(DISTINCT cl.name) FILTER (WHERE cl.name IS NOT NULL), '[]') AS classes,
             COALESCE(json_agg(DISTINCT u.first_name || ' ' || u.last_name) FILTER (WHERE u.id IS NOT NULL), '[]') AS teachers
      FROM subjects sub
      JOIN schools s ON s.id = sub.school_id
      JOIN countries c ON c.id = s.country_id
      LEFT JOIN subject_class_assignments sca ON sca.subject_id = sub.id
      LEFT JOIN classes cl ON cl.id = sca.class_id
      LEFT JOIN teacher_assignments ta ON ta.subject_id = sub.id
      LEFT JOIN teachers t ON t.id = ta.teacher_id
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN grades g ON g.subject_id = sub.id
      GROUP BY sub.id, s.school_code, c.iso_code
      ORDER BY sub.created_at, sub.subject_code
    `);
    return rows.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      schoolCode: row.school_code,
      countryCode: row.country_code,
      code: row.subject_code,
      name: row.name,
      coefficient: Number(row.coefficient),
      level: row.level ?? "Tous niveaux",
      description: row.description ?? "",
      status: this.fromAcademicStatus(row.status),
      classCount: Number(row.class_count),
      teacherCount: Number(row.teacher_count),
      gradeCount: Number(row.grade_count),
      classes: row.classes ?? [],
      teachers: row.teachers ?? [],
      canDelete: Number(row.grade_count) === 0,
      createdAt: this.formatDate(row.created_at),
    }));
  }

  async createSubject(payload) {
    await this.init();
    const school = await this.getSchoolByCode(payload.schoolCode ?? seedData.school.code);
    if (!school) throw new Error("Établissement introuvable");
    for (const field of ["name", "code"]) {
      if (!payload[field]) throw new Error(`Champ obligatoire: ${field}`);
    }

    const row = await this.one(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, level, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (subject_code) DO UPDATE SET
         name = EXCLUDED.name,
         coefficient = EXCLUDED.coefficient,
         level = EXCLUDED.level,
         description = EXCLUDED.description,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING id`,
      [
        school.id,
        String(payload.code).trim().toUpperCase(),
        String(payload.name).trim(),
        Number(payload.coefficient ?? 1),
        String(payload.level ?? "Tous niveaux").trim(),
        String(payload.description ?? "").trim(),
        this.toAcademicStatus(payload.status ?? "Actif"),
      ]
    );
    this.cachedDataset = null;
    await this.recordAudit({
      schoolCode: payload.schoolCode ?? seedData.school.code,
      action: "subject_upsert",
      entityType: "subject",
      entityId: String(payload.code).trim().toUpperCase(),
      newValue: payload,
    });
    return { id: row.id, message: "Matière enregistrée" };
  }

  async deleteSubject(subjectCode) {
    await this.init();
    const subject = await this.one("SELECT id, subject_code FROM subjects WHERE subject_code = $1", [String(subjectCode).trim().toUpperCase()]);
    if (!subject) throw new Error("Matière introuvable");
    const usage = await this.one("SELECT COUNT(*)::int AS count FROM grades WHERE subject_id = $1", [subject.id]);
    if (usage.count > 0) {
      const error = new Error("Suppression refusée: la matière possède déjà des notes");
      error.statusCode = 409;
      throw error;
    }
    await this.pool.query("DELETE FROM subjects WHERE id = $1", [subject.id]);
    this.cachedDataset = null;
    await this.recordAudit({
      action: "subject_delete",
      entityType: "subject",
      entityId: subject.subject_code,
    });
    return { message: "Matière supprimée" };
  }

  async getAcademicYearsV2() {
    await this.init();
    const rows = await this.all(`
      SELECT ay.*, s.school_code, c.iso_code AS country_code,
             COUNT(DISTINCT e.id) AS enrollment_count,
             COUNT(DISTINCT g.id) AS grade_count,
             COUNT(DISTINCT pd.id) AS decision_count
      FROM academic_years ay
      JOIN schools s ON s.id = ay.school_id
      JOIN countries c ON c.id = s.country_id
      LEFT JOIN enrollments e ON e.academic_year_id = ay.id
      LEFT JOIN terms tm ON tm.academic_year_id = ay.id
      LEFT JOIN grades g ON g.term_id = tm.id
      LEFT JOIN promotion_decisions pd ON pd.academic_year_id = ay.id
      GROUP BY ay.id, s.school_code, c.iso_code
      ORDER BY ay.start_date DESC NULLS LAST, ay.created_at DESC
    `);
    return rows.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      schoolCode: row.school_code,
      countryCode: row.country_code,
      name: row.name,
      startDate: this.formatIsoDate(row.start_date),
      endDate: this.formatIsoDate(row.end_date),
      status: this.fromYearStatus(row.status),
      isCurrent: row.is_current,
      enrollmentCount: Number(row.enrollment_count),
      gradeCount: Number(row.grade_count),
      promotionDecisionCount: Number(row.decision_count),
      notesLocked: row.status === "closed" || row.status === "archived",
    }));
  }

  async getExamsV2() {
    await this.init();
    const rows = await this.all(`
      SELECT ex.*, s.school_code, c.iso_code AS country_code, cl.name AS class_name, sub.name AS subject_name,
             COUNT(er.id) AS result_count,
             AVG(er.score) AS average_score,
             AVG(CASE WHEN er.score >= er.max_score / 2 THEN 1 ELSE 0 END) * 100 AS success_rate
      FROM exams ex
      JOIN schools s ON s.id = ex.school_id
      JOIN countries c ON c.id = s.country_id
      JOIN classes cl ON cl.id = ex.class_id
      LEFT JOIN subjects sub ON sub.id = ex.subject_id
      LEFT JOIN exam_results er ON er.exam_id = ex.id
      GROUP BY ex.id, s.school_code, c.iso_code, cl.name, sub.name
      ORDER BY ex.exam_date DESC, ex.created_at DESC
    `);
    return rows.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      schoolCode: row.school_code,
      countryCode: row.country_code,
      code: row.exam_code,
      name: row.name,
      type: row.exam_type,
      className: row.class_name,
      subject: row.subject_name ?? "Toutes matières",
      date: this.formatIsoDate(row.exam_date),
      status: this.fromExamStatus(row.status),
      resultCount: Number(row.result_count),
      average: Number(row.average_score ?? 0).toFixed(2),
      successRate: Math.round(Number(row.success_rate ?? 0)),
    }));
  }

  async getDocumentsV2() {
    await this.init();
    const rows = await this.all(`
      SELECT doc.*, s.school_code, c.iso_code AS country_code, st.student_code, st.first_name, st.last_name
      FROM student_documents doc
      JOIN schools s ON s.id = doc.school_id
      JOIN countries c ON c.id = s.country_id
      LEFT JOIN students st ON st.id = doc.student_id
      ORDER BY doc.generated_at DESC, doc.document_code
    `);
    return rows.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      schoolCode: row.school_code,
      countryCode: row.country_code,
      code: row.document_code,
      type: row.document_type,
      title: row.title,
      format: row.format,
      version: row.version,
      studentCode: row.student_code,
      studentName: [row.first_name, row.last_name].filter(Boolean).join(" "),
      status: row.status === "available" ? "Disponible" : "Archivé",
      storageKey: row.storage_key,
      generatedAt: this.formatDate(row.generated_at),
    }));
  }

  async getAdvancedReportsV2() {
    await this.init();
    const [academic, financial, attendance, exams, global] = await Promise.all([
      this.all(`
        SELECT cl.name AS label, AVG(g.score / NULLIF(g.max_score, 0) * 20) AS value, COUNT(g.id) AS count
        FROM grades g
        JOIN classes cl ON cl.id = g.class_id
        GROUP BY cl.name
        ORDER BY value DESC NULLS LAST
        LIMIT 10
      `),
      this.one(`
        SELECT
          COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN amount ELSE 0 END), 0) AS paid,
          COALESCE(SUM(CASE WHEN payment_status <> 'paid' THEN amount ELSE 0 END), 0) AS unpaid,
          COUNT(*) AS payments
        FROM payments
      `),
      this.all(`
        SELECT status AS label, COUNT(*) AS count
        FROM attendance
        GROUP BY status
        ORDER BY count DESC
      `),
      this.all(`
        SELECT ex.exam_type AS label,
               AVG(er.score / NULLIF(er.max_score, 0) * 20) AS average,
               AVG(CASE WHEN er.score >= er.max_score / 2 THEN 1 ELSE 0 END) * 100 AS success_rate
        FROM exams ex
        LEFT JOIN exam_results er ON er.exam_id = ex.id
        GROUP BY ex.exam_type
        ORDER BY ex.exam_type
      `),
      this.one(`
        SELECT
          (SELECT COUNT(*) FROM countries) AS countries,
          (SELECT COUNT(*) FROM schools) AS schools,
          (SELECT COUNT(*) FROM students) AS students,
          (SELECT COUNT(*) FROM teachers) AS teachers,
          (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') AS active_subscriptions
      `),
    ]);

    const attendanceTotal = attendance.reduce((sum, row) => sum + Number(row.count), 0);
    const presentTotal = attendance
      .filter((row) => row.label === "present")
      .reduce((sum, row) => sum + Number(row.count), 0);

    return {
      academic: academic.map((row) => ({
        label: row.label,
        average: Number(row.value ?? 0).toFixed(2),
        grades: Number(row.count),
      })),
      financial: {
        paid: Number(financial.paid),
        unpaid: Number(financial.unpaid),
        payments: Number(financial.payments),
        forecast: Number(financial.paid) + Number(financial.unpaid),
      },
      attendance: {
        rate: attendanceTotal ? Math.round((presentTotal / attendanceTotal) * 100) : 0,
        total: attendanceTotal,
        breakdown: attendance.map((row) => ({ label: this.fromAttendanceStatus(row.label), count: Number(row.count) })),
      },
      exams: exams.map((row) => ({
        label: row.label,
        average: Number(row.average ?? 0).toFixed(2),
        successRate: Math.round(Number(row.success_rate ?? 0)),
      })),
      global: {
        countries: Number(global.countries),
        schools: Number(global.schools),
        students: Number(global.students),
        teachers: Number(global.teachers),
        activeSubscriptions: Number(global.active_subscriptions),
      },
    };
  }

  mapCountry(country) {
    return {
      id: country.id,
      name: country.name,
      code: country.iso_code,
      phonePrefix: country.phone_code,
      currency: country.currency,
      timezone: "UTC",
      status: country.is_active ? "Actif" : "Suspendu",
      administratorId: "",
      createdAt: this.formatDate(country.created_at),
    };
  }

  mapSchool(school, subscription) {
    return {
      id: school.id,
      countryId: school.country_id,
      countryCode: school.iso_code,
      publicId: school.school_code,
      code: school.school_code,
      name: school.name,
      type: school.school_type,
      city: school.city,
      country: school.country_name === "République Démocratique du Congo" ? "RDC" : school.country_name,
      address: school.address,
      phone: school.phone,
      email: school.email,
      website: "",
      currency: school.country_currency,
      slogan: "Excellence et Innovation",
      status: this.fromDbStatus(school.status),
      logoUrl: school.logo_url ?? "",
      schoolYear: "2025-2026",
      timezone: "Africa/Kinshasa",
      language: "Français",
      dateFormat: "JJ-MM-AAAA",
      primaryColor: "#2563EB",
      subscriptionPlan: subscription?.plan_name ?? "Essentiel",
      subscriptionStartDate: this.formatDate(subscription?.start_date),
      subscriptionEndDate: this.formatDate(subscription?.end_date),
      subscriptionStatus: this.fromSubscriptionStatus(subscription?.status),
      maxStudents: 1200,
      maxTeachers: 120,
      createdAt: this.formatDate(school.created_at),
    };
  }

  mapSubscription(subscription) {
    return {
      id: subscription.id,
      schoolId: subscription.school_id,
      schoolCode: subscription.school_code,
      countryCode: subscription.country_code,
      country: subscription.country_name,
      plan: subscription.plan_name,
      monthlyPrice: Number(subscription.price_per_student ?? 0),
      annualPrice: Number(subscription.price_per_student ?? 0) * 10,
      currency: subscription.billing_currency,
      status: this.fromDbStatus(subscription.status === "active" ? "active" : subscription.status),
      paymentStatus: subscription.status === "active" ? "À jour" : "En retard",
      startDate: this.formatDate(subscription.start_date),
      endDate: this.formatDate(subscription.end_date),
      lastPaymentDate: this.formatDate(subscription.updated_at),
    };
  }

  mapUser(user, schoolByCode, teacherLoginByUserId = new Map()) {
    const role = roleFromDb[user.role] ?? user.role;
    const school = role === "Admin Pays" ? null : user.school_code ? schoolByCode.get(user.school_code) : null;
    const teacherLoginId = teacherLoginByUserId.get(user.id) ?? "";
    const identifier = this.getUserIdentifier(user, role, teacherLoginId);
    const countryCode = school?.iso_code ?? this.getCountryCodeForUser(user, role);
    const countryScope = this.getCountryScopeForUser(school, countryCode);

    return {
      id: user.id,
      schoolId: user.school_id,
      publicId: user.user_code,
      lastName: user.last_name,
      firstName: user.first_name,
      gender: "",
      phone: user.phone,
      email: user.email,
      role,
      secondaryRoles: [],
      scopeLevel: role === "Super Administrateur Somafrik" ? "Global" : role === "Admin Pays" ? "Pays" : "Établissement",
      countryScope,
      countryCode,
      schoolCode: role === "Admin Pays" ? "*" : user.school_code ?? "*",
      accessChannel: "Application",
      identifier,
      passwordHash: user.password_hash,
      pinHash: user.pin_hash,
      status: this.fromDbStatus(user.status),
      permissions: seedData.rolePermissions[role] ?? ["Voir tableau de bord"],
      temporaryPassword: "",
      mustChangePassword: Boolean(user.must_change_password),
      photoUrl: "",
      createdAt: this.formatDate(user.created_at),
      lastLoginAt: this.formatDate(user.last_login_at),
      createdBy: "PostgreSQL",
      history: ["Compte chargé depuis PostgreSQL"],
    };
  }

  getCountryCodeForUser(user, role) {
    if (role === "Admin Pays") {
      const match = String(user.user_code ?? "").match(/^ADM-([A-Z]{2})-/i);
      if (match) return match[1].toUpperCase();
    }

    return "";
  }

  getCountryScopeForUser(school, countryCode) {
    if (school?.country_name) {
      return school.country_name === "République Démocratique du Congo" ? "RDC" : school.country_name;
    }

    if (countryCode === "CD") {
      return "RDC";
    }

    return countryCode;
  }

  extractTeacherLoginId(code) {
    const match = String(code ?? "").match(/(ENS-\d+)$/i);
    return match ? match[1].toUpperCase() : "";
  }

  getUserIdentifier(user, role, teacherLoginId = "") {
    const aliases = {
      "USR-2026-000001": "admin",
      "USR-2026-000002": "superadmin",
      "ADM-CD-2026-0001": "admin-rdc",
      "USR-PREFET-0001": "prefet",
      "USR-SECRETARY-0001": "secretaire",
      // Jeu bulk : comptes démo de CD-2026-0001 (voir bulkPlatformSeed.buildSchoolRoleUser)
      "ADMIN-CD-2026-0001-01": "admin",
      "SECRETAIRE-CD-2026-0001-01": "secretaire",
      "PREFET-CD-2026-0001-01": "prefet",
    };

    if (aliases[user.user_code]) {
      return aliases[user.user_code];
    }

    if (role === "Admin Pays") {
      const match = String(user.user_code ?? "").match(/^ADM-([A-Z]{2})-/i);
      if (match) return `admin-${match[1].toLowerCase()}`;
    }

    if (role === "Enseignant") {
      if (teacherLoginId) {
        return teacherLoginId;
      }

      const fromUserCode = this.extractTeacherLoginId(user.user_code);
      if (fromUserCode) {
        return fromUserCode;
      }

      if (/^ENS-\d+$/i.test(String(user.user_code))) {
        return String(user.user_code).toUpperCase();
      }
    }

    if (role === "Parent" && user.phone) {
      return user.phone;
    }

    if (["Élève / Étudiant", "Élève", "Étudiant"].includes(role)) {
      const match = String(user.user_code ?? "").match(/(ELE-\d+)$/i);
      if (match) {
        return match[1].toUpperCase();
      }
      if (/^ELE-\d+$/i.test(String(user.user_code))) {
        return String(user.user_code).toUpperCase();
      }
    }

    return user.user_code || user.phone || user.email;
  }

  mapTeacher(teacher, gradeRows, assignmentRows = []) {
    const officialAssignments = assignmentRows
      .filter((assignment) => assignment.teacher_code === teacher.teacher_code)
      .map((assignment) => ({ className: assignment.class_name, course: assignment.subject_name }));
    const gradeAssignments = gradeRows
      .filter((grade) => grade.teacher_code === teacher.teacher_code)
      .map((grade) => ({ className: grade.class_name, course: grade.subject_name }));
    const assignments = this.uniqueBy([...officialAssignments, ...gradeAssignments], "className", "course");
    return {
      id: teacher.teacher_code,
      schoolId: teacher.school_id,
      schoolCode: teacher.school_code,
      publicId: teacher.teacher_code,
      userId: teacher.user_id,
      identifier: this.extractTeacherLoginId(teacher.teacher_code),
      name: [teacher.first_name, teacher.last_name].filter(Boolean).join(" ") || teacher.teacher_code,
      firstName: teacher.first_name,
      gender: "",
      phone: teacher.phone,
      email: teacher.email,
      mainSubject: teacher.speciality,
      passwordHash: teacher.pin_hash ?? teacher.password_hash,
      assignments,
    };
  }

  mapStudent(student) {
    return {
      id: student.student_code,
      schoolId: student.school_id,
      publicId: student.student_code,
      name: `${student.first_name} ${student.last_name}`.trim(),
      firstName: student.first_name,
      matricule: student.student_code,
      gender: student.gender,
      birthDate: this.formatDate(student.birth_date),
      className: student.class_name,
      schoolCode: student.school_code,
      pinHash: student.student_pin_hash,
      parentName: "Parent Somafrik",
      parentPhone: student.parent_phone,
      parentEmail: student.parent_email,
      archived: student.status === "archived",
    };
  }

  mapGrade(grade) {
    return {
      id: grade.id,
      schoolId: grade.school_id,
      schoolCode: grade.school_code,
      studentId: grade.student_code,
      subject: grade.subject_name,
      value: Number(grade.score),
      coefficient: Number(grade.subject_coefficient ?? 1),
      date: this.formatDate(grade.created_at),
      evaluationId: grade.id,
      evaluationTitle: grade.comment || this.fromEvaluationType(grade.grade_type),
      evaluationType: this.fromEvaluationType(grade.grade_type),
      period: grade.term_name,
      scale: Number(grade.max_score),
      evaluationCoefficient: Number(grade.coefficient),
      authorId: grade.teacher_code,
      enteredAt: this.formatDate(grade.created_at),
      audit: [{ authorId: grade.teacher_code, newValue: Number(grade.score), date: this.formatDate(grade.created_at) }],
    };
  }

  mapAttendance(attendance) {
    const status = this.fromAttendanceStatus(attendance.status);
    return {
      id: attendance.id,
      schoolId: attendance.school_id,
      schoolCode: attendance.school_code,
      publicId: attendance.id,
      studentId: attendance.student_code,
      className: attendance.class_name,
      date: this.formatIsoDate(attendance.attendance_date),
      savedAt: this.formatIsoDateTime(attendance.updated_at ?? attendance.created_at),
      present: status === "Présent" || status === "Retard",
      status,
    };
  }

  mapPayment(payment) {
    return {
      id: payment.id,
      schoolId: payment.school_id,
      schoolCode: payment.school_code,
      publicId: payment.payment_code,
      studentId: payment.student_code,
      amount: Number(payment.amount),
      date: this.formatIsoDate(payment.payment_date),
      status: payment.payment_status === "paid" ? "PAYE" : "EN_ATTENTE",
      method: payment.payment_method,
    };
  }

  mapAnnouncement(announcement) {
    return {
      id: announcement.id,
      schoolId: announcement.school_id,
      schoolCode: announcement.school_code,
      title: announcement.title,
      message: announcement.message,
      date: this.formatDate(announcement.published_at ?? announcement.created_at),
    };
  }

  mapNotification(notification) {
    return {
      id: notification.id,
      schoolId: notification.school_id,
      schoolCode: notification.school_code,
      audience: "BackOffice",
      countryCode: "*",
      title: notification.title,
      message: notification.message,
      type: notification.type,
      priority: "Moyenne",
      channels: [notification.channel],
      status: notification.status === "read" ? "Lu" : "Non lu",
      date: this.formatDate(notification.sent_at ?? notification.created_at),
      createdBy: "PostgreSQL",
    };
  }

  buildCourses(classRows, subjectRows, gradeRows) {
    const rows = [];
    const seen = new Set();

    gradeRows.forEach((grade) => {
      const key = `${grade.school_code}-${grade.class_name}-${grade.subject_name}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        id: `${grade.class_code}-${this.subjectCode(grade.subject_name)}`,
        publicId: `${grade.class_code}-${this.subjectCode(grade.subject_name)}`,
        schoolId: grade.school_id,
        schoolCode: grade.school_code,
        className: grade.class_name,
        name: grade.subject_name,
        coefficient: Number(grade.subject_coefficient ?? 1),
      });
    });

    if (!rows.length) {
      classRows.forEach((schoolClass) => {
        subjectRows.forEach((subject) => {
          rows.push({
            id: `${schoolClass.class_code}-${subject.subject_code}`,
            publicId: `${schoolClass.class_code}-${subject.subject_code}`,
            schoolId: schoolClass.school_id,
            schoolCode: "",
            className: schoolClass.name,
            name: subject.name,
            coefficient: Number(subject.coefficient ?? 1),
          });
        });
      });
    }

    return rows;
  }

  uniqueBy(rows, ...keys) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = keys.map((field) => row[field]).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getCountryCodeForSchool(school) {
    if (school.country === "RDC") return "CD";
    return String(school.code ?? "").slice(0, 2);
  }

  subjectCode(name) {
    return `SUB-${String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase()}`;
  }

  getSchoolByCode(code) {
    return this.one("SELECT * FROM schools WHERE school_code = $1", [String(code ?? "").trim().toUpperCase()]);
  }

  async getGradeById(id) {
    const grade = await this.one(
      `SELECT g.*, st.student_code, s.school_code, cl.class_code, cl.name AS class_name, sub.name AS subject_name,
              sub.coefficient AS subject_coefficient, t.teacher_code, term.name AS term_name
       FROM grades g
       JOIN schools s ON s.id = g.school_id
       JOIN students st ON st.id = g.student_id
       JOIN classes cl ON cl.id = g.class_id
       JOIN subjects sub ON sub.id = g.subject_id
       JOIN teachers t ON t.id = g.teacher_id
       JOIN terms term ON term.id = g.term_id
       WHERE g.id = $1`,
      [id]
    );
    return grade ? this.mapGrade(grade) : null;
  }

  async findTeacherForGrade(schoolId, teacherCode, classId, subjectId, principalRole) {
    const assignedTeacher = teacherCode
      ? await this.one(
          `SELECT t.*
           FROM teachers t
           JOIN teacher_assignments ta ON ta.teacher_id = t.id
           WHERE t.school_id = $1
             AND t.teacher_code = $2
             AND ta.class_id = $3
             AND ta.subject_id = $4
           LIMIT 1`,
          [schoolId, String(teacherCode), classId, subjectId]
        )
      : null;

    if (principalRole === "Enseignant") {
      return assignedTeacher;
    }

    return assignedTeacher ?? this.one("SELECT * FROM teachers WHERE school_id = $1 ORDER BY created_at LIMIT 1", [schoolId]);
  }

  async findTeacherForAttendance(schoolId, teacherCode, classId, principalRole) {
    const assignedTeacher = teacherCode
      ? await this.one(
          `SELECT t.*
           FROM teachers t
           JOIN teacher_assignments ta ON ta.teacher_id = t.id
           WHERE t.school_id = $1
             AND t.teacher_code = $2
             AND ta.class_id = $3
           LIMIT 1`,
          [schoolId, String(teacherCode), classId]
        )
      : null;

    if (principalRole === "Enseignant") {
      return assignedTeacher;
    }

    return assignedTeacher ?? this.one("SELECT * FROM teachers WHERE school_id = $1 ORDER BY created_at LIMIT 1", [schoolId]);
  }

  mentionForScore(score) {
    if (score >= 16) return "Très bien";
    if (score >= 14) return "Bien";
    if (score >= 12) return "Assez bien";
    if (score >= 10) return "Passable";
    return "Insuffisant";
  }

  toAcademicStatus(status) {
    const normalized = String(status ?? "").trim().toLowerCase();
    if (["inactive", "inactif", "inactive"].includes(normalized)) return "inactive";
    if (["archive", "archivé", "archived"].includes(normalized)) return "archived";
    return "active";
  }

  fromAcademicStatus(status) {
    if (status === "inactive") return "Inactive";
    if (status === "archived") return "Archivée";
    return "Active";
  }

  fromYearStatus(status) {
    if (status === "preparation") return "Préparation";
    if (status === "closed") return "Clôturée";
    if (status === "archived") return "Archivée";
    return "Ouverte";
  }

  fromExamStatus(status) {
    if (status === "draft") return "Brouillon";
    if (status === "validated") return "Validé";
    if (status === "published") return "Publié";
    return status;
  }

  fromEvaluationType(type) {
    if (type === "interrogation") return "Interrogation";
    if (type === "examen") return "Examen";
    if (type === "tp") return "Travail pratique";
    if (type === "projet") return "Projet";
    return "Devoir";
  }

  parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const match = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return null;
  }

  formatDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
  }

  formatIsoDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  formatIsoDateTime(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

  toDbStatus(status) {
    if (status === "Suspendu") return "suspended";
    if (status === "Désactivé") return "inactive";
    if (status === "Archivé") return "archived";
    return "active";
  }

  fromDbStatus(status) {
    if (status === "suspended") return "Suspendu";
    if (status === "inactive") return "Désactivé";
    if (status === "archived") return "Archivé";
    return "Actif";
  }

  toSubscriptionStatus(status, paymentStatus) {
    if (status === "Suspendu") return "suspended";
    if (paymentStatus === "En retard") return "expired";
    return "active";
  }

  fromSubscriptionStatus(status) {
    if (status === "active") return "À jour";
    if (status === "suspended") return "Suspendu";
    if (status === "expired") return "En retard";
    return "À contrôler";
  }

  toAttendanceStatus(status, present) {
    if (status === "Absent") return "absent";
    if (status === "Retard") return "late";
    if (status === "Justifié") return "excused";
    return present ? "present" : "absent";
  }

  fromAttendanceStatus(status) {
    if (status === "absent") return "Absent";
    if (status === "late") return "Retard";
    if (status === "excused") return "Justifié";
    return "Présent";
  }

  toPaymentMethod(method) {
    if (String(method).toLowerCase().includes("mobile")) return "mobile_money";
    if (String(method).toLowerCase().includes("virement")) return "bank_transfer";
    if (String(method).toLowerCase().includes("carte")) return "card";
    return "cash";
  }

  toPaymentStatus(status) {
    if (status === "PAYE") return "paid";
    if (status === "PARTIEL") return "partial";
    return "pending";
  }
}

module.exports = { PostgresRepository };

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function toDbEvaluationType(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized.includes("interrogation")) return "interrogation";
  if (normalized.includes("examen")) return "examen";
  if (normalized.includes("travail") || normalized === "tp") return "tp";
  if (normalized.includes("projet")) return "projet";
  return "devoir";
}

function defaultAcademicPeriods() {
  return [
    { id: "trimestre-1", name: "Trimestre 1", type: "Trimestre", order: 1, startDate: "01-09-2025", endDate: "31-12-2025", active: true },
    { id: "trimestre-2", name: "Trimestre 2", type: "Trimestre", order: 2, startDate: "01-01-2026", endDate: "31-03-2026", active: false },
    { id: "trimestre-3", name: "Trimestre 3", type: "Trimestre", order: 3, startDate: "01-04-2026", endDate: "30-06-2026", active: false },
  ];
}

function inferPeriodMode(periods) {
  const names = periods.map((period) => String(period.name ?? "").toLowerCase());
  if (names.some((name) => name.includes("semestre"))) return "semestre";
  if (names.some((name) => name.includes("trimestre"))) return "trimestre";
  return "periode";
}

function withSystemActivePeriods(config) {
  if (!config || !Array.isArray(config.periods)) return config;
  return {
    ...config,
    periods: applySystemActivePeriod(config.periods),
  };
}
