"use strict";

// Public school dashboard projection: never expose raw audit values, IPs, user agents or other tenants.
const ALLOWED = Object.freeze({
  create_class: "Classe créée",
  update_class: "Classe modifiée",
  enroll_student: "Élève inscrit",
  upsert_attendance: "Appel enregistré",
  upsert_attendance_batch: "Appel enregistré",
  create_course_schedule: "Cours planifié",
  update_course_schedule: "Planning modifié",
  cancel_course_schedule: "Cours annulé",
  create_payment: "Paiement enregistré",
});
const ACTIONS = Object.keys(ALLOWED);
const SCHEDULE_ACTIONS = new Set(["create_course_schedule", "update_course_schedule", "cancel_course_schedule"]);
const ATTENDANCE_ACTIONS = new Set(["upsert_attendance", "upsert_attendance_batch"]);
const WEEKDAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function clip(value, max = 80) {
  const text = String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim();
  return text ? text.slice(0, max) : "";
}

function clock(value) {
  const match = clip(value, 8).match(/^(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

/** Safe one-line detail. Never returns raw audit JSON, names from payment payloads, or secrets. */
function projectActivityDetail(row) {
  const action = String(row?.action ?? "");
  if (SCHEDULE_ACTIONS.has(action)) {
    const day = WEEKDAYS[Number(row.day_of_week)] || "";
    const time = [clock(row.start_time), clock(row.end_time)].filter(Boolean).join("–");
    const when = [day, time].filter(Boolean).join(" ");
    const detail = [clip(row.class_name), clip(row.subject_name), when].filter(Boolean).join(" · ");
    return detail || null;
  }
  if (action === "create_payment") {
    const amount = Number(row.amount);
    const currency = clip(row.currency, 8).toUpperCase();
    if (!Number.isFinite(amount) || !currency) return null;
    return `${new Intl.NumberFormat("fr-FR").format(amount)} ${currency}`;
  }
  if (ATTENDANCE_ACTIONS.has(action)) {
    const count = Number(row.attendance_count);
    if (!Number.isInteger(count) || count < 1) return null;
    return count === 1 ? "1 présence" : `${count} présences`;
  }
  return null;
}
const { matchesSchoolLookup } = require("./schoolCodeV2");

/** Resolve an Admin School tenant from the trusted JWT school code when no scope header is sent. */
async function resolveSchoolDashboardPrincipal(principal, lookupSchool) {
  if (principal?.role !== "Admin School") return principal;
  const existing = String(principal.effectiveSchoolId ?? "").trim();
  if (existing) return principal;
  const schoolCode = String(principal.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*" || typeof lookupSchool !== "function") return principal;
  const school = await lookupSchool(schoolCode);
  if (!school || !matchesSchoolLookup(school, schoolCode)) return principal;
  const id = String(school.id ?? school.schoolId ?? school.school_id ?? "").trim();
  return id ? { ...principal, effectiveSchoolId: id } : principal;
}


async function listSchoolDashboardActivities(repository, principal, query = {}) {
  if (principal?.role !== "Admin School") {
    const error = new Error("Accès aux activités réservé à l'administration de l'établissement.");
    error.statusCode = 403;
    throw error;
  }
  const schoolId = String(principal?.effectiveSchoolId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(schoolId)) {
    const error = new Error("Périmètre établissement indisponible.");
    error.statusCode = 403;
    throw error;
  }
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 10, 1), 30);
  const cursor = String(query.cursor ?? "");
  let before = null;
  let beforeId = null;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Number.isFinite(Date.parse(decoded.at)) || !/^[0-9a-f-]{36}$/i.test(decoded.id)) throw Error();
      before = new Date(decoded.at).toISOString();
      beforeId = decoded.id;
    } catch {
      const error = new Error("Curseur invalide.");
      error.statusCode = 400;
      throw error;
    }
  }
  const params = [schoolId, ACTIONS, limit + 1];
  const cursorSql = before ? "AND (a.created_at, a.id) < ($4::timestamptz, $5::uuid)" : "";
  if (before) params.push(before, beforeId);
  const rows = await repository.all(
    `SELECT a.id, a.action, a.created_at,
            CASE WHEN a.action = ANY($2::text[]) AND a.action IN ('create_course_schedule','update_course_schedule','cancel_course_schedule') THEN a.new_value->>'dayOfWeek' END AS day_of_week,
            CASE WHEN a.action IN ('create_course_schedule','update_course_schedule','cancel_course_schedule') THEN a.new_value->>'startTime' END AS start_time,
            CASE WHEN a.action IN ('create_course_schedule','update_course_schedule','cancel_course_schedule') THEN a.new_value->>'endTime' END AS end_time,
            CASE WHEN a.action IN ('create_course_schedule','update_course_schedule','cancel_course_schedule') THEN a.new_value->>'className' END AS class_name,
            CASE WHEN a.action IN ('create_course_schedule','update_course_schedule','cancel_course_schedule') THEN a.new_value->>'subject' END AS subject_name,
            CASE WHEN a.action = 'create_payment' THEN a.new_value->>'amount' END AS amount,
            CASE WHEN a.action = 'create_payment' THEN a.new_value->>'currency' END AS currency,
            CASE WHEN a.action IN ('upsert_attendance','upsert_attendance_batch') THEN a.new_value->>'count' END AS attendance_count
     FROM audit_logs a
     WHERE a.school_id = $1::uuid AND a.action = ANY($2::text[]) ${cursorSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $3`,
    params,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      label: ALLOWED[row.action],
      at: row.created_at,
      detail: projectActivityDetail(row),
    })),
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
      : null,
  };
}

module.exports = {
  listSchoolDashboardActivities,
  resolveSchoolDashboardPrincipal,
  projectActivityDetail,
  DASHBOARD_ACTIVITY_ACTIONS: ACTIONS,
};
