"use strict";

/**
 * PERF-PR2 — agrégats du tableau de bord établissement.
 * PostgreSQL uniquement, école résolue depuis le principal, jamais depuis
 * un school_id client. Aucun repli vers une projection globale.
 */

const { isPlatformAdminPrincipal } = require("./platformPersonalDataGuard");
const { resolveSchoolTimeZone } = require("./planningWeeklyOccurrences");
const { resolveSchoolDashboardPrincipal } = require("./schoolDashboardActivities");

const PERIODS = Object.freeze(["daily", "weekly", "monthly", "quarterly", "annual"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_ZONE_SQL_RE = /^[A-Za-z0-9_+\/-]{1,80}$/;

const FOLD_FROM = "ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿÇçÑñ";
const FOLD_TO = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyyCcNn";

const INTERNAL_ROLES = new Set([
  "admin school",
  "administrateur ecole",
  "administrateur etablissement",
  "school_admin",
  "secretaire",
  "secretary",
  "prefet des etudes",
  "prefet des etude",
  "prefet",
  "proviseur / directeur",
  "proviseur",
  "directeur",
  "directeur adjoint",
  "comptable",
  "principal",
  "enseignant",
  "teacher",
  "surveillant",
]);

const EXCLUDED_STUDENT_STATUSES = [
  "archived",
  "archive",
  "archivee",
  "inactive",
  "inactif",
  "disabled",
  "desactive",
  "deleted",
  "supprime",
  "desinscrit",
  "unenrolled",
  "transfere",
  "transferred",
  "sorti",
];

const INACTIVE_USER_STATUSES = [
  "archived",
  "archive",
  "archivee",
  "suspendu",
  "suspended",
  "desactive",
  "disabled",
  "inactive",
  "inactif",
  "deleted",
  "supprime",
];

const PERIOD_LABELS = {
  daily: "Quotidien",
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
  quarterly: "Trimestriel",
  annual: "Annuel",
};

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function sqlFold(expression) {
  return `lower(translate(${expression}, '${FOLD_FROM}', '${FOLD_TO}'))`;
}

function isTeacherRole(role) {
  const key = fold(role);
  return key === "enseignant" || key === "teacher";
}

function canRead(principal, feature) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  if (permissions.includes("ALL_PRIVILEGES")) return true;
  if (permissions.includes(`${feature}:READ`) || permissions.includes(`${feature}:R`) || permissions.includes(`${feature}:CRUD`)) {
    return true;
  }
  const featureKey = fold(feature);
  return permissions.some((permission) => {
    const key = fold(permission);
    if (!key.includes(featureKey)) return false;
    return (
      key.includes("read") ||
      key.includes("voir") ||
      key.includes("lire") ||
      key.includes("gerer")
    );
  });
}

function accessFor(principal) {
  return {
    students: canRead(principal, "Élèves"),
    teachers: canRead(principal, "Enseignants"),
    classes: canRead(principal, "Classes"),
    payments: canRead(principal, "Paiements"),
    presences: canRead(principal, "Présences"),
    notes: canRead(principal, "Notes"),
    exams: canRead(principal, "Examens"),
    bulletins: canRead(principal, "Bulletins"),
    documents: canRead(principal, "Documents"),
    users: canRead(principal, "Utilisateurs"),
    announcements: canRead(principal, "Annonces") || canRead(principal, "Announcements"),
  };
}

function assertReadable(access) {
  if (!Object.values(access).some(Boolean)) {
    throw httpError(403, "Aucun droit de consultation du tableau de bord.");
  }
}

async function resolveSchoolKpiPrincipal(principal, lookupSchool) {
  if (isPlatformAdminPrincipal(principal)) {
    throw httpError(403, "Les indicateurs scolaires ne sont pas accessibles à l'administration plateforme.");
  }
  if (!INTERNAL_ROLES.has(fold(principal?.role))) {
    throw httpError(403, "Accès aux indicateurs réservé au personnel de l'établissement.");
  }
  return resolveSchoolDashboardPrincipal(principal, lookupSchool);
}

function schoolIdOf(principal) {
  const schoolId = String(principal?.effectiveSchoolId ?? principal?.schoolId ?? "").trim();
  if (!UUID_RE.test(schoolId)) {
    throw httpError(403, "Périmètre établissement indisponible.");
  }
  return schoolId;
}

function sqlTimeZone(raw) {
  const zone = resolveSchoolTimeZone(raw);
  return TIME_ZONE_SQL_RE.test(zone) ? zone : resolveSchoolTimeZone("");
}

function civilDate(now, timeZone = resolveSchoolTimeZone("")) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), iso: `${get("year")}-${get("month")}-${get("day")}` };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function periodBounds(period, now = new Date(), timeZone = resolveSchoolTimeZone("")) {
  if (!PERIODS.includes(period)) {
    throw httpError(400, "Période invalide.");
  }
  const today = civilDate(now, timeZone);
  let start = today.iso;
  if (period === "weekly") start = addDays(today.iso, -6);
  if (period === "monthly") start = isoDate(today.year, today.month, 1);
  if (period === "quarterly") {
    const quarterMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
    start = isoDate(today.year, quarterMonth, 1);
  }
  if (period === "annual") start = isoDate(today.year, 1, 1);
  return { period, startDate: start, endDate: today.iso, today: today.iso, timeZone };
}

