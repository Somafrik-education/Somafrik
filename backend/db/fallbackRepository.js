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
    const catalogStudents = [
      ...(Array.isArray(state.students) ? state.students : []),
      ...seedData.students,
    ];
    const student = catalogStudents.find(
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

    if (principal.role === "Enseignant") {
      const classNames = principal.classNames ?? [];
      const classAllowedByPrincipal =
        classNames.length > 0 &&
        classNames.some(
          (className) => normalizeClassName(className) === normalizeClassName(student.className),
        );
      const classAllowedByBackOffice = this.teacherCanAccessClassFromBackOffice(principal, student, state);
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
      className: student.className,
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
}

module.exports = { FallbackRepository };
