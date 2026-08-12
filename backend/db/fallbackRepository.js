const seedData = require("../data");
const { shouldSeedDemoData } = require("../lib/demoSeedPolicy");
const { applySystemActivePeriod } = require("../lib/academicPeriods");
const { buildEmptyBackOfficeState } = require("../lib/emptyBackOfficeState");
const { hashSecret } = require("../services/credentialService");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FallbackRepository {
  constructor() {
    this.engine = "memory";
    this.ready = false;
    this.sessions = new Map();
    this.auditLogs = [];
    this.idempotencyRecords = new Map();
    this.backOfficeState = null;
    this.notes = clone(seedData.notes);
    this.presences = clone(seedData.presences);
    this.subjects = seedData.courses.map((course) => ({
      id: course.publicId ?? course.id,
      schoolId: seedData.school.id,
      schoolCode: seedData.school.code,
      countryCode: seedData.school.countryCode ?? "CD",
      code: course.publicId ?? course.id,
      name: course.name,
      coefficient: course.coefficient ?? 1,
      level: "Tous niveaux",
      description: course.description ?? "",
      status: "Active",
      classCount: new Set(seedData.courses.filter((item) => item.name === course.name).map((item) => item.className)).size,
      teacherCount: 1,
      gradeCount: seedData.notes.filter((note) => note.subject === course.name).length,
      classes: [...new Set(seedData.courses.filter((item) => item.name === course.name).map((item) => item.className))],
      teachers: [],
      canDelete: seedData.notes.every((note) => note.subject !== course.name),
      createdAt: "01-01-2026",
    })).filter((subject, index, rows) => rows.findIndex((item) => item.name === subject.name) === index);
  }

  async init() {
    this.ready = true;
  }

  async close() {
    this.ready = false;
  }

  async getDataset() {
    await this.init();
    if (!shouldSeedDemoData()) {
      return clone({
        school: null,
        platformSchools: [],
        countries: [],
        subscriptions: [],
        userAccounts: [],
        teachers: [],
        classes: [],
        courses: [],
        students: [],
        notes: [],
        presences: [],
        payments: [],
        announcements: [],
        exams: [],
        bulletins: [],
        documents: [],
        courseSchedules: [],
        academicConfigs: {},
        teacherAssignments: [],
        platformNotifications: [],
      });
    }
    return clone({
      school: seedData.school,
      platformSchools: seedData.platformSchools,
      countries: seedData.countries,
      subscriptions: seedData.subscriptions,
      subscriptionOffers: seedData.subscriptionOffers ?? [],
      userAccounts: seedData.userAccounts,
      teachers: seedData.teachers,
      classes: seedData.classes,
      courses: seedData.courses,
      students: seedData.students,
      notes: this.notes,
      presences: this.presences,
      payments: seedData.payments,
      announcements: seedData.announcements,
      exams: seedData.exams,
      bulletins: seedData.bulletins,
      documents: seedData.documents,
      courseSchedules: seedData.courseSchedules ?? [],
      academicConfigs: seedData.academicConfigs ?? {},
      teacherAssignments: seedData.teacherAssignments,
      platformNotifications: seedData.platformNotifications,
    });
  }

  async createSession({ sessionId, refreshTokenHash, userId, schoolCode, role, expiresAt, ipAddress, userAgent }) {
    this.sessions.set(sessionId, {
      session_code: sessionId,
      refresh_token_hash: refreshTokenHash,
      user_id: userId,
      school_code: schoolCode,
      role,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
      revoked_at: null,
    });
  }

  async findActiveSession(sessionId, refreshTokenHash) {
    const session = this.sessions.get(sessionId);

    if (!session || session.refresh_token_hash !== refreshTokenHash || session.revoked_at) {
      return null;
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      return null;
    }

    return session;
  }

  async revokeSession(sessionId, reason = "logout") {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.revoked_at = new Date();
      session.revoke_reason = reason;
    }
  }

  async recordAudit({ schoolCode, userId, action, entityType, entityId, oldValue, newValue, ipAddress, userAgent }) {
    this.auditLogs.unshift({
      id: `AUDIT-MEM-${String(this.auditLogs.length + 1).padStart(5, "0")}`,
      schoolCode,
      userId,
      userCode: userId,
      actor: userId ?? "system",
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      ipAddress,
      userAgent,
      createdAt: new Date().toISOString(),
      date: new Date().toLocaleDateString("fr-FR"),
    });
  }

  async getAuditLogs({ schoolCode, userId, action, limit = 100 } = {}) {
    return this.auditLogs
      .filter((row) => !schoolCode || row.schoolCode === schoolCode)
      .filter((row) => !userId || row.userId === userId)
      .filter((row) => !action || row.action === action)
      .slice(0, Math.min(Number(limit) || 100, 500));
  }

  async getBackOfficeState() {
    return clone(this.backOfficeState);
  }

  async saveBackOfficeState(payload) {
    this.backOfficeState = clone(payload ?? {});
    if (Array.isArray(payload?.notes)) {
      this.notes = clone(payload.notes);
    }
    return this.getBackOfficeState();
  }

  async findIdempotencyRecord(cacheId) {
    const record = this.idempotencyRecords.get(String(cacheId ?? ""));
    if (!record) return null;
    if (new Date(record.expires_at).getTime() <= Date.now()) {
      this.idempotencyRecords.delete(String(cacheId ?? ""));
      return null;
    }
    return record;
  }

  async saveIdempotencyRecord({ cacheId, routeKey, principalId, statusCode, responseBody, expiresAt }) {
    this.idempotencyRecords.set(String(cacheId ?? ""), {
      cache_id: String(cacheId ?? ""),
      route_key: String(routeKey ?? ""),
      principal_id: String(principalId ?? ""),
      status_code: Number(statusCode ?? 200),
      response_body: clone(responseBody ?? {}),
      expires_at: expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  async getAcademicConfig(schoolCode) {
    const normalizedSchoolCode = String(schoolCode && schoolCode !== "*" ? schoolCode : seedData.school.code).trim().toUpperCase();
    const config = this.backOfficeState?.academicConfigs?.[normalizedSchoolCode] ?? {
      schoolCode: normalizedSchoolCode,
      periodMode: "trimestre",
      periods: [
        { id: "trimestre-1", name: "Trimestre 1", type: "Trimestre", order: 1, startDate: "01-09-2025", endDate: "31-12-2025", active: false },
        { id: "trimestre-2", name: "Trimestre 2", type: "Trimestre", order: 2, startDate: "01-01-2026", endDate: "31-03-2026", active: false },
        { id: "trimestre-3", name: "Trimestre 3", type: "Trimestre", order: 3, startDate: "01-04-2026", endDate: "30-06-2026", active: false },
      ],
      evaluationTypes: ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
      defaultScale: 20,
      reportCardMode: "period",
      allowCustomClasses: true,
      allowCustomCourses: true,
      allowCustomReportCards: true,
      levels: seedData.demoLevels,
      tracks: seedData.demoTracks,
      classNames: seedData.demoClassNames,
      subjects: seedData.demoSubjects,
    };
    return {
      ...config,
      periods: applySystemActivePeriod(config.periods ?? []),
    };
  }

  async saveAcademicConfig(schoolCode, config) {
    const normalizedSchoolCode = String(config.schoolCode ?? (schoolCode && schoolCode !== "*" ? schoolCode : seedData.school.code)).trim().toUpperCase();
    const savedConfig = {
      schoolCode: normalizedSchoolCode,
      periodMode: config.periodMode ?? "trimestre",
      periods: applySystemActivePeriod(
        Array.isArray(config.periods) && config.periods.length ? config.periods : [
        { id: "trimestre-1", name: "Trimestre 1", type: "Trimestre", order: 1, startDate: "01-09-2025", endDate: "31-12-2025", active: false },
        { id: "trimestre-2", name: "Trimestre 2", type: "Trimestre", order: 2, startDate: "01-01-2026", endDate: "31-03-2026", active: false },
        { id: "trimestre-3", name: "Trimestre 3", type: "Trimestre", order: 3, startDate: "01-04-2026", endDate: "30-06-2026", active: false },
      ],
      ),
      evaluationTypes: Array.isArray(config.evaluationTypes) && config.evaluationTypes.length ? config.evaluationTypes : ["Interrogation", "Devoir", "Examen"],
      defaultScale: Number(config.defaultScale ?? 20),
      reportCardMode: config.reportCardMode ?? "period",
      allowCustomClasses: config.allowCustomClasses !== false,
      allowCustomCourses: config.allowCustomCourses !== false,
      allowCustomReportCards: config.allowCustomReportCards !== false,
      levels: Array.isArray(config.levels) && config.levels.length ? config.levels : seedData.demoLevels,
      tracks: Array.isArray(config.tracks) && config.tracks.length ? config.tracks : seedData.demoTracks,
      classNames: Array.isArray(config.classNames) && config.classNames.length ? config.classNames : seedData.demoClassNames,
      subjects: Array.isArray(config.subjects) && config.subjects.length ? config.subjects : seedData.demoSubjects,
    };
    this.backOfficeState = {
      ...(this.backOfficeState ?? {}),
      academicConfigs: {
        ...(this.backOfficeState?.academicConfigs ?? {}),
        [normalizedSchoolCode]: savedConfig,
      },
    };
    return clone(savedConfig);
  }

  async resetUserPassword(userId, temporaryPassword) {
    const secretHash = hashSecret(temporaryPassword);
    const existingStateUsers = this.backOfficeState?.users ?? [];
    const lookupKeys = (Array.isArray(userId) ? userId : [userId])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    const matchesLookup = (user) =>
      lookupKeys.some((key) =>
        [user.id, user.publicId, user.identifier].some((value) => String(value ?? "") === key),
      );
    const seedUserIndex = seedData.userAccounts.findIndex(matchesLookup);
    const stateUser = existingStateUsers.find(matchesLookup);

    if (!stateUser && seedUserIndex === -1) {
      const error = new Error("Utilisateur introuvable");
      error.statusCode = 404;
      throw error;
    }

    const sourceUser = stateUser ?? seedData.userAccounts[seedUserIndex];
    const updatedUser = {
      ...sourceUser,
      password: temporaryPassword,
      pin: temporaryPassword,
      passwordHash: secretHash,
      pinHash: secretHash,
      temporaryPassword,
      mustChangePassword: true,
      history: [
        ...(sourceUser.history ?? []),
        `Mot de passe temporaire régénéré le ${new Date().toLocaleDateString("fr-FR")}. Ancien mot de passe invalidé.`,
      ],
    };

    if (seedUserIndex !== -1) {
      seedData.userAccounts[seedUserIndex] = updatedUser;
    }

    this.backOfficeState = {
      ...(this.backOfficeState ?? {}),
      users: stateUser
        ? existingStateUsers.map((user) => (matchesLookup(user) ? updatedUser : user))
        : [updatedUser, ...existingStateUsers],
    };

    return clone(updatedUser);
  }

  async changeUserPassword(userId, newPassword) {
    const secretHash = hashSecret(newPassword);
    const existingStateUsers = this.backOfficeState?.users ?? [];
    const lookupKeys = (Array.isArray(userId) ? userId : [userId])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    const matchesLookup = (user) =>
      lookupKeys.some((key) =>
        [user.id, user.publicId, user.identifier].some((value) => String(value ?? "") === key),
      );
    const seedUserIndex = seedData.userAccounts.findIndex(matchesLookup);
    const stateUser = existingStateUsers.find(matchesLookup);

    if (!stateUser && seedUserIndex === -1) {
      const error = new Error("Utilisateur introuvable");
      error.statusCode = 404;
      throw error;
    }

    const sourceUser = stateUser ?? seedData.userAccounts[seedUserIndex];
    const updatedUser = {
      ...sourceUser,
      password: newPassword,
      pin: newPassword,
      passwordHash: secretHash,
      pinHash: secretHash,
      temporaryPassword: "",
      mustChangePassword: false,
      history: [
        ...(sourceUser.history ?? []),
        `Mot de passe personnel défini le ${new Date().toLocaleDateString("fr-FR")}.`,
      ],
    };

    if (seedUserIndex !== -1) {
      seedData.userAccounts[seedUserIndex] = updatedUser;
    }

    this.backOfficeState = {
      ...(this.backOfficeState ?? {}),
      users: stateUser
        ? existingStateUsers.map((user) => (matchesLookup(user) ? updatedUser : user))
        : [updatedUser, ...existingStateUsers],
    };

    return clone(updatedUser);
  }

  async upsertGrade(payload, principal) {
    const value = Number(payload.value);
    const scale = Number(payload.scale ?? 20);
    if (!payload.studentId || !payload.subject || Number.isNaN(value) || value < 0 || value > scale) {
      const error = new Error("Note invalide");
      error.statusCode = 400;
      throw error;
    }

    const existingIndex = this.notes.findIndex((note) => note.id === payload.id);
    const now = new Date().toLocaleDateString("fr-FR");
    const next = {
      id: existingIndex >= 0 ? this.notes[existingIndex].id : `NOTE-MEM-${Date.now()}`,
      studentId: payload.studentId,
      subject: payload.subject,
      value,
      coefficient: Number(payload.coefficient ?? 1),
      date: payload.date ?? now,
      evaluationId: payload.evaluationId,
      scale,
      evaluationCoefficient: Number(payload.evaluationCoefficient ?? 1),
      authorId: principal?.sub ?? payload.authorId ?? "teacher",
      enteredAt: now,
      audit: [
        ...(existingIndex >= 0 ? this.notes[existingIndex].audit ?? [] : []),
        {
          authorId: principal?.sub ?? payload.authorId ?? "teacher",
          oldValue: existingIndex >= 0 ? this.notes[existingIndex].value : undefined,
          newValue: value,
          date: now,
        },
      ],
    };

    if (existingIndex >= 0) {
      this.notes[existingIndex] = next;
    } else {
      this.notes.unshift(next);
    }

    return clone(next);
  }

  async upsertAttendanceBatch(payload = {}, principal = {}) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      return [];
    }

    const saved = [];
    for (const item of items) {
      saved.push(await this.upsertAttendance(item, principal));
    }

    return saved;
  }

  async upsertAttendance(payload = {}, principal = {}) {
    if (!payload.studentId || !payload.date) {
      const error = new Error("Présence invalide");
      error.statusCode = 400;
      throw error;
    }

    const state = (await this.getBackOfficeState()) ?? {};
    const catalogStudents = Array.isArray(state.students) ? state.students : [];
    const student = catalogStudents.find(
      (item) =>
        String(item.id) === String(payload.studentId) ||
        String(item.matricule) === String(payload.studentId) ||
        String(item.publicId) === String(payload.studentId),
    ) ?? (shouldSeedDemoData() ? seedData.students : []).find(
      (item) =>
        String(item.id) === String(payload.studentId) ||
        String(item.matricule) === String(payload.studentId) ||
        String(item.publicId) === String(payload.studentId),
    );
    if (!student) {
      const error = new Error("Élève ou classe introuvable pour l'appel");
      error.statusCode = 404;
      throw error;
    }

    const normalizeClassName = (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

    // Classe de référence pour l'appel : celle de la fiche élève si elle existe,
    // sinon la classe pour laquelle l'appel est effectué (payload.className). Cela
    // évite un refus à tort quand la fiche backend n'a pas (encore) de classe
    // synchronisée alors que l'élève figure bien dans la classe appelée.
    const resolvedClassName =
      String(student.className ?? "").trim() || String(payload.className ?? "").trim();
    const studentForAccess = { ...student, className: resolvedClassName };

    if (principal.role === "Enseignant") {
      const classNames = principal.classNames ?? [];
      const classAllowedByPrincipal =
        classNames.length > 0 &&
        classNames.some(
          (className) => normalizeClassName(className) === normalizeClassName(resolvedClassName),
        );
      const classAllowedByBackOffice = this.teacherCanAccessClassFromBackOffice(
        principal,
        studentForAccess,
        state,
      );
      if (!classAllowedByPrincipal && !classAllowedByBackOffice) {
        const error = new Error("Accès refusé: élève hors classe affectée.");
        error.statusCode = 403;
        throw error;
      }
    }

    const present = payload.present ?? !["Absent", "absent", "Excusé", "excused"].includes(payload.status);
    const status = payload.status ?? (present ? "Présent" : "Absent");
    const savedAt = new Date().toISOString();
    const studentKeys = new Set(
      [student.id, student.matricule, student.publicId, payload.studentId]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    );
    const existingIndex = this.presences.findIndex(
      (item) => studentKeys.has(String(item.studentId)) && String(item.date) === String(payload.date),
    );

    const next = {
      id: existingIndex >= 0 ? this.presences[existingIndex].id : `PRE-MEM-${Date.now()}`,
      publicId: existingIndex >= 0 ? this.presences[existingIndex].publicId : `PRE-MEM-${Date.now()}`,
      studentId: String(student.matricule ?? student.publicId ?? student.id),
      schoolCode: student.schoolCode,
      className: resolvedClassName || student.className,
      date: payload.date,
      savedAt,
      present,
      status,
    };

    if (existingIndex >= 0) {
      this.presences[existingIndex] = next;
    } else {
      this.presences.unshift(next);
    }

    if (this.backOfficeState) {
      this.backOfficeState = {
        ...this.backOfficeState,
        presences: clone(this.presences),
      };
    }

    return clone(next);
  }

  teacherCanAccessClassFromBackOffice(principal, student, state = {}) {
    const normalizeClassName = (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    const className = String(student.className ?? "").trim();
    if (!className) return false;

    const { assignmentMatchesTeacher } = require("../services/authService");
    const principalSub = String(principal.sub ?? "").trim();
    const principalIdentifier = normalizeClassName(principal.identifier);
    const teacher =
      (state.teachers ?? []).find((row) => {
        if (principalSub && String(row.userId ?? "") === principalSub) return true;
        if (principalSub && String(row.id ?? "") === principalSub) return true;
        if (principalIdentifier && normalizeClassName(row.identifier) === principalIdentifier) return true;
        return false;
      }) ?? null;

    const user = {
      id: principalSub,
      identifier: principal.identifier,
      firstName: principal.firstName,
      lastName: principal.lastName,
      name: principal.name,
    };

    for (const assignment of state.assignments ?? []) {
      if (normalizeClassName(assignment.className) !== normalizeClassName(className)) continue;
      if (assignmentMatchesTeacher(assignment, teacher ?? {}, user)) return true;
    }

    for (const assignment of teacher?.assignments ?? []) {
      if (normalizeClassName(assignment.className) === normalizeClassName(className)) return true;
    }

    return (principal.classNames ?? []).some(
      (name) => normalizeClassName(name) === normalizeClassName(className),
    );
  }

  async getSubjectsV2() {
    return clone(this.subjects);
  }

  async createSubject(payload) {
    for (const field of ["name", "code", "coefficient", "level", "description", "status"]) {
      if (!payload[field]) throw new Error(`Champ obligatoire: ${field}`);
    }

    const code = String(payload.code).trim().toUpperCase();
    const subject = {
      id: code,
      schoolId: seedData.school.id,
      schoolCode: payload.schoolCode ?? seedData.school.code,
      countryCode: "CD",
      code,
      name: String(payload.name).trim(),
      coefficient: Number(payload.coefficient),
      level: String(payload.level).trim(),
      description: String(payload.description).trim(),
      status: String(payload.status).trim(),
      classCount: 0,
      teacherCount: 0,
      gradeCount: 0,
      classes: [],
      teachers: [],
      canDelete: true,
      createdAt: new Date().toLocaleDateString("fr-FR"),
    };

    const existingIndex = this.subjects.findIndex((item) => item.code === code);
    if (existingIndex >= 0) {
      this.subjects[existingIndex] = subject;
    } else {
      this.subjects.push(subject);
    }

    await this.recordAudit({
      schoolCode: subject.schoolCode,
      action: "subject_upsert",
      entityType: "subject",
      entityId: code,
      newValue: payload,
    });
    return { id: code, message: "Matière enregistrée" };
  }

  async deleteSubject(subjectCode) {
    const code = String(subjectCode).trim().toUpperCase();
    const subject = this.subjects.find((item) => item.code === code);

    if (!subject) throw new Error("Matière introuvable");
    if (subject.gradeCount > 0) {
      const error = new Error("Suppression refusée: la matière possède déjà des notes");
      error.statusCode = 409;
      throw error;
    }

    this.subjects = this.subjects.filter((item) => item.code !== code);
    await this.recordAudit({ action: "subject_delete", entityType: "subject", entityId: code });
    return { message: "Matière supprimée" };
  }

  async getAcademicYearsV2() {
    return [{
      id: "AY-DEMO-2026",
      schoolId: seedData.school.id,
      schoolCode: seedData.school.code,
      countryCode: "CD",
      name: seedData.school.schoolYear ?? "2025-2026",
      startDate: "2025-09-01",
      endDate: "2026-08-31",
      status: "Ouverte",
      isCurrent: true,
      enrollmentCount: seedData.students.length,
      gradeCount: seedData.notes.length,
      promotionDecisionCount: 0,
      notesLocked: false,
    }];
  }

  async getExamsV2() {
    return seedData.notes.slice(0, 12).map((note, index) => ({
      id: `EXAM-DEMO-${String(index + 1).padStart(3, "0")}`,
      schoolId: seedData.school.id,
      schoolCode: seedData.school.code,
      countryCode: "CD",
      code: `EXAM-${String(index + 1).padStart(3, "0")}`,
      name: `Évaluation ${note.subject}`,
      type: "Contrôle",
      className: seedData.students.find((student) => student.id === note.studentId)?.className ?? "",
      subject: note.subject,
      date: "2026-06-01",
      status: "Publié",
      resultCount: 1,
      average: Number(note.value ?? 0).toFixed(2),
      successRate: Number(note.value ?? 0) >= 10 ? 100 : 0,
    }));
  }

  async getDocumentsV2() {
    return seedData.students.slice(0, 20).map((student, index) => ({
      id: `DOC-DEMO-${String(index + 1).padStart(3, "0")}`,
      schoolId: seedData.school.id,
      schoolCode: seedData.school.code,
      countryCode: "CD",
      code: `BUL-${student.matricule}`,
      type: "Bulletin",
      title: `Bulletin - ${student.name}`,
      format: "PDF",
      version: 1,
      studentCode: student.matricule,
      studentName: student.name,
      status: "Disponible",
      storageKey: "",
      generatedAt: "01-06-2026",
    }));
  }

  async getAdvancedReportsV2() {
    const paid = seedData.payments.filter((payment) => payment.status === "PAYE").reduce((sum, payment) => sum + Number(payment.amount), 0);
    const unpaid = seedData.payments.filter((payment) => payment.status !== "PAYE").reduce((sum, payment) => sum + Number(payment.amount), 0);
    const present = seedData.presences.filter((presence) => presence.present || presence.status === "Retard").length;

    return {
      academic: seedData.classes.map((item) => ({ label: item.name, average: "12.50", grades: seedData.notes.length })),
      financial: { paid, unpaid, payments: seedData.payments.length, forecast: paid + unpaid },
      attendance: {
        rate: seedData.presences.length ? Math.round((present / seedData.presences.length) * 100) : 0,
        total: seedData.presences.length,
        breakdown: [],
      },
      exams: [],
      global: {
        countries: seedData.countries.length,
        schools: seedData.platformSchools.length,
        students: seedData.students.length,
        teachers: seedData.teachers.length,
        activeSubscriptions: seedData.subscriptions.filter((item) => item.status === "Actif").length,
      },
    };
  }

  async listSchoolClasses(schoolCode) {
    const code = String(schoolCode ?? "").trim().toUpperCase();
    const rows = this._managedClasses ?? [];
    return rows.filter((row) => String(row.schoolCode).toUpperCase() === code);
  }

  async createSchoolClass(body, schoolCode) {
    const { generateClassCode, validateCreateClassInput, createHttpError } =
      require("../lib/classesManagement");
    if (!this._managedClasses) this._managedClasses = [];
    if (!this._managedAcademicYears) {
      this._managedAcademicYears = [
        {
          id: "AY-DEMO",
          school_id: seedData.school.id,
          school_code: seedData.school.code,
          name: "2025-2026",
        },
        // Fixture explicite pour tests d'homonymes inter-années (pas de fabrication à la volée).
        {
          id: "AY-DEMO-PREV",
          school_id: seedData.school.id,
          school_code: seedData.school.code,
          name: "2024-2025",
        },
      ];
    }

    const input = validateCreateClassInput(body, schoolCode);
    let academicYear = this._managedAcademicYears.find(
      (item) => item.name === input.academicYearName && item.school_code === input.schoolCode,
    );
    if (!academicYear && input.academicYearName === "2025-2026") {
      academicYear = {
        id: `AY-${input.schoolCode}-2025-2026`,
        school_id: `school-${input.schoolCode}`,
        school_code: input.schoolCode,
        name: "2025-2026",
      };
      this._managedAcademicYears.push(academicYear);
    }
    if (!academicYear) {
      throw createHttpError(400, "Année scolaire introuvable pour cet établissement.");
    }

    const duplicate = this._managedClasses.find(
      (row) =>
        row.schoolCode === input.schoolCode &&
        row.academicYearName === academicYear.name &&
        String(row.name).trim().toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicate) {
      throw createHttpError(
        409,
        `La classe « ${input.name} » existe déjà pour cette année scolaire dans l'établissement.`,
      );
    }

    const classCode = generateClassCode(input.schoolCode);
    const row = {
      id: classCode,
      publicId: classCode,
      classCode,
      name: input.name,
      level: input.level ?? "",
      section: input.section ?? "",
      track: input.section ?? "",
      status: input.status,
      schoolCode: input.schoolCode,
      academicYearId: academicYear.id,
      academicYearName: academicYear.name,
      schoolYear: academicYear.name,
      students: 0,
      teacher: "Non assigne",
      presenceRate: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._managedClasses.push(row);
    return clone(row);
  }

  async updateSchoolClass(classCode, schoolCode, body) {
    const { validateUpdateClassInput, requireClassCodeParam, createHttpError } =
      require("../lib/classesManagement");
    if (!this._managedClasses) this._managedClasses = [];
    const code = requireClassCodeParam(classCode);
    const patch = validateUpdateClassInput(body);
    const current = this._managedClasses.find(
      (row) => row.classCode === code && String(row.schoolCode) === String(schoolCode),
    );
    if (!current) {
      throw createHttpError(404, "Classe introuvable.");
    }
    if (patch.name) {
      const duplicate = this._managedClasses.find(
        (row) =>
          row.classCode !== code &&
          row.schoolCode === current.schoolCode &&
          row.academicYearName === current.academicYearName &&
          String(row.name).trim().toLowerCase() === patch.name.toLowerCase(),
      );
      if (duplicate) {
        throw createHttpError(
          409,
          `La classe « ${patch.name} » existe déjà pour cette année scolaire dans l'établissement.`,
        );
      }
      current.name = patch.name;
    }
    if (Object.hasOwn(patch, "level")) current.level = patch.level ?? "";
    if (Object.hasOwn(patch, "section")) {
      current.section = patch.section ?? "";
      current.track = current.section;
    }
    if (patch.status) current.status = patch.status;
    current.updatedAt = new Date().toISOString();
    return clone(current);
  }

  getClassStudentsRepository() {
    if (!this._classStudentsRepo) {
      const { createClassStudentsRepository } = require("./classStudentsRepository");
      if (!this._managedStudents) this._managedStudents = [];
      if (!this._managedEnrollments) this._managedEnrollments = [];
      const self = this;
      const memoryAdapter = {
        async getSchoolByCode(code) {
          const normalized = String(code ?? "").trim().toUpperCase();
          if (normalized === String(seedData.school.code).toUpperCase()) {
            return { id: seedData.school.id, school_code: seedData.school.code };
          }
          return { id: `school-${normalized}`, school_code: normalized };
        },
        async one(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.CLASS_CODE")) {
            const classCode = params[0];
            const schoolId = params[1];
            const cls = (self._managedClasses ?? []).find((row) => {
              if (row.classCode !== classCode) return false;
              const rowSchoolId =
                String(row.schoolCode ?? "").trim().toUpperCase() ===
                String(seedData.school.code).toUpperCase()
                  ? seedData.school.id
                  : `school-${String(row.schoolCode ?? "").trim().toUpperCase()}`;
              return rowSchoolId === schoolId;
            });
            if (!cls) return null;
            const year = (self._managedAcademicYears ?? []).find((item) => item.id === cls.academicYearId);
            return {
              id: cls.id ?? cls.classCode,
              class_code: cls.classCode,
              name: cls.name,
              status: cls.status,
              academic_year_id: cls.academicYearId,
              academic_year_name: cls.academicYearName,
              academic_year_status: year?.status ?? "open",
            };
          }
          if (text.startsWith("INSERT INTO STUDENTS")) {
            const row = {
              id: `stu-${params[1]}`,
              school_id: params[0],
              student_code: params[1],
              first_name: params[2],
              last_name: params[3],
              gender: params[4],
              birth_date: params[5],
              parent_phone: params[6],
              parent_email: params[7],
              status: "active",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            self._managedStudents.push(row);
            return row;
          }
          if (text.startsWith("INSERT INTO ENROLLMENTS")) {
            const row = {
              id: `enr-${params[1]}`,
              school_id: params[0],
              student_id: params[1],
              class_id: params[2],
              academic_year_id: params[3],
              enrollment_date: new Date().toISOString().slice(0, 10),
              status: "active",
            };
            self._managedEnrollments.push(row);
            return { id: row.id, enrollment_date: row.enrollment_date };
          }
          if (text.includes("FROM STUDENTS ST") && text.includes("WHERE ST.STUDENT_CODE")) {
            const student = (self._managedStudents ?? []).find(
              (row) => row.student_code === params[0] && row.school_id === params[1],
            );
            if (!student) return null;
            const enrollment = (self._managedEnrollments ?? []).find(
              (row) => row.student_id === student.id && row.status === "active",
            );
            const cls = (self._managedClasses ?? []).find((row) => row.id === enrollment?.class_id || row.classCode === enrollment?.class_id);
            const year = (self._managedAcademicYears ?? []).find((item) => item.id === enrollment?.academic_year_id);
            return {
              ...student,
              school_code: params[1] === seedData.school.id ? seedData.school.code : `school-${params[1]}`,
              class_code: cls?.classCode ?? "",
              class_name: cls?.name ?? "",
              academic_year_name: year?.name ?? cls?.academicYearName ?? "",
              enrollment_id: enrollment?.id ?? null,
              enrollment_date: enrollment?.enrollment_date ?? null,
            };
          }
          return null;
        },
        async all(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          const resolveSchoolCode = (schoolId) => {
            if (schoolId === seedData.school.id) return seedData.school.code;
            const managed = (self._managedClasses ?? []).find((row) => {
              const rowSchoolId =
                String(row.schoolCode ?? "").trim().toUpperCase() ===
                String(seedData.school.code).toUpperCase()
                  ? seedData.school.id
                  : `school-${String(row.schoolCode ?? "").trim().toUpperCase()}`;
              return rowSchoolId === schoolId;
            });
            return managed?.schoolCode ?? String(schoolId).replace(/^school-/, "");
          };
          if (text.includes("FROM ENROLLMENTS E") && text.includes("WHERE E.CLASS_ID")) {
            const classId = params[0];
            const schoolId = params[1];
            return (self._managedEnrollments ?? [])
              .filter((row) => row.class_id === classId && row.status === "active")
              .map((enrollment) => {
                const student = (self._managedStudents ?? []).find(
                  (row) => row.id === enrollment.student_id && row.school_id === schoolId,
                );
                const cls = (self._managedClasses ?? []).find(
                  (row) => row.id === classId || row.classCode === classId,
                );
                return student
                  ? {
                      ...student,
                      school_code: resolveSchoolCode(schoolId),
                      class_code: cls?.classCode ?? "",
                      class_name: cls?.name ?? "",
                      academic_year_name: cls?.academicYearName ?? "",
                      enrollment_id: enrollment.id,
                      enrollment_date: enrollment.enrollment_date,
                    }
                  : null;
              })
              .filter(Boolean);
          }
          if (text.startsWith("SELECT STUDENT_CODE FROM STUDENTS")) {
            return (self._managedStudents ?? [])
              .filter((row) => row.school_id === params[0])
              .map((row) => ({ student_code: row.student_code }));
          }
          return [];
        },
        async query(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (text.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        async withTransaction(fn) {
          const tx = {
            one: (sql, params) => memoryAdapter.one(sql, params),
            all: (sql, params) => memoryAdapter.all(sql, params),
            query: (sql, params) => memoryAdapter.query(sql, params),
          };
          return fn(tx);
        },
      };
      this._classStudentsRepo = createClassStudentsRepository(memoryAdapter);
    }
    return this._classStudentsRepo;
  }

  listClassStudents(classCode, schoolCode) {
    return this.getClassStudentsRepository().listByClassCode(classCode, schoolCode);
  }

  enrollStudentInClass(classCode, schoolCode, body) {
    return this.getClassStudentsRepository().enroll(classCode, schoolCode, body);
  }

  getSchoolStudentByCode(studentCode, schoolCode) {
    return this.getClassStudentsRepository().getByStudentCode(studentCode, schoolCode);
  }

  getTeachersRepository() {
    if (!this._teachersRepo) {
      const { createTeachersRepository } = require("./teachersRepository");
      if (!this._managedTeachers) this._managedTeachers = [];
      if (!this._managedTeacherUsers) this._managedTeacherUsers = [];
      const self = this;
      const memoryAdapter = {
        async getSchoolByCode(code) {
          const normalized = String(code ?? "").trim().toUpperCase();
          if (normalized === String(seedData.school.code).toUpperCase()) {
            return { id: seedData.school.id, school_code: seedData.school.code };
          }
          return { id: `school-${normalized}`, school_code: normalized };
        },
        async one(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (text.startsWith("INSERT INTO USERS")) {
            const row = {
              id: `user-${params[1]}`,
              school_id: params[0],
              user_code: params[1],
              first_name: params[2],
              last_name: params[3],
              email: params[4],
              phone: params[5],
              password_hash: params[6],
              pin_hash: params[6],
              must_change_password: true,
              role: "TEACHER",
              status: "active",
              birth_date: params[7],
              gender: params[8],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            self._managedTeacherUsers.push(row);
            return row;
          }
          if (text.startsWith("INSERT INTO TEACHERS")) {
            const existing = self._managedTeachers.find(
              (row) => row.user_id === params[1] && row.school_id === params[0],
            );
            if (existing) {
              const error = new Error("duplicate key value violates unique constraint \"teachers_school_user_unique\"");
              error.code = "23505";
              error.constraint = "teachers_school_user_unique";
              throw error;
            }
            const codeClash = self._managedTeachers.find((row) => row.teacher_code === params[2]);
            if (codeClash) {
              const error = new Error("duplicate key value violates unique constraint \"teachers_teacher_code_key\"");
              error.code = "23505";
              error.constraint = "teachers_teacher_code_key";
              throw error;
            }
            const row = {
              id: `tch-${params[2]}`,
              school_id: params[0],
              user_id: params[1],
              teacher_code: params[2],
              speciality: params[3],
              hire_date: params[4],
              status: "active",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            self._managedTeachers.push(row);
            return row;
          }
          if (text.includes("FROM TEACHERS T") && text.includes("WHERE T.TEACHER_CODE")) {
            const teacherCode = params[0];
            const schoolId = params[1];
            const teacher = (self._managedTeachers ?? []).find(
              (row) => row.teacher_code === teacherCode && row.school_id === schoolId,
            );
            if (!teacher) return null;
            const user = (self._managedTeacherUsers ?? []).find((row) => row.id === teacher.user_id);
            return {
              ...teacher,
              school_code:
                schoolId === seedData.school.id
                  ? seedData.school.code
                  : String(schoolId).replace(/^school-/, ""),
              first_name: user?.first_name,
              last_name: user?.last_name,
              email: user?.email,
              phone: user?.phone,
              birth_date: user?.birth_date,
              gender: user?.gender,
              must_change_password: user?.must_change_password,
            };
          }
          return null;
        },
        async all(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (
            text.includes("FROM TEACHERS T") &&
            text.includes("LEFT JOIN USERS") &&
            text.includes("WHERE T.SCHOOL_ID")
          ) {
            const schoolId = params[0];
            return (self._managedTeachers ?? [])
              .filter((row) => row.school_id === schoolId)
              .map((teacher) => {
                const user = (self._managedTeacherUsers ?? []).find((row) => row.id === teacher.user_id);
                return {
                  ...teacher,
                  school_code:
                    schoolId === seedData.school.id
                      ? seedData.school.code
                      : String(schoolId).replace(/^school-/, ""),
                  first_name: user?.first_name,
                  last_name: user?.last_name,
                  email: user?.email,
                  phone: user?.phone,
                  birth_date: user?.birth_date,
                  gender: user?.gender,
                  must_change_password: user?.must_change_password,
                };
              });
          }
          if (
            text.includes("FROM TEACHERS T") &&
            text.includes("JOIN USERS U") &&
            !text.includes("LEFT JOIN") &&
            text.includes("WHERE T.SCHOOL_ID")
          ) {
            const schoolId = params[0];
            return (self._managedTeachers ?? [])
              .filter((row) => row.school_id === schoolId)
              .map((teacher) => {
                const user = (self._managedTeacherUsers ?? []).find((row) => row.id === teacher.user_id);
                return {
                  teacher_code: teacher.teacher_code,
                  first_name: user?.first_name,
                  last_name: user?.last_name,
                  birth_date: user?.birth_date,
                  gender: user?.gender,
                };
              });
          }
          if (text.startsWith("SELECT TEACHER_CODE AS CODE FROM TEACHERS")) {
            const schoolId = params[0];
            const schoolCode =
              schoolId === seedData.school.id
                ? seedData.school.code
                : String(schoolId).replace(/^school-/, "");
            const managed = (self._managedTeachers ?? [])
              .filter((row) => row.school_id === schoolId)
              .map((row) => ({ code: row.teacher_code }));
            const seeded = (seedData.teachers ?? [])
              .filter(
                (row) =>
                  String(row.schoolCode ?? "").trim().toUpperCase() ===
                  String(schoolCode).trim().toUpperCase(),
              )
              .map((row) => ({ code: row.publicId ?? row.identifier ?? row.id }));
            return [...seeded, ...managed];
          }
          if (text.startsWith("SELECT USER_CODE AS CODE FROM USERS")) {
            const schoolId = params[0];
            const schoolCode =
              schoolId === seedData.school.id
                ? seedData.school.code
                : String(schoolId).replace(/^school-/, "");
            const managed = (self._managedTeacherUsers ?? [])
              .filter((row) => row.school_id === schoolId)
              .map((row) => ({ code: row.user_code }));
            const seeded = (seedData.userAccounts ?? [])
              .filter(
                (row) =>
                  String(row.schoolCode ?? "").trim().toUpperCase() ===
                  String(schoolCode).trim().toUpperCase(),
              )
              .map((row) => ({ code: row.publicId ?? row.identifier ?? row.id }));
            return [...seeded, ...managed];
          }
          return [];
        },
        async query(sql) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (text.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        async withTransaction(fn) {
          const snapshotTeachers = clone(self._managedTeachers ?? []);
          const snapshotUsers = clone(self._managedTeacherUsers ?? []);
          const tx = {
            one: (sql, params) => memoryAdapter.one(sql, params),
            all: (sql, params) => memoryAdapter.all(sql, params),
            query: (sql, params) => memoryAdapter.query(sql, params),
          };
          try {
            return await fn(tx);
          } catch (error) {
            self._managedTeachers = snapshotTeachers;
            self._managedTeacherUsers = snapshotUsers;
            throw error;
          }
        },
        async onTeacherCreated(created) {
          const identifier = String(created.identifier ?? "").trim();
          const schoolCode = String(created.schoolCode ?? "").trim();
          const managedUser = (self._managedTeacherUsers ?? []).find(
            (row) => row.user_code === created.teacherCode || row.user_code === created.publicId,
          );
          if (!managedUser) return;

          const account = {
            id: managedUser.id,
            publicId: managedUser.user_code,
            lastName: managedUser.last_name,
            firstName: managedUser.first_name,
            gender: managedUser.gender ?? "",
            birthDate: managedUser.birth_date
              ? String(managedUser.birth_date).slice(0, 10)
              : "",
            phone: managedUser.phone ?? "",
            email: managedUser.email ?? "",
            role: "Enseignant",
            secondaryRoles: [],
            scopeLevel: "Établissement",
            countryScope: seedData.school.countryScope ?? "RDC",
            countryCode: seedData.school.countryCode ?? "CD",
            schoolCode,
            accessChannel: "Application",
            identifier,
            passwordHash: managedUser.password_hash,
            pinHash: managedUser.pin_hash,
            status: "Actif",
            permissions: seedData.rolePermissions.Enseignant ?? ["Voir tableau de bord"],
            temporaryPassword: "",
            mustChangePassword: true,
            photoUrl: "",
            createdAt: new Date().toISOString().slice(0, 10),
            lastLoginAt: "",
            createdBy: "API teachers",
            history: ["Compte enseignant créé via POST /api/teachers"],
          };

          const existingIdx = seedData.userAccounts.findIndex(
            (user) => String(user.publicId ?? "") === String(account.publicId),
          );
          if (existingIdx >= 0) {
            seedData.userAccounts[existingIdx] = account;
          } else {
            seedData.userAccounts.push(account);
          }

          const teacherRow = {
            id: created.teacherCode,
            userId: managedUser.id,
            publicId: created.teacherCode,
            identifier,
            schoolCode,
            name: created.name,
            firstName: created.firstName,
            lastName: created.lastName,
            gender: created.gender,
            phone: created.phone,
            email: created.email,
            birthDate: created.birthDate,
            entryDate: created.entryDate,
            mainSubject: created.mainSubject || created.speciality || "",
            speciality: created.speciality || "",
            status: "Actif",
            assignments: [],
            assignedClasses: [],
            mustChangePassword: true,
          };
          const teacherIdx = seedData.teachers.findIndex(
            (row) => String(row.publicId ?? row.id ?? "") === String(created.teacherCode),
          );
          if (teacherIdx >= 0) {
            seedData.teachers[teacherIdx] = teacherRow;
          } else {
            seedData.teachers.push(teacherRow);
          }
        },
      };
      this._teachersRepo = createTeachersRepository(memoryAdapter);
    }
    return this._teachersRepo;
  }

  async listSchoolTeachers(schoolCode) {
    const normalized = String(schoolCode ?? "").trim().toUpperCase();
    const managed = await this.getTeachersRepository().listBySchoolCode(schoolCode);
    const seeded = (seedData.teachers ?? [])
      .filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === normalized)
      .filter(
        (row) =>
          !managed.some(
            (item) =>
              String(item.teacherCode ?? item.publicId ?? "") ===
              String(row.publicId ?? row.id ?? ""),
          ),
      )
      .map((row) => ({
        id: row.publicId ?? row.id,
        teacherCode: row.publicId ?? row.id,
        publicId: row.publicId ?? row.id,
        identifier: row.identifier ?? "",
        userId: row.userId ?? null,
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? String(row.name ?? "").split(" ").slice(-1)[0] ?? "",
        name: row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
        gender: row.gender ?? "",
        birthDate: row.birthDate ?? "",
        entryDate: row.entryDate ?? "",
        phone: row.phone ?? "",
        email: row.email ?? "",
        speciality: row.speciality ?? row.mainSubject ?? "",
        mainSubject: row.mainSubject ?? row.speciality ?? "",
        schoolCode: row.schoolCode,
        status: row.status ?? "Actif",
        mustChangePassword: Boolean(row.mustChangePassword),
        assignments: Array.isArray(row.assignments) ? row.assignments : [],
        assignedClasses: [
          ...new Set((row.assignments ?? []).map((item) => item.className).filter(Boolean)),
        ],
        courses: [...new Set((row.assignments ?? []).map((item) => item.course).filter(Boolean))],
      }));
    return [...seeded, ...managed];
  }

  getSchoolTeacherByCode(teacherCode, schoolCode) {
    return this.getTeachersRepository().getByTeacherCode(teacherCode, schoolCode);
  }

  createSchoolTeacher(body, schoolCode) {
    return this.getTeachersRepository().create(body, schoolCode);
  }
}

module.exports = { FallbackRepository };