function formatFrDate(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function periodLabel(bounds) {
  return `${PERIOD_LABELS[bounds.period]} · ${formatFrDate(bounds.startDate)} – ${formatFrDate(bounds.endDate)}`;
}

function num(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function int(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function isCountedCashStatus(status) {
  const key = fold(status);
  if (key.includes("annul") || key.includes("cancel")) return false;
  if (key.includes("attente") || key === "pending") return false;
  if (key === "refuse" || key === "echoue" || key === "failed" || key.includes("brouillon")) return false;
  return true;
}

function currencyKey(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  return raw === "FC" ? "CDF" : raw;
}

function revenueFromRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!isCountedCashStatus(row.status ?? row.payment_status ?? "paid")) continue;
    const key = currencyKey(row.currency);
    grouped.set(key, (grouped.get(key) ?? 0) + num(row.collected ?? row.amount));
  }
  const buckets = [...grouped.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((left, right) => {
      if (!left.currency) return 1;
      if (!right.currency) return -1;
      return left.currency.localeCompare(right.currency, "fr");
    });
  if (buckets.length !== 1 || !buckets[0].currency) {
    return { display: "—", currency: null, amount: null, buckets };
  }
  const display = `${new Intl.NumberFormat("fr-FR").format(buckets[0].amount)} ${buckets[0].currency}`;
  return { display, currency: buckets[0].currency, amount: buckets[0].amount, buckets };
}

function paymentRateFromAggregate(row) {
  const empty = { label: "Taux de paiement", value: "—", rate: null, expectedAmount: 0, collectedAmount: 0 };
  if (!row || int(row.rows) <= 0) return empty;
  if (int(row.currencies) !== 1 || row.missing === true) return empty;
  const expectedAmount = num(row.expected);
  const collectedAmount = num(row.collected);
  if (expectedAmount <= 0) return empty;
  const bounded = Math.min(collectedAmount, expectedAmount);
  const rate = Math.round((bounded / expectedAmount) * 100);
  return {
    label: "Taux de paiement",
    value: `${rate} %`,
    rate,
    expectedAmount,
    collectedAmount: bounded,
  };
}

function attendanceFromCounts(row) {
  const expected = int(row?.expected);
  const recorded = int(row?.recorded);
  const attended = int(row?.attended);
  if (!expected || recorded !== expected) {
    return { label: "Présence du jour", value: "—", rate: null, expected, attended, recorded };
  }
  const rate = Math.round((attended / expected) * 100);
  return { label: "Présence du jour", value: `${rate} %`, rate, expected, attended, recorded };
}

function paymentStatusLabel(status) {
  const key = fold(status).replace(/\s+/g, "_");
  if (key === "paye" || key === "paid") return "Payé";
  if (key === "en_attente" || key === "pending") return "En attente";
  if (key === "impaye" || key === "overdue") return "Impayé";
  const raw = String(status ?? "").trim();
  return raw || "Non renseigné";
}

function paymentAmountLabel(status) {
  const key = fold(status);
  if (key.includes("paye") || key === "paid") return "Payé";
  if (key.includes("attente") || key === "pending") return "En attente";
  return "Autre";
}

function mergeCounts(rows, labelOf) {
  const counts = new Map();
  for (const row of rows) {
    const label = labelOf(row.status ?? row.name);
    counts.set(label, (counts.get(label) ?? 0) + num(row.value ?? row.count));
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "fr"));
}

