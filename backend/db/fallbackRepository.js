const seedData = require("../data");
const { shouldSeedDemoData } = require("../lib/demoSeedPolicy");
const { applySystemActivePeriod } = require("../lib/academicPeriods");
const { buildEmptyBackOfficeState } = require("../lib/emptyBackOfficeState");
const { hashSecret } = require("../services/credentialService");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isTerminalTeacherStatus(status) {
  return ["deleted", "archived"].includes(String(status ?? "").toLowerCase());
}

function managedSchoolIdForClientsTeacher(teacher, tables) {
  const school = (tables.schools ?? []).find((row) => String(row.id) === String(teacher.school_id));
  const code = String(school?.code ?? school?.schoolCode ?? "").trim().toUpperCase();
  if (code && code === String(seedData.school.code).toUpperCase()) {
    return seedData.school.id;
  }
  return teacher.school_id;
}

function upsertSeedClassProjection(row) {
  const classCode = String(row.classCode ?? row.id ?? "");
  const seedIndex = seedData.classes.findIndex(
    (item) =>
      String(item.schoolCode ?? "").toUpperCase() === String(row.schoolCode).toUpperCase() &&
      [item.id, item.publicId, item.classCode].some((value) => String(value ?? "") === classCode),
  );
  const projection = {
    id: row.classCode ?? row.id,
    publicId: row.classCode ?? row.publicId ?? row.id,
    classCode: row.classCode ?? row.id,
    schoolCode: row.schoolCode,
    name: row.name,
    level: row.level ?? "",
    track: row.section ?? row.track ?? "",
    status: row.status === "inactive" ? "Archivée" : "Active",
    schoolYear: row.academicYearName ?? row.schoolYear,
  };
  if (seedIndex >= 0) {
    seedData.classes[seedIndex] = { ...seedData.classes[seedIndex], ...projection };
  } else {
    seedData.classes.push(projection);
  }
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
    if (this.ready) return;
    const { attachMemoryLoginLockoutStore } = require("../lib/loginLockout");
    attachMemoryLoginLockoutStore();
    const { ensureEstablishmentRolesBootstrap } = require("../lib/establishmentRolesService");
    await ensureEstablishmentRolesBootstrap(this);
    const { ensureFunctionalRbacBootstrap } = require("../lib/functionalRbacService");
    await ensureFunctionalRbacBootstrap(this);
    this.ready = true;
  }

  async close() {
    this.ready = false;
  }

  async getDataset() {
    await this.init();
    const seeded = shouldSeedDemoData();
    const schoolCodes = (
      seeded ? this._managedSchools ?? seedData.platformSchools : this._managedSchools ?? []
    )
      .map((school) => String(school.code ?? school.schoolCode ?? "").trim())
      .filter(Boolean);
    const managedStudents = this._managedStudents?.length
      ? (
          await Promise.all(
            [...new Set(schoolCodes)].map((schoolCode) =>
              this.getClassStudentsRepository().listBySchoolCode(schoolCode),
            ),
          )
        ).flat()
      : [];
    const studentsByCode = new Map();
    for (const student of seeded ? seedData.students : []) {
      const code = String(
        student.studentCode ?? student.matricule ?? student.publicId ?? student.id ?? "",
      );
      studentsByCode.set(code, student);
    }
    for (const student of managedStudents) {
      const code = String(
        student.studentCode ?? student.matricule ?? student.publicId ?? student.id ?? "",
      );
      studentsByCode.set(code, student);
    }
    const studentProjection = [...studentsByCode.values()];
    if (!seeded) {
      return clone({
        school: null,
        platformSchools: this._managedSchools ?? [],
        countries: [],
        subscriptions: [],
        userAccounts: [],
        teachers: [],
        classes: [],
        courses: [],
        students: studentProjection,
        notes: [],
        presences: [],
        payments: [],
        announcements: [],
        exams: [],
        bulletins: [],
        documents: [],
        courseSchedules: [],
        academicConfigs: {},
        teacherAssignments: clone(this._managedTeacherAssignments ?? []),
        platformNotifications: [],
      });
    }
    return clone({
      school: seedData.school,
      platformSchools: this._managedSchools ?? seedData.platformSchools,
      countries: seedData.countries,
      subscriptions: seedData.subscriptions,
      subscriptionOffers: seedData.subscriptionOffers ?? [],
      userAccounts: seedData.userAccounts,
      teachers: seedData.teachers,
      classes: seedData.classes,
      courses: seedData.courses,
      students: studentProjection,
      notes: this.notes,
      presences: this.presences,
      payments: seedData.payments,
      announcements: seedData.announcements,
      exams: seedData.exams,
      bulletins: seedData.bulletins,
      documents: seedData.documents,
      courseSchedules: seedData.courseSchedules ?? [],
      academicConfigs: seedData.academicConfigs ?? {},
      teacherAssignments: [
        ...(seedData.teacherAssignments ?? []).filter(
          (seeded) =>
            !(this._managedTeacherAssignments ?? []).some(
              (managed) => String(managed.id) === String(seeded.id),
            ),
        ),
        ...(this._managedTeacherAssignments ?? []),
      ].filter((row) => String(row.status ?? "active").toLowerCase() === "active"),
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

  async findActiveAccessSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked_at) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    return session;
  }

  async revokeSession(sessionId, reason = "logout") {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.revoked_at = new Date();
      session.revoke_reason = reason;
    }
  }

  async recordAudit({ schoolCode, userId, action, entityType, entityId, oldValue, newValue, ipAddress, userAgent }, _tx = null) {
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
    return null;
  }

  async saveBackOfficeState(_payload) {
    const { createBackOfficeStateWriteRemovedError } = require("../lib/backofficeStateRemoval");
    throw createBackOfficeStateWriteRemovedError();
  }

  getResidualStore() {
    if (!this._residualStore) {
      const { createResidualMemoryStore } = require("./residualMemoryStore");
      this._residualStore = createResidualMemoryStore();
      if (shouldSeedDemoData()) {
        const store = this._residualStore;
        for (const [schoolCode] of Object.entries(seedData.academicConfigs ?? {})) {
          store.saveAcademicConfig(String(schoolCode).toUpperCase(), {});
        }
        const defaultSchool = String(seedData.school?.code ?? "CD-2026-0001").toUpperCase();
        void defaultSchool;
      }
    }
    return this._residualStore;
  }

  async listResidualProjection() {
    const residual = this.getResidualStore().listProjection();
    const academicConfigs = { ...(residual.academicConfigs ?? {}) };
    this.getSchoolSettingsStore();
    if (this._schoolSettingsBootstrap) await this._schoolSettingsBootstrap;
    const schools = [seedData.school, ...(this._managedSchools ?? seedData.platformSchools ?? [])];
    for (const school of schools) {
      const code = String(school.code ?? school.schoolCode ?? "").trim().toUpperCase();
      if (!code) continue;
      try {
        academicConfigs[code] = await this.getAcademicConfig(code);
      } catch (_error) {
        academicConfigs[code] = academicConfigs[code] ?? { schoolCode: code };
      }
    }
    return { ...residual, academicConfigs };
  }

  replaceResidualExams() {
    const { assertLegacyResidualWriteForbidden } = require("../lib/documentsExamsManagement");
    assertLegacyResidualWriteForbidden("exam");
  }

  replaceResidualBulletins() {
    const { assertLegacyResidualWriteForbidden } = require("../lib/documentsExamsManagement");
    assertLegacyResidualWriteForbidden("bulletin");
  }

  replaceResidualDocuments() {
    const { assertLegacyResidualWriteForbidden } = require("../lib/documentsExamsManagement");
    assertLegacyResidualWriteForbidden("document");
  }

  async withResidualReplace(domain, schoolCode, items, principal, auditMeta) {
    const { recordResidualReplace } = require("../lib/residualStateManagement");
    return recordResidualReplace(this, domain, schoolCode, items, principal, auditMeta);
  }

  _establishmentStore() {
    if (!this._managedSchools) {
      this._managedSchools = shouldSeedDemoData() ? clone(seedData.platformSchools) : [];
    }
    return this._managedSchools;
  }

  async listEstablishments() {
    return clone(this._establishmentStore());
  }

  async persistEstablishment(record) {
    const {
      normalizeSchoolCode,
      findCanonicalCountry,
      COUNTRY_NOT_FOUND_CODE,
      COUNTRY_NOT_FOUND_MESSAGE,
    } = require("../lib/schoolsManagement");
    const code = normalizeSchoolCode(record?.code ?? record?.schoolCode ?? record?.publicId);
    if (!code || code === "*") {
      const error = new Error("Code établissement requis.");
      error.statusCode = 400;
      error.code = "SCHOOL_CODE_REQUIRED";
      throw error;
    }
    const catalog = [
      ...(Array.isArray(seedData.countries) ? seedData.countries : []),
      ...(Array.isArray(this.backOfficeState?.countries) ? this.backOfficeState.countries : []),
    ];
    if (!findCanonicalCountry(catalog, record?.countryCode, record?.country)) {
      const error = new Error(COUNTRY_NOT_FOUND_MESSAGE);
      error.statusCode = 400;
      error.code = COUNTRY_NOT_FOUND_CODE;
      throw error;
    }
    const school = { ...record, code, publicId: record?.publicId || code };
    const store = this._establishmentStore();
    const index = store.findIndex(
      (row) => String(row.code ?? row.publicId ?? "").trim().toUpperCase() === code,
    );
    if (index >= 0) {
      store[index] = { ...store[index], ...school };
    } else {
      store.unshift(school);
    }

    const seedIndex = seedData.platformSchools.findIndex(
      (row) => String(row.code ?? row.publicId ?? "").trim().toUpperCase() === code,
    );
    if (seedIndex >= 0) {
      seedData.platformSchools[seedIndex] = { ...seedData.platformSchools[seedIndex], ...school };
    } else if (shouldSeedDemoData()) {
      seedData.platformSchools.unshift(school);
    }

    if (this.backOfficeState) {
      const schools = Array.isArray(this.backOfficeState.schools) ? this.backOfficeState.schools : [];
      const stateIndex = schools.findIndex(
        (row) => String(row.code ?? row.publicId ?? "").trim().toUpperCase() === code,
      );
      this.backOfficeState.schools =
        stateIndex >= 0
          ? schools.map((row, idx) => (idx === stateIndex ? { ...row, ...school } : row))
          : [school, ...schools];
    }

    const saved = clone(index >= 0 ? store[index] : school);
    const settingsStore = this.getSchoolSettingsStore();
    if (typeof settingsStore.registerSchool === "function") {
      const registered = settingsStore.registerSchool(saved);
      if (registered?.id && typeof settingsStore.seedDefaultSettingsIfEmpty === "function") {
        await settingsStore.seedDefaultSettingsIfEmpty(registered.id);
      }
    }
    this.getDocumentsExamsStore().registerSchool(saved);
    return saved;
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
    const store = this.getSchoolSettingsStore();
    if (this._schoolSettingsBootstrap) await this._schoolSettingsBootstrap;
    const normalizedSchoolCode = String(schoolCode && schoolCode !== "*" ? schoolCode : seedData.school.code).trim().toUpperCase();
    try {
      const projected = await store.projectAcademicConfig(normalizedSchoolCode);
      const lists = await this.getSchoolEducationActiveLists(normalizedSchoolCode);
      const evaluationTypes = await this.listEvaluationTypeNames(normalizedSchoolCode);
      const roles = typeof this.listEstablishmentRoles === "function"
        ? (await this.listEstablishmentRoles({ schoolAssignableOnly: true })).map((row) => row.roleName)
        : [];
      return {
        ...projected,
        levels: lists.levels ?? [],
        tracks: lists.tracks ?? [],
        userRoles: roles,
        evaluationTypes,
      };
    } catch (error) {
      if (error?.statusCode === 404) return null;
      throw error;
    }
  }

  async saveAcademicConfig(schoolCode, config, tx = null) {
    const normalizedSchoolCode = String(schoolCode && schoolCode !== "*" ? schoolCode : seedData.school.code)
      .trim()
      .toUpperCase();
    const saved = await this.getResidualStore().saveAcademicConfig(normalizedSchoolCode, config, tx);
    const projected = await this.getAcademicConfig(normalizedSchoolCode);
    return projected ?? saved;
  }

  createTxScope(_tx) {
    return this;
  }

  async withTransaction(fn) {
    return fn(null);
  }

  async withReadOnlyRepeatableRead(fn) {
    return fn(this);
  }

  async touchUserLastLogin(lookupKeys = []) {
    const keys = (Array.isArray(lookupKeys) ? lookupKeys : [lookupKeys])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (!keys.length) return;
    const store = this.getClientsStore();
    if (typeof store.touchUserLastLogin === "function") {
      await store.touchUserLastLogin(keys);
    }
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
    const clientsUser = this.getClientsStore().resetUserPassword(lookupKeys, temporaryPassword);

    if (!stateUser && seedUserIndex === -1 && !clientsUser) {
      const error = new Error("Utilisateur introuvable");
      error.statusCode = 404;
      throw error;
    }

    if (clientsUser) {
      return clone(clientsUser);
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
    const clientsUser = this.getClientsStore().changeUserPassword(lookupKeys, newPassword);

    if (!stateUser && seedUserIndex === -1 && !clientsUser) {
      const error = new Error("Utilisateur introuvable");
      error.statusCode = 404;
      throw error;
    }

    if (clientsUser) {
      return clone(clientsUser);
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
    const { assertEvaluationAllowsGradeEntry, findStateEvaluation } = require("../lib/evaluationGradeEntry");
    const evaluationId = String(payload.evaluationId ?? "").trim();
    if (evaluationId) {
      const state = (await this.getBackOfficeState()) ?? {};
      assertEvaluationAllowsGradeEntry(findStateEvaluation(state, evaluationId));
    }

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

  async getSubjectsV2(query = {}) {
    const schoolCode = String(query.schoolCode ?? "").trim().toUpperCase();
    const rows = clone(this.subjects);
    if (schoolCode && schoolCode !== "*") {
      return rows.filter((row) => String(row.schoolCode ?? "").toUpperCase() === schoolCode);
    }
    return rows;
  }

  async createSubject(payload) {
    for (const field of ["name", "code"]) {
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
      coefficient: Number(payload.coefficient ?? 1),
      level: String(payload.level ?? "Tous niveaux").trim(),
      description: String(payload.description ?? "").trim(),
      status: String(payload.status ?? "active").trim(),
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
    return { id: code, message: "Cours enregistré" };
  }

  async deleteSubject(subjectCode) {
    const code = String(subjectCode).trim().toUpperCase();
    const subject = this.subjects.find((item) => item.code === code);

    if (!subject) throw new Error("Cours introuvable");
    if (subject.gradeCount > 0) {
      const error = new Error("Suppression refusée: le cours possède déjà des notes");
      error.statusCode = 409;
      throw error;
    }

    this.subjects = this.subjects.filter((item) => item.code !== code);
    await this.recordAudit({ action: "subject_delete", entityType: "subject", entityId: code });
    return { message: "Cours supprimé" };
  }

  demoAcademicYears() {
    return [
      {
        id: "AY-DEMO-2026",
        school_id: seedData.school.id,
        school_code: seedData.school.code,
        name: seedData.school.schoolYear ?? "2025-2026",
        start_date: "2025-09-01",
        end_date: "2026-08-31",
        status: "open",
        is_current: true,
      },
    ];
  }

  mapAcademicYearV2(row) {
    return {
      id: row.id,
      schoolId: row.school_id,
      schoolCode: row.school_code,
      countryCode: String(row.school_code ?? "").slice(0, 2).toUpperCase(),
      name: row.name,
      startDate: row.start_date ?? "",
      endDate: row.end_date ?? "",
      status: row.status === "open" ? "Ouverte" : row.status,
      isCurrent: Boolean(row.is_current),
      enrollmentCount: row.school_code === seedData.school.code ? seedData.students.length : 0,
      gradeCount: row.school_code === seedData.school.code ? seedData.notes.length : 0,
      promotionDecisionCount: 0,
      notesLocked: false,
    };
  }

  async getAcademicYearsV2() {
    if (!this._managedAcademicYears) {
      this._managedAcademicYears = this.demoAcademicYears();
    }
    return this._managedAcademicYears.map((row) => this.mapAcademicYearV2(row));
  }

  async createAcademicYearV2(input = {}) {
    const schoolCode = String(input.schoolCode ?? "").trim().toUpperCase();
    const name = String(input.name ?? "").trim();
    const startDate = String(input.startDate ?? "").trim();
    const endDate = String(input.endDate ?? "").trim();
    if (!schoolCode || !name || !startDate || !endDate || startDate >= endDate) {
      const error = new Error("Établissement, nom et dates valides sont requis.");
      error.statusCode = 400;
      throw error;
    }
    await this.getAcademicYearsV2();
    if (this._managedAcademicYears.some((row) => row.school_code === schoolCode && row.name.toLowerCase() === name.toLowerCase())) {
      const error = new Error(`L'année scolaire « ${name} » existe déjà pour cet établissement.`);
      error.statusCode = 409;
      throw error;
    }
    const isCurrent = input.isCurrent !== false;
    if (isCurrent) this._managedAcademicYears.forEach((row) => { if (row.school_code === schoolCode) row.is_current = false; });
    const row = { id: `AY-${Date.now()}-${this._managedAcademicYears.length}`, school_id: `school-${schoolCode}`, school_code: schoolCode, name, start_date: startDate, end_date: endDate, status: "open", is_current: isCurrent };
    this._managedAcademicYears.push(row);
    return (await this.getAcademicYearsV2()).find((item) => item.id === row.id);
  }

  async getAcademicYearV2ById(id) {
    const years = await this.getAcademicYearsV2();
    return years.find((item) => String(item.id) === String(id ?? "").trim()) ?? null;
  }

  async updateAcademicYearV2(id, input = {}) {
    const yearId = String(id ?? "").trim();
    await this.getAcademicYearsV2();
    const row = this._managedAcademicYears.find((item) => String(item.id) === yearId);
    if (!row) {
      const error = new Error("Année scolaire introuvable.");
      error.statusCode = 404;
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      const error = new Error("La clôture et l'archivage d'une année scolaire ne sont pas encore disponibles.");
      error.statusCode = 400;
      throw error;
    }
    const name = input.name !== undefined ? String(input.name ?? "").trim() : String(row.name ?? "").trim();
    const startDate = input.startDate !== undefined ? String(input.startDate ?? "").trim() : String(row.start_date ?? "").trim();
    const endDate = input.endDate !== undefined ? String(input.endDate ?? "").trim() : String(row.end_date ?? "").trim();
    const isCurrent = input.isCurrent !== undefined ? Boolean(input.isCurrent) : Boolean(row.is_current);
    if (!name || !startDate || !endDate || startDate >= endDate) {
      const error = new Error("Nom et dates valides sont requis.");
      error.statusCode = 400;
      throw error;
    }
    if (
      this._managedAcademicYears.some(
        (item) =>
          item.school_code === row.school_code &&
          item.id !== row.id &&
          String(item.name).toLowerCase() === name.toLowerCase(),
      )
    ) {
      const error = new Error(`L'année scolaire « ${name} » existe déjà pour cet établissement.`);
      error.statusCode = 409;
      throw error;
    }
    if (isCurrent) {
      this._managedAcademicYears.forEach((item) => {
        if (item.school_code === row.school_code) item.is_current = false;
      });
    }
    row.name = name;
    row.start_date = startDate;
    row.end_date = endDate;
    row.is_current = isCurrent;
    return (await this.getAcademicYearsV2()).find((item) => item.id === row.id);
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
    const enrollments = this._managedEnrollments ?? [];
    return rows
      .filter((row) => String(row.schoolCode).toUpperCase() === code)
      .map((row) => ({
        ...clone(row),
        classId: row.classId ?? row.id,
        className: row.className ?? row.name,
        students: enrollments.filter(
          (enrollment) =>
            enrollment.status === "active" &&
            (enrollment.class_id === row.id || enrollment.class_id === row.classCode),
        ).length,
      }));
  }

  async createSchoolClass(body, schoolCode, principal, auditMeta) {
    const {
      generateClassCode,
      validateCreateClassInput,
      composeClassDisplayName,
      createHttpError,
      CLASS_WRITE_ERROR,
    } = require("../lib/classesManagement");
    if (!this._managedClasses) this._managedClasses = [];

    const input = validateCreateClassInput(body, schoolCode);
    // Même source que GET /v2/academic-years (démo AY-DEMO-2026 ou années créées).
    // Ne pas réinitialiser _managedAcademicYears avec des ids AY-DEMO distincts.
    const listedYears = await this.getAcademicYearsV2();
    const academicYear = listedYears.find(
      (item) =>
        String(item.id) === input.academicYearId &&
        String(item.schoolCode ?? "").toUpperCase() === String(input.schoolCode).toUpperCase(),
    );
    if (!academicYear) {
      throw createHttpError(400, "Année scolaire introuvable pour cet établissement.");
    }

    const catalog = await this.getEducationSchoolCatalog(input.schoolCode);
    const level = (catalog.levels ?? []).find((row) => row.id === input.levelId && row.schoolActive);
    if (!level) {
      throw createHttpError(
        400,
        "Ce niveau n'est pas activé pour l'établissement.",
        CLASS_WRITE_ERROR.LEVEL_NOT_ACTIVATED,
      );
    }
    let streamName = null;
    if (input.streamId) {
      const stream = (catalog.streams ?? []).find((row) => row.id === input.streamId && row.schoolActive);
      if (!stream) {
        throw createHttpError(
          400,
          "Cette filière n'est pas activée pour l'établissement.",
          CLASS_WRITE_ERROR.STREAM_NOT_ACTIVATED,
        );
      }
      if (stream.levelId && stream.levelId !== level.id) {
        throw createHttpError(
          400,
          "Cette filière n'est pas rattachée au niveau choisi.",
          CLASS_WRITE_ERROR.STREAM_LEVEL_MISMATCH,
        );
      }
      streamName = stream.name;
    }

    const group = (catalog.groups ?? []).find((row) => row.id === input.groupId && row.schoolActive);
    if (!group) {
      throw createHttpError(
        400,
        "Ce groupe n'est pas activé pour l'établissement.",
        CLASS_WRITE_ERROR.GROUP_NOT_ACTIVATED,
      );
    }

    const displayName = composeClassDisplayName({
      levelName: level.name,
      streamName,
      groupCode: group.code,
    });

    const structuralDuplicate = this._managedClasses.find(
      (row) =>
        row.schoolCode === input.schoolCode &&
        row.academicYearId === academicYear.id &&
        row.levelId === input.levelId &&
        (row.streamId || null) === (input.streamId || null) &&
        String(row.groupId ?? "") === String(input.groupId),
    );
    if (structuralDuplicate) {
      throw createHttpError(
        409,
        "Une classe existe déjà pour ce niveau, cette filière et ce groupe sur cette année scolaire.",
        CLASS_WRITE_ERROR.STRUCTURAL_DUPLICATE,
      );
    }

    const { randomUUID } = require("node:crypto");
    const classCode = generateClassCode(input.schoolCode);
    const classId = randomUUID();
    const row = {
      id: classId,
      classId,
      publicId: classCode,
      classCode,
      name: displayName,
      className: displayName,
      level: level.name,
      section: group.code,
      track: streamName ?? "",
      groupCode: group.code,
      groupId: group.id,
      levelId: input.levelId,
      streamId: input.streamId,
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
    upsertSeedClassProjection(row);
    if (principal || auditMeta) {
      await this.recordAudit({
        schoolCode: input.schoolCode,
        userId: principal?.sub || principal?.id,
        action: "create_class",
        entityType: "class",
        entityId: classCode,
        newValue: row,
        ipAddress: auditMeta?.ipAddress,
        userAgent: auditMeta?.userAgent,
      });
    }
    return clone(row);
  }

  async updateSchoolClass(classCode, schoolCode, body, principal, auditMeta) {
    const {
      validateUpdateClassInput,
      requireClassCodeParam,
      composeClassDisplayName,
      createHttpError,
      CLASS_WRITE_ERROR,
    } = require("../lib/classesManagement");
    if (!this._managedClasses) this._managedClasses = [];
    const code = requireClassCodeParam(classCode);
    const patch = validateUpdateClassInput(body);
    const current = this._managedClasses.find(
      (row) => row.classCode === code && String(row.schoolCode) === String(schoolCode),
    );
    if (!current) {
      throw createHttpError(404, "Classe introuvable.");
    }

    const structuralTouched =
      Object.hasOwn(patch, "levelId") || Object.hasOwn(patch, "streamId") || Object.hasOwn(patch, "groupId");
    if (structuralTouched) {
      const nextLevelId = Object.hasOwn(patch, "levelId") ? patch.levelId : current.levelId;
      const nextStreamId = Object.hasOwn(patch, "streamId") ? patch.streamId : current.streamId;
      const nextGroupId = Object.hasOwn(patch, "groupId") ? patch.groupId : current.groupId;
      if (!nextLevelId || !nextGroupId) {
        throw createHttpError(
          400,
          "Les classes existantes sans rattachement catalogue se gèrent au lot E. Fournissez levelId et groupId.",
          CLASS_WRITE_ERROR.OFFERING_REQUIRED,
        );
      }
      const catalog = await this.getEducationSchoolCatalog(schoolCode);
      const level = (catalog.levels ?? []).find((row) => row.id === nextLevelId && row.schoolActive);
      if (!level) {
        throw createHttpError(
          400,
          "Ce niveau n'est pas activé pour l'établissement.",
          CLASS_WRITE_ERROR.LEVEL_NOT_ACTIVATED,
        );
      }
      let streamName = null;
      if (nextStreamId) {
        const stream = (catalog.streams ?? []).find((row) => row.id === nextStreamId && row.schoolActive);
        if (!stream) {
          throw createHttpError(
            400,
            "Cette filière n'est pas activée pour l'établissement.",
            CLASS_WRITE_ERROR.STREAM_NOT_ACTIVATED,
          );
        }
        streamName = stream.name;
      }
      const group = (catalog.groups ?? []).find((row) => row.id === nextGroupId && row.schoolActive);
      if (!group) {
        throw createHttpError(
          400,
          "Ce groupe n'est pas activé pour l'établissement.",
          CLASS_WRITE_ERROR.GROUP_NOT_ACTIVATED,
        );
      }
      current.levelId = nextLevelId;
      current.streamId = nextStreamId || null;
      current.groupId = nextGroupId;
      current.groupCode = group.code;
      current.level = level.name;
      current.track = streamName ?? "";
      current.section = group.code;
      current.name = composeClassDisplayName({
        levelName: level.name,
        streamName,
        groupCode: group.code,
      });
    }
    if (patch.status) current.status = patch.status;
    current.className = current.name;
    current.classId = current.classId ?? current.id;
    current.updatedAt = new Date().toISOString();
    upsertSeedClassProjection(current);
    if (principal || auditMeta) {
      await this.recordAudit({
        schoolCode,
        userId: principal?.sub || principal?.id,
        action: "update_class",
        entityType: "class",
        entityId: code,
        newValue: current,
        ipAddress: auditMeta?.ipAddress,
        userAgent: auditMeta?.userAgent,
      });
    }
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
          const match = (seedData.platformSchools ?? [seedData.school]).find(
            (row) => String(row.code ?? "").toUpperCase() === normalized,
          );
          const isPrimary = normalized === String(seedData.school.code).toUpperCase();
          return {
            id: isPrimary ? seedData.school.id : `school-${normalized}`,
            school_code: match?.code ?? normalized,
            name: match?.name ?? normalized,
            login_code: match?.loginCode ?? match?.login_code,
          };
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
            const { assignCanonicalStudentCode } = require("../lib/studentCodeAllocation");
            const schoolId = params[0];
            const isPrimary = String(schoolId) === String(seedData.school.id);
            const code = isPrimary
              ? seedData.school.code
              : String(schoolId).replace(/^school-/i, "");
            const match = (seedData.platformSchools ?? [seedData.school]).find(
              (row) => String(row.code ?? "").toUpperCase() === String(code).toUpperCase(),
            );
            const studentCode = assignCanonicalStudentCode(
              {
                school_code: match?.code ?? code,
                name: match?.name ?? seedData.school.name,
                login_code: match?.loginCode ?? match?.login_code ?? seedData.school.loginCode,
              },
              (self._managedStudents ?? []).map((row) => row.student_code),
              params[1],
              {
                firstName: params[2],
                lastName: params[3],
              },
            );
            const row = {
              id: `stu-${studentCode}`,
              school_id: schoolId,
              student_code: studentCode,
              login_code: studentCode,
              identity_code: studentCode,
              first_name: params[2],
              last_name: params[3],
              gender: params[4],
              birth_date: params[5],
              birth_place: "",
              photo_url: "",
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
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            self._managedEnrollments.push(row);
            return { id: row.id, enrollment_date: row.enrollment_date };
          }
          if (text.startsWith("UPDATE STUDENTS")) {
            const student = (self._managedStudents ?? []).find(
              (row) => row.id === params[7] && row.school_id === params[8],
            );
            if (!student) return null;
            if (String(student.updated_at) !== String(params[9])) return null;
            student.first_name = params[0];
            student.last_name = params[1];
            student.gender = params[2];
            student.birth_date = params[3];
            student.birth_place = params[4];
            student.parent_phone = params[5];
            student.parent_email = params[6];
        student.updated_at = new Date(Date.now() + 1).toISOString();
        return { id: student.id };
      }
      if (text.includes("SELECT ST.ID, ST.STUDENT_CODE") && text.includes("FROM STUDENTS ST")) {
        return (
          (self._managedStudents ?? []).find(
            (row) => row.student_code === params[0] && row.school_id === params[1],
          ) ?? null
        );
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
            const schoolCode =
              params[1] === seedData.school.id
                ? seedData.school.code
                : String(params[1]).replace(/^school-/i, "");
            return {
              ...student,
              student_uuid: student.id,
              school_code: schoolCode,
              class_id: cls?.id ?? cls?.classId ?? null,
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
            return managed?.schoolCode ?? String(schoolId).replace(/^school-/i, "");
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
                      student_uuid: student.id,
                      school_code: resolveSchoolCode(schoolId),
                      class_id: cls?.id ?? cls?.classId ?? classId,
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
          if (text.includes("FROM STUDENTS ST") && text.includes("WHERE ST.SCHOOL_ID")) {
            const schoolId = params[0];
            return (self._managedStudents ?? [])
              .filter((row) => row.school_id === schoolId)
              .map((student) => {
                const enrollment = (self._managedEnrollments ?? []).find(
                  (row) => row.student_id === student.id && row.status === "active",
                );
                const cls = (self._managedClasses ?? []).find(
                  (row) => row.id === enrollment?.class_id || row.classCode === enrollment?.class_id,
                );
                return {
                  ...student,
                  student_uuid: student.id,
                  school_code: resolveSchoolCode(schoolId),
                  class_id: cls?.id ?? cls?.classId ?? null,
                  class_code: cls?.classCode ?? "",
                  class_name: cls?.name ?? "",
                  academic_year_name: cls?.academicYearName ?? "",
                  enrollment_id: enrollment?.id ?? null,
                  enrollment_date: enrollment?.enrollment_date ?? null,
                };
              });
          }
          if (text.includes("FROM ENROLLMENTS E") && text.includes("WHERE E.STUDENT_ID")) {
            const studentId = params[0];
            const schoolId = params[1];
            return (self._managedEnrollments ?? [])
              .filter((row) => row.student_id === studentId && row.school_id === schoolId)
              .map((enrollment) => {
                const cls = (self._managedClasses ?? []).find(
                  (row) => row.id === enrollment.class_id || row.classCode === enrollment.class_id,
                );
                const year = (self._managedAcademicYears ?? []).find(
                  (item) => item.id === enrollment.academic_year_id,
                );
                return {
                  enrollment_id: enrollment.id,
                  enrollment_status: enrollment.status,
                  enrollment_date: enrollment.enrollment_date,
                  enrollment_created_at: enrollment.created_at,
                  enrollment_updated_at: enrollment.updated_at,
                  class_id: cls?.id ?? cls?.classId ?? null,
                  class_code: cls?.classCode ?? "",
                  class_name: cls?.name ?? "",
                  academic_year_name: year?.name ?? cls?.academicYearName ?? "",
                  academic_year_status: year?.status ?? "open",
                };
              });
          }
          if (text.includes("FROM STUDENT_DOCUMENTS")) {
            return [];
          }
          if (text.startsWith("SELECT STUDENT_CODE FROM STUDENTS")) {
            const rows = self._managedStudents ?? [];
            if (!params.length) {
              return rows.map((row) => ({ student_code: row.student_code }));
            }
            return rows
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
          if (text.startsWith("INSERT INTO USERS")) {
            if (!self._managedStudentUsers) self._managedStudentUsers = [];
            const userCode = params[1];
            if (self._managedStudentUsers.some((row) => row.user_code === userCode)) {
              const error = new Error(
                'duplicate key value violates unique constraint "users_user_code_key"',
              );
              error.code = "23505";
              throw error;
            }
            self._managedStudentUsers.push({
              id: userCode,
              user_code: userCode,
              school_id: params[0],
              first_name: params[2],
              last_name: params[3],
              email: params[4],
              phone: params[5],
              password_hash: params[6],
              pin_hash: params[6],
              must_change_password: true,
              role: "STUDENT",
            });
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

  listSchoolStudents(schoolCode) {
    return this.getClassStudentsRepository().listBySchoolCode(schoolCode);
  }

  async enrollStudentInClass(classCode, schoolCode, body) {
    const created = await this.getClassStudentsRepository().enroll(classCode, schoolCode, body);
    this.registerEnrolledStudentLoginAccount(created.student, schoolCode);
    if (typeof this.getClientsStore().ensureStudentRecord === "function") {
      const school = await this.getClientsStore().getSchoolByCode(schoolCode);
      this.getClientsStore().ensureStudentRecord({
        id: created.student.id,
        school_id: school?.id ?? created.student.schoolId,
        firstName: created.student.firstName,
        lastName: created.student.lastName,
        studentCode: created.student.studentCode,
        status: "active",
      });
    }
    return created;
  }

  /**
   * Enregistre le compte de connexion élève (hash seul) pour le premier login mémoire.
   * Jamais de secret clair : le plaintext n'existe que dans la réponse CREATE.
   */
  registerEnrolledStudentLoginAccount(student, schoolCode) {
    const studentCode = String(student?.studentCode ?? "").trim();
    if (!studentCode) return;
    const managedUser = (this._managedStudentUsers ?? []).find(
      (row) => row.user_code === studentCode,
    );
    if (!managedUser) return;

    const account = {
      id: managedUser.id ?? studentCode,
      publicId: studentCode,
      userCode: studentCode,
      identityCode: studentCode,
      lastName: student.lastName ?? managedUser.last_name ?? "",
      firstName: student.firstName ?? managedUser.first_name ?? "",
      gender: student.gender ?? "",
      birthDate: student.birthDate ?? "",
      phone: student.parentPhone ?? managedUser.phone ?? "",
      email: student.parentEmail ?? managedUser.email ?? "",
      role: "Élève / Étudiant",
      secondaryRoles: [],
      scopeLevel: "Établissement",
      countryScope: seedData.school.countryScope ?? "RDC",
      countryCode: seedData.school.countryCode ?? "CD",
      schoolCode,
      accessChannel: "Application",
      identifier: studentCode,
      passwordHash: managedUser.password_hash,
      pinHash: managedUser.pin_hash,
      status: "Actif",
      permissions: seedData.rolePermissions?.["Élève / Étudiant"] ?? ["Voir tableau de bord"],
      temporaryPassword: "",
      mustChangePassword: true,
      photoUrl: "",
      createdAt: new Date().toISOString().slice(0, 10),
      lastLoginAt: "",
      createdBy: "API class students",
      history: ["Compte élève créé via inscription de classe"],
    };

    const existingIdx = seedData.userAccounts.findIndex(
      (user) =>
        String(user.publicId ?? "").trim() === studentCode ||
        String(user.identifier ?? "").trim() === studentCode ||
        String(user.userCode ?? "").trim() === studentCode,
    );
    if (existingIdx >= 0) {
      seedData.userAccounts[existingIdx] = {
        ...seedData.userAccounts[existingIdx],
        ...account,
        temporaryPassword: "",
      };
    } else {
      seedData.userAccounts.push(account);
    }
  }

  getSchoolStudentByCode(studentCode, schoolCode) {
    return this.getClassStudentsRepository().getByStudentCode(studentCode, schoolCode);
  }

  updateSchoolStudentByCode(studentCode, schoolCode, body) {
    return this.getClassStudentsRepository().updateByStudentCode(studentCode, schoolCode, body);
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
          if (
            text.includes("FROM TEACHERS T") &&
            text.includes("T.TEACHER_CODE") &&
            (text.includes("WHERE T.TEACHER_CODE") || text.includes("FOR UPDATE"))
          ) {
            const teacherCodeFirst = text.includes("WHERE T.TEACHER_CODE");
            const teacherCode = teacherCodeFirst ? params[0] : params[1];
            const schoolId = teacherCodeFirst ? params[1] : params[0];
            const teacher = (self._managedTeachers ?? []).find(
              (row) => row.teacher_code === teacherCode && row.school_id === schoolId,
            );
            if (!teacher) return null;
            const user = (self._managedTeacherUsers ?? []).find((row) => row.id === teacher.user_id);
            return {
              ...teacher,
              teacher_id: teacher.id,
              teacher_status: teacher.status,
              user_status: user?.status ?? "active",
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
          if (text.startsWith("SELECT U.ID") && text.includes("FROM USERS U")) {
            const excludeUserId = text.includes("U.ID::TEXT <>") ? params[0] : null;
            const schoolId = excludeUserId ? params[1] : params[0];
            const identity = String((excludeUserId ? params[2] : params[1]) ?? "").toLowerCase();
            const match = (self._managedTeacherUsers ?? []).find((row) => {
              if (row.school_id !== schoolId) return false;
              if (["deleted", "archived"].includes(String(row.status ?? "active").toLowerCase())) return false;
              if (excludeUserId && String(row.id) === String(excludeUserId)) return false;
              if (text.includes("U.EMAIL")) {
                return String(row.email ?? "").trim().toLowerCase() === identity;
              }
              return String(row.phone ?? "").trim().toLowerCase() === identity;
            });
            return match ? { id: match.id, user_code: match.user_code } : null;
          }
          if (text.startsWith("UPDATE USERS") && text.includes("SET FIRST_NAME")) {
            const user = (self._managedTeacherUsers ?? []).find((row) => row.id === params[0]);
            if (!user) return null;
            Object.assign(user, {
              first_name: params[1],
              last_name: params[2],
              email: params[3],
              phone: params[4],
              birth_date: params[5],
              gender: params[6],
              updated_at: new Date().toISOString(),
            });
            return { id: user.id };
          }
          if (text.startsWith("UPDATE TEACHERS") && text.includes("SET SPECIALITY")) {
            const teacher = (self._managedTeachers ?? []).find((row) => row.id === params[0]);
            if (!teacher) return null;
            Object.assign(teacher, {
              speciality: params[1],
              hire_date: params[2],
              updated_at: new Date().toISOString(),
            });
            return { id: teacher.id };
          }
          if (text.startsWith("UPDATE TEACHERS") && text.includes("SET STATUS = 'ARCHIVED'")) {
            const teacher = (self._managedTeachers ?? []).find((row) => row.id === params[0]);
            if (!teacher) return null;
            teacher.status = "archived";
            teacher.updated_at = new Date().toISOString();
            return { id: teacher.id };
          }
          if (text.startsWith("UPDATE USERS") && text.includes("SET STATUS = 'ARCHIVED'")) {
            const user = (self._managedTeacherUsers ?? []).find((row) => row.id === params[0]);
            if (!user) return null;
            user.status = "archived";
            user.updated_at = new Date().toISOString();
            const seedUser = seedData.userAccounts.find(
              (row) => String(row.publicId ?? row.id ?? "") === String(user.user_code) || String(row.id) === String(user.id),
            );
            if (seedUser) seedUser.status = "archived";
            return { id: user.id };
          }
          if (text.startsWith("SELECT") && text.includes("AS COURSES")) {
            const teacherId = params[0];
            const courses = (self._managedSchoolCourses ?? []).filter(
              (row) => row.teacher_id === teacherId && row.status === "active",
            ).length;
            const schedules = (self._managedScheduleSlots ?? []).filter(
              (row) => row.teacher_id === teacherId && new Date(row.ends_at).getTime() > Date.now(),
            ).length;
            return { courses, schedules };
          }
          return null;
        },
        async all(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (text.includes("FROM TEACHER_ASSIGNMENTS TA")) {
            // Mode mémoire : affectations seed gérées dans listSchoolTeachers ; aucune TA managée.
            return [];
          }
          if (
            text.includes("FROM TEACHERS T") &&
            text.includes("LEFT JOIN USERS") &&
            text.includes("WHERE T.SCHOOL_ID")
          ) {
            const schoolId = params[0];
            return (self._managedTeachers ?? [])
              .filter((row) => row.school_id === schoolId)
              .filter((row) => !["deleted", "archived"].includes(String(row.status ?? "active").toLowerCase()))
              .map((teacher) => {
                const user = (self._managedTeacherUsers ?? []).find((row) => row.id === teacher.user_id);
                if (user && ["deleted", "archived"].includes(String(user.status ?? "active").toLowerCase())) {
                  return null;
                }
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
              })
              .filter(Boolean);
          }
          if (
            text.includes("FROM TEACHERS T") &&
            text.includes("JOIN USERS U") &&
            !text.includes("LEFT JOIN") &&
            text.includes("WHERE T.SCHOOL_ID")
          ) {
            const schoolId = params[0];
            const excludeCode = params[1];
            return (self._managedTeachers ?? [])
              .filter((row) => row.school_id === schoolId)
              .filter((row) => !excludeCode || row.teacher_code !== excludeCode)
              .filter((row) => !["deleted", "archived"].includes(String(row.status ?? "active").toLowerCase()))
              .map((teacher) => {
                const user = (self._managedTeacherUsers ?? []).find((row) => row.id === teacher.user_id);
                if (user && ["deleted", "archived"].includes(String(user.status ?? "active").toLowerCase())) {
                  return null;
                }
                return {
                  teacher_code: teacher.teacher_code,
                  first_name: user?.first_name,
                  last_name: user?.last_name,
                  birth_date: user?.birth_date,
                  gender: user?.gender,
                };
              })
              .filter(Boolean);
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
        async query(sql, params = []) {
          const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
          if (text.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) {
            return { rows: [] };
          }
          if (text.startsWith("UPDATE TEACHER_ASSIGNMENTS") && text.includes("SET STATUS = 'DELETED'")) {
            const teacherId = params[0];
            const teacher = (self._managedTeachers ?? []).find((item) => item.id === teacherId);
            const teacherCode = teacher?.teacher_code ?? "";
            self._managedTeacherAssignments = (self._managedTeacherAssignments ?? []).map((row) => {
              const matches =
                String(row.teacher_id ?? "") === String(teacherId) ||
                String(row.teacherCode ?? row.teacherId ?? "") === String(teacherCode);
              if (!matches || String(row.status ?? "active") !== "active") return row;
              return { ...row, status: "deleted", updatedAt: new Date().toISOString() };
            });
            return { rows: [], rowCount: 1 };
          }
          if (text.startsWith("UPDATE SESSIONS") && text.includes("TEACHER_ARCHIVED")) {
            const userId = params[0];
            for (const session of self.sessions.values()) {
              if (String(session.user_id ?? "") === String(userId) && !session.revoked_at) {
                session.revoked_at = new Date();
                session.revoke_reason = "teacher_archived";
              }
            }
            return { rows: [], rowCount: 1 };
          }
          return { rows: [] };
        },
        createTxScope(tx) {
          return {
            one: (sql, params) => (tx || memoryAdapter).one(sql, params),
            all: (sql, params) => (tx || memoryAdapter).all(sql, params),
            query: (sql, params) => (tx || memoryAdapter).query(sql, params),
            getSchoolByCode: (code) => memoryAdapter.getSchoolByCode(code),
            recordAudit: (payload, innerTx) => self.recordAudit(payload, innerTx ?? tx),
            withTransaction: (fn) => fn(tx),
          };
        },
        recordAudit: (payload, tx) => self.recordAudit(payload, tx),
        async withTransaction(fn) {
          // Sérialise les créations concurrentes mémoire (simule advisory lock établissement).
          if (!self._teacherTxChain) self._teacherTxChain = Promise.resolve();
          const run = self._teacherTxChain.then(async () => {
            const snapshotTeachers = clone(self._managedTeachers ?? []);
            const snapshotUsers = clone(self._managedTeacherUsers ?? []);
            const snapshotAssignments = clone(self._managedTeacherAssignments ?? []);
            const snapshotSessions = [...self.sessions.entries()].map(([id, session]) => [
              id,
              { ...session },
            ]);
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
              self._managedTeacherAssignments = snapshotAssignments;
              for (const [id, session] of snapshotSessions) {
                const current = self.sessions.get(id);
                if (!current) continue;
                current.revoked_at = session.revoked_at;
                current.revoke_reason = session.revoke_reason;
              }
              throw error;
            }
          });
          self._teacherTxChain = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
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
      this._teachersMemoryDb = memoryAdapter;
      this._teachersRepo = createTeachersRepository(memoryAdapter);
    }
    return this._teachersRepo;
  }

  getTeacherLifecycleRepository() {
    if (!this._teacherLifecycleRepo) {
      const { createTeacherLifecycleRepository } = require("./teacherLifecycleRepository");
      this.getTeachersRepository();
      this._teacherLifecycleRepo = createTeacherLifecycleRepository(this._teachersMemoryDb);
    }
    return this._teacherLifecycleRepo;
  }

  writeManagedTeacherToClients(snapshot = {}) {
    const tables = this.getClientsStore()?._tables;
    if (!tables) return;
    const teacherCode = String(snapshot.teacherCode ?? snapshot.teacher_code ?? "").trim();
    if (!teacherCode) return;
    const teacher = (tables.teachers ?? []).find(
      (row) => String(row.teacher_code ?? "") === teacherCode,
    );
    if (!teacher) return;
    if (snapshot.speciality !== undefined) teacher.speciality = snapshot.speciality;
    if (snapshot.entryDate !== undefined || snapshot.hire_date !== undefined) {
      teacher.hire_date = snapshot.entryDate ?? snapshot.hire_date;
    }
    if (snapshot.status !== undefined) teacher.status = snapshot.status;
    const user = (tables.users ?? []).find((row) => String(row.id) === String(teacher.user_id));
    if (!user) return;
    if (snapshot.firstName !== undefined) user.first_name = snapshot.firstName;
    if (snapshot.lastName !== undefined) user.last_name = snapshot.lastName;
    if (snapshot.email !== undefined) user.email = snapshot.email;
    if (snapshot.phone !== undefined) user.phone = snapshot.phone;
    if (snapshot.birthDate !== undefined) user.birth_date = snapshot.birthDate;
    if (snapshot.gender !== undefined) user.gender = snapshot.gender;
    if (snapshot.userStatus !== undefined) user.status = snapshot.userStatus;
  }

  syncClientsTeachersIntoManaged() {
    const tables = this.getClientsStore()?._tables;
    if (!tables) return;
    this.getTeachersRepository();
    if (!this._managedTeachers) this._managedTeachers = [];
    if (!this._managedTeacherUsers) this._managedTeacherUsers = [];
    for (const teacher of tables.teachers ?? []) {
      const managedSchoolId = managedSchoolIdForClientsTeacher(teacher, tables);
      const existing = this._managedTeachers.find(
        (row) =>
          String(row.teacher_code ?? "") === String(teacher.teacher_code ?? "") ||
          (String(row.user_id) === String(teacher.user_id) &&
            (String(row.school_id) === String(teacher.school_id) ||
              String(row.school_id) === String(managedSchoolId))),
      );
      if (existing) {
        if (!isTerminalTeacherStatus(existing.status) || isTerminalTeacherStatus(teacher.status)) {
          existing.status = teacher.status;
        }
        existing.speciality = teacher.speciality || existing.speciality;
        existing.teacher_code = teacher.teacher_code || existing.teacher_code;
        existing.school_id = managedSchoolId;
        continue;
      }
      const user = tables.users.find((row) => row.id === teacher.user_id);
      if (user && !this._managedTeacherUsers.some((row) => String(row.id) === String(user.id))) {
        this._managedTeacherUsers.push({
          id: user.id,
          school_id: managedSchoolId,
          user_code: user.user_code,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          phone: user.phone,
          password_hash: user.password_hash,
          pin_hash: user.pin_hash,
          must_change_password: user.must_change_password,
          role: "TEACHER",
          status: user.status,
          birth_date: user.birth_date,
          gender: user.gender,
          created_at: user.created_at,
          updated_at: user.updated_at,
        });
      }
      this._managedTeachers.push({
        id: teacher.id,
        school_id: managedSchoolId,
        user_id: teacher.user_id,
        teacher_code: teacher.teacher_code,
        speciality: teacher.speciality,
        hire_date: teacher.hire_date,
        status: teacher.status ?? "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  projectClientsTeachers(schoolCode) {
    const store = this._clientsStore;
    const tables = store?._tables;
    if (!tables) return [];
    const normalized = String(schoolCode ?? "").trim().toUpperCase();
    const school = tables.schools.find(
      (row) => String(row.code ?? row.schoolCode ?? "").trim().toUpperCase() === normalized,
    );
    if (!school) return [];
    return tables.teachers
      .filter((row) => row.school_id === school.id)
      .filter((row) => !["deleted", "archived"].includes(String(row.status ?? "active").toLowerCase()))
      .map((teacher) => {
        const user = tables.users.find((row) => row.id === teacher.user_id);
        const identifier = String(teacher.teacher_code ?? "").match(/(ENS-\d+)$/i)?.[1]?.toUpperCase() ?? teacher.teacher_code;
        return {
          id: teacher.teacher_code,
          teacherCode: teacher.teacher_code,
          publicId: teacher.teacher_code,
          identifier,
          userId: teacher.user_id,
          firstName: user?.first_name ?? "",
          lastName: user?.last_name ?? "",
          name: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim(),
          gender: user?.gender ?? "",
          birthDate: user?.birth_date ?? "",
          entryDate: teacher.hire_date ?? "",
          phone: user?.phone ?? "",
          email: user?.email ?? "",
          speciality: teacher.speciality ?? "",
          mainSubject: teacher.speciality ?? "",
          schoolCode: normalized,
          status: String(teacher.status ?? "active").toLowerCase() === "inactive" ? "Inactif" : "Actif",
          mustChangePassword: Boolean(user?.must_change_password),
          assignments: [],
          assignedClasses: [],
          courses: [],
        };
      });
  }

  async listSchoolTeachers(schoolCode) {
    this.syncClientsTeachersIntoManaged();
    const normalized = String(schoolCode ?? "").trim().toUpperCase();
    const managed = await this.getTeachersRepository().listBySchoolCode(schoolCode);
    const clientsTeachers = this.projectClientsTeachers(normalized);
    const seeded = (seedData.teachers ?? [])
      .filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === normalized)
      .filter((row) => !["archived", "deleted", "archivé"].includes(String(row.status ?? "actif").toLowerCase()))
      .filter(
        (row) =>
          !managed.some(
            (item) =>
              String(item.teacherCode ?? item.publicId ?? "") ===
              String(row.publicId ?? row.id ?? ""),
          ) &&
          !clientsTeachers.some(
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
    const rows = [...seeded, ...managed, ...clientsTeachers.filter((teacher) =>
      ![...seeded, ...managed].some(
        (item) =>
          String(item.teacherCode ?? item.publicId ?? "") === String(teacher.teacherCode ?? teacher.publicId ?? "") ||
          String(item.userId ?? "") === String(teacher.userId ?? ""),
      ),
    )];
    const assignments = await this.listSchoolTeacherAssignments(schoolCode);
    return rows.map((teacher) => {
      const teacherAssignments = assignments
        .filter(
          (assignment) =>
            [teacher.id, teacher.teacherCode, teacher.publicId, teacher.identifier, teacher.userId]
              .map((value) => String(value ?? ""))
              .includes(String(assignment.teacherId ?? assignment.teacherCode ?? "")) ||
            String(assignment.teacherName ?? "") === String(teacher.name ?? ""),
        )
        .map((assignment) => ({
          classId: assignment.classId ?? assignment.class_id ?? null,
          className: assignment.className,
          classCode: assignment.classCode ?? "",
          course: assignment.subject ?? assignment.course ?? "",
          status: assignment.status ?? "active",
        }));
      return {
        ...teacher,
        assignments: teacherAssignments,
        assignedClasses: [...new Set(teacherAssignments.map((item) => item.className).filter(Boolean))],
        assignedClassCodes: [...new Set(teacherAssignments.map((item) => item.classCode).filter(Boolean))],
        assignedClassIds: [...new Set(teacherAssignments.map((item) => item.classId).filter(Boolean))],
        courses: [...new Set(teacherAssignments.map((item) => item.course).filter(Boolean))],
      };
    });
  }

  getSchoolTeacherByCode(teacherCode, schoolCode) {
    return this.listSchoolTeachers(schoolCode).then((rows) => {
      const code = String(teacherCode ?? "").trim();
      const match = rows.find(
        (row) =>
          String(row.teacherCode ?? "") === code ||
          String(row.publicId ?? "") === code ||
          String(row.id ?? "") === code ||
          String(row.identifier ?? "") === code,
      );
      if (!match) {
        const { createTeacherHttpError } = require("../lib/teachersManagement");
        throw createTeacherHttpError(404, "Enseignant introuvable.");
      }
      return match;
    });
  }

  createSchoolTeacher(body, schoolCode, principal, auditMeta) {
    return this.getTeachersRepository().create(body, schoolCode, principal, auditMeta);
  }

  async updateSchoolTeacher(teacherCode, body, schoolCode, principal, auditMeta) {
    this.syncClientsTeachersIntoManaged();
    const snapshot = await this.getTeacherLifecycleRepository().update(
      teacherCode,
      body,
      schoolCode,
      principal,
      auditMeta,
    );
    this.writeManagedTeacherToClients(snapshot);
    const updated = await this.getSchoolTeacherByCode(teacherCode, schoolCode);
    const seedIdx = (seedData.teachers ?? []).findIndex(
      (row) => String(row.publicId ?? row.id ?? "") === String(teacherCode),
    );
    if (seedIdx >= 0) {
      seedData.teachers[seedIdx] = {
        ...seedData.teachers[seedIdx],
        firstName: updated.firstName,
        lastName: updated.lastName,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        gender: updated.gender,
        birthDate: updated.birthDate,
        entryDate: updated.entryDate,
        speciality: updated.speciality,
        mainSubject: updated.mainSubject || updated.speciality,
      };
    }
    return updated;
  }

  async archiveSchoolTeacher(teacherCode, schoolCode, principal, auditMeta) {
    this.syncClientsTeachersIntoManaged();
    const result = await this.getTeacherLifecycleRepository().archive(
      teacherCode,
      schoolCode,
      principal,
      auditMeta,
    );
    this.writeManagedTeacherToClients({
      teacherCode: result.teacherCode ?? teacherCode,
      status: "archived",
    });
    const seedIdx = (seedData.teachers ?? []).findIndex(
      (row) => String(row.publicId ?? row.id ?? "") === String(teacherCode),
    );
    if (seedIdx >= 0) {
      seedData.teachers[seedIdx] = { ...seedData.teachers[seedIdx], status: "archived" };
    }
    return result;
  }

  async listSchoolTeacherAssignments(schoolCode) {
    const code = String(schoolCode ?? "").trim().toUpperCase();
    if (!code || code === "*") {
      const { assignmentError } = require("../lib/teacherAssignmentsManagement");
      throw assignmentError(400, "schoolCode établissement requis.", "ASSIGNMENT_SCHOOL_REQUIRED");
    }
    return clone(
      [
        ...(shouldSeedDemoData() ? seedData.teacherAssignments ?? [] : []).filter(
          (seeded) =>
            !(this._managedTeacherAssignments ?? []).some(
              (managed) => String(managed.id) === String(seeded.id),
            ),
        ),
        ...(this._managedTeacherAssignments ?? []),
      ].filter(
        (row) =>
          String(row.schoolCode ?? "").trim().toUpperCase() === code &&
          String(row.status ?? "active").toLowerCase() === "active",
      ),
    );
  }

  async createSchoolTeacherAssignment(body, schoolCode, principal, auditMeta) {
    const { assignmentError, validateAssignmentInput } = require("../lib/teacherAssignmentsManagement");
    const input = validateAssignmentInput(body);
    const code = String(schoolCode ?? "").trim().toUpperCase();
    const [teachers, dataset, existing] = await Promise.all([
      this.listSchoolTeachers(code),
      this.getDataset(),
      this.listSchoolTeacherAssignments(code),
    ]);
    const teacher = teachers.find((row) =>
      [row.id, row.teacherCode, row.publicId, row.identifier, row.userId].some(
        (value) => String(value ?? "") === input.teacherCode,
      ),
    );
    const schoolClass = (dataset.classes ?? []).find(
      (row) =>
        String(row.schoolCode ?? code).toUpperCase() === code &&
        [row.publicId, row.classCode, row.name].some((value) => String(value ?? "") === input.classRef),
    );
    const matchingSubjects = (dataset.courses ?? []).filter(
      (row) =>
        String(row.schoolCode ?? code).toUpperCase() === code &&
        [row.publicId, row.subjectCode, row.name].some(
          (value) => String(value ?? "") === input.subjectRef,
        ),
    );
    const subject = matchingSubjects.find(
      (row) => String(row.className ?? "") === String(schoolClass?.name ?? ""),
    ) ?? matchingSubjects[0];
    if (!teacher) throw assignmentError(404, "Enseignant introuvable.", "ASSIGNMENT_TEACHER_NOT_FOUND");
    if (!schoolClass) throw assignmentError(404, "Classe introuvable.", "ASSIGNMENT_CLASS_NOT_FOUND");
    if (!subject) throw assignmentError(404, "Cours introuvable.", "ASSIGNMENT_SUBJECT_NOT_FOUND");
    if (
      existing.some(
        (row) =>
          String(row.teacherCode ?? row.teacherId) === String(teacher.teacherCode ?? teacher.publicId ?? teacher.id) &&
          row.className === schoolClass.name &&
          String(row.subject ?? row.course) === subject.name,
      )
    ) {
      throw assignmentError(
        409,
        "Cette affectation existe déjà pour cet enseignant.",
        "TEACHER_ASSIGNMENT_ALREADY_EXISTS",
      );
    }
    if (
      existing.some(
        (row) => row.className === schoolClass.name && String(row.subject ?? row.course) === subject.name,
      )
    ) {
      throw assignmentError(409, "Ce cours est déjà affecté à un enseignant pour cette classe.", "ASSIGNMENT_COURSE_CONFLICT");
    }
    if (!this._managedTeacherAssignments) this._managedTeacherAssignments = [];
    const created = {
      id: `MEM-ASSIGN-${String(this._managedTeacherAssignments.length + 1).padStart(6, "0")}`,
      schoolCode: code,
      teacherId: teacher.teacherCode ?? teacher.publicId ?? teacher.id,
      teacherCode: teacher.teacherCode ?? teacher.publicId ?? teacher.id,
      teacherName: teacher.name,
      className: schoolClass.name,
      classId: schoolClass.classId ?? schoolClass.id ?? null,
      classCode: schoolClass.classCode ?? schoolClass.publicId ?? "",
      subject: subject.name,
      course: subject.name,
      subjectCode: subject.subjectCode ?? subject.publicId ?? "",
      assignmentRole: input.assignmentRole,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._managedTeacherAssignments.push(created);
    try {
      if (principal || auditMeta) {
        await this.recordAudit({
          schoolCode: code,
          userId: principal?.sub || auditMeta?.userId,
          action: "create_teacher_assignment",
          entityType: "teacher_assignment",
          entityId: created.id,
          newValue: {
            teacherCode: created.teacherCode,
            classCode: created.classCode,
            subjectCode: created.subjectCode,
            schoolCode: code,
          },
          ipAddress: auditMeta?.ipAddress,
          userAgent: auditMeta?.userAgent,
        });
      }
    } catch (error) {
      this._managedTeacherAssignments = this._managedTeacherAssignments.filter(
        (row) => String(row.id) !== String(created.id),
      );
      throw error;
    }
    return clone(created);
  }

  async updateSchoolTeacherAssignment(assignmentId, body, schoolCode, principal, auditMeta) {
    const current = (await this.listSchoolTeacherAssignments(schoolCode)).find(
      (row) => String(row.id) === String(assignmentId),
    );
    if (!current) {
      const { assignmentError } = require("../lib/teacherAssignmentsManagement");
      throw assignmentError(404, "Affectation introuvable.", "ASSIGNMENT_NOT_FOUND");
    }
    await this.deleteSchoolTeacherAssignment(assignmentId, schoolCode);
    try {
      const created = await this.createSchoolTeacherAssignment(
        {
          teacherCode: body?.teacherCode ?? body?.teacherId ?? current.teacherCode,
          classCode: body?.classCode ?? body?.className ?? current.classCode ?? current.className,
          subjectCode:
            body?.subjectCode ?? body?.subject ?? body?.course ?? current.subjectCode ?? current.subject,
          assignmentRole: body?.assignmentRole ?? current.assignmentRole,
        },
        schoolCode,
      );
      const generatedId = created.id;
      created.id = current.id;
      this._managedTeacherAssignments = this._managedTeacherAssignments.filter(
        (row) =>
          String(row.id) !== String(generatedId) &&
          String(row.id) !== String(current.id),
      );
      this._managedTeacherAssignments.push(created);
      if (principal || auditMeta) {
        await this.recordAudit({
          schoolCode,
          userId: principal?.sub || auditMeta?.userId,
          action: "update_teacher_assignment",
          entityType: "teacher_assignment",
          entityId: created.id,
          newValue: {
            teacherCode: created.teacherCode,
            classCode: created.classCode,
            subjectCode: created.subjectCode,
            schoolCode,
          },
          ipAddress: auditMeta?.ipAddress,
          userAgent: auditMeta?.userAgent,
        });
      }
      return clone(created);
    } catch (error) {
      current.status = "active";
      if (!this._managedTeacherAssignments) this._managedTeacherAssignments = [];
      this._managedTeacherAssignments = this._managedTeacherAssignments.filter(
        (row) => String(row.id) !== String(current.id),
      );
      this._managedTeacherAssignments.push(current);
      throw error;
    }
  }

  async deleteSchoolTeacherAssignment(assignmentId, schoolCode, principal, auditMeta) {
    const rows = await this.listSchoolTeacherAssignments(schoolCode);
    const current = rows.find((row) => String(row.id) === String(assignmentId));
    if (!current) {
      const { assignmentError } = require("../lib/teacherAssignmentsManagement");
      throw assignmentError(404, "Affectation introuvable.", "ASSIGNMENT_NOT_FOUND");
    }
    if (!this._managedTeacherAssignments) this._managedTeacherAssignments = [];
    let managed = false;
    this._managedTeacherAssignments = this._managedTeacherAssignments.map((row) => {
      if (String(row.id) !== String(assignmentId)) return row;
      managed = true;
      return { ...row, status: "deleted", updatedAt: new Date().toISOString() };
    });
    if (!managed) this._managedTeacherAssignments.push({ ...current, status: "deleted" });
    try {
      if (principal || auditMeta) {
        await this.recordAudit({
          schoolCode,
          userId: principal?.sub || auditMeta?.userId,
          action: "delete_teacher_assignment",
          entityType: "teacher_assignment",
          entityId: current.id,
          newValue: { id: current.id, deleted: true, schoolCode },
          ipAddress: auditMeta?.ipAddress,
          userAgent: auditMeta?.userAgent,
        });
      }
    } catch (error) {
      this._managedTeacherAssignments = this._managedTeacherAssignments.map((row) =>
        String(row.id) === String(current.id) ? { ...current, status: "active" } : row,
      );
      throw error;
    }
    return { id: current.id, deleted: true };
  }

  getFinanceStore() {
    if (!this._financeStore) {
      const { createFinanceMemoryStore } = require("./financeMemoryStore");
      const { studentMatches } = require("../lib/financeManagement");
      this._financeStore = createFinanceMemoryStore({
        getSchoolByCode: async (code) => {
          const normalized = String(code ?? "").trim().toUpperCase();
          return (
            this._establishmentStore().find(
              (row) => String(row.code ?? row.publicId ?? "").trim().toUpperCase() === normalized,
            ) || null
          );
        },
        findStudent: async (studentKey, principal) => {
          const dataset = await this.getDataset();
          const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
          return (
            (dataset.students ?? []).find((student) => {
              if (schoolCode && schoolCode !== "*" && String(student.schoolCode ?? "").toUpperCase() !== schoolCode) {
                return false;
              }
              return studentMatches(student, studentKey);
            }) || null
          );
        },
        listStudentsInClass: async (schoolCode, className) => {
          const dataset = await this.getDataset();
          const { normalizeKey } = require("../lib/financeManagement");
          return (dataset.students ?? []).filter(
            (student) =>
              String(student.schoolCode ?? "").toUpperCase() === String(schoolCode).toUpperCase() &&
              normalizeKey(student.className) === normalizeKey(className),
          );
        },
      });
    }
    return this._financeStore;
  }

  listFinanceProjection() {
    return this.getFinanceStore().listProjection();
  }

  createSchoolPayment(payload, principal, auditMeta) {
    return this.getFinanceStore().createSchoolPayment(payload, principal, auditMeta);
  }

  getSchoolPayment(id, principal) {
    return this.getFinanceStore().getSchoolPayment(id, principal);
  }

  cancelSchoolPayment(id, reason, principal, auditMeta) {
    return this.getFinanceStore().cancelSchoolPayment(id, reason, principal, auditMeta);
  }

  listFinancePaymentStatuses() {
    return this.getFinanceStore().listFinancePaymentStatuses();
  }

  upsertFinancePaymentStatus(payload, principal) {
    return this.getFinanceStore().upsertFinancePaymentStatus(payload, principal);
  }

  listFinanceFeeGrids() {
    return this.getFinanceStore().listFinanceFeeGrids();
  }

  getFinanceFeeGrid(id, principal) {
    return this.getFinanceStore().getFinanceFeeGrid(id, principal);
  }

  upsertFinanceFeeGrid(payload, principal) {
    return this.getFinanceStore().upsertFinanceFeeGrid(payload, principal);
  }

  setFinanceFeeGridStatus(id, status, principal) {
    return this.getFinanceStore().setFinanceFeeGridStatus(id, status, principal);
  }

  applyFinanceFeeGrid(id, principal, options) {
    return this.getFinanceStore().applyFinanceFeeGrid(id, principal, options);
  }

  listFinanceStudentFees() {
    return this.getFinanceStore().listFinanceStudentFees();
  }

  getFinanceStudentFee(id, principal) {
    return this.getFinanceStore().getFinanceStudentFee(id, principal);
  }

  adjustFinanceStudentFee(id, patch, principal) {
    return this.getFinanceStore().adjustFinanceStudentFee(id, patch, principal);
  }

  createFinanceReminder(studentId, payload, principal, options) {
    return this.getFinanceStore().createFinanceReminder(studentId, payload, principal, options);
  }

  async listPedagogyProjection() {
    const state = (await this.getBackOfficeState()) ?? {};
    return {
      courses: state.courses ?? [],
      courseSchedules: state.courseSchedules ?? [],
      evaluations: state.evaluations ?? [],
      notes: state.notes ?? [],
      presences: state.presences ?? [],
    };
  }

  createSchoolCourse() {
    throw new Error("PostgreSQL requis pour les écritures pédagogiques canoniques.");
  }

  updateSchoolCourse() {
    return this.createSchoolCourse();
  }

  deleteSchoolCourse() {
    return this.createSchoolCourse();
  }

  getSchoolCourse() {
    return Promise.resolve(null);
  }

  createCourseSchedule() {
    return this.createSchoolCourse();
  }

  updateCourseSchedule() {
    return this.createSchoolCourse();
  }

  deleteCourseSchedule() {
    return this.createSchoolCourse();
  }

  getCourseSchedule() {
    return Promise.resolve(null);
  }

  async listCourseSchedules(principal, query = {}) {
    const projection = String(query.projection ?? "").trim().toLowerCase();
    if (projection === "course-options" || projection === "planning-course-options") {
      return this.listPlanningCourseOptions(principal, query);
    }
    const state = (await this.getBackOfficeState()) ?? {};
    const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
    let rows = Array.isArray(state.courseSchedules) ? [...state.courseSchedules] : [];
    if (schoolCode && schoolCode !== "*") {
      rows = rows.filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === schoolCode);
    }
    const role = String(principal?.role ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (role === "enseignant" || role === "teacher" || role.includes("prof")) {
      const ids = new Set(
        [principal?.sub, principal?.id, principal?.identifier, principal?.teacherId]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      );
      rows = rows.filter((slot) => ids.has(String(slot.teacherId ?? "")));
    }
    const classId = String(query.classId ?? query.class_id ?? "").trim();
    const teacherId = String(query.teacherId ?? query.teacher_id ?? "").trim();
    const schoolCourseId = String(query.schoolCourseId ?? query.school_course_id ?? "").trim();
    const academicYearId = String(query.academicYearId ?? query.academic_year_id ?? "").trim();
    const dayOfWeek = String(query.dayOfWeek ?? "").trim();
    if (classId) rows = rows.filter((row) => String(row.classId ?? "") === classId);
    if (teacherId) rows = rows.filter((row) => String(row.teacherId ?? "") === teacherId);
    if (schoolCourseId) rows = rows.filter((row) => String(row.schoolCourseId ?? "") === schoolCourseId);
    if (academicYearId) rows = rows.filter((row) => String(row.academicYearId ?? "") === academicYearId);
    if (dayOfWeek) rows = rows.filter((row) => String(row.dayOfWeek ?? "") === dayOfWeek);
    return rows;
  }

  async listPlanningCourseOptions(principal, query = {}) {
    const state = (await this.getBackOfficeState()) ?? {};
    const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
    const classId = String(query.classId ?? query.class_id ?? "").trim();
    const className = String(query.className ?? query.class_name ?? "").trim().toLowerCase();
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const role = String(principal?.role ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    const teacherKeys = new Set(
      [principal?.sub, principal?.id, principal?.identifier, principal?.teacherId, principal?.teacherCode]
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
    const isTeacher = role === "enseignant" || role === "teacher" || role.includes("prof");
    const items = [];
    for (const row of Array.isArray(state.courses) ? state.courses : []) {
      const status = String(row.status ?? "").trim().toLowerCase();
      if (status === "archived" || status === "archivé") continue;
      const rowSchool = String(row.schoolCode ?? "").trim().toUpperCase();
      if (schoolCode && schoolCode !== "*" && rowSchool && rowSchool !== schoolCode) continue;
      if (classId && String(row.classId ?? "") !== classId) continue;
      if (!classId && className && String(row.className ?? "").trim().toLowerCase() !== className) continue;
      const schoolCourseId = String(row.schoolCourseId ?? row.dbId ?? row.id ?? "").trim();
      if (!UUID_RE.test(schoolCourseId)) continue;
      if (isTeacher) {
        const courseTeacher = String(row.teacherId ?? "").trim().toLowerCase();
        if (!teacherKeys.has(courseTeacher)) continue;
      }
      items.push({
        schoolCourseId,
        classId: String(row.classId ?? ""),
        className: String(row.className ?? ""),
        academicYearId: String(row.academicYearId ?? ""),
        name: String(row.name ?? row.subject ?? "").trim(),
        teacherId: String(row.teacherId ?? ""),
        teacherName: String(row.teacherName ?? ""),
        status: "active",
      });
    }
    return { projection: "planning-course-options", items };
  }

  async listSchoolEvaluations(schoolCode, principal = {}) {
    const state = (await this.getBackOfficeState()) ?? {};
    const code = String(schoolCode ?? "").trim().toUpperCase();
    let rows = (state.evaluations ?? []).filter(
      (row) => String(row.schoolCode ?? "").trim().toUpperCase() === code,
    );
    const role = String(principal?.role ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (role === "enseignant" || role === "teacher" || role.includes("prof")) {
      const assignments = Array.isArray(principal.assignments) ? principal.assignments : [];
      const allowed = new Set();
      for (const assignment of assignments) {
        const status = String(assignment.status ?? assignment.assignmentStatus ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase();
        if (!["active", "actif", "open", "ouverte"].includes(status)) continue;
        const classId = String(assignment.classId ?? assignment.class_id ?? "").trim();
        const subjectId = String(assignment.subjectId ?? assignment.subject_id ?? "").trim();
        if (!classId || !subjectId) continue;
        allowed.add(`${classId}|${subjectId}`);
      }
      if (!allowed.size) return [];
      rows = rows.filter((row) =>
        allowed.has(`${String(row.classId ?? "").trim()}|${String(row.subjectId ?? "").trim()}`),
      );
    }
    return rows;
  }

  async createSchoolEvaluation(payload, principal, auditMeta) {
    this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    const { ignoreClientScope } = require("../lib/pedagogyManagement");
    const { resolveEvaluationTypeForWrite } = require("../lib/evaluationTypesService");
    const scoped = ignoreClientScope(payload ?? {});
    const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
    const school = await this.getEvaluationTypesStore().requireSchoolByCode(schoolCode);
    const lookup = { ...scoped };
    const resolved = await resolveEvaluationTypeForWrite(this, school.id, lookup, { required: true });
    const evaluation = {
      ...scoped,
      id: scoped.id || `EVAL-${Date.now()}`,
      schoolCode,
      evaluationType: resolved.name,
      evaluationTypeId: resolved.id,
      evaluationTypeCode: resolved.code,
    };
    const state = (await this.getBackOfficeState()) ?? {};
    this.backOfficeState = { ...state, evaluations: [...(state.evaluations ?? []), evaluation] };
    if (auditMeta) {
      await this.recordAudit({
        schoolCode,
        userId: principal?.sub,
        action: "create_evaluation",
        entityType: "evaluation",
        entityId: evaluation.id,
        newValue: evaluation,
        ipAddress: auditMeta.ipAddress,
        userAgent: auditMeta.userAgent,
      });
    }
    return evaluation;
  }

  async updateSchoolEvaluation(id, patch, principal, auditMeta) {
    this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    const { ignoreClientScope } = require("../lib/pedagogyManagement");
    const scoped = ignoreClientScope(patch ?? {});
    const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
    const typeTouched = Boolean(
      scoped.evaluationTypeId || scoped.evaluation_type_id || scoped.evaluationType || scoped.type || scoped.evaluation_type,
    );
    let resolved = null;
    if (typeTouched) {
      const { resolveEvaluationTypeForWrite } = require("../lib/evaluationTypesService");
      const school = await this.getEvaluationTypesStore().requireSchoolByCode(schoolCode);
      resolved = await resolveEvaluationTypeForWrite(this, school.id, scoped, { required: true });
    }
    const state = (await this.getBackOfficeState()) ?? {};
    const evaluations = (state.evaluations ?? []).map((row) => {
      if (String(row.id) !== String(id)) return row;
      return {
        ...row,
        ...scoped,
        schoolCode: row.schoolCode || schoolCode,
        ...(resolved
          ? {
              evaluationType: resolved.name,
              evaluationTypeId: resolved.id,
              evaluationTypeCode: resolved.code,
            }
          : {}),
      };
    });
    this.backOfficeState = { ...state, evaluations };
    const saved = evaluations.find((row) => String(row.id) === String(id));
    if (auditMeta && saved) {
      await this.recordAudit({
        schoolCode: saved.schoolCode,
        userId: principal?.sub,
        action: "update_evaluation",
        entityType: "evaluation",
        entityId: saved.id,
        newValue: saved,
        ipAddress: auditMeta.ipAddress,
        userAgent: auditMeta.userAgent,
      });
    }
    return saved;
  }

  async upsertSchoolGrade(payload, principal) {
    return this.upsertGrade(payload, principal);
  }

  async upsertSchoolAttendanceBatch(payload, principal) {
    return this.upsertAttendanceBatch(payload, principal);
  }

  getPlatformStore() {
    if (!this._platformStore) {
      const { createPlatformMemoryStore } = require("./platformMemoryStore");
      const platformSeed = shouldSeedDemoData()
        ? {
            school: seedData.school,
            platformSchools: this._managedSchools ?? seedData.platformSchools,
            countries: seedData.countries,
            subscriptions: seedData.subscriptions,
            subscriptionOffers: seedData.subscriptionOffers ?? [],
            platformNotifications: seedData.platformNotifications,
            rolePermissions: seedData.rolePermissions,
          }
        : null;
      this._platformStore = createPlatformMemoryStore({
        getSchoolByCode: async (code) => {
          const { getCountryCodeFromScope } = require("../lib/countryScope");
          const dataset = await this.getDataset();
          const school = (dataset.platformSchools ?? []).find(
            (row) => String(row.code ?? row.schoolCode).toUpperCase() === String(code).toUpperCase(),
          );
          if (!school) return null;
          const countryCode =
            school.country_code ??
            school.countryCode ??
            getCountryCodeFromScope(school.country) ??
            String(school.code ?? "").slice(0, 2).toUpperCase();
          return {
            ...school,
            id: school.id ?? school.code ?? school.schoolCode,
            school_code: school.school_code ?? school.code ?? school.schoolCode,
            country_code: countryCode,
            country_name: school.country_name ?? school.country,
          };
        },
        getCountryByCode: async (code) => {
          const dataset = await this.getDataset();
          return (dataset.countries ?? []).find(
            (country) => String(country.code).toUpperCase() === String(code).toUpperCase(),
          );
        },
        seed: platformSeed,
      });
    }
    return this._platformStore;
  }

  listPlatformProjection() {
    return this.getPlatformStore().listProjection();
  }

  getPlatformSchoolByCode(code) {
    return this.getPlatformStore().getSchoolByCode(code);
  }

  getSchoolByCode(code) {
    return this.getPlatformSchoolByCode(code);
  }

  async getRolePermissionsMap() {
    const { mergeRolePermissionMaps } = require("../lib/functionalRbacService");
    const seedMap = require("../data").rolePermissions ?? {};
    const platformMap = (await this.getPlatformStore().getRolePermissionsMap()) ?? {};
    const establishmentMap = await this.getEstablishmentRolesStore().getPermissionsMap();
    return mergeRolePermissionMaps(seedMap, platformMap, establishmentMap);
  }

  getFunctionalRbacStore() {
    if (!this._functionalRbacStore) {
      const { createFunctionalRbacMemoryStore } = require("./functionalRbacMemoryStore");
      const self = this;
      this._functionalRbacStore = createFunctionalRbacMemoryStore({
        async resolveCountryAndSchool({ countryCode, schoolCode, countryId, schoolId }) {
          const dataset = await self.getDataset();
          const school = (dataset.platformSchools ?? []).find((row) => {
            const code = String(row.code ?? row.schoolCode ?? row.school_code ?? "").toUpperCase();
            return (
              (schoolCode && code === String(schoolCode).toUpperCase()) ||
              (schoolId && String(row.id) === String(schoolId))
            );
          });
          const country = (dataset.countries ?? []).find((row) => {
            const code = String(row.code ?? row.iso_code ?? "").toUpperCase();
            return (
              (countryCode && (code === String(countryCode).toUpperCase() || String(row.name).toUpperCase() === String(countryCode).toUpperCase())) ||
              (countryId && String(row.id) === String(countryId)) ||
              (school && (code === String(school.countryCode ?? school.country_code ?? "").toUpperCase() || String(row.name) === school.country))
            );
          });
          return {
            country: country
              ? { id: country.id ?? country.code, code: country.code }
              : countryCode
                ? { id: `country-${countryCode}`, code: countryCode }
                : null,
            school: school
              ? {
                  id: school.id ?? school.code ?? school.schoolCode,
                  school_code: school.school_code ?? school.code ?? school.schoolCode,
                  country_id: country?.id ?? country?.code ?? school.country_id,
                  country_code: country?.code ?? school.countryCode ?? school.country_code,
                }
              : null,
          };
        },
      });
    }
    return this._functionalRbacStore;
  }

  resolveEffectivePermissions(principal) {
    const { resolveEffectivePermissionsForPrincipal } = require("../lib/functionalRbacService");
    return resolveEffectivePermissionsForPrincipal(this, principal);
  }

  listRbacCatalog(principal) {
    const { listRbacCatalog } = require("../lib/functionalRbacService");
    return listRbacCatalog(this, principal);
  }

  getConfiguredRolePermissions(query, principal) {
    const { getConfiguredPermissions } = require("../lib/functionalRbacService");
    return getConfiguredPermissions(this, query, principal);
  }

  getEffectiveRolePermissions(query, principal) {
    const { getEffectivePermissionsConfigured } = require("../lib/functionalRbacService");
    return getEffectivePermissionsConfigured(this, query, principal);
  }

  patchConfiguredRolePermissions(payload, principal, auditMeta) {
    const { patchConfiguredPermissions } = require("../lib/functionalRbacService");
    return patchConfiguredPermissions(this, payload, principal, auditMeta);
  }

  createPlatformCountry(payload, principal, auditMeta) {
    return this.getPlatformStore().createCountry(payload, principal, auditMeta);
  }

  updatePlatformCountry(code, patch, principal, auditMeta) {
    return this.getPlatformStore().updateCountry(code, patch, principal, auditMeta);
  }

  upsertPlatformSubscription(payload, principal, auditMeta) {
    return this.getPlatformStore().upsertSubscription(payload, principal, auditMeta);
  }

  createPlatformNotification(payload, principal, auditMeta) {
    return this.getPlatformStore().createNotification(payload, principal, auditMeta);
  }

  updatePlatformNotification(id, patch, principal, auditMeta) {
    return this.getPlatformStore().updateNotification(id, patch, principal, auditMeta);
  }

  replacePlatformRolePermissions(map, principal, auditMeta) {
    return this.getPlatformStore().replaceRolePermissions(map, principal, auditMeta);
  }

  savePlatformDashboardChartConfig(config, principal, auditMeta) {
    return this.getPlatformStore().saveDashboardChartConfig(config, principal, auditMeta);
  }

  upsertPlatformSubscriptionOffer(payload, principal, auditMeta) {
    return this.getPlatformStore().upsertSubscriptionOffer(payload, principal, auditMeta);
  }

  createPlatformSubscriptionPayment(payload, principal, auditMeta) {
    return this.getPlatformStore().createSubscriptionPayment(payload, principal, auditMeta);
  }

  updatePlatformSubscriptionPayment(id, patch, principal, auditMeta) {
    return this.getPlatformStore().updateSubscriptionPayment(id, patch, principal, auditMeta);
  }

  createPlatformSubscriptionDiscount(payload, principal, auditMeta) {
    return this.getPlatformStore().createSubscriptionDiscount(payload, principal, auditMeta);
  }

  updatePlatformSubscriptionDiscount(id, patch, principal, auditMeta) {
    return this.getPlatformStore().updateSubscriptionDiscount(id, patch, principal, auditMeta);
  }

  getClientsStore() {
    if (!this._clientsStore) {
      const { createClientsMemoryStore } = require("./clientsMemoryStore");
      const store = createClientsMemoryStore({
        school: shouldSeedDemoData() ? seedData.school : null,
        platformSchools: this._managedSchools ?? (shouldSeedDemoData() ? seedData.platformSchools : []),
        students: shouldSeedDemoData()
          ? (seedData.students ?? []).map((student) => ({
              ...student,
              school_id: seedData.school.id,
              student_code: student.studentCode ?? student.matricule ?? student.publicId ?? student.id,
            }))
          : [],
      });
      store.assertEstablishmentRoleAssignable = (role, principal) =>
        this.assertEstablishmentRoleAssignable(role, principal);
      store.listEstablishmentAssignableRoles = (principal) =>
        this.listEstablishmentRoles({ schoolAssignableOnly: true, principal });
      this._clientsStore = store;
    }
    return this._clientsStore;
  }

  listClientsProjection() {
    return Promise.resolve(this.getClientsStore().listProjection());
  }

  listClientsAuthAccounts() {
    return Promise.resolve(this.getClientsStore().listAuthAccounts());
  }

  createClientsUser(payload, principal, auditMeta) {
    return this.getClientsStore().createUser(payload, principal, auditMeta);
  }

  provisionClientsUser(payload, principal, auditMeta) {
    return this.getClientsStore().provisionUser(payload, principal, auditMeta);
  }

  updateClientsUser(id, patch, principal, auditMeta) {
    return this.getClientsStore().updateUser(id, patch, principal, auditMeta);
  }

  reassignClientsUserSchool(id, payload, principal, auditMeta) {
    return this.getClientsStore().reassignUserSchool(id, payload, principal, auditMeta).then((result) => {
      const userId = String(result?.id ?? id);
      for (const session of this.sessions.values()) {
        if (String(session.user_id ?? "") === userId && !session.revoked_at) {
          session.revoked_at = new Date();
          session.revoke_reason = "tenant_reassign";
        }
      }
      return result;
    });
  }

  async grantClientsUserRole(userId, payload, principal, auditMeta) {
    const result = await this.getClientsStore().grantUserRole(userId, payload, principal, auditMeta);
    this.syncClientsTeachersIntoManaged();
    return result;
  }

  async revokeClientsUserRole(userId, payload, principal, auditMeta) {
    const result = await this.getClientsStore().revokeUserRole(userId, payload, principal, auditMeta);
    this.syncClientsTeachersIntoManaged();
    return result;
  }

  listAssignableClientsUserRoles(principal) {
    return this.getClientsStore().listAssignableUserRoles(principal);
  }

  listActiveUserRoleKeys(userId) {
    const store = this.getClientsStore();
    if (store?.bind) return store.bind().listActiveUserRoleKeys(userId);
    return Promise.resolve([]);
  }

  createClientsContact(payload, principal, auditMeta) {
    return this.getClientsStore().createContact(payload, principal, auditMeta);
  }

  updateClientsContact(id, patch, principal, auditMeta) {
    return this.getClientsStore().updateContact(id, patch, principal, auditMeta);
  }

  provisionClientsContactAccount(contactId, payload, principal, auditMeta) {
    return this.getClientsStore().provisionContactAccount(contactId, payload, principal, auditMeta);
  }

  createClientsRelation(payload, principal, auditMeta) {
    return this.getClientsStore().createRelation(payload, principal, auditMeta);
  }

  linkParent(payload, principal, auditMeta) {
    return this.getClientsStore().linkParent(payload, principal, auditMeta);
  }

  lookupParentIdentity(query, principal) {
    return this.getClientsStore().lookupParentIdentity(query, principal);
  }

  archiveParentRelation(relationId, payload, principal, auditMeta) {
    return this.getClientsStore().archiveParentRelation(relationId, payload, principal, auditMeta);
  }

  sendClientsMessage(payload, principal, auditMeta) {
    return this.getClientsStore().sendMessage(payload, principal, auditMeta);
  }

  markClientsMessageRead(messageId, principal, auditMeta) {
    return this.getClientsStore().markMessageRead(messageId, principal, auditMeta);
  }

  createClientsAnnouncement(payload, principal, auditMeta) {
    return this.getClientsStore().createAnnouncement(payload, principal, auditMeta);
  }

  updateClientsAnnouncement(id, patch, principal, auditMeta) {
    return this.getClientsStore().updateAnnouncement(id, patch, principal, auditMeta);
  }

  archiveClientsAnnouncement(id, principal, auditMeta) {
    return this.getClientsStore().archiveAnnouncement(id, principal, auditMeta);
  }

  getEducationReferenceStore() {
    if (!this._educationReferenceStore) {
      const { createEducationReferenceMemoryStore } = require("./educationReferenceMemoryStore");
      const datasetPromise = this.getDataset();
      this._educationReferenceStore = createEducationReferenceMemoryStore({
        school: seedData.school,
        schools: seedData.platformSchools,
        countries: seedData.countries,
      });
      this._educationReferenceStore._datasetPromise = datasetPromise;
    }
    return this._educationReferenceStore;
  }

  getSchoolEducationActiveLists(schoolCode) {
    return this.getEducationReferenceStore().getSchoolActiveLists(schoolCode);
  }

  listEducationLevelsByCountry(countryCode, options) {
    return this.getEducationReferenceStore().listLevelsByCountry(countryCode, options);
  }

  listEducationStreamsByCountry(countryCode, options) {
    return this.getEducationReferenceStore().listStreamsByCountry(countryCode, options);
  }

  listEducationClassGroupsByCountry(countryCode, options) {
    return this.getEducationReferenceStore().listGroupsByCountry(countryCode, options);
  }

  getEducationSchoolCatalog(schoolCode) {
    return this.getEducationReferenceStore().getSchoolCatalog(schoolCode);
  }

  createEducationLevel(payload, principal, auditMeta) {
    const { createLevel } = require("../lib/educationReferenceService");
    return createLevel(this, payload, principal, auditMeta);
  }

  updateEducationLevel(levelId, patch, principal, auditMeta) {
    const { updateLevel } = require("../lib/educationReferenceService");
    return updateLevel(this, levelId, patch, principal, auditMeta);
  }

  archiveEducationLevel(levelId, principal, auditMeta) {
    const { archiveLevel } = require("../lib/educationReferenceService");
    return archiveLevel(this, levelId, principal, auditMeta);
  }

  createEducationStream(payload, principal, auditMeta) {
    const { createStream } = require("../lib/educationReferenceService");
    return createStream(this, payload, principal, auditMeta);
  }

  updateEducationStream(streamId, patch, principal, auditMeta) {
    const { updateStream } = require("../lib/educationReferenceService");
    return updateStream(this, streamId, patch, principal, auditMeta);
  }

  archiveEducationStream(streamId, principal, auditMeta) {
    const { archiveStream } = require("../lib/educationReferenceService");
    return archiveStream(this, streamId, principal, auditMeta);
  }

  createEducationClassGroup(payload, principal, auditMeta) {
    const { createGroup } = require("../lib/educationReferenceService");
    return createGroup(this, payload, principal, auditMeta);
  }

  updateEducationClassGroup(groupId, patch, principal, auditMeta) {
    const { updateGroup } = require("../lib/educationReferenceService");
    return updateGroup(this, groupId, patch, principal, auditMeta);
  }

  archiveEducationClassGroup(groupId, principal, auditMeta) {
    const { archiveGroup } = require("../lib/educationReferenceService");
    return archiveGroup(this, groupId, principal, auditMeta);
  }

  saveSchoolEducationActivation(schoolCode, activation, principal, auditMeta) {
    const { saveSchoolActivation } = require("../lib/educationReferenceService");
    return saveSchoolActivation(this, schoolCode, activation, principal, auditMeta);
  }

  updateCountryPedagogicalLabels(payload, principal, auditMeta) {
    const { updateCountryPedagogicalLabels } = require("../lib/educationReferenceService");
    return updateCountryPedagogicalLabels(this, payload, principal, auditMeta);
  }

  async ensureEducationReferenceConstraints() {
    const { ensureEducationReferenceConstraints } = require("../lib/educationReferenceService");
    return ensureEducationReferenceConstraints(this, console);
  }

  getEstablishmentRolesStore() {
    if (!this._establishmentRolesStore) {
      const { createEstablishmentRolesMemoryStore } = require("./establishmentRolesMemoryStore");
      const { buildSeedRolesFromData } = require("../lib/establishmentRolesService");
      this._establishmentRolesStore = createEstablishmentRolesMemoryStore({
        roles: buildSeedRolesFromData().map((role, index) => ({
          ...role,
          displayOrder: index,
        })),
      });
    }
    return this._establishmentRolesStore;
  }

  listEstablishmentRoles(options) {
    return this.getEstablishmentRolesStore().listRoles(options);
  }

  createEstablishmentRole(payload, principal, auditMeta) {
    const { createRole } = require("../lib/establishmentRolesService");
    return createRole(this, payload, principal, auditMeta);
  }

  updateEstablishmentRole(roleId, patch, principal, auditMeta) {
    const { updateRole } = require("../lib/establishmentRolesService");
    return updateRole(this, roleId, patch, principal, auditMeta);
  }

  archiveEstablishmentRole(roleId, principal, auditMeta) {
    const { archiveRole } = require("../lib/establishmentRolesService");
    return archiveRole(this, roleId, principal, auditMeta);
  }

  assertEstablishmentRoleAssignable(roleLabel, principal) {
    const { assertEstablishmentRoleAssignable } = require("../lib/establishmentRolesService");
    return assertEstablishmentRoleAssignable(this, roleLabel, principal);
  }

  getEvaluationTypesStore() {
    if (!this._evaluationTypesStore) {
      const { createEvaluationTypesMemoryStore } = require("./evaluationTypesMemoryStore");
      this._evaluationTypesStore = createEvaluationTypesMemoryStore({
        school: seedData.school,
        schools: seedData.platformSchools,
      });
      this._evaluationTypesBootstrap = this._evaluationTypesStore.bootstrapCanonicalTypesForAllSchools();
    }
    return this._evaluationTypesStore;
  }

  async listEvaluationTypes(schoolCode, options) {
    const store = this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    return store.listBySchool(schoolCode, options);
  }

  async listEvaluationTypeNames(schoolCode) {
    const store = this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    return store.listActiveNames(schoolCode);
  }

  async createEvaluationType(payload, principal, auditMeta, schoolCode) {
    this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    const { createEvaluationType } = require("../lib/evaluationTypesService");
    return createEvaluationType(this, payload, principal, auditMeta, schoolCode);
  }

  async updateEvaluationType(typeId, patch, principal, auditMeta, schoolCode) {
    this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    const { updateEvaluationType } = require("../lib/evaluationTypesService");
    return updateEvaluationType(this, typeId, patch, principal, auditMeta, schoolCode);
  }

  async archiveEvaluationType(typeId, principal, auditMeta, schoolCode) {
    this.getEvaluationTypesStore();
    if (this._evaluationTypesBootstrap) await this._evaluationTypesBootstrap;
    const { archiveEvaluationType } = require("../lib/evaluationTypesService");
    return archiveEvaluationType(this, typeId, principal, auditMeta, schoolCode);
  }

  getSchoolSettingsStore() {
    if (!this._schoolSettingsStore) {
      const { createSchoolSettingsMemoryStore } = require("./schoolSettingsMemoryStore");
      this._schoolSettingsStore = createSchoolSettingsMemoryStore({
        school: seedData.school,
        schools: seedData.platformSchools,
      });
      this._schoolSettingsStore.setClassNames(seedData.school.code, seedData.demoClassNames);
      this._schoolSettingsStore.setSubjectNames(seedData.school.code, seedData.demoSubjects);
      this._schoolSettingsBootstrap = this._schoolSettingsStore.bootstrapCanonicalSettingsForAllSchools();
    }
    return this._schoolSettingsStore;
  }

  async getSchoolSettings(principal, schoolCode) {
    this.getSchoolSettingsStore();
    if (this._schoolSettingsBootstrap) await this._schoolSettingsBootstrap;
    const { getSchoolSettings } = require("../lib/schoolSettingsService");
    return getSchoolSettings(this, principal, schoolCode);
  }

  async patchSchoolSettings(payload, principal, auditMeta, schoolCode) {
    this.getSchoolSettingsStore();
    if (this._schoolSettingsBootstrap) await this._schoolSettingsBootstrap;
    const { patchSchoolSettings } = require("../lib/schoolSettingsService");
    return patchSchoolSettings(this, payload, principal, auditMeta, schoolCode);
  }

  async replaceAcademicPeriods(payload, principal, auditMeta, schoolCode) {
    this.getSchoolSettingsStore();
    if (this._schoolSettingsBootstrap) await this._schoolSettingsBootstrap;
    const { replaceAcademicPeriods } = require("../lib/schoolSettingsService");
    return replaceAcademicPeriods(this, payload, principal, auditMeta, schoolCode);
  }

  getDocumentsExamsStore() {
    if (!this._documentsExamsStore) {
      const { createDocumentsExamsMemoryStore } = require("./documentsExamsMemoryStore");
      this._documentsExamsStore = createDocumentsExamsMemoryStore({
        school: seedData.school,
        schools: seedData.platformSchools,
      });
      if (shouldSeedDemoData()) {
        const store = this._documentsExamsStore;
        for (const exam of seedData.exams ?? []) {
          const school = store.registerSchool({ code: exam.schoolCode });
          if (school) void store.insertExam(school.id, exam);
        }
        for (const bulletin of seedData.bulletins ?? []) {
          const school = store.registerSchool({ code: bulletin.schoolCode });
          if (school) void store.generateReportCard(school.id, bulletin);
        }
        for (const document of seedData.documents ?? []) {
          const school = store.registerSchool({ code: document.schoolCode });
          if (school) {
            void store.insertSchoolDocument(school.id, {
              ...document,
              status: String(document.status).includes("génération") ? "generating" : "available",
            });
          }
        }
      }
    }
    return this._documentsExamsStore;
  }

  async listDocumentsExamsProjection() {
    const store = this.getDocumentsExamsStore();
    const exams = [];
    const bulletins = [];
    const documents = [];
    for (const school of [seedData.school, ...(seedData.platformSchools ?? [])]) {
      const registered = store.registerSchool(school);
      if (!registered) continue;
      exams.push(...(await store.listExams(registered.id)));
      bulletins.push(...(await store.listReportCards(registered.id)));
      documents.push(...(await store.listSchoolDocuments(registered.id)));
    }
    return { exams, bulletins, documents };
  }

  async listExams(principal, schoolCode) {
    const { listExams } = require("../lib/documentsExamsService");
    return listExams(this, principal, schoolCode);
  }

  async getExam(examId, principal, schoolCode) {
    const { getExam } = require("../lib/documentsExamsService");
    return getExam(this, principal, examId, schoolCode);
  }

  async createExam(payload, principal, auditMeta, schoolCode) {
    const { createExam } = require("../lib/documentsExamsService");
    return createExam(this, payload, principal, auditMeta, schoolCode);
  }

  async patchExam(examId, payload, principal, auditMeta, schoolCode) {
    const { patchExam } = require("../lib/documentsExamsService");
    return patchExam(this, examId, payload, principal, auditMeta, schoolCode);
  }

  async validateExam(examId, principal, auditMeta, schoolCode) {
    const { validateExam } = require("../lib/documentsExamsService");
    return validateExam(this, examId, principal, auditMeta, schoolCode);
  }

  async cancelExam(examId, principal, auditMeta, schoolCode) {
    const { cancelExam } = require("../lib/documentsExamsService");
    return cancelExam(this, examId, principal, auditMeta, schoolCode);
  }

  async archiveExam(examId, principal, auditMeta, schoolCode) {
    const { archiveExam } = require("../lib/documentsExamsService");
    return archiveExam(this, examId, principal, auditMeta, schoolCode);
  }

  async listReportCards(principal, schoolCode) {
    const { listReportCards } = require("../lib/documentsExamsService");
    return listReportCards(this, principal, schoolCode);
  }

  async generateReportCard(payload, principal, auditMeta, schoolCode) {
    const { generateReportCard } = require("../lib/documentsExamsService");
    return generateReportCard(this, payload, principal, auditMeta, schoolCode);
  }

  async publishReportCard(cardId, principal, auditMeta, schoolCode) {
    const { publishReportCard } = require("../lib/documentsExamsService");
    return publishReportCard(this, cardId, principal, auditMeta, schoolCode);
  }

  async archiveReportCard(cardId, principal, auditMeta, schoolCode) {
    const { archiveReportCard } = require("../lib/documentsExamsService");
    return archiveReportCard(this, cardId, principal, auditMeta, schoolCode);
  }

  async listReportCardTemplates(principal, schoolCode) {
    const { listTemplates } = require("../lib/documentsExamsService");
    return listTemplates(this, principal, schoolCode);
  }

  async upsertReportCardTemplate(payload, principal, auditMeta, schoolCode) {
    const { upsertTemplate } = require("../lib/documentsExamsService");
    return upsertTemplate(this, payload, principal, auditMeta, schoolCode);
  }

  async archiveReportCardTemplate(templateId, principal, auditMeta, schoolCode) {
    const { archiveTemplate } = require("../lib/documentsExamsService");
    return archiveTemplate(this, templateId, principal, auditMeta, schoolCode);
  }

  async listSchoolDocuments(principal, schoolCode) {
    const { listSchoolDocuments } = require("../lib/documentsExamsService");
    return listSchoolDocuments(this, principal, schoolCode);
  }

  async createSchoolDocument(payload, principal, auditMeta, schoolCode) {
    const { createSchoolDocument } = require("../lib/documentsExamsService");
    return createSchoolDocument(this, payload, principal, auditMeta, schoolCode);
  }

  async patchSchoolDocument(documentId, payload, principal, auditMeta, schoolCode) {
    const { patchSchoolDocument } = require("../lib/documentsExamsService");
    return patchSchoolDocument(this, documentId, payload, principal, auditMeta, schoolCode);
  }

  async archiveSchoolDocument(documentId, principal, auditMeta, schoolCode) {
    const { archiveSchoolDocument } = require("../lib/documentsExamsService");
    return archiveSchoolDocument(this, documentId, principal, auditMeta, schoolCode);
  }
}

module.exports = { FallbackRepository };
