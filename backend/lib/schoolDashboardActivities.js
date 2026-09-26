"use strict";

// Public school dashboard projection: never expose raw audit values, IPs, user agents or other tenants.
const ALLOWED = Object.freeze({
  create_class: "Classe créée",
  update_class: "Classe modifiée",
  enroll_student: "Élève inscrit",
  upsert_attendance: "Appel enregistré",
  create_course_schedule: "Cours planifié",
  update_course_schedule: "Planning modifié",
  cancel_course_schedule: "Cours annulé",
});
const ACTIONS = Object.keys(ALLOWED);
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
    `SELECT a.id, a.action, a.created_at, a.entity_type
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
    })),
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
      : null,
  };
}

module.exports = { listSchoolDashboardActivities, resolveSchoolDashboardPrincipal };
