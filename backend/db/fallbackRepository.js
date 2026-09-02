Warning: truncated output (original token count: 39259)
Total output lines: 3920

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
        const defaultSchool = String(seedData.school?.loginCode ?? seedData.school?.code ?? "").toUpperCase();
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
    const {
      allocateNextSchoolLoginCode,
      generateInternalSchoolAlias,
      isInternalSchoolAlias,
      isLegacySchoolCodeFormat,
      matchesSchoolLookup,
    } = require("../lib/schoolCodeV2");
    const requestedId = String(record?.id ?? "").trim();
    const requested = normalizeSchoolCode(record?.code ?? record?.schoolCode ?? record?.legacySchoolCode);
    const store = this._establishmentStore();
    let existing = requestedId ? store.find((row) => String(row.id ?? "") === requestedId) : null;
    if (!existing && requested) {
      existing = store.find((row) => matchesSchoolLookup(row, requested)) ?? null;
    }
    if (!existing && requested && isLegacySchoolCodeFormat(requested)) {
      const error = new Error(
        "Format établissement legacy interdit pour une création (ex. CD-2026-0001). Utiliser le code V2 généré par PostgreSQL.",
      );
      error.statusCode = 400;
      error.code = "SCHOOL_CODE_LEGACY_FORBIDDEN";
      throw error;
    }
    const code =
      existing?.legacySchoolCode ||
      existing?.code ||
      (isInternalSchoolAlias(requested) ? requested : generateInternalSchoolAlias());
    if (!code || code === "*") {
      const error = new Error("Code établissement requis.");
      error.statusCode = 400;
      error.code = "SCHOOL_CODE_INVALID";
      throw error;
    }
    const catalog = [
      ...(Array.isArray(seedData.countries) ? seedData.countries : []),
      ...(Array.isArray(this.backOfficeState?.countries) ? this.backOfficeState.countries : []),
    ];
    const canonical = findCanonicalCountry(catalog, record?.countryCode, record?.country);
    if (!canonical) {
      const error = new Error(COUNTRY_NOT_FOUND_MESSAGE);
      error.statusCode = 400;
      error.code = COUNTRY_NOT_FOUND_CODE;
      throw error;
    }
    const loginCode =
      record?.loginCode ||
      existing?.loginCode ||
      (existing
        ? ""
        : allocateNextSchoolLoginCode(store, {
            countryIso: canonical.code,
            schoolName: record?.name,
          }));
    const school = {
      ...record,
      id: existing?.id || record?.id,
      code,
      publicId: record?.publicId || existing?.publicId || loginCode || code,
      loginCode,
    };
    const index = existing
      ? store.findIndex(
          (row) =>
            (existing.id && String(row.id ?? "") === String(existing.id)) ||
            matchesSchoolLookup(row, existing.code || requested),
        )
      : -1;
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

  async saveIdempotencyRecord({
    cacheId,
    routeKey,
    principalId,
    schoolScope,
    requestHash,
    statusCode,
    responseBody,
    expiresAt,
  }) {
    const id = String(cacheId ?? "");
    const existing = this.idempotencyRecords.get(id);
    const nextHash = String(requestHash ?? "");
    if (existing?.request_hash && existing.request_hash !== nextHash) {
      return;
    }
    this.idempotencyRecords.set(id, {
      cache_id: id,
      route_key: String(routeKey ?? ""),
      principal_id: String(principalId ?? ""),
      school_scope: String(schoolScope ?? "").toUpperCase(),
      request_hash: nextHash,
      status_code: Number(statusCode ?? 200),
      response_body: clone(responseBody ?? {}),
      expires_at: expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  async purgeExpiredIdempotencyRecords() {
    const now = Date.now();
    for (const [id, record] of this.idempotencyRecords.entries()) {
      if (new Date(record.expires_at).getTime() <= now) {
        this.idempotencyRecords.delete(id);
      }
    }
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

  createTransactionalClientsStore(_tx) {
    return this.getClientsStore();
  }

  async withTransaction(fn) {
    const store = this.getClientsStore();
    if (typeof store.withTransaction === "function") {
      return store.withTransaction(() => fn(null));
    }
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

  async getAcademicYearsV2(scope = { mode: "all" }) {
    if (!this._managedAcademicYears) {
      this._managedAcademicYears = this.demoAcademicYears();
    }
    const { filterAcademicYearRows } = require("../lib/academicYearSchoolScope");
    const mapped = this._managedAcademicYears.map((row) => this.mapAcademicYearV2(row));
    return filterAcademicYearRows(mapped, scope);
  }

  async createAcademicYearV2(input = {}) {
    const schoolId = String(input.schoolId ?? "").trim();
    const schoolCode = String(input.schoolCode ?? "").trim().toUpperCase();
    const name = String(input.name ?? "").trim();
    const startDate = String(input.startDate ?? "").trim();
    const endDate = String(input.endDate ?? "").trim();
    if ((!schoolId && !schoolCode) || !name || !startDate || !endDate || startDate >= endDate) {
      const error = new Error("Établissement, nom et dates valides sont requis.");
      error.statusCode = 400;
      throw error;
    }
    await this.getAcademicYearsV2();
    const identity = schoolCode || schoolId;
    if (this._managedAcademicYears.some((row) => row.school_code === identity && row.name.toLowerCase() === name.toLowerCase())) {
      const error = new Error(`L'année scolaire « ${name} » existe déjà pour cet établissement.`);
      error.statusCode = 409;
      throw error;
    }
    const isCurrent = input.isCurrent !== false;
    if (isCurrent) this._managedAcademicYears.forEach((row) => { if (row.school_code === identity || (schoolId && row.school_id === schoolId)) row.is_current = false; });
    const row = {
      id: `AY-${Date.now()}-${this._managedAcademicYears.length}`,
      school_id: schoolId || `school-${identity}`,
      school_code: identity,
      name,
      start_date: startDate,
      end_date: endDate,
      status: "open",
      is_current: isCurrent,
    };
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
          const match = (seedData.platformSchools ?? [seedData.school]).find((row) => {
            const keys = [row.code, row.schoolCode, row.loginCode, row.login_code, row.publicId]
              .map((value) => String(value ?? "").trim().toUpperCase())
              .filter(Boolean);
            return keys.includes(normalized);
          });
          const isPrimary =
            normalized === String(seedData.school.code).toUpperCase() ||
            normalized === String(seedData.school.loginCode ?? "").toUpperCase() ||
            normalized === String(seedData.school.publicId ?? "").toUpperCase();
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
              .map((enrollment) => …9259 tokens truncated…"../lib/teachersManagement");
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

  async listSchoolTeacherAssignments(schoolCode, options = {}) {
    const code = String(schoolCode ?? "").trim().toUpperCase();
    if (!code || code === "*") {
      const { assignmentError } = require("../lib/teacherAssignmentsManagement");
      throw assignmentError(400, "schoolCode établissement requis.", "ASSIGNMENT_SCHOOL_REQUIRED");
    }
    if (Object.hasOwn(options, "teacherId") && !String(options.teacherId ?? "").trim()) {
      return [];
    }
    const teacherId = String(options.teacherId ?? "").trim();
    return clone(
      [
        ...(shouldSeedDemoData() ? seedData.teacherAssignments ?? [] : []).filter(
          (seeded) =>
            !(this._managedTeacherAssignments ?? []).some(
              (managed) => String(managed.id) === String(seeded.id),
            ),
        ),
        ...(this._managedTeacherAssignments ?? []),
      ].filter((row) => {
        const sameSchool = String(row.schoolCode ?? "").trim().toUpperCase() === code;
        if (!sameSchool || String(row.status ?? "active").trim() !== "active") return false;
        if (!teacherId) return true;
        const liveUuid = String(row.teacherUuid ?? row.teacher_id ?? row.internalTeacherId ?? "").trim();
        return Boolean(liveUuid) && liveUuid === teacherId;
      }),
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
      const { studentMatches, studentMatchesClassScope } = require("../lib/financeManagement");
      const { resolveFinanceSchoolScope, schoolRecordInFinanceScope, attachFinanceFixtureScope } = require("../lib/financeSchoolScope");
      const fixtureSchoolRecord = (row) => {
        const schoolCode = String(row?.schoolCode || row?.school_code || "").trim();
        if (!schoolCode) return row;
        return { ...row, login_code: schoolCode, loginCode: schoolCode };
      };
      this._financeStore = createFinanceMemoryStore({
        getSchoolByCode: async (code) => {
          const normalized = String(code ?? "").trim().toUpperCase();
          return (
            this._establishmentStore().find((row) => {
              const keys = [row.loginCode, row.login_code, row.publicId, row.code, row.schoolCode, row.school_code]
                .map((value) => String(value ?? "").trim().toUpperCase())
                .filter(Boolean);
              return keys.includes(normalized);
            }) || null
          );
        },
        findStudent: async (studentKey, principal) => {
          const dataset = await this.getDataset();
          const scope = resolveFinanceSchoolScope(attachFinanceFixtureScope(principal));
          if (scope.mode === "none") return null;
          const student =
            (dataset.students ?? []).find((row) => {
              if (principal && !schoolRecordInFinanceScope(fixtureSchoolRecord(row), scope)) {
                return false;
              }
              return studentMatches(row, studentKey);
            }) || null;
          if (!student) return null;
          return {
            ...student,
            academicYear: student.academicYear || student.academicYearName || student.schoolYear || "",
          };
        },
        listStudentsInClass: async (schoolCode, classRef) => {
          const dataset = await this.getDataset();
          const requested = String(schoolCode ?? "").trim().toUpperCase();
          const school = this._establishmentStore().find((row) => {
            const keys = [row.loginCode, row.login_code, row.publicId, row.code, row.schoolCode, row.school_code]
              .map((value) => String(value ?? "").trim().toUpperCase())
              .filter(Boolean);
            return keys.includes(requested);
          });
          const aliases = new Set(
            [
              requested,
              school?.loginCode,
              school?.login_code,
              school?.publicId,
              school?.code,
              school?.schoolCode,
              school?.school_code,
            ]
              .map((value) => String(value ?? "").trim().toUpperCase())
              .filter(Boolean),
          );
          return (dataset.students ?? [])
            .filter(
              (student) =>
                aliases.has(String(student.schoolCode ?? "").toUpperCase()) &&
                studentMatchesClassScope(student, classRef),
            )
            .map((student) => ({
              ...student,
              academicYear: student.academicYear || student.academicYearName || student.schoolYear || "",
            }));
        },
        listSchoolStudents: async (principal) => {
          const dataset = await this.getDataset();
          const scope = resolveFinanceSchoolScope(attachFinanceFixtureScope(principal));
          if (scope.mode === "none") return [];
          return (dataset.students ?? []).filter((student) =>
            schoolRecordInFinanceScope(fixtureSchoolRecord(student), scope),
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

  listFinancePaymentStatuses(principal) {
    return this.getFinanceStore().listFinancePaymentStatuses(principal);
  }

  upsertFinancePaymentStatus(payload, principal) {
    return this.getFinanceStore().upsertFinancePaymentStatus(payload, principal);
  }

  listFinanceFeeGrids(principal) {
    return this.getFinanceStore().listFinanceFeeGrids(principal);
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

  ensureEnrollmentObligations(input, principal, auditMeta) {
    return this.getFinanceStore().ensureEnrollmentObligations(input, principal, auditMeta);
  }

  listFinanceStudentFees(principal) {
    return this.getFinanceStore().listFinanceStudentFees(principal);
  }

  reconcileFinancePaymentAllocations(principal, options, auditMeta) {
    return this.getFinanceStore().reconcileFinancePaymentAllocations(principal, options, auditMeta);
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

  listPaymentStudentOptions(principal) {
    return this.getFinanceStore().listPaymentStudentOptions(principal);
  }

  listSchoolPaymentMethods(principal) {
    return this.getFinanceStore().listSchoolPaymentMethods(principal);
  }

  replaceSchoolPaymentMethods(methods, principal) {
    return this.getFinanceStore().replaceSchoolPaymentMethods(methods, principal);
  }

  listCatalogFeeTypes(principal) {
    return this.getFinanceStore().listCatalogFeeTypes(principal);
  }

  getFinanceCatalog(principal) {
    return this.getFinanceStore().getFinanceCatalog(principal);
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
            const keys = [row.code, row.schoolCode, row.school_code, row.loginCode, row.login_code, row.publicId]
              .map((value) => String(value ?? "").toUpperCase())
              .filter(Boolean);
            return (
              (schoolCode && keys.includes(String(schoolCode).toUpperCase())) ||
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
      if (shouldSeedDemoData()) {
        const { backfillMemoryUserRolesFromSeedAccounts } = require("../lib/memoryUserRolesBackfill");
        backfillMemoryUserRolesFromSeedAccounts(store._tables, seedData.userAccounts);
      }
      this._clientsStore = store;
    }
    return this._clientsStore;
  }

  getMobilePushStore() {
    if (!this._mobilePushStore) {
      const { createMemoryMobilePushDevicesStore } = require("./mobilePushDevicesStore");
      this._mobilePushStore = createMemoryMobilePushDevicesStore();
    }
    return this._mobilePushStore;
  }

  upsertMobilePushDevice(principal, payload) {
    const service = require("../lib/mobilePushDevicesService");
    return service.upsertFromSession(this.getMobilePushStore(), principal, payload);
  }

  revokeCurrentMobilePushDevice(principal, payload) {
    const service = require("../lib/mobilePushDevicesService");
    return service.revokeCurrentFromSession(this.getMobilePushStore(), principal, payload);
  }

  sendMobilePushSelfTest(principal, payload) {
    const { createExpoPushService } = require("../lib/expoPushService");
    const service = require("../lib/mobilePushDevicesService");
    const store = this.getMobilePushStore();
    const pushClient = createExpoPushService({ store });
    return service.sendSelfTest(store, principal, payload, pushClient);
  }

  listClientsProjection() {
    return Promise.resolve(this.getClientsStore().listProjection());
  }

  listClientsUsers(scope) {
    return Promise.resolve(this.getClientsStore().listUsers(scope));
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

  listActiveUserRoleKeysForSchool(userId, schoolId) {
    const uid = String(userId ?? "").trim();
    const sid = String(schoolId ?? "").trim();
    if (!uid || !sid) return Promise.resolve([]);
    const store = this.getClientsStore();
    const bound = store?.bind ? store.bind() : store;
    if (typeof bound?.listActiveUserRoleKeysForSchool !== "function") {
      return Promise.resolve([]);
    }
    return bound.listActiveUserRoleKeysForSchool(uid, sid);
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

  markClientsMessageRead(messageId, principal, auditMeta, query) {
    return this.getClientsStore().markMessageRead(messageId, principal, auditMeta, query);
  }

  listClientsMessages(principal, query) {
    return this.getClientsStore().listMessagesForPrincipal(principal, query);
  }

  listClientConversations(principal, query) {
    return this.getClientsStore().listConversationsForPrincipal(principal, query);
  }

  getClientConversation(conversationId, principal, query) {
    return this.getClientsStore().getConversationForPrincipal(conversationId, principal, query);
  }

  listClientConversationMessages(conversationId, principal, query) {
    return this.getClientsStore().listConversationMessagesForPrincipal(conversationId, principal, query);
  }

  getClientMessage(messageId, principal, query) {
    return this.getClientsStore().getMessageForPrincipal(messageId, principal, query);
  }

  createClientConversation(payload, principal, auditMeta) {
    return this.getClientsStore().createConversationForPrincipal(payload, principal, auditMeta);
  }

  replyClientConversationMessage(conversationId, payload, principal, auditMeta) {
    return this.getClientsStore().replyToConversationForPrincipal(conversationId, payload, principal, auditMeta);
  }

  getClientMessagesUnreadCount(principal, query) {
    return this.getClientsStore().unreadCountForPrincipal(principal, query);
  }

  listClientMessageRecipients(principal, query) {
    return this.getClientsStore().listMessageRecipientsForPrincipal(principal, query);
  }

  uploadCommunicationAttachment(principal, file, query) {
    return this.getClientsStore().uploadCommunicationAttachment(principal, file, query);
  }

  downloadCommunicationAttachment(attachmentId, principal, query) {
    return this.getClientsStore().downloadCommunicationAttachment(attachmentId, principal, query);
  }

  createClientsAnnouncement(payload, principal, auditMeta) {
    return this.getClientsStore().createAnnouncement(payload, principal, auditMeta);
  }

  updateClientsAnnouncement(id, patch, principal, auditMeta) {
    return this.getClientsStore().updateAnnouncement(id, patch, principal, auditMeta);
  }

  archiveClientsAnnouncement(id, principal, auditMeta, query) {
    return this.getClientsStore().archiveAnnouncement(id, principal, auditMeta, query);
  }

  listClientsAnnouncements(principal, query) {
    return this.getClientsStore().listAnnouncementsForPrincipal(principal, query);
  }

  getClientsAnnouncement(id, principal, query) {
    return this.getClientsStore().getAnnouncementForPrincipal(id, principal, query);
  }

  markClientsAnnouncementRead(id, principal, auditMeta, query) {
    return this.getClientsStore().markAnnouncementRead(id, principal, auditMeta, query);
  }

  getClientsAnnouncementsUnreadCount(principal, query) {
    return this.getClientsStore().unreadAnnouncementCountForPrincipal(principal, query);
  }

  listAnnouncementAudienceOptions(principal, query) {
    return this.getClientsStore().announcementAudienceOptionsForPrincipal(principal, query);
  }

  uploadAnnouncementAttachment(principal, file, query) {
    return this.getClientsStore().uploadAnnouncementAttachment(principal, file, query);
  }

  getPlatformAnnouncementsUnreadCount(principal) {
    return this.getClientsStore().unreadPlatformAnnouncementCountForPrincipal(principal);
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