function presenceSeries(row) {
  const present = int(row?.present);
  const absent = int(row?.absent);
  const late = int(row?.late);
  const justified = int(row?.justified);
  const total = present + absent + late + justified;
  return {
    present,
    absent,
    late,
    justified,
    total,
    rate: total ? Math.round(((present + late) / total) * 100) : 0,
  };
}

async function teacherClassIds(repository, schoolId, principal) {
  if (!isTeacherRole(principal?.role)) return null;
  const userId = String(principal?.id ?? principal?.userId ?? principal?.sub ?? "").trim();
  if (!UUID_RE.test(userId)) return [];
  const rows = await repository.all(
    `SELECT DISTINCT class_id
     FROM (
       SELECT ta.class_id
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id AND t.school_id = ta.school_id
       WHERE ta.school_id = $1::uuid AND t.user_id = $2::uuid AND ta.status = 'active'
       UNION
       SELECT ht.class_id
       FROM class_head_teachers ht
       JOIN teachers t ON t.id = ht.teacher_id AND t.school_id = ht.school_id
       WHERE ht.school_id = $1::uuid AND t.user_id = $2::uuid AND ht.status = 'active'
     ) assigned
     WHERE class_id IS NOT NULL`,
    [schoolId, userId],
  );
  return rows.map((row) => String(row.class_id)).filter((id) => UUID_RE.test(id));
}

/**
 * Comptes d'annuaire (enseignants, utilisateurs, annonces) : toute l'école pour
 * l'administration, et pour un enseignant seulement s'il a au moins une classe.
 */
function schoolWideOpenSql(paramIndex = 2) {
  return `($${paramIndex}::uuid[] IS NULL OR cardinality($${paramIndex}::uuid[]) > 0)`;
}

/**
 * Lignes rattachées à un élève (paiements, frais) : toute l'école pour
 * l'administration ($2 NULL), sinon uniquement les élèves inscrits dans les
 * classes de l'enseignant. Une liste vide ne retient aucune ligne.
 */
function teacherStudentScopeSql(column) {
  return `($2::uuid[] IS NULL OR ${column} IN (
    SELECT e.student_id FROM enrollments e
     WHERE e.school_id = $1::uuid
       AND e.class_id = ANY($2::uuid[])
       AND e.closed_at IS NULL
       AND e.transferred_at IS NULL))`;
}

async function loadSchoolTimeZone(repository, schoolId) {
  const rows = await repository.all(
    `SELECT profile_payload->>'timezone' AS timezone FROM schools WHERE id = $1::uuid`,
    [schoolId],
  );
  return sqlTimeZone(rows[0]?.timezone);
}

function sqlTextList(values) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
}

