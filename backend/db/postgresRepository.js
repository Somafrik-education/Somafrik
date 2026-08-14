const { applySystemActivePeriod } = require("../lib/academicPeriods");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { shouldSeedDemoData } = require("../lib/demoSeedPolicy");
const seedData = require("../data");
const { createTxAdapter } = require("./txAdapter");
const { mapAssignment } = require("./teacherAssignmentsRepository");

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
    hasTemporaryPassword: true,
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
    await this.query(schema);
    await this.ensureSchoolsCanonicalColumns();
    await this.ensureAttendanceCanonicalUniqueness();
    await this.ensureNotesCanonicalPersistence();
    await this.ensureClassesDomainConstraints();
    await this.ensureTeachersDomainConstraints();
    await this.ensureUsersLoginIdentityConstraints();
    await this.ensureFinanceCanonicalSchema();
    await this.ensurePedagogyCanonicalSchema();
    await this.ensurePlatformCanonicalSchema();
    await this.ensureClientsCanonicalSchema();
    await this.ensureResidualCanonicalSchema();
    if (shouldSeedDemoData()) {
      await this.seedIfEmpty();
      await this.ensurePlatformReferenceData();
      await this.ensureStudentUsers();
      await this.ensureDemoWebAccounts();
      await this.ensureV2Data();
    }
    this.ready = true;
  }

  /**
   * D3.6b — Ordre : schéma déjà appliqué → inventaire/migration JSON → dédup → UNIQUE.
   */
  async ensureNotesCanonicalPersistence() {
    // Ordre D3.6b : inventaire/rattachement → anomalies → dédup → UNIQUE → normalisation → contraintes.
    await this.migrateEvaluationsFromBackOffice();
    await this.migrateNotesFromBackOffice();
    await this.ensureGradeCanonicalUniqueness();
    await this.normalizeLegacyGradeContractRows();
    await this.ensureGradeContractConstraints();
  }

  /**
   * Normalise les lignes legacy incohérentes avant application des CHECK.
   * Sans cette étape, ensureGradeContractConstraints doit échouer (fail-fast).
   */
  async normalizeLegacyGradeContractRows() {
    await this.query(
      `UPDATE grades
       SET version = 1
       WHERE version IS NULL OR version < 1`,
    );
    await this.query(
      `UPDATE grades
       SET grade_status = CASE
         WHEN score IS NOT NULL THEN 'graded'
         ELSE 'not_submitted'
       END
       WHERE grade_status IS NULL
          OR grade_status NOT IN ('graded', 'absent', 'excused', 'not_submitted', 'exempt')`,
    );
    await this.query(
      `UPDATE grades
       SET grade_status = 'not_submitted', score = NULL
       WHERE grade_status = 'graded' AND score IS NULL`,
    );
    await this.query(
      `UPDATE grades
       SET grade_status = 'graded'
       WHERE grade_status <> 'graded' AND score IS NOT NULL`,
    );
    await this.query(
      `UPDATE evaluations
       SET status = 'draft'
       WHERE status IS NULL
          OR status NOT IN ('draft', 'open', 'locked', 'published', 'archived')`,
    );
  }

  async ensureGradeContractConstraints() {
    // duplicate_object géré en SQL (idempotence). Toute autre erreur remonte et bloque init.
    const statements = [
      `DO $$ BEGIN
         ALTER TABLE evaluations
           ADD CONSTRAINT evaluations_status_check
           CHECK (status IN ('draft', 'open', 'locked', 'published', 'archived'));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
         ALTER TABLE grades
           ADD CONSTRAINT grades_version_positive CHECK (version >= 1);
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
         ALTER TABLE grades
           ADD CONSTRAINT grades_status_check
           CHECK (grade_status IN ('graded', 'absent', 'excused', 'not_submitted', 'exempt'));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
         ALTER TABLE grades
           ADD CONSTRAINT grades_status_score_coherence
           CHECK (
             (grade_status = 'graded' AND score IS NOT NULL)
             OR (grade_status <> 'graded' AND score IS NULL)
           );
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    ];
    for (const sql of statements) {
      await this.query(sql);
    }
  }

  async query(sql, params = []) {
    return this.pool.query(sql, params);
  }

  /**
   * Proxy transactionnel : les méthodes du dépôt utilisent le client tx passé explicitement.
   * @param {ReturnType<typeof createTxAdapter>} tx
   */
  createTxScope(tx) {
    if (!tx || typeof tx.query !== "function") {
      return this;
    }
    const self = this;
    // Bind methods to the Proxy (receiver), not the raw repository: otherwise
    // internal this.query / this.one / this.all bypass tx and hit the pool.
    return new Proxy(self, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return (sql, params) => tx.query(sql, params);
        }
        if (prop === "one") {
          return (sql, params) => tx.one(sql, params);
        }
        if (prop === "all") {
          return (sql, params) => tx.all(sql, params);
        }
        if (prop === "withTransaction") {
          return async (fn) => fn(tx);
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return value.bind(receiver);
        }
        return value;
      },
    });
  }

  async withTransaction(fn) {
    const client = await this.pool.connect();
    const tx = createTxAdapter(client);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_rollbackError) {
        // conserve l'erreur métier d'origine
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureGradeCanonicalUniqueness() {
    const {
      COUNT_GRADE_DUPLICATE_GROUPS_SQL,
      DEDUP_GRADES_KEEP_LATEST_SQL,
      CREATE_GRADE_UNIQUE_INDEX_SQL,
      COUNT_GRADE_ANOMALIES_SQL,
    } = require("../lib/gradeUniqueness");

    const anomalies = await this.one(COUNT_GRADE_ANOMALIES_SQL);
    const anomalyCount = Number(anomalies?.anomaly_count ?? 0);
    if (anomalyCount > 0) {
      console.warn(
        `[D3.6b] Notes : ${anomalyCount} anomalie(s) sans evaluation_id résoluble — non fusionnées silencieusement`,
      );
    }

    const before = await this.one(COUNT_GRADE_DUPLICATE_GROUPS_SQL);
    const duplicateGroups = Number(before?.duplicate_groups ?? 0);
    if (duplicateGroups > 0) {
      console.warn(
        `[D3.6b] Notes : ${duplicateGroups} groupe(s) en doublon — conservation version/updated_at/created_at/id DESC`,
      );
      await this.query(DEDUP_GRADES_KEEP_LATEST_SQL);
    }

    const after = await this.one(COUNT_GRADE_DUPLICATE_GROUPS_SQL);
    if (Number(after?.duplicate_groups ?? 0) > 0) {
      throw new Error(
        "D3.6b : des doublons grades persistent après déduplication — index unique non créé.",
      );
    }

    await this.query(CREATE_GRADE_UNIQUE_INDEX_SQL);
  }

  async migrateEvaluationsFromBackOffice() {
    const {
      toEvaluationStatus,
      validateEvaluationContract,
    } = require("../lib/gradesCanonical");
    const row = await this.one("SELECT state_payload FROM backoffice_state WHERE state_key = 'default'");
    const state = row?.state_payload ?? {};
    const evaluations = Array.isArray(state.evaluations) ? state.evaluations : [];
    for (const evaluation of evaluations) {
      try {
        await this.upsertEvaluationFromLegacy(evaluation, { skipCacheClear: true });
      } catch (error) {
        const contractError = validateEvaluationContract({
          maxScore: evaluation.scale ?? evaluation.max_score ?? 20,
          coefficient: evaluation.coefficient ?? 1,
          status: toEvaluationStatus(evaluation.status, "draft"),
        });
        console.warn(
          `[D3.6b] Évaluation legacy non migrée (${evaluation.id ?? "?"}): ${error.message || contractError || "erreur"}`,
        );
      }
    }
  }

  async migrateNotesFromBackOffice() {
    const { toGradeStatus } = require("../lib/gradesCanonical");
    const row = await this.one("SELECT state_payload FROM backoffice_state WHERE state_key = 'default'");
    const state = row?.state_payload ?? {};
    const notes = Array.isArray(state.notes) ? state.notes : [];
    let anomalyCount = 0;
    for (const note of notes) {
      const evaluationId = String(note.evaluationId ?? "").trim();
      if (!evaluationId) {
        anomalyCount += 1;
        console.warn(`[D3.6b] Anomalie note sans evaluation_id: ${note.id ?? note.studentId ?? "?"}`);
        continue;
      }
      const evaluation = await this.resolveEvaluationRow(evaluationId, note.schoolCode, {
        allowGlobalLegacyFallback: true,
      });
      if (!evaluation) {
        anomalyCount += 1;
        console.warn(
          `[D3.6b] Anomalie note evaluation_id non résoluble: ${note.id ?? "?"} → ${evaluationId}`,
        );
        continue;
      }
      const student = await this.one(
        `SELECT st.id FROM students st
         WHERE st.school_id = $1 AND (st.student_code = $2 OR st.id::text = $2)
         LIMIT 1`,
        [evaluation.school_id, String(note.studentId ?? "")],
      );
      if (!student) {
        anomalyCount += 1;
        console.warn(`[D3.6b] Anomalie note élève introuvable: ${note.studentId ?? "?"}`);
        continue;
      }
      const already = await this.one(
        `SELECT id FROM grades
         WHERE school_id = $1 AND evaluation_id = $2 AND student_id = $3
         LIMIT 1`,
        [evaluation.school_id, evaluation.id, student.id],
      );
      // Idempotent : ne pas re-upsert (évite bump version à chaque démarrage).
      if (already) continue;
      try {
        await this.upsertGrade(
          {
            ...note,
            evaluationId: evaluation.legacy_json_id || evaluation.id,
            gradeStatus: toGradeStatus(note.gradeStatus ?? note.status, note.value != null),
            scale: note.scale ?? evaluation.max_score,
            evaluationCoefficient: note.evaluationCoefficient ?? evaluation.coefficient,
          },
          { role: "Admin School", sub: note.authorId },
          { allowMissingTeacher: true, skipCacheClear: true },
        );
      } catch (error) {
        anomalyCount += 1;
        console.warn(`[D3.6b] Anomalie migration note ${note.id ?? "?"}: ${error.message}`);
      }
    }
    if (anomalyCount > 0) {
      console.warn(`[D3.6b] Migration notes: ${anomalyCount} anomalie(s) explicite(s)`);
    }
  }

  /**
   * D3.5b — Pour bases legacy : compter → dédup déterministe → index unique.
   * L'index n'est PAS créé dans schema.sql (évite l'échec avant dédup).
   */
  async ensureAttendanceCanonicalUniqueness() {
    const {
      COUNT_ATTENDANCE_DUPLICATE_GROUPS_SQL,
      DEDUP_ATTENDANCE_KEEP_LATEST_SQL,
      CREATE_ATTENDANCE_UNIQUE_INDEX_SQL,
    } = require("../lib/attendanceUniqueness");

    const before = await this.one(COUNT_ATTENDANCE_DUPLICATE_GROUPS_SQL);
    const duplicateGroups = Number(before?.duplicate_groups ?? 0);
    if (duplicateGroups > 0) {
      console.warn(
        `[D3.5b] Présences : ${duplicateGroups} groupe(s) en doublon — conservation updated_at/created_at/id DESC`,
      );
      await this.query(DEDUP_ATTENDANCE_KEEP_LATEST_SQL);
    }

    const after = await this.one(COUNT_ATTENDANCE_DUPLICATE_GROUPS_SQL);
    if (Number(after?.duplicate_groups ?? 0) > 0) {
      throw new Error(
        "D3.5b : des doublons attendance persistent après déduplication — index unique non créé.",
      );
    }

    await this.query(CREATE_ATTENDANCE_UNIQUE_INDEX_SQL);
  }

  /**
   * Classes — unicité atomique (école + année + nom normalisé) + statut active|inactive.
   * Ordre : normaliser statuts → détecter doublons (fail-safe) → index unique → CHECK.
   * Interdit : suppression silencieuse des classes en doublon.
   */
  async ensureClassesDomainConstraints() {
    const {
      COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
      LIST_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
      CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
      ENSURE_CLASSES_STATUS_CHECK_SQL,
      NORMALIZE_CLASSES_STATUS_SQL,
      formatClassesNameDuplicateDiagnostic,
    } = require("../lib/classesUniqueness");

    await this.query(NORMALIZE_CLASSES_STATUS_SQL);

    const before = await this.one(COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL);
    const duplicateGroups = Number(before?.duplicate_groups ?? 0);
    if (duplicateGroups > 0) {
      const groups = await this.all(LIST_CLASSES_NAME_DUPLICATE_GROUPS_SQL);
      throw new Error(formatClassesNameDuplicateDiagnostic(groups, duplicateGroups));
    }

    await this.query(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL);
    await this.query(ENSURE_CLASSES_STATUS_CHECK_SQL);
  }

  /**
   * Teachers — unicité atomique (school_id, user_id) pour fiche canonique liée.
   * Ordre : inventaire doublons read-only (fail-safe) → index unique partiel → re-vérification.
   * Interdit : suppression / fusion / choix automatique de canon.
   */
  async ensureFinanceCanonicalSchema() {
    const { FINANCE_SCHEMA_SQL } = require("./financeSchema");
    await this.query(FINANCE_SCHEMA_SQL);
  }

  async ensurePedagogyCanonicalSchema() {
    const { PEDAGOGY_SCHEMA_SQL } = require("./pedagogySchema");
    await this.query(PEDAGOGY_SCHEMA_SQL);
  }

  async ensurePlatformCanonicalSchema() {
    const { PLATFORM_SCHEMA_SQL, assertPlatformSchemaPreflight } = require("./platformSchema");
    await assertPlatformSchemaPreflight(this);
    await this.query(PLATFORM_SCHEMA_SQL);
  }

  async ensureClientsCanonicalSchema() {
    const { CLIENTS_SCHEMA_SQL } = require("./clientsSchema");
    await this.query(CLIENTS_SCHEMA_SQL);
  }

  async ensureResidualCanonicalSchema() {
    const { RESIDUAL_STATE_SCHEMA_SQL } = require("./residualStateSchema");
    await this.query(RESIDUAL_STATE_SCHEMA_SQL);
  }

  getResidualStore() {
    if (!this._residualStore) {
      const { createResidualPgStore } = require("./residualPgStore");
      this._residualStore = createResidualPgStore(this);
    }
    return this._residualStore;
  }

  listResidualProjection() {
    return this.getResidualStore().listProjection();
  }

  replaceResidualExams(schoolCode, items, principal, auditMeta) {
    return this.withResidualReplace("exam", schoolCode, items, principal, auditMeta);
  }

  replaceResidualBulletins(schoolCode, items, principal, auditMeta) {
    return this.withResidualReplace("bulletin", schoolCode, items, principal, auditMeta);
  }

  replaceResidualDocuments(schoolCode, items, principal, auditMeta) {
    return this.withResidualReplace("document", schoolCode, items, principal, auditMeta);
  }

  async withResidualReplace(domain, schoolCode, items, principal, auditMeta) {
    const { recordResidualReplace } = require("../lib/residualStateManagement");
    return recordResidualReplace(this, domain, schoolCode, items, principal, auditMeta);
  }

  getPlatformStore() {
    if (!this._platformStore) {
      const { createPlatformPgStore } = require("./platformPgStore");
      this._platformStore = createPlatformPgStore(this);
    }
    return this._platformStore;
  }

  listPlatformProjection() {
    return this.getPlatformStore().listProjection();
  }

  getPlatformSchoolByCode(code) {
    return this.getPlatformStore().getSchoolByCode(code);
  }

  getRolePermissionsMap() {
    return this.getPlatformStore().getRolePermissionsMap();
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
      const { createClientsPgStore } = require("./clientsPgStore");
      this._clientsStore = createClientsPgStore(this);
    }
    return this._clientsStore;
  }

  listClientsProjection() {
    return this.getClientsStore().listProjection();
  }

  async listClientsAuthAccounts() {
    await this.init();
    const rows = await this.all(
      `SELECT u.*, s.school_code, c.iso_code AS country_code, c.name AS country_name
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN countries c ON c.id = s.country_id
       WHERE COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')`,
    );
    const schoolRows = await this.all(`
      SELECT s.*, c.name AS country_name, c.iso_code
      FROM schools s
      LEFT JOIN countries c ON c.id = s.country_id
    `);
    const schoolByCode = new Map(schoolRows.map((school) => [school.school_code, school]));
    return rows.map((row) => this.mapUser(row, schoolByCode));
  }

  createClientsUser(payload, principal, auditMeta) {
    this.cachedDataset = null;
    return this.getClientsStore().createUser(payload, principal, auditMeta);
  }

  updateClientsUser(id, patch, principal, auditMeta) {
    this.cachedDataset = null;
    return this.getClientsStore().updateUser(id, patch, principal, auditMeta);
  }

  createClientsContact(payload, principal, auditMeta) {
    return this.getClientsStore().createContact(payload, principal, auditMeta);
  }

  updateClientsContact(id, patch, principal, auditMeta) {
    return this.getClientsStore().updateContact(id, patch, principal, auditMeta);
  }

  provisionClientsContactAccount(contactId, payload, principal, auditMeta) {
    this.cachedDataset = null;
    return this.getClientsStore().provisionContactAccount(contactId, payload, principal, auditMeta);
  }

  createClientsRelation(payload, principal, auditMeta) {
    return this.getClientsStore().createRelation(payload, principal, auditMeta);
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

  getPedagogyStore() {
    if (!this._pedagogyStore) {
      const { createPedagogyPgStore } = require("./pedagogyPgStore");
      this._pedagogyStore = createPedagogyPgStore(this);
    }
    return this._pedagogyStore;
  }

  listPedagogyProjection() {
    return this.getPedagogyStore().listProjection();
  }

  createSchoolCourse(payload, principal, auditMeta) {
    return this.getPedagogyStore().createSchoolCourse(payload, principal, auditMeta);
  }

  updateSchoolCourse(id, patch, principal, auditMeta) {
    return this.getPedagogyStore().updateSchoolCourse(id, patch, principal, auditMeta);
  }

  deleteSchoolCourse(id, principal, auditMeta) {
    return this.getPedagogyStore().deleteSchoolCourse(id, principal, auditMeta);
  }

  getSchoolCourse(id, principal) {
    return this.getPedagogyStore().getSchoolCourse(id, principal);
  }

  createCourseSchedule(payload, principal, auditMeta) {
    return this.getPedagogyStore().createCourseSchedule(payload, principal, auditMeta);
  }

  updateCourseSchedule(id, patch, principal, auditMeta) {
    return this.getPedagogyStore().updateCourseSchedule(id, patch, principal, auditMeta);
  }

  deleteCourseSchedule(id, principal, auditMeta) {
    return this.getPedagogyStore().deleteCourseSchedule(id, principal, auditMeta);
  }

  getCourseSchedule(id, principal) {
    return this.getPedagogyStore().getCourseSchedule(id, principal);
  }

  createSchoolEvaluation(payload, principal, auditMeta) {
    return this.getPedagogyStore().createEvaluation(payload, principal, auditMeta);
  }

  updateSchoolEvaluation(id, patch, principal, auditMeta) {
    return this.getPedagogyStore().updateEvaluation(id, patch, principal, auditMeta);
  }

  upsertSchoolGrade(payload, principal, auditMeta) {
    return this.getPedagogyStore().upsertSchoolGrade(payload, principal, auditMeta);
  }

  upsertSchoolAttendanceBatch(payload, principal, auditMeta) {
    return this.getPedagogyStore().upsertSchoolAttendanceBatch(payload, principal, auditMeta);
  }

  getFinanceStore() {
    if (!this._financeStore) {
      const { createFinancePgStore } = require("./financePgStore");
      this._financeStore = createFinancePgStore(this);
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

  async ensureUsersLoginIdentityConstraints() {
    const { ensureUsersLoginIdentityConstraints } = require("../lib/usersLoginIdentity");
    await ensureUsersLoginIdentityConstraints(
      {
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
      },
      console,
    );
  }

  async ensureTeachersDomainConstraints() {
    const { ensureTeachersDomainConstraints } = require("../lib/teachersUniqueness");
    await ensureTeachersDomainConstraints(
      {
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
      },
      console,
    );
  }

  /**
   * LOT 1 — colonnes canoniques établissements (idempotent pour bases déjà créées).
   */
  async ensureSchoolsCanonicalColumns() {
    await this.query(
      `ALTER TABLE schools ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );
    await this.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
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
      evaluationRows,
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
        SELECT t.*, s.school_code, u.first_name, u.last_name, u.email, u.phone,
               u.password_hash, u.pin_hash, u.birth_date, u.gender, u.must_change_password
        FROM teachers t
        JOIN schools s ON s.id = t.school_id
        LEFT JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at, t.teacher_code
      `),
      this.all(`
        SELECT ta.id, ta.school_id, ta.teacher_id, ta.class_id, ta.subject_id,
               ta.academic_year_id, ta.assignment_role, ta.status,
               ta.created_at, ta.updated_at,
               s.school_code, t.teacher_code, u.first_name, u.last_name,
               cl.class_code, cl.name AS class_name,
               sub.subject_code, sub.name AS subject_name,
               ay.name AS academic_year_name
        FROM teacher_assignments ta
        JOIN schools s ON s.id = ta.school_id
        JOIN teachers t ON t.id = ta.teacher_id
        LEFT JOIN users u ON u.id = t.user_id
        JOIN classes cl ON cl.id = ta.class_id
        JOIN subjects sub ON sub.id = ta.subject_id
        JOIN academic_years ay ON ay.id = ta.academic_year_id
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
        SELECT ev.*, s.school_code, cl.name AS class_name, sub.name AS subject_name,
               t.teacher_code, term.name AS term_name
        FROM evaluations ev
        JOIN schools s ON s.id = ev.school_id
        JOIN classes cl ON cl.id = ev.class_id
        JOIN subjects sub ON sub.id = ev.subject_id
        JOIN terms term ON term.id = ev.term_id
        LEFT JOIN teachers t ON t.id = ev.teacher_id
        ORDER BY ev.created_at
      `),
      this.all(`
        SELECT g.*, st.student_code, s.school_code, cl.class_code, cl.name AS class_name, sub.name AS subject_name,
               sub.coefficient AS subject_coefficient, t.teacher_code, term.name AS term_name,
               ev.id AS evaluation_uuid, ev.legacy_json_id AS evaluation_legacy_id,
               ev.title AS evaluation_title, ev.status AS evaluation_status,
               ev.max_score AS evaluation_max_score, ev.coefficient AS evaluation_coefficient,
               ev.evaluation_type AS evaluation_type_pg
        FROM grades g
        JOIN schools s ON s.id = g.school_id
        JOIN students st ON st.id = g.student_id
        JOIN classes cl ON cl.id = g.class_id
        JOIN subjects sub ON sub.id = g.subject_id
        JOIN teachers t ON t.id = g.teacher_id
        JOIN terms term ON term.id = g.term_id
        LEFT JOIN evaluations ev ON ev.id = g.evaluation_id
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
    const evaluations = evaluationRows.map((evaluation) => this.mapEvaluation(evaluation));
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
      teacherAssignments: teacherAssignmentRows.map(mapAssignment),
      classes,
      courses,
      students,
      evaluations,
      notes,
      presences: attendanceRows.map((attendance) => this.mapAttendance(attendance)),
      payments,
      announcements: announcementRows.map((announcement) => this.mapAnnouncement(announcement)),
      platformNotifications: notificationRows.map((notification) => this.mapNotification(notification)),
    };

    return this.cachedDataset;
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async one(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0];
  }

  async close() {
    await this.pool.end();
  }

  async createSession({ sessionId, refreshTokenHash, userId, schoolCode, role, expiresAt, ipAddress, userAgent }) {
    await this.init();
    const school = schoolCode && schoolCode !== "*" ? await this.getSchoolByCode(schoolCode) : null;
    const dbUserId = await this.resolveDbUserId(userId);
    await this.query(
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
    await this.query(
      "UPDATE sessions SET revoked_at = NOW(), revoke_reason = $2 WHERE session_code = $1 AND revoked_at IS NULL",
      [sessionId, reason]
    );
  }

  async recordAudit(
    { schoolCode, userId, action, entityType, entityId, oldValue, newValue, ipAddress, userAgent },
    tx = null,
  ) {
    await this.init();
    const executor = tx && typeof tx.query === "function" ? tx : this;
    const school = schoolCode && schoolCode !== "*" ? await this.getSchoolByCode(schoolCode) : null;
    const dbUserId = await this.resolveDbUserId(userId);
    await executor.query(
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
      ],
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
    // LOT 8 — plus de lecture du snapshot JSON global.
    return null;
  }

  async saveBackOfficeState(_payload) {
    // LOT 8 — écriture snapshot interdite ; compatibilité tests internes uniquement.
    const { createBackOfficeStateWriteRemovedError } = require("../lib/backofficeStateRemoval");
    throw createBackOfficeStateWriteRemovedError();
  }

  async getAcademicConfig(schoolCode) {
    await this.init();
    return this.getResidualStore().getAcademicConfig(schoolCode);
  }

  async saveAcademicConfig(schoolCode, config, tx = null) {
    await this.init();
    return this.getResidualStore().saveAcademicConfig(schoolCode, config, tx);
  }

  async touchUserLastLogin(lookupKeys = []) {
    await this.init();
    const keys = (Array.isArray(lookupKeys) ? lookupKeys : [lookupKeys])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    for (const key of keys) {
      await this.query(
        `UPDATE users
         SET last_login_at = NOW(), updated_at = NOW()
         WHERE id::text = $1 OR user_code = $1`,
        [key],
      );
    }
    this.cachedDataset = null;
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

    const error = new Error("Utilisateur introuvable");
    error.statusCode = 404;
    throw error;
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

    const error = new Error("Utilisateur introuvable");
    error.statusCode = 404;
    throw error;
  }

  /**
   * D3.6b — Upsert note canonique : clé (school_id, evaluation_id, student_id) + version.
   */
  async upsertGrade(payload, principal = {}, options = {}) {
    const {
      toGradeStatus,
      validateGradeContract,
      fromGradeStatus,
    } = require("../lib/gradesCanonical");
    const { assertNoteOptimisticLock, noteVersion } = require("../lib/noteConcurrency");

    const evaluationKey = String(payload.evaluationId ?? "").trim();
    if (!evaluationKey) {
      const error = new Error("evaluation_id obligatoire pour une note");
      error.statusCode = 400;
      throw error;
    }

    const evaluation = await this.resolveEvaluationRow(evaluationKey, payload.schoolCode);
    if (!evaluation) {
      const error = new Error("Evaluation introuvable");
      error.statusCode = 404;
      throw error;
    }

    const gradeStatus = toGradeStatus(
      payload.gradeStatus ?? payload.status,
      payload.value != null && payload.value !== "",
    );
    const maxScore = Number(payload.scale ?? evaluation.max_score ?? 20);
    const coefficient = Number(
      payload.evaluationCoefficient ?? evaluation.coefficient ?? payload.coefficient ?? 1,
    );
    const scoreRaw = gradeStatus === "graded" ? payload.value ?? payload.score : null;
    const contractError = validateGradeContract({
      status: gradeStatus,
      score: scoreRaw,
      maxScore,
      coefficient,
    });
    if (contractError) {
      const error = new Error(contractError);
      error.statusCode = 400;
      throw error;
    }
    const score = gradeStatus === "graded" ? Number(scoreRaw) : null;

    // HOTFIX-PRE-E1-01 : résolution par identifiants stables (+ matérialisation BO), jamais par nom.
    const evaluationSchool = await this.one(`SELECT school_code FROM schools WHERE id = $1`, [
      evaluation.school_id,
    ]);
    const principalSchool = String(principal?.schoolCode ?? "")
      .trim()
      .toUpperCase();
    const lookupSchoolCode =
      principalSchool && principalSchool !== "*"
        ? principalSchool
        : String(evaluationSchool?.school_code ?? "").trim().toUpperCase();
    const student = await this.resolveStudentForGrade(payload.studentId, lookupSchoolCode);
    if (!student) {
      const error = new Error("Eleve introuvable");
      error.statusCode = 404;
      throw error;
    }
    if (String(student.school_id) !== String(evaluation.school_id)) {
      const error = new Error("L'élève et l'évaluation doivent appartenir au même établissement.");
      error.statusCode = 400;
      throw error;
    }

    // HOTFIX-PRE-E1-02 : gardes enseignant — établissement + classe + matière/affectation.
    // Ne pas affaiblir le RBAC.
    // Audit causalité (SOMAFRIK_AUTHZ_TRACE=1) : tracer la source réelle d'autorisation.
    const {
      isEnabled: authzTraceEnabled,
      createNotesAuthzTrace,
      pushStep,
      finalizeTrace,
      persistTrace,
    } = require("../lib/notesAuthzTrace");
    const authzTrace = authzTraceEnabled()
      ? createNotesAuthzTrace({ principal, payload })
      : null;
    this._activeNotesAuthzTrace = authzTrace;
    let classAccessVia = null;
    let evaluationAccessVia = null;
    if (principal.role === "Enseignant" && !options.allowMissingTeacher) {
      const principalSchool = String(principal.schoolCode ?? "")
        .trim()
        .toUpperCase();
      pushStep(authzTrace, {
        gate: "school_scope",
        principalSchool,
        lookupSchoolCode,
      });
      if (
        principalSchool &&
        principalSchool !== "*" &&
        lookupSchoolCode &&
        principalSchool !== lookupSchoolCode
      ) {
        const denied = finalizeTrace(authzTrace, {
          allowed: false,
          denyReason: "school_mismatch",
        });
        this.lastNotesAuthzTrace = denied;
        persistTrace(denied);
        this._activeNotesAuthzTrace = null;
        const error = new Error("Accès refusé: établissement hors périmètre.");
        error.statusCode = 403;
        throw error;
      }
      pushStep(authzTrace, { gate: "school_scope", result: "pass" });
      const classAccess = await this.teacherCanAccessStudentClass(principal, student);
      classAccessVia = this._lastTeacherClassAccessVia ?? (classAccess ? "unknown" : null);
      pushStep(authzTrace, {
        gate: "student_class",
        result: classAccess ? "allow" : "deny",
        via: classAccessVia,
      });
      if (!classAccess) {
        const denied = finalizeTrace(authzTrace, {
          allowed: false,
          denyReason: "student_class",
        });
        this.lastNotesAuthzTrace = denied;
        persistTrace(denied);
        this._activeNotesAuthzTrace = null;
        const error = new Error("Accès refusé: élève hors classe affectée.");
        error.statusCode = 403;
        throw error;
      }
      const evaluationAccess = await this.teacherCanAccessEvaluation(
        principal,
        evaluation,
        student,
      );
      evaluationAccessVia = this._lastTeacherEvaluationAccessVia ?? (evaluationAccess ? "unknown" : null);
      pushStep(authzTrace, {
        gate: "evaluation_subject",
        result: evaluationAccess ? "allow" : "deny",
        via: evaluationAccessVia,
      });
      if (!evaluationAccess) {
        const denied = finalizeTrace(authzTrace, {
          allowed: false,
          denyReason: "evaluation_subject",
        });
        this.lastNotesAuthzTrace = denied;
        persistTrace(denied);
        this._activeNotesAuthzTrace = null;
        const error = new Error("Accès refusé: matière non affectée.");
        error.statusCode = 403;
        throw error;
      }
      const grantedBy = `class:${classAccessVia}+evaluation:${evaluationAccessVia}`;
      const allowed = finalizeTrace(authzTrace, { allowed: true, grantedBy });
      this.lastNotesAuthzTrace = allowed;
      persistTrace(allowed);
      this._activeNotesAuthzTrace = null;
    } else if (authzTrace) {
      const skipped = finalizeTrace(authzTrace, {
        allowed: true,
        grantedBy: "non_teacher_or_allowMissingTeacher",
      });
      this.lastNotesAuthzTrace = skipped;
      persistTrace(skipped);
      this._activeNotesAuthzTrace = null;
    }

    // Lot 2 — auteur pédagogique déterministe (jamais inventé via created_at / premier de l'école).
    // Rôle d'abord : admin/direction exige TOUJOURS une clé explicite (même si evaluation.teacher_id).
    // Enseignant : résolution par affectation ; evaluation.teacher_id reste source déterministe si déjà présent.
    const isEnseignant = principal.role === "Enseignant";
    let teacherId = null;
    if (!isEnseignant) {
      const explicitKey = this.extractExplicitTeacherKey(payload);
      if (!explicitKey) {
        throw this.teacherUnresolvedError(
          "GRADE_TEACHER_UNRESOLVED",
          "Clé enseignant explicite requise pour attribuer une note (admin/direction).",
        );
      }
      const explicitTeacher = await this.resolveUniqueTeacherInSchool(
        evaluation.school_id,
        explicitKey,
      );
      if (!explicitTeacher) {
        throw this.teacherUnresolvedError(
          "GRADE_TEACHER_UNRESOLVED",
          "Enseignant introuvable ou ambigu pour la note.",
        );
      }
      if (
        evaluation.teacher_id &&
        String(evaluation.teacher_id) !== String(explicitTeacher.id)
      ) {
        throw this.teacherUnresolvedError(
          "GRADE_TEACHER_UNRESOLVED",
          "Clé enseignant divergente de l'enseignant de l'évaluation.",
        );
      }
      teacherId = explicitTeacher.id;
    } else if (evaluation.teacher_id) {
      teacherId = evaluation.teacher_id;
    } else {
      const teacher = await this.findTeacherForGrade(
        evaluation.school_id,
        String(principal.sub ?? "").trim(),
        evaluation.class_id,
        evaluation.subject_id,
        principal.role,
      );
      if (!teacher) {
        throw this.teacherUnresolvedError(
          "GRADE_TEACHER_UNRESOLVED",
          "Enseignant introuvable ou ambigu pour la note.",
        );
      }
      teacherId = teacher.id;
    }

    let existing = await this.one(
      `SELECT * FROM grades
       WHERE school_id = $1 AND evaluation_id = $2 AND student_id = $3
       LIMIT 1`,
      [evaluation.school_id, evaluation.id, student.id],
    );
    if (!existing && isUuid(payload.id)) {
      existing = await this.one("SELECT * FROM grades WHERE id = $1", [payload.id]);
    }

    if (existing) {
      assertNoteOptimisticLock(
        { version: existing.version ?? 1 },
        payload.version ?? payload.expectedVersion,
      );
      const nextVersion = noteVersion(existing) + 1;
      await this.query(
        `UPDATE grades
         SET score = $1,
             max_score = $2,
             coefficient = $3,
             teacher_id = $4,
             grade_type = $5,
             comment = $6,
             grade_status = $7,
             evaluation_id = $8,
             class_id = $9,
             subject_id = $10,
             term_id = $11,
             version = $12,
             updated_by = $13,
             updated_at = NOW()
         WHERE id = $14`,
        [
          score,
          maxScore,
          coefficient,
          teacherId,
          toDbEvaluationType(payload.evaluationType ?? evaluation.evaluation_type),
          payload.comment ?? "",
          gradeStatus,
          evaluation.id,
          evaluation.class_id,
          evaluation.subject_id,
          evaluation.term_id,
          nextVersion,
          isUuid(principal.sub) ? principal.sub : null,
          existing.id,
        ],
      );
      if (!options.skipCacheClear) this.cachedDataset = null;
      return this.getGradeById(existing.id);
    }

    const inserted = await this.one(
      `INSERT INTO grades (
         school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
         grade_type, score, max_score, coefficient, comment, grade_status, version, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$14)
       RETURNING id`,
      [
        evaluation.school_id,
        student.id,
        evaluation.class_id,
        evaluation.subject_id,
        teacherId,
        evaluation.term_id,
        evaluation.id,
        toDbEvaluationType(payload.evaluationType ?? evaluation.evaluation_type),
        score,
        maxScore,
        coefficient,
        payload.comment ?? "",
        gradeStatus,
        isUuid(principal.sub) ? principal.sub : null,
      ],
    );
    if (!options.skipCacheClear) this.cachedDataset = null;
    const mapped = await this.getGradeById(inserted.id);
    return mapped ?? {
      id: inserted.id,
      evaluationId: evaluation.legacy_json_id || evaluation.id,
      studentId: student.student_code,
      gradeStatus: fromGradeStatus(gradeStatus),
      value: score,
      scale: maxScore,
      version: 1,
    };
  }

  async resolveEvaluationRow(evaluationKey, schoolCode, options = {}) {
    const key = String(evaluationKey ?? "").trim();
    if (!key) return null;

    const scoped = Boolean(schoolCode && schoolCode !== "*");
    let schoolId = null;
    if (scoped) {
      const school = await this.getSchoolByCode(schoolCode);
      if (!school) return null;
      schoolId = school.id;
    }

    if (isUuid(key)) {
      if (schoolId) {
        return this.one("SELECT * FROM evaluations WHERE id = $1 AND school_id = $2", [key, schoolId]);
      }
      return this.one("SELECT * FROM evaluations WHERE id = $1", [key]);
    }

    if (schoolId) {
      return this.one(
        `SELECT * FROM evaluations WHERE school_id = $1 AND legacy_json_id = $2 LIMIT 1`,
        [schoolId, key],
      );
    }

    if (options.allowGlobalLegacyFallback === true) {
      return this.one(`SELECT * FROM evaluations WHERE legacy_json_id = $1 LIMIT 1`, [key]);
    }

    return null;
  }

  async findForeignEvaluationRow(evaluationKey, schoolId) {
    const key = String(evaluationKey ?? "").trim();
    if (!key || !schoolId) return null;
    if (isUuid(key)) {
      return this.one("SELECT * FROM evaluations WHERE id = $1 AND school_id <> $2 LIMIT 1", [
        key,
        schoolId,
      ]);
    }
    return this.one(
      `SELECT * FROM evaluations WHERE legacy_json_id = $1 AND school_id <> $2 LIMIT 1`,
      [key, schoolId],
    );
  }

  async findSubjectByNormalizedName(schoolId, subjectName) {
    const { normalizeText } = require("../lib/evaluationAttachment");
    const target = normalizeText(subjectName);
    if (!target) return null;
    const exact = await this.one(
      `SELECT *
       FROM subjects
       WHERE school_id = $1
         AND (
           LOWER(TRIM(name)) = LOWER(TRIM($2))
           OR LOWER(TRIM(subject_code)) = LOWER(TRIM($2))
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [schoolId, String(subjectName ?? "").trim()],
    );
    if (exact) return exact;
    const rows = await this.all(`SELECT * FROM subjects WHERE school_id = $1`, [schoolId]);
    return (
      rows.find(
        (row) =>
          normalizeText(row.name) === target || normalizeText(row.subject_code) === target,
      ) ?? null
    );
  }

  async findClassByNormalizedName(schoolId, className) {
    const { normalizeText } = require("../lib/evaluationAttachment");
    const target = normalizeText(className);
    if (!target) return null;
    const exact = await this.one(
      `SELECT *
       FROM classes
       WHERE school_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
       ORDER BY created_at DESC
       LIMIT 1`,
      [schoolId, String(className ?? "").trim()],
    );
    if (exact) return exact;
    const rows = await this.all(`SELECT * FROM classes WHERE school_id = $1`, [schoolId]);
    return rows.find((row) => normalizeText(row.name) === target) ?? null;
  }

  async ensureSubjectForSchool(schoolId, subjectName, context = {}) {
    const normalizedName = String(subjectName ?? "").trim();
    if (!normalizedName) return null;

    const existing = await this.findSubjectByNormalizedName(schoolId, normalizedName);
    if (existing) return existing;

    const { matchByNormalizedName } = require("../lib/evaluationAttachment");
    const state = (await this.getBackOfficeState()) ?? {};
    const fromContext =
      matchByNormalizedName(context.subjects, normalizedName) ||
      matchByNormalizedName(context.courses, normalizedName) ||
      matchByNormalizedName(state.subjects, normalizedName) ||
      matchByNormalizedName(state.courses, normalizedName);

    const school = await this.one(`SELECT school_code FROM schools WHERE id = $1`, [schoolId]);
    const subjectCode = String(
      fromContext?.code ??
        fromContext?.subjectCode ??
        fromContext?.publicId ??
        fromContext?.id ??
        `${String(school?.school_code ?? schoolId).trim().toUpperCase()}-SUB-${normalizedName
          .replace(/\s+/g, "-")
          .toUpperCase()
          .slice(0, 24)}`,
    )
      .trim()
      .toUpperCase();

    return this.one(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, level, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (subject_code) DO UPDATE SET
         name = EXCLUDED.name,
         coefficient = EXCLUDED.coefficient,
         updated_at = NOW()
       RETURNING *`,
      [
        schoolId,
        subjectCode,
        String(fromContext?.name ?? normalizedName).trim(),
        Number(fromContext?.coefficient ?? 1),
        String(fromContext?.level ?? "Tous niveaux").trim(),
        String(fromContext?.description ?? "").trim(),
      ],
    );
  }

  async upsertEvaluationFromLegacy(evaluation = {}, options = {}) {
    const {
      toEvaluationStatus,
      validateEvaluationContract,
    } = require("../lib/gradesCanonical");
    const { resolveEvaluationAttachments } = require("../lib/evaluationAttachment");
    const { asTrimmed, createPedagogyError, PEDAGOGY_ERROR } = require("../lib/pedagogyManagement");

    const principal = options.principal;
    if (principal) {
      const tenantCode = asTrimmed(principal.schoolCode).toUpperCase();
      if (!tenantCode || tenantCode === "*") {
        throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
      }
      evaluation = { ...evaluation, schoolCode: tenantCode };
    }

    const legacyId = String(evaluation.id ?? evaluation.legacy_json_id ?? "").trim();
    const context = options.context ?? {};
    const ensure = options.ensure !== false;
    const scopedSchoolCode = asTrimmed(evaluation.schoolCode).toUpperCase();
    const schoolRecord = scopedSchoolCode ? await this.getSchoolByCode(scopedSchoolCode) : null;
    if (principal && !schoolRecord) {
      throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }

    let existing = null;
    if (legacyId && scopedSchoolCode) {
      existing = await this.resolveEvaluationRow(legacyId, scopedSchoolCode);
      if (!existing && principal && schoolRecord) {
        const foreign = await this.findForeignEvaluationRow(legacyId, schoolRecord.id);
        if (foreign) {
          throw createPedagogyError(404, "Évaluation introuvable.", PEDAGOGY_ERROR.EVALUATION_NOT_FOUND);
        }
      }
    }
    if (!existing && isUuid(evaluation.id) && schoolRecord) {
      existing = await this.one("SELECT * FROM evaluations WHERE id = $1 AND school_id = $2", [
        evaluation.id,
        schoolRecord.id,
      ]);
      if (!existing && principal) {
        const foreign = await this.findForeignEvaluationRow(evaluation.id, schoolRecord.id);
        if (foreign) {
          throw createPedagogyError(404, "Évaluation introuvable.", PEDAGOGY_ERROR.EVALUATION_NOT_FOUND);
        }
      }
    }

    if (options.requireExisting && !existing) {
      throw createPedagogyError(404, "Évaluation introuvable.", PEDAGOGY_ERROR.EVALUATION_NOT_FOUND);
    }

    if (existing && principal && schoolRecord && String(existing.school_id) !== String(schoolRecord.id)) {
      throw createPedagogyError(403, "Accès refusé : évaluation hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }

    let attachmentEvaluation = { ...evaluation };
    if (existing) {
      const refs = await this.one(
        `SELECT c.name AS class_name, sub.name AS subject_name, tm.name AS term_name, t.teacher_code
         FROM evaluations e
         JOIN classes c ON c.id = e.class_id
         JOIN subjects sub ON sub.id = e.subject_id
         JOIN terms tm ON tm.id = e.term_id
         LEFT JOIN teachers t ON t.id = e.teacher_id
         WHERE e.id = $1`,
        [existing.id],
      );
      attachmentEvaluation = {
        ...attachmentEvaluation,
        className: attachmentEvaluation.className ?? attachmentEvaluation.class_name ?? refs?.class_name,
        subject:
          attachmentEvaluation.subject ??
          attachmentEvaluation.subjectName ??
          refs?.subject_name,
        period: attachmentEvaluation.period ?? refs?.term_name,
        teacherId: attachmentEvaluation.teacherId ?? refs?.teacher_code,
      };
    }

    const attachmentDeps = {
        getSchoolByCode: (code) => this.getSchoolByCode(code),
        ensureSchool: ensure ? (code) => this.ensureSchoolFromBackOfficeRecord(code) : undefined,
        findClassById: (schoolId, id) =>
          this.one(`SELECT * FROM classes WHERE school_id = $1 AND (id::text = $2 OR class_code = $2) LIMIT 1`, [
            schoolId,
            id,
          ]),
        findClassByName: (schoolId, name) => this.findClassByNormalizedName(schoolId, name),
        ensureClass: ensure
          ? async (schoolId, name) => {
              const classId = await this.ensureClassForSchool(schoolId, name);
              return classId
                ? this.one(`SELECT * FROM classes WHERE id = $1`, [classId])
                : null;
            }
          : undefined,
        findSubjectById: (schoolId, id) =>
          this.one(
            `SELECT * FROM subjects WHERE school_id = $1 AND (id::text = $2 OR subject_code = $2) LIMIT 1`,
            [schoolId, id],
          ),
        findSubjectByCode: (schoolId, code) =>
          this.one(
            `SELECT * FROM subjects WHERE school_id = $1 AND LOWER(TRIM(subject_code)) = LOWER(TRIM($2)) LIMIT 1`,
            [schoolId, code],
          ),
        findSubjectByName: (schoolId, name) => this.findSubjectByNormalizedName(schoolId, name),
        ensureSubject: ensure ? (schoolId, name) => this.ensureSubjectForSchool(schoolId, name, context) : undefined,
        getCurrentAcademicYear: ensure
          ? (schoolId) => this.getCurrentAcademicYear(schoolId)
          : (schoolId) => this.findOpenAcademicYear(schoolId),
        ensureAcademicYear: ensure ? (schoolId) => this.ensureCurrentAcademicYearForSchool(schoolId) : undefined,
        findTermByName: (academicYearId, name) =>
          this.one(
            `SELECT * FROM terms WHERE academic_year_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
            [academicYearId, name],
          ),
        ensureTerm: ensure
          ? async (academicYearId, name) =>
              (await this.one(
                `SELECT * FROM terms WHERE academic_year_id = $1 AND name = $2 LIMIT 1`,
                [academicYearId, name],
              )) ??
              (await this.one(
                `INSERT INTO terms (academic_year_id, name, status)
                 VALUES ($1, $2, 'open')
                 ON CONFLICT (academic_year_id, name) DO UPDATE SET name = EXCLUDED.name
                 RETURNING *`,
                [academicYearId, name],
              ))
          : undefined,
        findTeacherByCode: (schoolId, code) =>
          this.one(
            `SELECT * FROM teachers WHERE school_id = $1 AND teacher_code = $2 LIMIT 1`,
            [schoolId, code],
          ),
        ensureTeacher: ensure
          ? async (schoolId, code, ctx) => {
              const teachers = Array.isArray(ctx?.teachers) ? ctx.teachers : [];
              const state = (await this.getBackOfficeState()) ?? {};
              const boTeacher =
                teachers.find(
                  (row) =>
                    String(row.id ?? "").trim() === String(code) ||
                    String(row.publicId ?? "").trim() === String(code),
                ) ??
                (state.teachers ?? []).find(
                  (row) =>
                    String(row.id ?? "").trim() === String(code) ||
                    String(row.publicId ?? "").trim() === String(code),
                );
              if (!boTeacher) return null;
              if (
                String(boTeacher.id ?? "").trim() !== String(code) &&
                String(boTeacher.publicId ?? "").trim() !== String(code)
              ) {
                return null;
              }
              const schoolRow = await this.one(`SELECT school_code FROM schools WHERE id = $1`, [schoolId]);
              const materialized = await this.materializeBackOfficeTeacher(
                {
                  ...boTeacher,
                  schoolCode: boTeacher.schoolCode ?? schoolRow?.school_code,
                },
                ctx,
              );
              return materialized?.teacherId
                ? this.one(`SELECT * FROM teachers WHERE id = $1`, [materialized.teacherId])
                : null;
            }
          : undefined,
        findTeacherByExactAssignment: ensure
          ? (schoolId, classId, subjectId, preferredTeacherCode) => {
              if (!preferredTeacherCode) return null;
              return this.one(
                `SELECT t.*
                 FROM teachers t
                 JOIN teacher_assignments ta ON ta.teacher_id = t.id
                 WHERE t.school_id = $1
                   AND t.teacher_code = $2
                   AND ta.class_id = $3
                   AND ta.subject_id = $4
                   AND ta.status = 'active'
                 LIMIT 1`,
                [schoolId, preferredTeacherCode, classId, subjectId],
              );
            }
          : undefined,
    };

    const {
      school,
      schoolClass,
      subject,
      academicYear,
      term,
      teacher,
      periodName,
      schoolCode,
    } = await resolveEvaluationAttachments(attachmentEvaluation, attachmentDeps, {
        ensure,
        context,
        requireTeacher: options.requireTeacher === true,
      },
    );

    // academicYear / periodName reserved for term resolution side-effects above
    void academicYear;
    void periodName;

    const patchTouches = (keys) => evaluationPatchTouches(evaluation, keys);

    let maxScore;
    let coefficient;
    let status;
    let evaluationType;
    let evaluationDate;
    let active;
    let title;
    let classId;
    let subjectId;
    let termId;
    let teacherId;

    if (existing) {
      maxScore = patchTouches(["scale", "max_score", "maxScore"])
        ? Number(evaluation.scale ?? evaluation.max_score ?? evaluation.maxScore ?? 20)
        : Number(existing.max_score ?? 20);
      coefficient = patchTouches(["coefficient"])
        ? Number(evaluation.coefficient ?? 1)
        : Number(existing.coefficient ?? 1);
      status = patchTouches(["status"])
        ? toEvaluationStatus(evaluation.status, String(existing.status ?? "draft"))
        : String(existing.status ?? "draft");
      evaluationType = patchTouches(["evaluationType", "type", "evaluation_type"])
        ? toDbEvaluationType(evaluation.evaluationType ?? evaluation.type)
        : String(existing.evaluation_type ?? "devoir");
      evaluationDate = patchTouches(["date", "evaluation_date"])
        ? this.parseDate(evaluation.date ?? evaluation.evaluation_date)
        : existing.evaluation_date ?? null;
      active = patchTouches(["active"]) ? evaluation.active !== false : existing.active !== false;
      title = patchTouches(["title"])
        ? String(evaluation.title ?? "Évaluation").trim() || "Évaluation"
        : String(existing.title ?? "Évaluation").trim() || "Évaluation";
      classId = patchTouches(["className", "class_name", "classId", "class_id"])
        ? schoolClass.id
        : existing.class_id;
      subjectId = patchTouches(["subject", "subjectName", "subjectCode", "subjectId", "subject_id"])
        ? subject.id
        : existing.subject_id;
      termId = patchTouches(["period", "termName", "term_id"])
        ? term.id
        : existing.term_id;
      teacherId = patchTouches(["teacherId", "teacher_code"])
        ? teacher?.id ?? null
        : existing.teacher_id ?? null;
    } else {
      maxScore = Number(evaluation.scale ?? evaluation.max_score ?? evaluation.maxScore ?? 20);
      coefficient = Number(evaluation.coefficient ?? 1);
      status = toEvaluationStatus(evaluation.status, "draft");
      evaluationType = toDbEvaluationType(evaluation.evaluationType ?? evaluation.type);
      evaluationDate = this.parseDate(evaluation.date ?? evaluation.evaluation_date);
      active = evaluation.active !== false;
      title = String(evaluation.title ?? "Évaluation").trim() || "Évaluation";
      classId = schoolClass.id;
      subjectId = subject.id;
      termId = term.id;
      teacherId = teacher?.id ?? null;
    }

    const contractError = validateEvaluationContract({ maxScore, coefficient, status });
    if (contractError) {
      const error = new Error(contractError);
      error.statusCode = 400;
      throw error;
    }

    if (existing) {
      await this.query(
        `UPDATE evaluations
         SET class_id = $1, subject_id = $2, teacher_id = $3, term_id = $4,
             title = $5, evaluation_type = $6, evaluation_date = $7,
             max_score = $8, coefficient = $9, status = $10,
             active = $11, legacy_json_id = COALESCE(legacy_json_id, $12),
             updated_at = NOW()
         WHERE id = $13`,
        [
          classId,
          subjectId,
          teacherId,
          termId,
          title,
          evaluationType,
          evaluationDate,
          maxScore,
          coefficient,
          status,
          active,
          legacyId || null,
          existing.id,
        ],
      );
      if (!options.skipCacheClear) this.cachedDataset = null;
      return this.one("SELECT * FROM evaluations WHERE id = $1", [existing.id]);
    }

    const inserted = await this.one(
      `INSERT INTO evaluations (
         school_id, class_id, subject_id, teacher_id, term_id,
         title, evaluation_type, evaluation_date, max_score, coefficient,
         status, active, legacy_json_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        school.id,
        schoolClass.id,
        subject.id,
        teacher?.id ?? null,
        term.id,
        title,
        evaluationType,
        evaluationDate,
        maxScore,
        coefficient,
        status,
        evaluation.active !== false,
        legacyId || null,
      ],
    );
    if (!options.skipCacheClear) this.cachedDataset = null;
    return inserted;
  }

  /**
   * Sync BO → PG par enregistrement (HOTFIX-SYNC-01).
   * Acceptés → PG ; rejetés métier → ACK failed (pas de throw global, pas de perte silencieuse).
   * Les erreurs infra inattendues remontent toujours (rollback txn).
   */
  async syncNotesDomainFromBackOffice(payload = {}) {
    const evaluations = Array.isArray(payload.evaluations) ? payload.evaluations : null;
    const notes = Array.isArray(payload.notes) ? payload.notes : null;
    const accepted = { evaluations: [], notes: [] };
    const rejected = [];
    if (!evaluations && !notes) {
      return { synced: true, accepted, rejected, evaluationCount: 0, noteCount: 0 };
    }

    if (evaluations) {
      const attachmentContext = {
        schools: Array.isArray(payload.schools) ? payload.schools : [],
        classes: Array.isArray(payload.classes) ? payload.classes : [],
        courses: Array.isArray(payload.courses) ? payload.courses : [],
        subjects: Array.isArray(payload.subjects) ? payload.subjects : [],
        teachers: Array.isArray(payload.teachers) ? payload.teachers : [],
      };
      for (const evaluation of evaluations) {
        const id = String(evaluation.id ?? evaluation.legacy_json_id ?? "").trim();
        const clientMutationId = String(evaluation.clientMutationId ?? "").trim() || undefined;
        try {
          await this.upsertEvaluationFromLegacy(evaluation, {
            skipCacheClear: true,
            context: attachmentContext,
            ensure: true,
          });
          if (id) accepted.evaluations.push(id);
        } catch (error) {
          if (error?.statusCode && Number(error.statusCode) >= 500) throw error;
          rejected.push({
            entity: "evaluations",
            id: id || undefined,
            clientMutationId,
            code: error?.code,
            error: error?.message ?? "Échec de synchronisation de l'évaluation",
          });
        }
      }
    }
    if (notes) {
      const { toGradeStatus } = require("../lib/gradesCanonical");
      for (const note of notes) {
        const id = String(note.id ?? "").trim();
        const clientMutationId = String(note.clientMutationId ?? "").trim() || undefined;
        try {
          if (!String(note.evaluationId ?? "").trim()) {
            const error = new Error(
              `D3.6b: note sans evaluation_id refusée (${note.id ?? note.studentId ?? "?"})`,
            );
            error.statusCode = 400;
            throw error;
          }
          await this.upsertGrade(
            {
              ...note,
              gradeStatus: toGradeStatus(note.gradeStatus ?? note.status, note.value != null),
            },
            { role: "Admin School", sub: note.authorId ?? note.updatedBy },
            { skipCacheClear: true, allowMissingTeacher: true },
          );
          if (id) accepted.notes.push(id);
        } catch (error) {
          if (error?.statusCode && Number(error.statusCode) >= 500) throw error;
          rejected.push({
            entity: "notes",
            id: id || undefined,
            clientMutationId,
            error: error?.message ?? "Échec de synchronisation de la note",
          });
        }
      }
    }
    this.cachedDataset = null;
    return {
      synced: rejected.length === 0,
      accepted,
      rejected,
      evaluationCount: accepted.evaluations.length,
      noteCount: accepted.notes.length,
    };
  }

  normalizeComparableText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  classNamesInclude(classNames, className) {
    const target = this.normalizeComparableText(className);
    if (!target) return false;
    return (classNames ?? []).some((name) => this.normalizeComparableText(name) === target);
  }

  async findBackOfficeStudentRecord(studentKey) {
    const state = (await this.getBackOfficeState()) ?? {};
    const students = Array.isArray(state.students) ? state.students : [];
    const key = String(studentKey ?? "").trim();
    if (!key) return null;
    return (
      students.find((student) =>
        [student.id, student.publicId, student.matricule].some(
          (candidate) => String(candidate ?? "").trim() === key,
        ),
      ) ?? null
    );
  }

  collectStudentLookupKeys(studentKey, backOfficeStudent) {
    const keys = new Set();
    const add = (value) => {
      const text = String(value ?? "").trim();
      if (text) keys.add(text);
    };
    add(studentKey);
    if (backOfficeStudent) {
      add(backOfficeStudent.id);
      add(backOfficeStudent.publicId);
      add(backOfficeStudent.matricule);
    }
    return [...keys];
  }

  async queryStudentWithClass(studentKey, schoolCode) {
    const backOfficeStudent = await this.findBackOfficeStudentRecord(studentKey);
    const lookupKeys = this.collectStudentLookupKeys(studentKey, backOfficeStudent);

    for (const key of lookupKeys) {
      const params = [key];
      let sql = `
        SELECT st.*, s.school_code, e.class_id, cl.name AS class_name
        FROM students st
        JOIN schools s ON s.id = st.school_id
        LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
        LEFT JOIN classes cl ON cl.id = e.class_id
        WHERE (st.student_code = $1 OR st.id::text = $1)`;
      if (schoolCode && schoolCode !== "*") {
        sql += ` AND s.school_code = $2`;
        params.push(String(schoolCode).trim().toUpperCase());
      }
      sql += ` LIMIT 1`;
      const row = await this.one(sql, params);
      if (row) return { row, backOfficeStudent };
    }

    return { row: null, backOfficeStudent };
  }

  async findOpenAcademicYear(schoolId) {
    return this.one(
      `SELECT *
       FROM academic_years
       WHERE school_id = $1 AND status IN ('active', 'open')
       ORDER BY is_current DESC, created_at DESC
       LIMIT 1`,
      [schoolId],
    );
  }

  async getCurrentAcademicYear(schoolId) {
    const current = await this.one(
      `SELECT *
       FROM academic_years
       WHERE school_id = $1 AND status IN ('active', 'open')
       ORDER BY is_current DESC, created_at DESC
       LIMIT 1`,
      [schoolId],
    );
    if (current) return current;

    // HOTFIX-SYNC-02 : lecture miss ⇒ création idempotente (ensure).
    return this.ensureCurrentAcademicYearForSchool(schoolId);
  }

  /**
   * HOTFIX-SYNC-02 — Crée une année scolaire active si absente (idempotent).
   * Séparé de la lecture pour rendre l'ensure explicite dans les tests/revue.
   */
  async ensureCurrentAcademicYearForSchool(schoolId) {
    const existing = await this.one(
      `SELECT *
       FROM academic_years
       WHERE school_id = $1 AND status IN ('active', 'open')
       ORDER BY is_current DESC, created_at DESC
       LIMIT 1`,
      [schoolId],
    );
    if (existing) return existing;

    const year = new Date().getFullYear();
    return this.one(
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, $2, $3, $4, TRUE, 'open')
       ON CONFLICT (school_id, name) DO UPDATE SET
         is_current = TRUE,
         status = 'open'
       RETURNING *`,
      [schoolId, `${year}-${year + 1}`, `${year}-09-01`, `${year + 1}-08-31`],
    );
  }

  async ensureClassForSchool(schoolId, className, context = {}) {
    const normalizedClassName = String(className ?? "").trim();
    if (!normalizedClassName) return null;

    const existing = await this.findClassByNormalizedName(schoolId, normalizedClassName);
    if (existing?.id) return existing.id;

    const state = (await this.getBackOfficeState()) ?? {};
    const contextClasses = Array.isArray(context.classes) ? context.classes : [];
    const stateClasses = Array.isArray(state.classes) ? state.classes : [];
    const backOfficeClass = [...contextClasses, ...stateClasses].find(
      (row) => this.normalizeComparableText(row.name) === this.normalizeComparableText(normalizedClassName),
    );
    const academicYear = await this.getCurrentAcademicYear(schoolId);
    if (!academicYear) return null;

    const classCode = String(
      backOfficeClass?.publicId ??
        backOfficeClass?.id ??
        `${String((await this.one("SELECT school_code FROM schools WHERE id = $1", [schoolId]))?.school_code ?? schoolId)
          .trim()
          .toUpperCase()}-${normalizedClassName.replace(/\s+/g, "-").toUpperCase()}`,
    ).trim();
    const inserted = await this.one(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, level, section, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (class_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        schoolId,
        academicYear.id,
        classCode,
        normalizedClassName,
        backOfficeClass?.level ?? "",
        backOfficeClass?.track ?? backOfficeClass?.section ?? "",
      ],
    );
    return inserted?.id ?? null;
  }

  async ensureActiveEnrollment(schoolId, studentDbId, classId) {
    if (!studentDbId || !classId) return;
    const academicYear = await this.getCurrentAcademicYear(schoolId);
    if (!academicYear) return;
    await this.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')
       ON CONFLICT (student_id, academic_year_id) DO UPDATE SET
         class_id = EXCLUDED.class_id,
         status = 'active'`,
      [schoolId, studentDbId, classId, academicYear.id],
    );
  }

  async ensureSchoolFromBackOfficeRecord(schoolCode, context = {}) {
    const normalized = String(schoolCode ?? "").trim().toUpperCase();
    if (!normalized || normalized === "*") return null;

    const existing = await this.getSchoolByCode(normalized);
    if (existing) return existing;

    const state = (await this.getBackOfficeState()) ?? {};
    const contextSchools = Array.isArray(context.schools) ? context.schools : [];
    const stateSchools = Array.isArray(state.schools) ? state.schools : [];
    const backOfficeSchool = [...contextSchools, ...stateSchools].find(
      (row) => String(row.code ?? "").trim().toUpperCase() === normalized,
    );
    if (!backOfficeSchool) return null;

    const { extractProfilePayload, toSchoolDbStatus, normalizeCountryIso } = require("../lib/schoolsManagement");
    const isoCode = normalizeCountryIso(backOfficeSchool.countryCode, backOfficeSchool.country);
    let country = null;
    if (isoCode) {
      country = await this.one("SELECT id FROM countries WHERE iso_code = $1 LIMIT 1", [isoCode]);
    }
    if (!country && backOfficeSchool.country) {
      country = await this.one("SELECT id FROM countries WHERE lower(name) = lower($1) LIMIT 1", [
        String(backOfficeSchool.country).trim(),
      ]);
    }
    if (!country) {
      return null;
    }
    const profile = extractProfilePayload({ ...backOfficeSchool, code: normalized });
    return this.one(
      `INSERT INTO schools (country_id, school_code, name, logo_url, address, city, phone, email, school_type, status, profile_payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW())
       ON CONFLICT (school_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [
        country.id,
        normalized,
        backOfficeSchool.name ?? normalized,
        backOfficeSchool.logoUrl ?? "",
        backOfficeSchool.address ?? "",
        backOfficeSchool.city ?? "",
        backOfficeSchool.phone ?? "",
        backOfficeSchool.email ?? "",
        backOfficeSchool.type ?? "Établissement",
        toSchoolDbStatus(backOfficeSchool.status ?? "Actif"),
        JSON.stringify(profile),
      ],
    );
  }

  /**
   * HOTFIX-PRE-E1-01 — Sync BO students[] → PG students + enrollments.
   * No-op si `students` absent (PUT partiel). Rejets métier sans throw global.
   */
  async syncStudentsDomainFromBackOffice(payload = {}) {
    const {
      shouldSyncStudentsFromPayload,
      validateStudentSyncRecord,
    } = require("../lib/studentsBoPersistence");
    const accepted = { students: [], enrollments: [] };
    const rejected = [];
    if (!shouldSyncStudentsFromPayload(payload)) {
      return { synced: true, accepted, rejected, studentCount: 0, enrollmentCount: 0 };
    }

    const context = {
      schools: Array.isArray(payload.schools) ? payload.schools : [],
      classes: Array.isArray(payload.classes) ? payload.classes : [],
    };

    for (const record of payload.students) {
      const validation = validateStudentSyncRecord(record);
      const stableId = validation.ok ? validation.studentCode : String(record?.id ?? "").trim();
      try {
        if (!validation.ok) {
          const error = new Error(validation.error);
          error.statusCode = 400;
          error.code = validation.code;
          throw error;
        }
        const result = await this.materializeBackOfficeStudent(record, context);
        if (!result?.studentId) {
          const error = new Error("Échec de matérialisation élève (établissement introuvable)");
          error.statusCode = 400;
          error.code = "STUDENT_SYNC_MATERIALIZE_FAILED";
          throw error;
        }
        accepted.students.push(validation.studentCode);
        if (result.enrollment) {
          accepted.enrollments.push(validation.studentCode);
        }
      } catch (error) {
        if (error?.statusCode && Number(error.statusCode) >= 500) throw error;
        rejected.push({
          entity: "students",
          id: stableId || undefined,
          code: error?.code,
          error: error?.message ?? "Échec de synchronisation de l'élève",
        });
      }
    }

    this.cachedDataset = null;
    return {
      synced: rejected.length === 0,
      accepted,
      rejected,
      studentCount: accepted.students.length,
      enrollmentCount: accepted.enrollments.length,
    };
  }

  /**
   * HOTFIX-PRE-E1-02 — Sync BO teachers[] / assignments[] → PG.
   * No-op si collections absentes. Rejets métier sans throw global.
   */
  async syncPedagogyStaffDomainFromBackOffice(payload = {}) {
    const {
      shouldSyncTeachersFromPayload,
      shouldSyncAssignmentsFromPayload,
      validateTeacherSyncRecord,
      validateAssignmentSyncRecord,
    } = require("../lib/pedagogyStaffBoPersistence");

    const accepted = { teachers: [], assignments: [] };
    const rejected = [];
    const context = {
      schools: Array.isArray(payload.schools) ? payload.schools : [],
      classes: Array.isArray(payload.classes) ? payload.classes : [],
      teachers: Array.isArray(payload.teachers) ? payload.teachers : [],
      courses: Array.isArray(payload.courses) ? payload.courses : [],
      subjects: Array.isArray(payload.subjects) ? payload.subjects : [],
      users: Array.isArray(payload.users) ? payload.users : [],
    };

    if (shouldSyncTeachersFromPayload(payload)) {
      for (const record of payload.teachers) {
        const validation = validateTeacherSyncRecord(record);
        const stableId = validation.ok ? validation.teacherCode : String(record?.id ?? "").trim();
        try {
          if (!validation.ok) {
            const error = new Error(validation.error);
            error.statusCode = 400;
            error.code = validation.code;
            throw error;
          }
          const result = await this.materializeBackOfficeTeacher(record, context);
          if (!result?.teacherId) {
            const error = new Error("Échec de matérialisation enseignant (établissement introuvable)");
            error.statusCode = 400;
            error.code = "TEACHER_SYNC_MATERIALIZE_FAILED";
            throw error;
          }
          accepted.teachers.push(validation.teacherCode);
        } catch (error) {
          if (error?.statusCode && Number(error.statusCode) >= 500) throw error;
          rejected.push({
            entity: "teachers",
            id: stableId || undefined,
            code: error?.code,
            error: error?.message ?? "Échec de synchronisation de l'enseignant",
          });
        }
      }
    }

    if (shouldSyncAssignmentsFromPayload(payload)) {
      for (const record of payload.assignments) {
        const validation = validateAssignmentSyncRecord(record);
        const stableId = validation.ok
          ? validation.assignmentKey
          : String(record?.id ?? "").trim();
        try {
          if (!validation.ok) {
            const error = new Error(validation.error);
            error.statusCode = 400;
            error.code = validation.code;
            throw error;
          }
          const result = await this.materializeBackOfficeAssignment(record, context);
          if (!result?.assignmentId) {
            const error = new Error("Échec de matérialisation affectation");
            error.statusCode = 400;
            error.code = "ASSIGNMENT_SYNC_MATERIALIZE_FAILED";
            throw error;
          }
          accepted.assignments.push(validation.assignmentKey);
        } catch (error) {
          if (error?.statusCode && Number(error.statusCode) >= 500) throw error;
          rejected.push({
            entity: "assignments",
            id: stableId || undefined,
            code: error?.code,
            error: error?.message ?? "Échec de synchronisation de l'affectation",
          });
        }
      }
    }

    this.cachedDataset = null;
    return {
      synced: rejected.length === 0,
      accepted,
      rejected,
      teacherCount: accepted.teachers.length,
      assignmentCount: accepted.assignments.length,
    };
  }

  async resolvePgUserIdForTeacher(record = {}, schoolId, context = {}) {
    const candidates = new Set();
    const add = (value) => {
      const text = String(value ?? "").trim();
      if (text) candidates.add(text);
    };
    add(record.userId);
    add(record.contactId);
    add(record.identifier);
    add(record.publicId);
    add(record.email);

    const contextUsers = Array.isArray(context.users) ? context.users : [];
    const state = (await this.getBackOfficeState()) ?? {};
    const boUsers = [...contextUsers, ...(Array.isArray(state.users) ? state.users : [])];
    const linked = boUsers.find((user) => {
      const keys = [user.id, user.publicId, user.identifier, user.email, user.contactId].map((v) =>
        String(v ?? "").trim(),
      );
      return keys.some((key) => key && candidates.has(key));
    });
    if (linked) {
      add(linked.id);
      add(linked.publicId);
      add(linked.identifier);
    }

    for (const key of candidates) {
      const row = await this.one(
        `SELECT id FROM users
         WHERE (id::text = $1 OR user_code = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($1)))
           AND ($2::uuid IS NULL OR school_id = $2 OR school_id IS NULL)
         LIMIT 1`,
        [key, schoolId],
      );
      if (row?.id) return row.id;
    }
    return null;
  }

  /**
   * HOTFIX-PRE-E1-02B — Matérialise l'utilisateur PG lié à la fiche enseignant BO
   * pour que teachers.user_id soit non null (user_code = id BO ou identifier).
   *
   * Isolation multi-tenant / rôle :
   * - inexistant → INSERT (role TEACHER)
   * - même établissement + rôle enseignant compatible → UPDATE contrôlé
   *   (jamais forcer role/status/school_id)
   * - même établissement + rôle non enseignant → REJET TEACHER_USER_ROLE_CONFLICT
   * - autre établissement → REJET TEACHER_USER_TENANT_CONFLICT
   */
  isTeacherCompatiblePgRole(role) {
    return String(role ?? "").trim().toUpperCase() === "TEACHER";
  }

  async ensurePgUserForBackOfficeTeacher(record = {}, schoolId, context = {}) {
    const contextUsers = Array.isArray(context.users) ? context.users : [];
    const state = (await this.getBackOfficeState()) ?? {};
    const boUsers = [...contextUsers, ...(Array.isArray(state.users) ? state.users : [])];
    const schoolRow = schoolId
      ? await this.one(`SELECT school_code FROM schools WHERE id = $1 LIMIT 1`, [schoolId])
      : null;
    const schoolCode = String(record.schoolCode ?? schoolRow?.school_code ?? "")
      .trim()
      .toUpperCase();
    const sameSchool = (user) => {
      const userSchool = String(user?.schoolCode ?? "")
        .trim()
        .toUpperCase();
      return !schoolCode || !userSchool || userSchool === schoolCode;
    };

    // Correspondance forte (id) vs souple (identifier/email) — la souple est
    // forcément scopée établissement : ENS-0001 n'est pas globalement unique.
    const strongKeys = new Set(
      [record.userId, record.contactId]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    );
    const softKeys = new Set(
      [record.identifier, record.publicId, record.email]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    );
    const linked =
      boUsers.find((user) =>
        [user.id, user.publicId, user.contactId]
          .map((value) => String(value ?? "").trim())
          .some((key) => key && strongKeys.has(key)),
      ) ??
      boUsers.find(
        (user) =>
          sameSchool(user) &&
          [user.identifier, user.email, user.publicId]
            .map((value) => String(value ?? "").trim())
            .some((key) => key && softKeys.has(key)),
      );

    // Ne jamais laisser un match soft (identifier) écraser le userId explicite
    // de la fiche enseignant — évite le rattachement cross-tenant via ENS-*.
    const userCode = String(
      record.userId ?? linked?.id ?? record.identifier ?? linked?.identifier ?? "",
    ).trim();
    if (!userCode) return null;

    const firstName =
      String(linked?.firstName ?? record.firstName ?? "").trim() || "Enseignant";
    const lastName =
      String(linked?.lastName ?? record.lastName ?? record.name ?? "").trim() || userCode;
    const email = String(linked?.email ?? record.email ?? "").trim() || null;
    const phone = String(linked?.phone ?? record.phone ?? "").trim() || null;

    // Lookup global par user_code — ne pas dépendre de l'unicité « de fait ».
    const existing = await this.one(
      `SELECT id, school_id, role, status, user_code
       FROM users
       WHERE user_code = $1
       LIMIT 1`,
      [userCode],
    );

    if (!existing) {
      const inserted = await this.one(
        `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, 'TEACHER', 'active')
         RETURNING id`,
        [schoolId, userCode, firstName, lastName, email, phone],
      );
      return inserted?.id ?? null;
    }

    if (
      existing.school_id != null &&
      String(existing.school_id) !== String(schoolId)
    ) {
      const error = new Error(
        "Conflit multi-tenant: user_code déjà rattaché à un autre établissement",
      );
      error.statusCode = 409;
      error.code = "TEACHER_USER_TENANT_CONFLICT";
      throw error;
    }

    if (!this.isTeacherCompatiblePgRole(existing.role)) {
      const error = new Error(
        "Conflit de rôle: compte existant non enseignant — liaison teachers.user_id refusée",
      );
      error.statusCode = 409;
      error.code = "TEACHER_USER_ROLE_CONFLICT";
      throw error;
    }

    // Même établissement (ou school_id NULL) + rôle TEACHER : mise à jour contrôlée —
    // ne jamais forcer role/status, ni déplacer school_id vers un autre tenant.
    const updated = await this.one(
      `UPDATE users
       SET first_name = COALESCE(NULLIF($2, ''), first_name),
           last_name = COALESCE(NULLIF($3, ''), last_name),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           school_id = COALESCE(school_id, $6)
       WHERE id = $1
         AND (school_id IS NULL OR school_id = $6)
       RETURNING id, school_id, role`,
      [existing.id, firstName, lastName, email, phone, schoolId],
    );
    if (!updated) {
      const error = new Error(
        "Conflit multi-tenant: impossible de lier l'utilisateur enseignant à cet établissement",
      );
      error.statusCode = 409;
      error.code = "TEACHER_USER_TENANT_CONFLICT";
      throw error;
    }
    return updated.id;
  }

  async materializeBackOfficeTeacher(record, context = {}) {
    const { resolveStableTeacherCode } = require("../lib/pedagogyStaffBoPersistence");
    const schoolCode = String(record.schoolCode ?? "")
      .trim()
      .toUpperCase();
    const school = await this.ensureSchoolFromBackOfficeRecord(schoolCode, context);
    if (!school) return null;

    const teacherCode = resolveStableTeacherCode(record);
    if (!teacherCode) return null;

    const userId =
      (await this.ensurePgUserForBackOfficeTeacher(record, school.id, context)) ??
      (await this.resolvePgUserIdForTeacher(record, school.id, context));
    const speciality = String(record.mainSubject ?? record.speciality ?? record.subject ?? "").trim();

    let row = await this.one(
      `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (teacher_code) DO UPDATE SET
         speciality = COALESCE(NULLIF(EXCLUDED.speciality, ''), teachers.speciality),
         user_id = COALESCE(EXCLUDED.user_id, teachers.user_id),
         status = EXCLUDED.status,
         updated_at = NOW()
       WHERE teachers.school_id = EXCLUDED.school_id
       RETURNING id, school_id, teacher_code`,
      [
        school.id,
        userId,
        teacherCode,
        speciality,
        record.archived ? "archived" : "active",
      ],
    );

    if (!row) {
      const existing = await this.one(
        `SELECT id, school_id, teacher_code FROM teachers WHERE teacher_code = $1 LIMIT 1`,
        [teacherCode],
      );
      if (existing && String(existing.school_id) !== String(school.id)) {
        const error = new Error("Conflit d'identifiant enseignant entre établissements");
        error.statusCode = 409;
        error.code = "TEACHER_TENANT_CONFLICT";
        throw error;
      }
      row = existing;
    }
    if (!row) return null;
    return { teacherId: row.id, teacherCode: row.teacher_code, schoolId: school.id };
  }

  async materializeBackOfficeAssignment(record, context = {}) {
    const { validateAssignmentSyncRecord } = require("../lib/pedagogyStaffBoPersistence");
    const validation = validateAssignmentSyncRecord(record);
    if (!validation.ok) {
      const error = new Error(validation.error);
      error.statusCode = 400;
      error.code = validation.code;
      throw error;
    }

    const school = await this.ensureSchoolFromBackOfficeRecord(validation.schoolCode, context);
    if (!school) {
      const error = new Error("Établissement introuvable pour l'affectation");
      error.statusCode = 400;
      error.code = "ASSIGNMENT_SYNC_SCHOOL_MISSING";
      throw error;
    }

    let teacher = await this.one(
      `SELECT * FROM teachers WHERE school_id = $1 AND teacher_code = $2 LIMIT 1`,
      [school.id, validation.teacherCode],
    );
    if (!teacher) {
      const boTeacher =
        (context.teachers ?? []).find(
          (row) =>
            String(row.id ?? "").trim() === validation.teacherCode ||
            String(row.publicId ?? "").trim() === validation.teacherCode,
        ) ??
        ((await this.getBackOfficeState())?.teachers ?? []).find(
          (row) =>
            String(row.id ?? "").trim() === validation.teacherCode ||
            String(row.publicId ?? "").trim() === validation.teacherCode,
        );
      if (boTeacher) {
        const materialized = await this.materializeBackOfficeTeacher(
          { ...boTeacher, schoolCode: boTeacher.schoolCode ?? validation.schoolCode },
          context,
        );
        if (materialized?.teacherId) {
          teacher = await this.one(`SELECT * FROM teachers WHERE id = $1`, [materialized.teacherId]);
        }
      }
    }
    if (!teacher) {
      const error = new Error(`Enseignant introuvable pour l'affectation (${validation.teacherCode})`);
      error.statusCode = 400;
      error.code = "ASSIGNMENT_SYNC_TEACHER_MISSING";
      throw error;
    }

    const classId = await this.ensureClassForSchool(school.id, validation.className, context);
    if (!classId) {
      const error = new Error(`Classe introuvable pour l'affectation (${validation.className})`);
      error.statusCode = 400;
      error.code = "ASSIGNMENT_SYNC_CLASS_MISSING";
      throw error;
    }

    const subject = await this.ensureSubjectForSchool(school.id, validation.subjectName, context);
    if (!subject?.id) {
      const error = new Error(`Matière introuvable pour l'affectation (${validation.subjectName})`);
      error.statusCode = 400;
      error.code = "ASSIGNMENT_SYNC_SUBJECT_MISSING";
      throw error;
    }

    const academicYear = await this.getCurrentAcademicYear(school.id);
    if (!academicYear) {
      const error = new Error("Année scolaire introuvable pour l'affectation");
      error.statusCode = 400;
      error.code = "ASSIGNMENT_SYNC_YEAR_MISSING";
      throw error;
    }

    const row = await this.one(
      `INSERT INTO teacher_assignments (
         school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status
       ) VALUES ($1, $2, $3, $4, $5, 'primary', 'active')
       ON CONFLICT (teacher_id, class_id, subject_id, academic_year_id, assignment_role)
       DO UPDATE SET status = 'active', updated_at = NOW()
       RETURNING id`,
      [school.id, teacher.id, classId, subject.id, academicYear.id],
    );

    return {
      assignmentId: row?.id ?? null,
      teacherId: teacher.id,
      classId,
      subjectId: subject.id,
    };
  }

  /**
   * HOTFIX-PRE-E1-01 — Résolution élève pour POST /api/notes.
   * Lookup `student_code` / UUID uniquement ; matérialisation BO si besoin.
   * Pas de recherche nominale.
   */
  async resolveStudentForGrade(studentKey, schoolCode) {
    const key = String(studentKey ?? "").trim();
    if (!key) return null;
    const scopedCode =
      schoolCode && schoolCode !== "*" ? String(schoolCode).trim().toUpperCase() : "";

    let { row: student, backOfficeStudent } = await this.queryStudentWithClass(key, scopedCode);

    if (!student && backOfficeStudent) {
      const boSchool = String(backOfficeStudent.schoolCode ?? "")
        .trim()
        .toUpperCase();
      if (scopedCode && boSchool && boSchool !== scopedCode) {
        return null;
      }
      const materialized = await this.materializeBackOfficeStudent(backOfficeStudent);
      if (materialized?.studentId) {
        ({ row: student } = await this.queryStudentWithClass(key, scopedCode));
      }
    }

    return student;
  }

  async materializeBackOfficeStudent(record, context = {}) {
    const { resolveStableStudentCode } = require("../lib/studentsBoPersistence");
    const schoolCode = String(record.schoolCode ?? "")
      .trim()
      .toUpperCase();
    const school = await this.ensureSchoolFromBackOfficeRecord(schoolCode, context);
    if (!school) return null;

    const matricule = resolveStableStudentCode(record);
    if (!matricule) return null;

    const nameParts = String(record.name ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const firstName = String(record.firstName ?? nameParts[0] ?? "Eleve").trim();
    const lastName = String(record.lastName ?? nameParts.slice(1).join(" ") ?? "Somafrik").trim();

    // Isolation multi-tenant : ne jamais écraser un student_code d'un autre établissement.
    let row = await this.one(
      `INSERT INTO students (school_id, student_code, first_name, last_name, gender, birth_date, birth_place, photo_url, parent_phone, parent_email, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, $9)
       ON CONFLICT (student_code) DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         gender = EXCLUDED.gender,
         birth_date = EXCLUDED.birth_date,
         parent_phone = EXCLUDED.parent_phone,
         parent_email = EXCLUDED.parent_email,
         status = EXCLUDED.status,
         updated_at = NOW()
       WHERE students.school_id = EXCLUDED.school_id
       RETURNING id, school_id`,
      [
        school.id,
        matricule,
        firstName,
        lastName,
        record.gender ?? "Non renseigné",
        this.parseDate(record.birthDate),
        record.parentPhone ?? record.phone ?? "",
        record.parentEmail ?? record.email ?? "",
        record.archived ? "archived" : "active",
      ],
    );

    if (!row) {
      const existing = await this.one(
        `SELECT id, school_id FROM students WHERE student_code = $1 LIMIT 1`,
        [matricule],
      );
      if (existing && String(existing.school_id) !== String(school.id)) {
        const error = new Error("Conflit d'identifiant élève entre établissements");
        error.statusCode = 409;
        error.code = "STUDENT_TENANT_CONFLICT";
        throw error;
      }
      row = existing;
    }
    if (!row) return null;
    if (String(row.school_id) !== String(school.id)) {
      const error = new Error("Conflit d'identifiant élève entre établissements");
      error.statusCode = 409;
      error.code = "STUDENT_TENANT_CONFLICT";
      throw error;
    }

    const className = String(record.className ?? "").trim();
    const classId = await this.ensureClassForSchool(school.id, className, context);
    let enrollment = false;
    if (classId) {
      await this.ensureActiveEnrollment(school.id, row.id, classId);
      enrollment = true;
    }
    return {
      studentId: row.id,
      schoolId: school.id,
      classId: classId ?? null,
      enrollment,
    };
  }

  async assertPrincipalStudentTenant(principal, student) {
    const schoolCode = String(principal?.schoolCode ?? "")
      .trim()
      .toUpperCase();
    if (!schoolCode || schoolCode === "*") return;
    const school = await this.getSchoolByCode(schoolCode);
    if (!school || String(student?.school_id) !== String(school.id)) {
      const error = new Error("Accès refusé : élève hors périmètre établissement.");
      error.statusCode = 403;
      error.code = "TENANT_MISMATCH";
      throw error;
    }
  }

  async resolveStudentForAttendance(payload, principal = {}, options = {}) {
    const schoolCode = String(payload.schoolCode ?? principal.schoolCode ?? "").trim().toUpperCase();
    const tenantScoped = Boolean(schoolCode && schoolCode !== "*");
    const pedagogyStrict = options.pedagogyStrict === true || tenantScoped;
    const className = String(payload.className ?? "").trim();

    if (tenantScoped && !options.skipSchoolEnsure) {
      await this.ensureSchoolFromBackOfficeRecord(schoolCode);
    }

    let { row: student, backOfficeStudent } = await this.queryStudentWithClass(payload.studentId, schoolCode);

    if (!student && !backOfficeStudent && !pedagogyStrict) {
      ({ row: student, backOfficeStudent } = await this.queryStudentWithClass(payload.studentId, ""));
    }

    if (!student && backOfficeStudent && !pedagogyStrict) {
      const materialized = await this.materializeBackOfficeStudent(backOfficeStudent);
      if (materialized?.studentId) {
        ({ row: student, backOfficeStudent } = await this.queryStudentWithClass(
          payload.studentId,
          schoolCode,
        ));
      }
    }

    if (!student) return null;

    if (tenantScoped) {
      const tenantSchool = await this.getSchoolByCode(schoolCode);
      if (!tenantSchool || String(student.school_id) !== String(tenantSchool.id)) {
        return null;
      }
    }

    if (!student.class_id) {
      if (pedagogyStrict) {
        return null;
      }
      const targetClassName =
        className ||
        String(backOfficeStudent?.className ?? "").trim() ||
        String(student.class_name ?? "").trim();
      if (targetClassName) {
        const classId = await this.ensureClassForSchool(student.school_id, targetClassName);
        if (classId) {
          await this.ensureActiveEnrollment(student.school_id, student.id, classId);
          student = { ...student, class_id: classId, class_name: targetClassName };
        }
      }
    }

    return student;
  }

  async teacherCanAccessClassFromBackOffice(principal, student) {
    const { pushStep } = require("../lib/notesAuthzTrace");
    const trace = this._activeNotesAuthzTrace;
    const state = (await this.getBackOfficeState()) ?? {};
    const className = String(student.class_name ?? "").trim();
    if (!className) {
      pushStep(trace, { gate: "fallback_bo_class", result: "deny", reason: "empty_class_name" });
      return false;
    }

    const { assignmentMatchesTeacher } = require("../services/authService");
    const principalSub = String(principal.sub ?? "").trim();
    const principalIdentifier = this.normalizeComparableText(principal.identifier);
    // HOTFIX-PRE-E1-02 : toutes les fiches liées (évite TEACHER- vs TEACHERS-).
    const linkedTeachers = (state.teachers ?? []).filter((row) => {
      if (principalSub && [row.userId, row.id, row.publicId].some((v) => String(v ?? "").trim() === principalSub)) {
        return true;
      }
      if (principalIdentifier && this.normalizeComparableText(row.identifier) === principalIdentifier) {
        return true;
      }
      return false;
    });
    pushStep(trace, {
      gate: "fallback_bo_class",
      linkedTeacherIds: linkedTeachers.map((row) => row.id),
      assignmentCount: (state.assignments ?? []).length,
    });

    const user = {
      id: principalSub,
      identifier: principal.identifier,
      firstName: principal.firstName,
      lastName: principal.lastName,
      name: principal.name,
    };

    for (const assignment of state.assignments ?? []) {
      if (!this.classNamesInclude([assignment.className], className)) continue;
      for (const teacher of linkedTeachers) {
        if (assignmentMatchesTeacher(assignment, teacher, user)) {
          this._lastTeacherClassAccessVia = "bo_assignment_match";
          pushStep(trace, {
            gate: "fallback_bo_class",
            result: "allow",
            via: "bo_assignment_match",
            assignmentId: assignment.id ?? null,
            teacherId: teacher.id ?? null,
          });
          return true;
        }
      }
      const assignmentTeacherId = String(assignment.teacherId ?? "").trim();
      if (
        assignmentTeacherId &&
        linkedTeachers.some((teacher) =>
          [teacher.id, teacher.publicId].some((value) => String(value ?? "").trim() === assignmentTeacherId),
        )
      ) {
        this._lastTeacherClassAccessVia = "bo_assignment_teacher_id";
        pushStep(trace, {
          gate: "fallback_bo_class",
          result: "allow",
          via: "bo_assignment_teacher_id",
          assignmentId: assignment.id ?? null,
          assignmentTeacherId,
        });
        return true;
      }
    }

    for (const teacher of linkedTeachers) {
      for (const assignment of teacher?.assignments ?? []) {
        if (this.classNamesInclude([assignment.className], className)) {
          this._lastTeacherClassAccessVia = "bo_teacher_embedded_assignment";
          pushStep(trace, {
            gate: "fallback_bo_class",
            result: "allow",
            via: "bo_teacher_embedded_assignment",
            teacherId: teacher.id ?? null,
          });
          return true;
        }
      }
    }

    const jwtHit = this.classNamesInclude(principal.classNames, className);
    this._lastTeacherClassAccessVia = jwtHit ? "jwt_classNames" : null;
    pushStep(trace, {
      gate: "fallback_bo_class",
      result: jwtHit ? "allow" : "deny",
      via: jwtHit ? "jwt_classNames" : null,
      jwtClassNames: principal.classNames ?? [],
      studentClassName: className,
    });
    return jwtHit;
  }

  async teacherCanAccessStudentClass(principal, student) {
    const { pushStep } = require("../lib/notesAuthzTrace");
    const trace = this._activeNotesAuthzTrace;
    this._lastTeacherClassAccessVia = null;
    if (principal.role !== "Enseignant") {
      this._lastTeacherClassAccessVia = "non_teacher";
      return true;
    }
    if (this.classNamesInclude(principal.classNames, student.class_name)) {
      this._lastTeacherClassAccessVia = "jwt_classNames";
      pushStep(trace, {
        gate: "pg_or_jwt_class",
        result: "allow",
        via: "jwt_classNames",
        jwtClassNames: principal.classNames ?? [],
        studentClassName: student.class_name,
      });
      return true;
    }
    pushStep(trace, {
      gate: "jwt_classNames",
      result: "miss",
      jwtClassNames: principal.classNames ?? [],
      studentClassName: student.class_name,
    });

    const lookupKeys = await this.collectTeacherLookupKeysForPrincipal(principal, student.school_id);
    pushStep(trace, { gate: "pg_teacher_lookup", lookupValues: lookupKeys });
    let pgTeacherFound = false;
    for (const lookupValue of lookupKeys) {
      const teacher = await this.one(
        `SELECT t.id, t.teacher_code
         FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.school_id = $1
           AND (
             t.teacher_code = $2
             OR u.user_code = $2
             OR u.id::text = $2
             OR t.id::text = $2
           )
         LIMIT 1`,
        [student.school_id, lookupValue],
      );
      if (!teacher?.id) continue;
      pgTeacherFound = true;
      pushStep(trace, {
        gate: "pg_teacher_lookup",
        result: "hit",
        lookupValue,
        teacherId: teacher.id,
        teacherCode: teacher.teacher_code,
      });
      if (teacher?.id && student.class_id) {
        const assignment = await this.one(
          `SELECT 1 AS ok
           FROM teacher_assignments ta
           WHERE ta.teacher_id = $1
             AND ta.class_id = $2
             AND ta.status = 'active'
           LIMIT 1`,
          [teacher.id, student.class_id],
        );
        if (assignment) {
          this._lastTeacherClassAccessVia = "pg_teacher_assignment";
          pushStep(trace, {
            gate: "pg_teacher_assignment",
            result: "allow",
            via: "pg_teacher_assignment",
            teacherId: teacher.id,
            classId: student.class_id,
          });
          return true;
        }
        pushStep(trace, {
          gate: "pg_teacher_assignment",
          result: "miss",
          teacherId: teacher.id,
          classId: student.class_id,
        });
      }
    }
    if (!pgTeacherFound) {
      pushStep(trace, {
        gate: "pg_teacher_lookup",
        result: "miss",
        lookupValues: lookupKeys,
      });
    }

    pushStep(trace, { gate: "fallback_bo_class", entering: true });
    return this.teacherCanAccessClassFromBackOffice(principal, student);
  }

  /**
   * HOTFIX-PRE-E1-02 — Enseignant autorisé sur l'évaluation (classe + matière).
   * PG teacher_assignments, sinon affectation BO, sinon teacher_id évaluation.
   */
  async teacherCanAccessEvaluation(principal, evaluation, student) {
    const { pushStep } = require("../lib/notesAuthzTrace");
    const trace = this._activeNotesAuthzTrace;
    this._lastTeacherEvaluationAccessVia = null;
    if (principal.role !== "Enseignant") {
      this._lastTeacherEvaluationAccessVia = "non_teacher";
      return true;
    }
    if (!evaluation?.class_id || !evaluation?.subject_id) {
      pushStep(trace, {
        gate: "evaluation_subject",
        result: "deny",
        reason: "missing_class_or_subject_id",
      });
      return false;
    }

    const principalSchool = String(principal.schoolCode ?? "")
      .trim()
      .toUpperCase();
    if (principalSchool && principalSchool !== "*") {
      const evaluationSchool = await this.one(`SELECT school_code FROM schools WHERE id = $1`, [
        evaluation.school_id,
      ]);
      const evaluationSchoolCode = String(evaluationSchool?.school_code ?? "")
        .trim()
        .toUpperCase();
      if (evaluationSchoolCode && evaluationSchoolCode !== principalSchool) {
        pushStep(trace, {
          gate: "evaluation_school",
          result: "deny",
          principalSchool,
          evaluationSchoolCode,
        });
        return false;
      }
    }

    const lookupKeys = await this.collectTeacherLookupKeysForPrincipal(
      principal,
      evaluation.school_id,
    );
    pushStep(trace, {
      gate: "pg_teacher_lookup_for_evaluation",
      lookupValues: lookupKeys,
    });
    let pgTeacherFound = false;
    for (const lookupValue of lookupKeys) {
      const teacher = await this.one(
        `SELECT t.id, t.teacher_code
         FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.school_id = $1
           AND (
             t.teacher_code = $2
             OR u.user_code = $2
             OR u.id::text = $2
             OR t.id::text = $2
           )
         LIMIT 1`,
        [evaluation.school_id, lookupValue],
      );
      if (!teacher?.id) continue;
      pgTeacherFound = true;
      pushStep(trace, {
        gate: "pg_teacher_lookup_for_evaluation",
        result: "hit",
        lookupValue,
        teacherId: teacher.id,
        teacherCode: teacher.teacher_code,
      });
      // Exiger l'affectation classe+matière (ne pas se fier seul à evaluation.teacher_id).
      const assignment = await this.one(
        `SELECT 1 AS ok
         FROM teacher_assignments ta
         WHERE ta.teacher_id = $1
           AND ta.class_id = $2
           AND ta.subject_id = $3
           AND ta.status = 'active'
         LIMIT 1`,
        [teacher.id, evaluation.class_id, evaluation.subject_id],
      );
      if (assignment) {
        this._lastTeacherEvaluationAccessVia = "pg_teacher_assignment";
        pushStep(trace, {
          gate: "pg_teacher_assignment_subject",
          result: "allow",
          via: "pg_teacher_assignment",
          teacherId: teacher.id,
          classId: evaluation.class_id,
          subjectId: evaluation.subject_id,
        });
        return true;
      }
      pushStep(trace, {
        gate: "pg_teacher_assignment_subject",
        result: "miss",
        teacherId: teacher.id,
        classId: evaluation.class_id,
        subjectId: evaluation.subject_id,
      });
    }
    if (!pgTeacherFound) {
      pushStep(trace, {
        gate: "pg_teacher_lookup_for_evaluation",
        result: "miss",
        lookupValues: lookupKeys,
      });
    }

    // Fallback BO : affectation classe + matière (ID enseignant stable), même école.
    const state = (await this.getBackOfficeState()) ?? {};
    const className = String(student?.class_name ?? "").trim();
    const subjectRow = await this.one(`SELECT name FROM subjects WHERE id = $1`, [
      evaluation.subject_id,
    ]);
    const subjectName = String(subjectRow?.name ?? "").trim();
    if (!className || !subjectName) {
      pushStep(trace, {
        gate: "fallback_bo_evaluation",
        result: "deny",
        reason: "missing_class_or_subject_name",
      });
      return false;
    }

    const { resolveTeacherAssignments } = require("../services/authService");
    const principalSub = String(principal.sub ?? "").trim();
    const linkedTeachers = (state.teachers ?? []).filter((row) =>
      [row.userId, row.id, row.publicId].some((value) => String(value ?? "").trim() === principalSub),
    );
    const schoolCode = String(principal.schoolCode ?? "").trim().toUpperCase();
    pushStep(trace, {
      gate: "fallback_bo_evaluation",
      entering: true,
      linkedTeacherIds: linkedTeachers.map((row) => row.id),
      className,
      subjectName,
    });
    for (const teacher of linkedTeachers) {
      const assignments = resolveTeacherAssignments(teacher, principal, state.assignments ?? []);
      const matched = assignments.find((assignment) => {
        const assignmentSchool = String(assignment.schoolCode ?? "").trim().toUpperCase();
        if (schoolCode && assignmentSchool && schoolCode !== "*" && schoolCode !== assignmentSchool) {
          return false;
        }
        return (
          this.classNamesInclude([assignment.className], className) &&
          this.normalizeComparableText(assignment.course ?? assignment.subject) ===
            this.normalizeComparableText(subjectName)
        );
      });
      if (matched) {
        this._lastTeacherEvaluationAccessVia = "bo_assignment";
        pushStep(trace, {
          gate: "fallback_bo_evaluation",
          result: "allow",
          via: "bo_assignment",
          teacherId: teacher.id,
          assignmentId: matched.id ?? null,
        });
        return true;
      }
    }
    pushStep(trace, { gate: "fallback_bo_evaluation", result: "deny" });
    return false;
  }

  /**
   * HOTFIX-PRE-E1-02 — Clés stables enseignant pour le principal (jamais par nom seul).
   */
  async collectTeacherLookupKeysForPrincipal(principal = {}, schoolId = null) {
    const keys = new Set();
    const add = (value) => {
      const text = String(value ?? "").trim();
      if (text) keys.add(text);
    };
    add(principal.sub);
    add(principal.publicId);
    add(principal.identifier);

    const state = (await this.getBackOfficeState()) ?? {};
    const principalSub = String(principal.sub ?? "").trim();
    const principalIdentifier = this.normalizeComparableText(principal.identifier);
    const linkedTeachers = (state.teachers ?? []).filter((row) => {
      if (principalSub && [row.userId, row.id, row.publicId].some((v) => String(v ?? "").trim() === principalSub)) {
        return true;
      }
      if (principalIdentifier && this.normalizeComparableText(row.identifier) === principalIdentifier) {
        return true;
      }
      return false;
    });
    for (const boTeacher of linkedTeachers) {
      add(boTeacher.id);
      add(boTeacher.publicId);
      add(boTeacher.userId);
      add(boTeacher.identifier);
    }

    if (schoolId && principalSub) {
      const byUser = await this.one(
        `SELECT t.teacher_code
         FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.school_id = $1
           AND (u.id::text = $2 OR u.user_code = $2 OR t.teacher_code = $2)
         LIMIT 1`,
        [schoolId, principalSub],
      );
      add(byUser?.teacher_code);
    }

    return [...keys];
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

    const student = await this.resolveStudentForAttendance(payload, principal, { pedagogyStrict: true });
    if (!student || !student.class_id) {
      const error = new Error("Élève ou classe introuvable pour l'appel");
      error.statusCode = 404;
      throw error;
    }

    await this.assertPrincipalStudentTenant(principal, student);

    if (!(await this.teacherCanAccessStudentClass(principal, student))) {
      const error = new Error("Accès refusé: élève hors classe affectée.");
      error.statusCode = 403;
      throw error;
    }

    const isEnseignant = principal.role === "Enseignant";
    const teacherKey = isEnseignant
      ? String(principal.sub ?? "").trim()
      : this.extractExplicitTeacherKey(payload);
    if (!isEnseignant && !teacherKey) {
      throw this.teacherUnresolvedError(
        "ATTENDANCE_TEACHER_UNRESOLVED",
        "Clé enseignant explicite requise pour attribuer une présence (admin/direction).",
      );
    }
    const teacher = await this.findTeacherForAttendance(
      student.school_id,
      teacherKey,
      student.class_id,
      principal.role,
    );
    // Enseignant : parcours inchangé (teacher_id nullable si pas de match fiche).
    // Admin/direction : refus 409 si non résolu / ambigu — jamais d'auteur inventé.
    if (!isEnseignant && !teacher) {
      throw this.teacherUnresolvedError(
        "ATTENDANCE_TEACHER_UNRESOLVED",
        "Enseignant introuvable ou ambigu pour la présence.",
      );
    }
    const status = this.toAttendanceStatus(payload.status, payload.present);
    // D3.5b : Justifié = absence justifiée (pas de justificatif documentaire)
    const reason =
      payload.reason ?? (status === "excused" ? "Absence justifiée" : null);
    const row = await this.one(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (school_id, student_id, attendance_date)
       DO UPDATE SET
         status = EXCLUDED.status,
         reason = EXCLUDED.reason,
         teacher_id = EXCLUDED.teacher_id,
         class_id = EXCLUDED.class_id,
         updated_at = NOW()
       RETURNING id`,
      [
        student.school_id,
        student.id,
        student.class_id,
        teacher?.id ?? null,
        attendanceDate,
        status,
        reason,
      ],
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
      // Lot 2 — seed démo : pas d'auteur inventé (premier teacher) si authorId absent/non mappé.
      const teacherId = teacherIds.get(note.authorId);
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
      await this.query(
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
      await this.query(
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
    await this.query(
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
        await this.query(
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
      await this.query(
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
        await this.query(
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
        await this.query(
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
      await this.query(
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
      await this.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL, $7, 'active')
         ON CONFLICT (user_code) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email`,
        [schoolId, code, firstName, lastName, email, hashSecret("1234"), role]
      );
    }
  }

  async ensureSubjectScopes(schoolId) {
    await this.query(
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
    await this.query("DELETE FROM subjects WHERE id = $1", [subject.id]);
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

  async createAcademicYearV2(input = {}) {
    await this.init();
    const schoolCode = String(input.schoolCode ?? "").trim().toUpperCase();
    const name = String(input.name ?? "").trim();
    const startDate = String(input.startDate ?? "").trim();
    const endDate = String(input.endDate ?? "").trim();
    const isCurrent = input.isCurrent !== false;
    if (!schoolCode || !name || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      const error = new Error("Établissement, nom, date de début et date de fin sont requis.");
      error.statusCode = 400;
      throw error;
    }
    if (startDate >= endDate) {
      const error = new Error("La date de fin doit être postérieure à la date de début.");
      error.statusCode = 400;
      throw error;
    }
    const school = await this.ensureSchoolFromBackOfficeRecord(schoolCode);
    if (!school) {
      const error = new Error("Établissement introuvable.");
      error.statusCode = 404;
      throw error;
    }
    const duplicate = await this.one(
      "SELECT id FROM academic_years WHERE school_id = $1 AND lower(btrim(name)) = lower(btrim($2))",
      [school.id, name],
    );
    if (duplicate) {
      const error = new Error(`L'année scolaire « ${name} » existe déjà pour cet établissement.`);
      error.statusCode = 409;
      throw error;
    }
    if (isCurrent) {
      await this.query("UPDATE academic_years SET is_current = FALSE, updated_at = NOW() WHERE school_id = $1", [school.id]);
    }
    const row = await this.one(
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, $2, $3, $4, $5, 'open') RETURNING *`,
      [school.id, name, startDate, endDate, isCurrent],
    );
    return {
      id: row.id, schoolId: row.school_id, schoolCode, name: row.name,
      startDate: this.formatIsoDate(row.start_date), endDate: this.formatIsoDate(row.end_date),
      status: this.fromYearStatus(row.status), isCurrent: row.is_current,
      enrollmentCount: 0, gradeCount: 0, promotionDecisionCount: 0, notesLocked: false,
    };
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
    const { mapEstablishmentRow } = require("../lib/schoolsManagement");
    const mapped = mapEstablishmentRow(school, subscription);
    if (!mapped.subscriptionPlan) mapped.subscriptionPlan = subscription?.plan_name ?? "Essentiel";
    if (!mapped.subscriptionStatus && subscription?.status) {
      mapped.subscriptionStatus = this.fromSubscriptionStatus(subscription.status);
    }
    if (mapped.maxStudents == null) mapped.maxStudents = 1200;
    if (mapped.maxTeachers == null) mapped.maxTeachers = 120;
    if (!mapped.slogan) mapped.slogan = "Excellence et Innovation";
    return mapped;
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
      gender: user.gender ?? "",
      birthDate: this.formatDate(user.birth_date),
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
      "ADMIN-CG-2026-0001-01": "admin-cg",
      "ADMIN-BI-2026-0001-01": "admin-bi",
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
      lastName: teacher.last_name ?? "",
      gender: teacher.gender ?? "",
      birthDate: this.formatDate(teacher.birth_date),
      entryDate: this.formatDate(teacher.hire_date),
      phone: teacher.phone,
      email: teacher.email,
      mainSubject: teacher.speciality,
      speciality: teacher.speciality,
      mustChangePassword: Boolean(teacher.must_change_password),
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

  mapEvaluation(evaluation) {
    const { fromEvaluationStatus } = require("../lib/gradesCanonical");
    return {
      id: evaluation.legacy_json_id || evaluation.id,
      publicId: evaluation.legacy_json_id || evaluation.id,
      pgId: evaluation.id,
      schoolId: evaluation.school_id,
      schoolCode: evaluation.school_code,
      className: evaluation.class_name,
      subject: evaluation.subject_name,
      teacherId: evaluation.teacher_code,
      period: evaluation.term_name,
      title: evaluation.title,
      evaluationType: this.fromEvaluationType(evaluation.evaluation_type),
      date: this.formatDate(evaluation.evaluation_date),
      scale: Number(evaluation.max_score ?? 20),
      coefficient: Number(evaluation.coefficient ?? 1),
      status: fromEvaluationStatus(evaluation.status),
      active: evaluation.active !== false,
      createdAt: this.formatIsoDateTime(evaluation.created_at),
      updatedAt: this.formatIsoDateTime(evaluation.updated_at),
    };
  }

  mapGrade(grade) {
    const { fromGradeStatus } = require("../lib/gradesCanonical");
    const evaluationId =
      grade.evaluation_legacy_id || grade.evaluation_uuid || grade.evaluation_id || null;
    const gradeStatus = fromGradeStatus(grade.grade_status ?? (grade.score == null ? "not_submitted" : "graded"));
    const score = grade.score == null ? undefined : Number(grade.score);
    return {
      id: grade.id,
      schoolId: grade.school_id,
      schoolCode: grade.school_code,
      studentId: grade.student_code,
      className: grade.class_name,
      subject: grade.subject_name,
      value: score,
      score,
      coefficient: Number(grade.subject_coefficient ?? 1),
      date: this.formatDate(grade.created_at),
      evaluationId,
      evaluationTitle: grade.evaluation_title || grade.comment || this.fromEvaluationType(grade.grade_type),
      evaluationType: this.fromEvaluationType(grade.evaluation_type_pg || grade.grade_type),
      period: grade.term_name,
      scale: Number(grade.evaluation_max_score ?? grade.max_score ?? 20),
      evaluationCoefficient: Number(grade.evaluation_coefficient ?? grade.coefficient ?? 1),
      gradeStatus,
      status: gradeStatus,
      comment: grade.comment ?? "",
      version: Number(grade.version ?? 1),
      authorId: grade.teacher_code,
      enteredAt: this.formatDate(grade.created_at),
      audit: [
        {
          authorId: grade.teacher_code,
          newValue: score,
          date: this.formatDate(grade.created_at),
        },
      ],
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

  getSchoolsRepository() {
    if (!this._schoolsRepository) {
      const { createSchoolsRepository } = require("./schoolsRepository");
      this._schoolsRepository = createSchoolsRepository({
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
      });
    }
    return this._schoolsRepository;
  }

  listEstablishments() {
    return this.getSchoolsRepository().listAll();
  }

  async persistEstablishment(record) {
    const saved = await this.getSchoolsRepository().persist(record);
    this.cachedDataset = null;
    return saved;
  }

  /**
   * Classes métier — délégation au repository PostgreSQL dédié.
   */
  getClassesRepository() {
    if (!this._classesRepository) {
      const { createClassesRepository } = require("./classesRepository");
      this._classesRepository = createClassesRepository({
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
        getSchoolByCode: (code) => this.getSchoolByCode(code),
      });
    }
    return this._classesRepository;
  }

  listSchoolClasses(schoolCode) {
    return this.getClassesRepository().listBySchoolCode(schoolCode);
  }

  async createSchoolClass(body, schoolCode) {
    const created = await this.getClassesRepository().create(body, schoolCode);
    this.cachedDataset = null;
    return created;
  }

  async updateSchoolClass(classCode, schoolCode, body) {
    const updated = await this.getClassesRepository().update(classCode, schoolCode, body);
    this.cachedDataset = null;
    return updated;
  }

  getClassStudentsRepository() {
    if (!this._classStudentsRepository) {
      const { createClassStudentsRepository } = require("./classStudentsRepository");
      this._classStudentsRepository = createClassStudentsRepository({
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
        getSchoolByCode: (code) => this.getSchoolByCode(code),
        withTransaction: (fn) => this.withTransaction(fn),
      });
    }
    return this._classStudentsRepository;
  }

  listClassStudents(classCode, schoolCode) {
    return this.getClassStudentsRepository().listByClassCode(classCode, schoolCode);
  }

  listSchoolStudents(schoolCode) {
    return this.getClassStudentsRepository().listBySchoolCode(schoolCode);
  }

  async enrollStudentInClass(classCode, schoolCode, body) {
    const created = await this.getClassStudentsRepository().enroll(classCode, schoolCode, body);
    this.cachedDataset = null;
    return created;
  }

  getSchoolStudentByCode(studentCode, schoolCode) {
    return this.getClassStudentsRepository().getByStudentCode(studentCode, schoolCode);
  }

  async updateSchoolStudentByCode(studentCode, schoolCode, body) {
    const updated = await this.getClassStudentsRepository().updateByStudentCode(
      studentCode,
      schoolCode,
      body,
    );
    this.cachedDataset = null;
    return updated;
  }

  getTeachersRepository() {
    if (!this._teachersRepository) {
      const { createTeachersRepository } = require("./teachersRepository");
      this._teachersRepository = createTeachersRepository({
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
        getSchoolByCode: (code) => this.getSchoolByCode(code),
        withTransaction: (fn) => this.withTransaction(fn),
        createTxScope: (tx) => this.createTxScope(tx),
        recordAudit: (payload, tx) => this.recordAudit(payload, tx),
        onTeacherCreated: async () => {
          this.cachedDataset = null;
        },
      });
    }
    return this._teachersRepository;
  }

  listSchoolTeachers(schoolCode) {
    return this.getTeachersRepository().listBySchoolCode(schoolCode);
  }

  getSchoolTeacherByCode(teacherCode, schoolCode) {
    return this.getTeachersRepository().getByTeacherCode(teacherCode, schoolCode);
  }

  createSchoolTeacher(body, schoolCode, principal, auditMeta) {
    return this.getTeachersRepository().create(body, schoolCode, principal, auditMeta);
  }

  getTeacherLifecycleRepository() {
    if (!this._teacherLifecycleRepository) {
      const { createTeacherLifecycleRepository } = require("./teacherLifecycleRepository");
      this._teacherLifecycleRepository = createTeacherLifecycleRepository(this);
    }
    return this._teacherLifecycleRepository;
  }

  async updateSchoolTeacher(teacherCode, body, schoolCode, principal, auditMeta) {
    await this.getTeacherLifecycleRepository().update(
      teacherCode,
      body,
      schoolCode,
      principal,
      auditMeta,
    );
    this.cachedDataset = null;
    return this.getSchoolTeacherByCode(teacherCode, schoolCode);
  }

  async archiveSchoolTeacher(teacherCode, schoolCode, principal, auditMeta) {
    const result = await this.getTeacherLifecycleRepository().archive(
      teacherCode,
      schoolCode,
      principal,
      auditMeta,
    );
    this.cachedDataset = null;
    return result;
  }

  getTeacherAssignmentsRepository() {
    if (!this._teacherAssignmentsRepository) {
      const { createTeacherAssignmentsRepository } = require("./teacherAssignmentsRepository");
      this._teacherAssignmentsRepository = createTeacherAssignmentsRepository({
        one: (sql, params) => this.one(sql, params),
        all: (sql, params) => this.all(sql, params),
        query: (sql, params) => this.query(sql, params),
        getSchoolByCode: (code) => this.getSchoolByCode(code),
        withTransaction: (fn) => this.withTransaction(fn),
        createTxScope: (tx) => this.createTxScope(tx),
        recordAudit: (payload, tx) => this.recordAudit(payload, tx),
      });
    }
    return this._teacherAssignmentsRepository;
  }

  listSchoolTeacherAssignments(schoolCode) {
    return this.getTeacherAssignmentsRepository().listBySchoolCode(schoolCode);
  }

  createSchoolTeacherAssignment(body, schoolCode, principal, auditMeta) {
    return this.getTeacherAssignmentsRepository()
      .create(body, schoolCode, principal, auditMeta)
      .then((created) => {
        this.cachedDataset = null;
        return created;
      });
  }

  updateSchoolTeacherAssignment(assignmentId, body, schoolCode, principal, auditMeta) {
    return this.getTeacherAssignmentsRepository()
      .update(assignmentId, body, schoolCode, principal, auditMeta)
      .then((updated) => {
        this.cachedDataset = null;
        return updated;
      });
  }

  deleteSchoolTeacherAssignment(assignmentId, schoolCode, principal, auditMeta) {
    return this.getTeacherAssignmentsRepository()
      .remove(assignmentId, schoolCode, principal, auditMeta)
      .then((result) => {
        this.cachedDataset = null;
        return result;
      });
  }

  async getGradeById(id) {
    const grade = await this.one(
      `SELECT g.*, st.student_code, s.school_code, cl.class_code, cl.name AS class_name, sub.name AS subject_name,
              sub.coefficient AS subject_coefficient, t.teacher_code, term.name AS term_name,
              ev.id AS evaluation_uuid, ev.legacy_json_id AS evaluation_legacy_id,
              ev.title AS evaluation_title, ev.status AS evaluation_status,
              ev.max_score AS evaluation_max_score, ev.coefficient AS evaluation_coefficient,
              ev.evaluation_type AS evaluation_type_pg
       FROM grades g
       JOIN schools s ON s.id = g.school_id
       JOIN students st ON st.id = g.student_id
       JOIN classes cl ON cl.id = g.class_id
       JOIN subjects sub ON sub.id = g.subject_id
       JOIN teachers t ON t.id = g.teacher_id
       JOIN terms term ON term.id = g.term_id
       LEFT JOIN evaluations ev ON ev.id = g.evaluation_id
       WHERE g.id = $1`,
      [id],
    );
    return grade ? this.mapGrade(grade) : null;
  }

  /**
   * Lot 2 — erreur structurée attribution enseignant (notes / présences).
   * HTTP 409 : conflit d'état/résolution métier (contrat CTO).
   */
  teacherUnresolvedError(code, message) {
    const error = new Error(message);
    error.statusCode = 409;
    error.code = code;
    return error;
  }

  /** Clé enseignant explicite depuis payload (admin/direction). */
  extractExplicitTeacherKey(payload = {}) {
    return String(
      payload.teacherId ??
        payload.authorId ??
        payload.teacher_code ??
        payload.teacherCode ??
        "",
    ).trim();
  }

  /**
   * Lot 2 — résolution unique scopée école (0 ou >1 → null = unresolved/ambiguous).
   * Aucun ORDER BY created_at / premier de l'école.
   */
  async resolveUniqueTeacherInSchool(schoolId, teacherKey) {
    const key = String(teacherKey ?? "").trim();
    if (!key || !schoolId) return null;
    const rows = await this.all(
      `SELECT t.*
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.school_id = $1
         AND (
           t.teacher_code = $2
           OR u.user_code = $2
           OR u.id::text = $2
           OR t.id::text = $2
         )`,
      [schoolId, key],
    );
    if (!rows || rows.length !== 1) return null;
    return rows[0];
  }

  async findTeacherForGrade(schoolId, teacherCode, classId, subjectId, principalRole) {
    // Lot 2 — admin/direction : clé explicite unique scopée école uniquement.
    if (principalRole !== "Enseignant") {
      return this.resolveUniqueTeacherInSchool(schoolId, teacherCode);
    }

    // HOTFIX-PRE-E1-02 : tenter toutes les clés stables du principal (userId, teacher_code BO…).
    const lookupKeys = new Set();
    const add = (value) => {
      const text = String(value ?? "").trim();
      if (text) lookupKeys.add(text);
    };
    add(teacherCode);
    for (const key of await this.collectTeacherLookupKeysForPrincipal(
      { sub: teacherCode, role: principalRole },
      schoolId,
    )) {
      add(key);
    }

    let assignedTeacher = null;
    for (const key of lookupKeys) {
      assignedTeacher = await this.one(
        `SELECT t.*
         FROM teachers t
         JOIN teacher_assignments ta ON ta.teacher_id = t.id
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.school_id = $1
           AND (
             t.teacher_code = $2
             OR u.user_code = $2
             OR u.id::text = $2
             OR t.id::text = $2
           )
           AND ta.class_id = $3
           AND ta.subject_id = $4
           AND ta.status = 'active'
         LIMIT 1`,
        [schoolId, key, classId, subjectId],
      );
      if (assignedTeacher) break;
    }

    return assignedTeacher;
  }

  async findTeacherForAttendance(schoolId, teacherCode, classId, principalRole) {
    // Lot 2 — admin/direction : clé explicite unique scopée école uniquement.
    if (principalRole !== "Enseignant") {
      return this.resolveUniqueTeacherInSchool(schoolId, teacherCode);
    }

    const lookupCode = String(teacherCode ?? "").trim();
    if (!lookupCode) return null;
    // Parcours Enseignant inchangé : match par clé + préférence affectation classe.
    return this.one(
      `SELECT t.*
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.class_id = $3
       WHERE t.school_id = $1
         AND (
           t.teacher_code = $2
           OR u.user_code = $2
           OR u.id::text = $2
           OR t.id::text = $2
         )
       ORDER BY CASE WHEN ta.id IS NULL THEN 1 ELSE 0 END, t.created_at
       LIMIT 1`,
      [schoolId, lookupCode, classId],
    );
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
    const normalized = String(status ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (normalized === "absent" || normalized === "absence") return "absent";
    if (normalized === "retard" || normalized === "late") return "late";
    // Justifié = absence justifiée (contrat D3.5b)
    if (
      normalized === "justifie" ||
      normalized === "justifiee" ||
      normalized === "excused" ||
      normalized === "excuse"
    ) {
      return "excused";
    }
    if (normalized === "present" || normalized === "present.") return "present";
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

  async findIdempotencyRecord(cacheId) {
    await this.init();
    const row = await this.query(
      "SELECT cache_id, status_code, response_body, expires_at FROM idempotency_keys WHERE cache_id = $1 LIMIT 1",
      [String(cacheId ?? "")],
    );
    return row.rows[0] ?? null;
  }

  async saveIdempotencyRecord({ cacheId, routeKey, principalId, statusCode, responseBody, expiresAt }) {
    await this.init();
    await this.query(
      `INSERT INTO idempotency_keys (cache_id, route_key, principal_id, status_code, response_body, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (cache_id) DO UPDATE SET
         status_code = EXCLUDED.status_code,
         response_body = EXCLUDED.response_body,
         expires_at = EXCLUDED.expires_at`,
      [
        String(cacheId ?? ""),
        String(routeKey ?? ""),
        String(principalId ?? ""),
        Number(statusCode ?? 200),
        JSON.stringify(responseBody ?? {}),
        expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ],
    );
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

function evaluationPatchTouches(evaluation = {}, keys = []) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(evaluation, key));
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
