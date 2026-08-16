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
    await this.ensureLoginLockoutsCanonicalSchema();
    this.attachLoginLockoutStore();
    await this.ensureSchoolsCanonicalColumns();
    await this.ensureAttendanceCanonicalUniqueness();
    await this.ensureNotesCanonicalPersistence();
    await this.ensureClassesDomainConstraints();
    await this.ensureTeachersDomainConstraints();
    await this.ensureTeacherAssignmentsActiveUniqueness();
    await this.ensureUsersLoginIdentityConstraints();
    await this.ensureFinanceCanonicalSchema();
    await this.ensurePedagogyCanonicalSchema();
    await this.ensurePlatformCanonicalSchema();
    await this.ensurePlatformRolePermissionsBootstrap();
    await this.ensureClientsCanonicalSchema();
    await this.ensureUserRolesCanonicalSchema();
    await this.ensureResidualCanonicalSchema();
    await this.ensureEducationReferencePreflight();
    await this.ensureEducationReferenceConstraints();
    await this.ensureEducationReferenceCanonicalSchema();
    await this.stripLegacyAcademicReferencePayloads();
    await this.ensureEstablishmentRolesPreflight();
    await this.ensureEstablishmentRolesConstraints();
    await this.ensureEstablishmentRolesCanonicalSchema();
    await this.stripLegacyUserRolesPayloads();
    await this.ensureEstablishmentRolesBootstrap();
    await this.ensureEvaluationTypesPreflight();
    await this.ensureEvaluationTypesConstraints();
    await this.ensureEvaluationTypesCanonicalSchema();
    await this.stripLegacyEvaluationTypesPayloads();
    await this.ensureEvaluationTypesBootstrap();
    await this.runSchoolSettingsCanonicalBoot();
    await this.runDocumentsExamsCanonicalBoot();
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

  async ensureLoginLockoutsCanonicalSchema() {
    const { LOGIN_LOCKOUTS_SCHEMA_SQL } = require("./loginLockoutSchema");
    await this.query(LOGIN_LOCKOUTS_SCHEMA_SQL);
  }

  attachLoginLockoutStore() {
    const { attachPostgresLoginLockoutStore } = require("../lib/loginLockout");
    attachPostgresLoginLockoutStore(this);
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
        if (prop === "withReadOnlyRepeatableRead") {
          return async (fn) => fn(receiver, tx);
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

  /**
   * Snapshot lecture LOT 6 : une seule connexion, READ ONLY + REPEATABLE READ.
   * Toutes les lectures d'export doivent passer par le scoped repo (createTxScope).
   */
  async withReadOnlyRepeatableRead(fn) {
    const client = await this.pool.connect();
    const tx = createTxAdapter(client);
    try {
      await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
      const scoped = this.createTxScope(tx);
      const result = await fn(scoped, tx);
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
        console.warn(`[D3.6b] Note legacy non migrée (${note.id ?? "?"}): ${error.message}`);
      }
    }
    if (anomalyCount > 0) {
      console.warn(`[D3.6b] Notes legacy : ${anomalyCount} anomalie(s) détectée(s), aucune suppression silencieuse.`);
    }
  }

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

  async ensurePlatformRolePermissionsBootstrap() {
    const seedData = require("../data");
    const platformRoles = [
      "Super Administrateur Somafrik",
      "Super Administrateur OKAFRIK",
      "Admin Pays",
      "Admin School",
    ];
    for (const roleName of platformRoles) {
      const existing = await this.one(`SELECT role_name FROM role_permissions WHERE role_name = $1`, [roleName]);
      if (existing) continue;
      await this.query(
        `INSERT INTO role_permissions (role_name, permissions, updated_at)
         VALUES ($1, $2::jsonb, NOW())`,
        [roleName, JSON.stringify(seedData.rolePermissions?.[roleName] ?? [])],
      );
    }
  }

  async ensureClientsCanonicalSchema() {
    const { CLIENTS_SCHEMA_SQL } = require("./clientsSchema");
    await this.query(CLIENTS_SCHEMA_SQL);
  }

  async ensureUserRolesCanonicalSchema() {
    const {
      USER_ROLES_SCHEMA_SQL,
      USER_ROLES_MIGRATION_AMBIGUOUS,
      INVENTORY_UNKNOWN_USERS_ROLE_SQL,
      INVENTORY_UNKNOWN_SECONDARY_ROLES_SQL,
      BACKFILL_FROM_USERS_ROLE_SQL,
      BACKFILL_FROM_SECONDARY_ROLES_SQL,
    } = require("./userRolesSchema");
    const unknownRoles = await this.all(INVENTORY_UNKNOWN_USERS_ROLE_SQL);
    const profilePayloadColumns = await this.all(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'users'
         AND column_name = 'profile_payload'`,
    );
    const hasProfilePayload = profilePayloadColumns.length > 0;
    const unknownSecondary = hasProfilePayload ? await this.all(INVENTORY_UNKNOWN_SECONDARY_ROLES_SQL) : [];
    if (unknownRoles.length || unknownSecondary.length) {
      console.error(
        "[user-roles] préflight ambigu :",
        JSON.stringify({ unknownRoles, unknownSecondary }),
      );
      const error = new Error(
        "USER_ROLES_MIGRATION_AMBIGUOUS: rôles utilisateurs non déterministes. Conversion refusée.",
      );
      error.code = USER_ROLES_MIGRATION_AMBIGUOUS;
      error.details = { unknownRoles, unknownSecondary };
      throw error;
    }
    await this.query(USER_ROLES_SCHEMA_SQL);
    await this.query(BACKFILL_FROM_USERS_ROLE_SQL);
    if (hasProfilePayload) {
      await this.query(BACKFILL_FROM_SECONDARY_ROLES_SQL);
    }
  }

  async ensureResidualCanonicalSchema() {
    const { RESIDUAL_STATE_SCHEMA_SQL } = require("./residualStateSchema");
    await this.query(RESIDUAL_STATE_SCHEMA_SQL);
  }

  async ensureEducationReferencePreflight() {
    const { assertEducationReferenceSchemaPreflight } = require("./educationReferenceSchema");
    await assertEducationReferenceSchemaPreflight(this);
  }

  async ensureEducationReferenceCanonicalSchema() {
    const { EDUCATION_REFERENCE_SCHEMA_SQL } = require("./educationReferenceSchema");
    await this.query(EDUCATION_REFERENCE_SCHEMA_SQL);
  }

  async stripLegacyAcademicReferencePayloads() {
    const { stripLegacyAcademicReferencePayloads } = require("../lib/educationReferenceService");
    await stripLegacyAcademicReferencePayloads(this);
  }

  async ensureEducationReferenceConstraints() {
    const { ensureEducationReferenceConstraints } = require("../lib/educationReferenceService");
    await ensureEducationReferenceConstraints(this, console);
  }

  getEducationReferenceStore() {
    if (!this._educationReferenceStore) {
      const { createEducationReferencePgStore } = require("./educationReferencePgStore");
      this._educationReferenceStore = createEducationReferencePgStore(this);
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

  saveSchoolEducationActivation(schoolCode, activation, principal, auditMeta) {
    const { saveSchoolActivation } = require("../lib/educationReferenceService");
    return saveSchoolActivation(this, schoolCode, activation, principal, auditMeta);
  }

  async ensureEstablishmentRolesPreflight() {
    const { assertEstablishmentRolesSchemaPreflight } = require("./establishmentRolesSchema");
    await assertEstablishmentRolesSchemaPreflight(this);
  }

  async ensureEstablishmentRolesCanonicalSchema() {
    const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("./establishmentRolesSchema");
    await this.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
  }

  async stripLegacyUserRolesPayloads() {
    const { stripLegacyUserRolesPayloads } = require("../lib/establishmentRolesService");
    await stripLegacyUserRolesPayloads(this);
  }

  async ensureEstablishmentRolesConstraints() {
    const { ensureEstablishmentRolesConstraints } = require("../lib/establishmentRolesService");
    await ensureEstablishmentRolesConstraints(this, console);
  }

  async ensureEstablishmentRolesBootstrap() {
    const { ensureEstablishmentRolesBootstrap } = require("../lib/establishmentRolesService");
    await ensureEstablishmentRolesBootstrap(this);
  }

  getEstablishmentRolesStore() {
    if (!this._establishmentRolesStore) {
      const { createEstablishmentRolesPgStore } = require("./establishmentRolesPgStore");
      this._establishmentRolesStore = createEstablishmentRolesPgStore(this);
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

  async ensureEvaluationTypesPreflight() {
    const { assertEvaluationTypesSchemaPreflight } = require("./evaluationTypesSchema");
    await assertEvaluationTypesSchemaPreflight(this);
  }

  async ensureEvaluationTypesCanonicalSchema() {
    const { EVALUATION_TYPES_SCHEMA_SQL } = require("./evaluationTypesSchema");
    await this.query(EVALUATION_TYPES_SCHEMA_SQL);
  }

  async stripLegacyEvaluationTypesPayloads() {
    const { stripLegacyEvaluationTypesPayloads } = require("../lib/evaluationTypesService");
    await stripLegacyEvaluationTypesPayloads(this);
  }

  async ensureEvaluationTypesConstraints() {
    const { ensureEvaluationTypesConstraints } = require("../lib/evaluationTypesService");
    await ensureEvaluationTypesConstraints(this, console);
  }

  async ensureEvaluationTypesBootstrap() {
    const { ensureEvaluationTypesBootstrap } = require("../lib/evaluationTypesService");
    await ensureEvaluationTypesBootstrap(this);
  }

  getEvaluationTypesStore() {
    const { createEvaluationTypesPgStore } = require("./evaluationTypesPgStore");
    return createEvaluationTypesPgStore(this);
  }

  async runSchoolSettingsCanonicalBoot() {
    const { runSchoolSettingsCanonicalBoot } = require("../lib/schoolSettingsService");
    return runSchoolSettingsCanonicalBoot(this, console);
  }

  async ensureSchoolSettingsPreflight() {
    const { assertSchoolSettingsSchemaPreflight } = require("./schoolSettingsSchema");
    await assertSchoolSettingsSchemaPreflight(this);
  }

  async ensureSchoolSettingsCanonicalSchema() {
    const { SCHOOL_SETTINGS_SCHEMA_SQL } = require("./schoolSettingsSchema");
    await this.query(SCHOOL_SETTINGS_SCHEMA_SQL);
  }

  async stripLegacySchoolSettingsPayloads() {
    const { stripLegacySchoolSettingsPayloads } = require("../lib/schoolSettingsService");
    await stripLegacySchoolSettingsPayloads(this);
  }

  async ensureSchoolSettingsConstraints() {
    const { ensureSchoolSettingsConstraints } = require("../lib/schoolSettingsService");
    return ensureSchoolSettingsConstraints(this, console);
  }

  async ensureSchoolSettingsBootstrap(captured) {
    const { ensureSchoolSettingsBootstrap } = require("../lib/schoolSettingsService");
    await ensureSchoolSettingsBootstrap(this, captured);
  }

  async verifySchoolSettingsMaterialized(captured) {
    const { verifySchoolSettingsMaterialized } = require("../lib/schoolSettingsService");
    await verifySchoolSettingsMaterialized(this, captured);
  }

  getSchoolSettingsStore() {
    const { createSchoolSettingsPgStore } = require("./schoolSettingsPgStore");
    return createSchoolSettingsPgStore(this);
  }

  getSchoolSettings(principal, schoolCode) {
    const { getSchoolSettings } = require("../lib/schoolSettingsService");
    return getSchoolSettings(this, principal, schoolCode);
  }

  patchSchoolSettings(payload, principal, auditMeta, schoolCode) {
    const { patchSchoolSettings } = require("../lib/schoolSettingsService");
    return patchSchoolSettings(this, payload, principal, auditMeta, schoolCode);
  }

  replaceAcademicPeriods(payload, principal, auditMeta, schoolCode) {
    const { replaceAcademicPeriods } = require("../lib/schoolSettingsService");
    return replaceAcademicPeriods(this, payload, principal, auditMeta, schoolCode);
  }

  async runDocumentsExamsCanonicalBoot() {
    const { runDocumentsExamsCanonicalBoot } = require("../lib/documentsExamsService");
    return runDocumentsExamsCanonicalBoot(this, console);
  }

  getDocumentsExamsStore() {
    const { createDocumentsExamsPgStore } = require("./documentsExamsPgStore");
    return createDocumentsExamsPgStore(this);
  }

  async listDocumentsExamsProjection() {
    const schools = await this.all(`SELECT id, school_code FROM schools`);
    const exams = [];
    const bulletins = [];
    const documents = [];
    const store = this.getDocumentsExamsStore();
    for (const school of schools) {
      exams.push(...(await store.listExams(school.id)));
      bulletins.push(...(await store.listReportCards(school.id)));
      documents.push(...(await store.listSchoolDocuments(school.id)));
    }
    return { exams, bulletins, documents };
  }

  listExams(principal, schoolCode) {
    const { listExams } = require("../lib/documentsExamsService");
    return listExams(this, principal, schoolCode);
  }

  getExam(examId, principal, schoolCode) {
    const { getExam } = require("../lib/documentsExamsService");
    return getExam(this, principal, examId, schoolCode);
  }

  createExam(payload, principal, auditMeta, schoolCode) {
    const { createExam } = require("../lib/documentsExamsService");
    return createExam(this, payload, principal, auditMeta, schoolCode);
  }

  patchExam(examId, payload, principal, auditMeta, schoolCode) {
    const { patchExam } = require("../lib/documentsExamsService");
    return patchExam(this, principal, examId, payload, auditMeta, schoolCode);
  }

  validateExam(examId, principal, auditMeta, schoolCode) {
    const { validateExam } = require("../lib/documentsExamsService");
    return validateExam(this, principal, examId, auditMeta, schoolCode);
  }

  cancelExam(examId, principal, auditMeta, schoolCode) {
    const { cancelExam } = require("../lib/documentsExamsService");
    return cancelExam(this, principal, examId, auditMeta, schoolCode);
  }

  archiveExam(examId, principal, auditMeta, schoolCode) {
    const { archiveExam } = require("../lib/documentsExamsService");
    return archiveExam(this, principal, examId, auditMeta, schoolCode);
  }

  listReportCards(principal, schoolCode) {
    const { listReportCards } = require("../lib/documentsExamsService");
    return listReportCards(this, principal, schoolCode);
  }

  generateReportCard(payload, principal, auditMeta, schoolCode) {
    const { generateReportCard } = require("../lib/documentsExamsService");
    return generateReportCard(this, payload, principal, auditMeta, schoolCode);
  }

  publishReportCard(cardId, principal, auditMeta, schoolCode) {
    const { publishReportCard } = require("../lib/documentsExamsService");
    return publishReportCard(this, cardId, principal, auditMeta, schoolCode);
  }

  archiveReportCard(cardId, principal, auditMeta, schoolCode) {
    const { archiveReportCard } = require("../lib/documentsExamsService");
    return archiveReportCard(this, cardId, principal, auditMeta, schoolCode);
  }

  listReportCardTemplates(principal, schoolCode) {
    const { listTemplates } = require("../lib/documentsExamsService");
    return listTemplates(this, principal, schoolCode);
  }

  upsertReportCardTemplate(payload, principal, auditMeta, schoolCode) {
    const { upsertTemplate } = require("../lib/documentsExamsService");
    return upsertTemplate(this, payload, principal, auditMeta, schoolCode);
  }

  archiveReportCardTemplate(templateId, principal, auditMeta, schoolCode) {
    const { archiveTemplate } = require("../lib/documentsExamsService");
    return archiveTemplate(this, templateId, principal, auditMeta, schoolCode);
  }

  listSchoolDocuments(principal, schoolCode) {
    const { listSchoolDocuments } = require("../lib/documentsExamsService");
    return listSchoolDocuments(this, principal, schoolCode);
  }

  createSchoolDocument(payload, principal, auditMeta, schoolCode) {
    const { createSchoolDocument } = require("../lib/documentsExamsService");
    return createSchoolDocument(this, payload, principal, auditMeta, schoolCode);
  }

  patchSchoolDocument(documentId, payload, principal, auditMeta, schoolCode) {
    const { patchSchoolDocument } = require("../lib/documentsExamsService");
    return patchSchoolDocument(this, documentId, payload, principal, auditMeta, schoolCode);
  }

  archiveSchoolDocument(documentId, principal, auditMeta, schoolCode) {
    const { archiveSchoolDocument } = require("../lib/documentsExamsService");
    return archiveSchoolDocument(this, documentId, principal, auditMeta, schoolCode);
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

    const rows = await this.all(
      `SELECT a.*, s.school_code, u.user_code
       FROM audit_logs a
       LEFT JOIN schools s ON s.id = a.school_id
       LEFT JOIN users u ON u.id = a.user_id
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY a.created_at DESC
       LIMIT ${Math.max(1, Math.min(500, Number(limit) || 100))}`,
      params,
    );
    return rows;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresRepository, roleToDb, roleFromDb };