function scopedStudentsSql() {
  return `
  SELECT s.id,
         enr.class_id,
         COALESCE(NULLIF(btrim(c.name), ''), '') AS class_name,
         CASE WHEN NULLIF(btrim(c.level), '') IS NULL THEN 'Non renseigné' ELSE btrim(c.level) END AS level_name,
         (${sqlFold("COALESCE(s.status, '')")} = ANY(ARRAY[${sqlTextList(EXCLUDED_STUDENT_STATUSES)}]::text[])) AS excluded,
         (enr.class_id IS NOT NULL) AS enrolled
  FROM students s
  LEFT JOIN LATERAL (
    SELECT e.class_id
    FROM enrollments e
    WHERE e.school_id = s.school_id
      AND e.student_id = s.id
      AND e.class_id IS NOT NULL
      AND e.closed_at IS NULL
      AND e.transferred_at IS NULL
    ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC
    LIMIT 1
  ) enr ON TRUE
  LEFT JOIN classes c ON c.id = enr.class_id AND c.school_id = s.school_id
  WHERE s.school_id = $1::uuid
    AND ($2::uuid[] IS NULL OR enr.class_id = ANY($2::uuid[]))
`;
}

function periodActivityStudentsSql(startParam, endParam, timeZone) {
  return `
    SELECT a.student_id FROM attendance a
     WHERE a.school_id = $1::uuid
       AND a.attendance_date >= $${startParam}::date
       AND a.attendance_date <= $${endParam}::date
       AND ($2::uuid[] IS NULL OR a.class_id = ANY($2::uuid[]))
    UNION
    SELECT g.student_id FROM grades g
     WHERE g.school_id = $1::uuid
       AND g.created_at >= ($${startParam}::timestamp AT TIME ZONE '${timeZone}')
       AND g.created_at <= (($${endParam}::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}')
       AND ($2::uuid[] IS NULL OR g.class_id = ANY($2::uuid[]))
  `;
}

function assertSchoolStaff(principal) {
  if (isPlatformAdminPrincipal(principal)) {
    throw httpError(403, "Les indicateurs scolaires ne sont pas accessibles à l'administration plateforme.");
  }
  if (!INTERNAL_ROLES.has(fold(principal?.role))) {
    throw httpError(403, "Accès aux indicateurs réservé au personnel de l'établissement.");
  }
}

async function listSchoolDashboardKpis(repository, principal, query = {}, now = new Date()) {
  assertSchoolStaff(principal);
  const schoolId = schoolIdOf(principal);
  const access = accessFor(principal);
  assertReadable(access);
  const period = String(query.period ?? "monthly");
  if (!PERIODS.includes(period)) throw httpError(400, "Période invalide.");
  const timeZone = await loadSchoolTimeZone(repository, schoolId);
  const bounds = periodBounds(period, now, timeZone);
  const classIds = await teacherClassIds(repository, schoolId, principal);
  const studentParams = [schoolId, classIds];
  const rangeParams = [schoolId, classIds, bounds.startDate, bounds.endDate];

  const needsStudents = access.students || access.presences;
  const [studentRows, levelRows, teacherRow, classRow, cashRows, rateRows, statusRows, presenceRow, pedagogyRow, classSizeRows, subjectRows] =
    await Promise.all([
      needsStudents
        ? repository.all(
            `WITH scoped AS (${scopedStudentsSql()})
             SELECT
               COUNT(*)::int AS students,
               COUNT(*) FILTER (WHERE enrolled AND NOT excluded)::int AS expected,
               COUNT(*) FILTER (
                 WHERE enrolled AND NOT excluded AND a.id IS NOT NULL
               )::int AS recorded,
               COUNT(*) FILTER (
                 WHERE enrolled AND NOT excluded AND a.id IS NOT NULL
                   AND ${sqlFold("COALESCE(a.status, '')")} IN ('present', 'late', 'retard')
               )::int AS attended
             FROM scoped
             LEFT JOIN attendance a
               ON a.school_id = $1::uuid
              AND a.student_id = scoped.id
              AND a.attendance_date = $3::date`,
            [...studentParams, bounds.today],
          )
        : Promise.resolve([]),
      access.students
        ? repository.all(
            `WITH scoped AS (${scopedStudentsSql()})
             SELECT level_name AS name, COUNT(*)::int AS value
             FROM scoped
             GROUP BY level_name
             ORDER BY COUNT(*) DESC, level_name`,
            studentParams,
          )
        : Promise.resolve(null),
      access.teachers
        ? repository.all(
            `SELECT COUNT(*)::int AS teachers FROM teachers
             WHERE school_id = $1::uuid AND ${schoolWideOpenSql()}`,
            [schoolId, classIds],
          )
        : Promise.resolve(null),
      access.classes
        ? repository.all(
            `SELECT COUNT(DISTINCT lower(btrim(name)))::int AS classes
             FROM classes
             WHERE school_id = $1::uuid
               AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
            [schoolId, classIds],
          )
        : Promise.resolve(null),
      access.payments
        ? repository.all(
            `SELECT currency, SUM(amount)::float8 AS collected
             FROM payments
             WHERE school_id = $1::uuid
               AND ${teacherStudentScopeSql("payments.student_id")}
               AND NOT (
                 ${sqlFold("COALESCE(payment_status, '')")} ~ '(annul|cancel|attente|brouillon)'
                 OR ${sqlFold("COALESCE(payment_status, '')")} IN ('pending', 'refuse', 'echoue', 'failed')
               )
             GROUP BY currency`,
            [schoolId, classIds],
          )
        : Promise.resolve(null),
      access.payments
        ? repository.all(
            `SELECT COUNT(*)::int AS rows,
                    COUNT(DISTINCT upper(btrim(COALESCE(currency, ''))))::int AS currencies,
                    bool_or(amount_due IS NULL OR amount_paid IS NULL) AS missing,
                    COALESCE(SUM(GREATEST(0, amount_due - COALESCE(exemption, 0))), 0)::float8 AS expected,
                    COALESCE(SUM(GREATEST(0, amount_paid)), 0)::float8 AS collected
             FROM student_fee_obligations
             WHERE school_id = $1::uuid
               AND ${teacherStudentScopeSql("student_fee_obligations.student_id")}
               AND archived_at IS NULL
               AND ${sqlFold("COALESCE(status, '')")} NOT IN ('annule', 'cancelled', 'canceled')`,
            [schoolId, classIds],
          )
        : Promise.resolve(null),
      access.payments
        ? repository.all(
            `SELECT payment_status AS status, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float8 AS amount
             FROM payments
             WHERE school_id = $1::uuid
               AND ${teacherStudentScopeSql("payments.student_id")}
               AND (
                 (payment_date IS NOT NULL AND payment_date >= $3::date AND payment_date <= $4::date)
                 OR (payment_date IS NULL AND created_at >= ($3::timestamp AT TIME ZONE '${timeZone}')
                                      AND created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}'))
               )
             GROUP BY payment_status`,
            [schoolId, classIds, bounds.startDate, bounds.endDate],
          )
        : Promise.resolve(null),
      access.presences
        ? repository.all(
            `SELECT
               COUNT(*) FILTER (WHERE ${sqlFold("COALESCE(status, '')")} IN ('present'))::int AS present,
               COUNT(*) FILTER (WHERE ${sqlFold("COALESCE(status, '')")} IN ('late', 'retard'))::int AS late,
               COUNT(*) FILTER (WHERE ${sqlFold("COALESCE(status, '')")} IN ('excused', 'justifie'))::int AS justified,
               COUNT(*) FILTER (
                 WHERE ${sqlFold("COALESCE(status, '')")} NOT IN ('present', 'late', 'retard', 'excused', 'justifie')
               )::int AS absent
             FROM attendance
             WHERE school_id = $1::uuid
               AND attendance_date >= $3::date
               AND attendance_date <= $4::date
               AND ($2::uuid[] IS NULL OR class_id = ANY($2::uuid[]))`,
            rangeParams,
          )
        : Promise.resolve(null),
      repository.all(
        `SELECT
           ${access.notes ? `(SELECT COUNT(*)::int FROM grades g WHERE g.school_id = $1::uuid AND g.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND g.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}') AND ($2::uuid[] IS NULL OR g.class_id = ANY($2::uuid[])))` : "NULL::int"} AS notes,
           ${access.exams ? `(SELECT COUNT(*)::int FROM exams e WHERE e.school_id = $1::uuid AND e.exam_date >= $3::date AND e.exam_date <= $4::date AND ($2::uuid[] IS NULL OR e.class_id = ANY($2::uuid[])))` : "NULL::int"} AS exams,
           ${access.bulletins ? `(SELECT COUNT(*)::int FROM report_cards b WHERE b.school_id = $1::uuid AND b.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND b.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}') AND ($2::uuid[] IS NULL OR b.class_id = ANY($2::uuid[])))` : "NULL::int"} AS bulletins,
           ${access.bulletins ? `(SELECT COUNT(*)::int FROM report_cards b WHERE b.school_id = $1::uuid AND b.status = 'draft' AND b.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND b.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}') AND ($2::uuid[] IS NULL OR b.class_id = ANY($2::uuid[])))` : "NULL::int"} AS pending_bulletins,
           ${access.documents ? `(SELECT COUNT(*)::int FROM student_documents d WHERE d.school_id = $1::uuid AND d.generated_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND d.generated_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}') AND ($2::uuid[] IS NULL OR d.student_id IN (SELECT e.student_id FROM enrollments e WHERE e.school_id = $1::uuid AND e.class_id = ANY($2::uuid[]) AND e.closed_at IS NULL AND e.transferred_at IS NULL)))` : "NULL::int"} AS documents,
           ${access.users ? `(SELECT COUNT(*)::int FROM users u WHERE u.school_id = $1::uuid AND ${schoolWideOpenSql()} AND ${sqlFold("COALESCE(u.status, '')")} <> ALL(ARRAY[${sqlTextList(INACTIVE_USER_STATUSES)}]::text[]) AND u.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND u.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}'))` : "NULL::int"} AS active_users,
           ${access.announcements ? `(SELECT COUNT(*)::int FROM announcements n WHERE n.school_id = $1::uuid AND ${schoolWideOpenSql()} AND n.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND n.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}'))` : "NULL::int"} AS announcements,
           ${access.students ? `(SELECT COUNT(*)::int FROM (${scopedStudentsSql()}) scoped WHERE scoped.id IN (
               ${periodActivityStudentsSql(3, 4, timeZone)}
               ${access.payments ? `UNION
               SELECT p.student_id FROM payments p
                WHERE p.school_id = $1::uuid
                  AND ${teacherStudentScopeSql("p.student_id")}
                  AND (
                    (p.payment_date IS NOT NULL AND p.payment_date >= $3::date AND p.payment_date <= $4::date)
                    OR (p.payment_date IS NULL AND p.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}')
                                         AND p.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}'))
                  )` : ""}
             ))` : "NULL::int"} AS active_students,
           ${access.students ? `(SELECT COUNT(DISTINCT NULLIF(lower(btrim(class_name)), ''))::int FROM (${scopedStudentsSql()}) scoped WHERE scoped.id IN (
               ${periodActivityStudentsSql(3, 4, timeZone)}
               ${access.payments ? `UNION SELECT p.student_id FROM payments p WHERE p.school_id = $1::uuid AND ${teacherStudentScopeSql("p.student_id")} AND ((p.payment_date IS NOT NULL AND p.payment_date >= $3::date AND p.payment_date <= $4::date) OR (p.payment_date IS NULL AND p.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND p.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}')))` : ""}
             ))` : "NULL::int"} AS period_classes`,
        [schoolId, classIds, bounds.startDate, bounds.endDate],
      ),
      access.students
        ? repository.all(
            `WITH scoped AS (${scopedStudentsSql()})
             SELECT CASE WHEN btrim(class_name) = '' THEN 'Non renseigné' ELSE class_name END AS name,
                    COUNT(*)::int AS value
             FROM scoped
             WHERE id IN (
               ${periodActivityStudentsSql(3, 4, timeZone)}
               ${access.payments ? `UNION SELECT p.student_id FROM payments p WHERE p.school_id = $1::uuid AND ${teacherStudentScopeSql("p.student_id")} AND ((p.payment_date IS NOT NULL AND p.payment_date >= $3::date AND p.payment_date <= $4::date) OR (p.payment_date IS NULL AND p.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}') AND p.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}')))` : ""}
             )
             GROUP BY 1
             ORDER BY COUNT(*) DESC, 1
             LIMIT 8`,
            [schoolId, classIds, bounds.startDate, bounds.endDate],
          )
        : Promise.resolve(null),
      access.notes
        ? repository.all(
            `SELECT s.name AS name, COUNT(*)::int AS value
             FROM grades g
             JOIN subjects s ON s.id = g.subject_id AND s.school_id = g.school_id
             WHERE g.school_id = $1::uuid
               AND g.created_at >= ($3::timestamp AT TIME ZONE '${timeZone}')
               AND g.created_at <= (($4::date + TIME '23:59:59.999') AT TIME ZONE '${timeZone}')
               AND ($2::uuid[] IS NULL OR g.class_id = ANY($2::uuid[]))
             GROUP BY s.name
             ORDER BY COUNT(*) DESC, s.name
             LIMIT 6`,
            [schoolId, classIds, bounds.startDate, bounds.endDate],
          )
        : Promise.resolve(null),
    ]);

  const head = studentRows[0] ?? {};
  const pedagogy = pedagogyRow[0] ?? {};
  const nullableInt = (value) => (value == null ? null : int(value));

  return {
    schoolId,
    generatedAt: now.toISOString(),
    period: bounds.period,
    periodLabel: periodLabel(bounds),
    timeZone: bounds.timeZone,
    cards: {
      students: access.students ? int(head.students) : null,
      teachers: access.teachers ? int(teacherRow?.[0]?.teachers) : null,
      classes: access.classes ? int(classRow?.[0]?.classes) : null,
      revenue: access.payments ? revenueFromRows(cashRows) : null,
      levels: access.students ? levelRows.map((row) => ({ name: row.name, value: int(row.value) })) : null,
      attendance: access.presences ? attendanceFromCounts(head) : null,
      paymentRate: access.payments ? paymentRateFromAggregate(rateRows[0]) : null,
    },
    series: {
      activeStudents: nullableInt(pedagogy.active_students),
      periodClasses: nullableInt(pedagogy.period_classes),
      teachers: access.teachers ? int(teacherRow?.[0]?.teachers) : null,
      notes: nullableInt(pedagogy.notes),
      exams: nullableInt(pedagogy.exams),
      bulletins: nullableInt(pedagogy.bulletins),
      pendingBulletins: nullableInt(pedagogy.pending_bulletins),
      documents: nullableInt(pedagogy.documents),
      presences: access.presences ? presenceSeries(presenceRow[0]).total : null,
      activeUsers: nullableInt(pedagogy.active_users),
      announcements: nullableInt(pedagogy.announcements),
      presence: access.presences ? presenceSeries(presenceRow[0]) : null,
      paymentStatus: access.payments ? mergeCounts(statusRows, (status) => paymentStatusLabel(status)) : null,
      paymentAmounts: access.payments
        ? mergeCounts(
            statusRows.map((row) => ({ status: row.status, value: num(row.amount) })),
            (status) => paymentAmountLabel(status),
          )
        : null,
      classSizes: access.students ? classSizeRows.map((row) => ({ name: row.name, value: int(row.value) })) : null,
      notesBySubject: access.notes ? subjectRows.map((row) => ({ name: row.name, value: int(row.value) })) : null,
    },
  };
}

module.exports = {
  PERIODS,
  resolveSchoolKpiPrincipal,
  listSchoolDashboardKpis,
  periodBounds,
  revenueFromRows,
  paymentRateFromAggregate,
  attendanceFromCounts,
  isCountedCashStatus,
  accessFor,
};
