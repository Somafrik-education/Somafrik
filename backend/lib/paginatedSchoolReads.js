"use strict";

/**
 * PERF-PR3 — lectures paginées canoniques (présences, paiements, notes).
 *
 * - LIMIT, filtres et ordre exécutés par PostgreSQL (keyset (clé, id)).
 * - Établissement résolu par les périmètres PERF-PR1, jamais depuis le client.
 * - Enseignant : affectations actives relues en base ; aucune affectation, aucune ligne.
 * - Réservé au personnel de l'établissement : Parent / Élève restent sur les routes
 *   historiques, Superadmin et Admin Pays sont refusés en amont (garde plateforme).
 * - Le curseur est lié aux filtres, au tri et à l'établissement : rejoué ailleurs, il est refusé.
 */

const crypto = require("node:crypto");
const { decoratePaymentWithItems } = require("./financePaymentItems");
const { projectPaymentsWithAllocations } = require("./financeUnallocatedCash");
const { mapPaymentRow } = require("./financeManagement");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STUDENT_REF_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SEARCH_MAX = 64;

const PRESENCE_STATUS = Object.freeze({
  Présent: "present",
  Absent: "absent",
  Retard: "late",
  Justifié: "excused",
});

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function badRequest(message) {
  return httpError(400, message, "PAGINATION_INVALID");
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function firstValue(raw) {
  return Array.isArray(raw) ? raw[0] : raw;
}

function text(raw) {
  const value = firstValue(raw);
  return value == null ? "" : String(value).trim();
}

function parseLimit(raw) {
  const value = text(raw);
  if (!value) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) throw badRequest("Paramètre limit invalide.");
  const limit = Number(value);
  if (limit < 1) throw badRequest("Paramètre limit invalide.");
  if (limit > MAX_LIMIT) throw badRequest(`Paramètre limit trop grand (maximum ${MAX_LIMIT}).`);
  return limit;
}

function isRealDate(iso) {
  if (!ISO_DATE_RE.test(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDate(raw, name) {
  const value = text(raw);
  if (!value) return null;
  if (!isRealDate(value)) throw badRequest(`Paramètre ${name} invalide (AAAA-MM-JJ attendu).`);
  return value;
}

function parseUuid(raw, name) {
  const value = text(raw);
  if (!value) return null;
  if (!UUID_RE.test(value)) throw badRequest(`Paramètre ${name} invalide.`);
  return value.toLowerCase();
}

function parseStudentRef(raw) {
  const value = text(raw);
  if (!value) return null;
  if (!STUDENT_REF_RE.test(value)) throw badRequest("Paramètre studentId invalide.");
  return value;
}

function parseSort(raw, allowed, fallback) {
  const value = text(raw) || fallback;
  if (!allowed.includes(value)) throw badRequest("Paramètre sort invalide.");
  return value;
}

function parseRange(query) {
  const date = parseDate(query.date, "date");
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (date && (from || to)) throw badRequest("Utiliser date, ou from et to, pas les deux.");
  if (from && to && from > to) throw badRequest("Période invalide : from est après to.");
  return date ? { from: date, to: date } : { from, to };
}

function fingerprint(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

function encodeCursor(key, id, fp) {
  return Buffer.from(JSON.stringify({ v: 1, k: key, id, f: fp })).toString("base64url");
}

function decodeCursor(raw, fp, keyKind) {
  const value = text(raw);
  if (!value) return null;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw badRequest("Curseur invalide.");
  }
  if (!decoded || decoded.v !== 1 || !UUID_RE.test(String(decoded.id ?? "")) || typeof decoded.k !== "string") {
    throw badRequest("Curseur invalide.");
  }
  const keyOk = keyKind === "date" ? isRealDate(decoded.k) : Number.isFinite(Date.parse(decoded.k));
  if (!keyOk) throw badRequest("Curseur invalide.");
  if (decoded.f !== fp) throw badRequest("Curseur invalide pour ces filtres.");
  return { key: keyKind === "date" ? decoded.k : new Date(decoded.k).toISOString(), id: decoded.id };
}

function isParentOrStudent(principal) {
  const role = fold(principal?.role);
  if (role.includes("parent") || role.includes("eleve") || role.includes("etudiant") || role === "student") {
    return true;
  }
  const keys = Array.isArray(principal?.roleKeys) ? principal.roleKeys.map((key) => String(key).toUpperCase()) : [];
  return keys.length > 0 && keys.every((key) => key === "PARENT" || key === "STUDENT");
}

function isTeacher(principal) {
  const role = fold(principal?.role);
  return role === "enseignant" || role === "teacher";
}

function assertStaff(principal) {
  if (!principal) throw httpError(401, "Authentification requise.");
  if (isParentOrStudent(principal)) {
    throw httpError(
      403,
      "Liste paginée réservée au personnel de l'établissement.",
      "PAGINATION_STAFF_ONLY",
    );
  }
}

function schoolIdFromScope(scope) {
  const schoolId = String(scope?.schoolId ?? "").trim();
  if (!UUID_RE.test(schoolId)) {
    throw httpError(403, "Établissement requis pour cette liste.", "PAGINATION_SCHOOL_REQUIRED");
  }
  return schoolId.toLowerCase();
}

/**
 * Contexte commun : établissement (UUID) et classes de l'enseignant (null = toute l'école).
 * @param {{ all: Function }} repository
 * @param {object} principal
 * @param {{ schoolId?: string } | null} scope périmètre PERF-PR1 déjà résolu
 * @param {(repo, schoolId, principal) => Promise<string[]|null>} teacherClassIds
 */
async function resolveReadContext(repository, principal, scope, teacherClassIds) {
  assertStaff(principal);
  const schoolId = schoolIdFromScope(scope);
  const classIds = isTeacher(principal) ? await teacherClassIds(repository, schoolId, principal) : null;
  return { schoolId, classIds: Array.isArray(classIds) ? classIds : null };
}

function pageOf(rows, limit, keyOf, fp) {
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  return {
    page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last), String(last.id), fp) : null,
  };
}

function isoDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

// --- Présences ---------------------------------------------------------------

async function listPresencesPage(repository, context, query = {}) {
  const limit = parseLimit(query.limit);
  const sort = parseSort(query.sort, ["-date", "date"], "-date");
  const range = parseRange(query);
  const classId = parseUuid(query.classId, "classId");
  const attendanceId = parseUuid(query.attendanceId, "attendanceId");
  const studentRef = parseStudentRef(query.studentId);
  const statusLabel = text(query.status);
  if (statusLabel && !Object.hasOwn(PRESENCE_STATUS, statusLabel)) throw badRequest("Paramètre status invalide.");

  const fp = fingerprint(["presences", context.schoolId, sort, range, classId, attendanceId, studentRef, statusLabel]);
  const cursor = decodeCursor(query.cursor, fp, "date");
  if (Array.isArray(context.classIds) && context.classIds.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const params = [context.schoolId];
  const where = ["a.school_id = $1::uuid"];
  const add = (value, sql) => {
    params.push(value);
    where.push(sql.replace("$?", `$${params.length}`));
  };
  if (context.classIds) add(context.classIds, "a.class_id = ANY($?::uuid[])");
  if (range.from) add(range.from, "a.attendance_date >= $?::date");
  if (range.to) add(range.to, "a.attendance_date <= $?::date");
  if (classId) add(classId, "a.class_id = $?::uuid");
  if (attendanceId) add(attendanceId, "a.id = $?::uuid");
  if (studentRef) {
    params.push(studentRef);
    where.push(`(st.student_code = $${params.length} OR st.id::text = lower($${params.length}))`);
  }
  if (statusLabel) {
    const status = PRESENCE_STATUS[statusLabel];
    if (status === "present") {
      where.push("(a.status IS NULL OR a.status NOT IN ('absent', 'late', 'excused'))");
    } else {
      add(status, "a.status = $?");
    }
  }
  const desc = sort === "-date";
  if (cursor) {
    params.push(cursor.key, cursor.id);
    const op = desc ? "<" : ">";
    where.push(`(a.attendance_date, a.id) ${op} ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const direction = desc ? "DESC" : "ASC";
  const rows = await repository.all(
    `SELECT a.*, s.login_code, st.student_code, c.name AS class_name, c.class_code, t.teacher_code
     FROM attendance a
     JOIN schools s ON s.id = a.school_id
     JOIN students st ON st.id = a.student_id AND st.school_id = a.school_id
     LEFT JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     LEFT JOIN teachers t ON t.id = a.teacher_id
     WHERE ${where.join("\n       AND ")}
     ORDER BY a.attendance_date ${direction}, a.id ${direction}
     LIMIT $${params.length}`,
    params,
  );
  const { page, hasMore, nextCursor } = pageOf(rows, limit, (row) => isoDate(row.attendance_date), fp);
  return { items: page.map((row) => repository.mapAttendance(row)), nextCursor, hasMore };
}

// --- Notes -------------------------------------------------------------------

async function listNotesPage(repository, context, query = {}) {
  const limit = parseLimit(query.limit);
  const sort = parseSort(query.sort, ["-updatedAt", "updatedAt"], "-updatedAt");
  const classId = parseUuid(query.classId, "classId");
  const subjectId = parseUuid(query.subjectId, "subjectId");
  const termId = parseUuid(query.termId, "termId");
  const evaluationId = parseUuid(query.evaluationId, "evaluationId");
  const studentRef = parseStudentRef(query.studentId);

  const fp = fingerprint(["notes", context.schoolId, sort, classId, subjectId, termId, evaluationId, studentRef]);
  const cursor = decodeCursor(query.cursor, fp, "timestamp");
  if (Array.isArray(context.classIds) && context.classIds.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const params = [context.schoolId];
  const where = ["g.school_id = $1::uuid"];
  const add = (value, sql) => {
    params.push(value);
    where.push(sql.replace("$?", `$${params.length}`));
  };
  if (context.classIds) add(context.classIds, "g.class_id = ANY($?::uuid[])");
  if (classId) add(classId, "g.class_id = $?::uuid");
  if (subjectId) add(subjectId, "g.subject_id = $?::uuid");
  if (termId) add(termId, "g.term_id = $?::uuid");
  if (evaluationId) add(evaluationId, "g.evaluation_id = $?::uuid");
  if (studentRef) {
    params.push(studentRef);
    where.push(`(st.student_code = $${params.length} OR st.id::text = lower($${params.length}))`);
  }
  const desc = sort === "-updatedAt";
  if (cursor) {
    params.push(cursor.key, cursor.id);
    const op = desc ? "<" : ">";
    where.push(`(g.updated_at, g.id) ${op} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const direction = desc ? "DESC" : "ASC";
  const rows = await repository.all(
    `SELECT g.*, s.school_code, st.student_code, c.name AS class_name, sub.name AS subject_name,
            COALESCE(
              (SELECT sc.coefficient FROM school_courses sc
                WHERE sc.school_id = g.school_id AND sc.class_id = g.class_id
                  AND sc.subject_id = g.subject_id AND sc.status = 'active'
                ORDER BY sc.created_at ASC, sc.id ASC LIMIT 1),
              sub.coefficient
            ) AS subject_coefficient,
            t.teacher_code, tm.name AS term_name, e.title AS evaluation_title,
            e.max_score AS evaluation_max_score, e.coefficient AS evaluation_coefficient,
            e.evaluation_type AS evaluation_type_pg, e.legacy_json_id AS evaluation_legacy_id,
            e.id AS evaluation_uuid, e.evaluation_type_id,
            et.name AS evaluation_type_name, et.code AS evaluation_type_code
     FROM grades g
     JOIN schools s ON s.id = g.school_id
     JOIN students st ON st.id = g.student_id AND st.school_id = g.school_id
     JOIN classes c ON c.id = g.class_id
     JOIN subjects sub ON sub.id = g.subject_id
     JOIN teachers t ON t.id = g.teacher_id
     JOIN terms tm ON tm.id = g.term_id
     LEFT JOIN evaluations e ON e.id = g.evaluation_id
     LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
     WHERE ${where.join("\n       AND ")}
     ORDER BY g.updated_at ${direction}, g.id ${direction}
     LIMIT $${params.length}`,
    params,
  );
  const { page, hasMore, nextCursor } = pageOf(rows, limit, (row) => new Date(row.updated_at).toISOString(), fp);
  return { items: page.map((row) => repository.mapGrade(row)), nextCursor, hasMore };
}

// --- Paiements ---------------------------------------------------------------

async function listPaymentsPage(repository, context, query = {}) {
  const limit = parseLimit(query.limit);
  const sort = parseSort(query.sort, ["-createdAt", "createdAt"], "-createdAt");
  const range = parseRange(query);
  const studentRef = parseStudentRef(query.studentId);
  const search = text(query.q);
  if (search.length > SEARCH_MAX) throw badRequest("Recherche trop longue.");

  const fp = fingerprint(["payments", context.schoolId, sort, range, studentRef, fold(search)]);
  const cursor = decodeCursor(query.cursor, fp, "timestamp");
  if (Array.isArray(context.classIds) && context.classIds.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const params = [context.schoolId];
  const where = ["p.school_id = $1::uuid"];
  const add = (value, sql) => {
    params.push(value);
    where.push(sql.replace("$?", `$${params.length}`));
  };
  if (context.classIds) {
    add(
      context.classIds,
      `p.student_id IN (
        SELECT e.student_id FROM enrollments e
         WHERE e.school_id = $1::uuid AND e.class_id = ANY($?::uuid[])
           AND e.closed_at IS NULL AND e.transferred_at IS NULL)`,
    );
  }
  if (range.from) add(range.from, "COALESCE(p.payment_date, p.created_at::date) >= $?::date");
  if (range.to) add(range.to, "COALESCE(p.payment_date, p.created_at::date) <= $?::date");
  if (studentRef) {
    params.push(studentRef);
    where.push(`(st.student_code = $${params.length} OR st.id::text = lower($${params.length}))`);
  }
  if (search) {
    // Recherche littérale : % et _ du client ne sont pas des jokers.
    const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
    add(
      `%${escaped}%`,
      `(st.student_code ILIKE $? OR p.payment_code ILIKE $?
        OR concat_ws(' ', st.first_name, st.last_name) ILIKE $?
        OR concat_ws(' ', st.last_name, st.first_name) ILIKE $?)`.replace(/\$\?/g, `$${params.length + 1}`),
    );
  }
  const desc = sort === "-createdAt";
  if (cursor) {
    params.push(cursor.key, cursor.id);
    const op = desc ? "<" : ">";
    where.push(`(p.created_at, p.id) ${op} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const direction = desc ? "DESC" : "ASC";
  const rows = await repository.all(
    `SELECT p.*, s.school_code, s.login_code, st.student_code,
            NULLIF(btrim(concat_ws(' ', st.first_name, st.last_name)), '') AS student_display_name,
            cls.name AS student_class_name
     FROM payments p
     JOIN schools s ON s.id = p.school_id
     JOIN students st ON st.id = p.student_id AND st.school_id = p.school_id
     LEFT JOIN LATERAL (
       SELECT c.name FROM enrollments en
       JOIN classes c ON c.id = en.class_id AND c.school_id = en.school_id
       WHERE en.school_id = p.school_id AND en.student_id = p.student_id
         AND en.closed_at IS NULL AND en.transferred_at IS NULL
       ORDER BY en.updated_at DESC NULLS LAST, en.created_at DESC
       LIMIT 1
     ) cls ON TRUE
     WHERE ${where.join("\n       AND ")}
     ORDER BY p.created_at ${direction}, p.id ${direction}
     LIMIT $${params.length}`,
    params,
  );
  const { page, hasMore, nextCursor } = pageOf(rows, limit, (row) => new Date(row.created_at).toISOString(), fp);
  if (!page.length) return { items: [], nextCursor, hasMore };

  const ids = page.map((row) => row.id);
  const [itemRows, allocationRows] = await Promise.all([
    repository.all(
      `SELECT * FROM payment_items
       WHERE school_id = $1::uuid AND payment_id = ANY($2::uuid[])
       ORDER BY sort_order ASC, created_at ASC`,
      [context.schoolId, ids],
    ),
    repository.all(
      `SELECT * FROM payment_allocations WHERE school_id = $1::uuid AND payment_id = ANY($2::uuid[])`,
      [context.schoolId, ids],
    ),
  ]);
  const itemsByPayment = new Map();
  for (const item of itemRows) {
    const list = itemsByPayment.get(item.payment_id) || [];
    list.push(item);
    itemsByPayment.set(item.payment_id, list);
  }
  const mapped = page.map((row) => {
    const payment = decoratePaymentWithItems(mapPaymentRow(row), itemsByPayment.get(row.id) || []);
    return {
      ...payment,
      studentName: row.student_display_name || payment.studentName || "Eleve inconnu",
      className: row.student_class_name || payment.className || "",
    };
  });
  return { items: projectPaymentsWithAllocations(mapped, allocationRows), nextCursor, hasMore };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseLimit,
  parseRange,
  encodeCursor,
  decodeCursor,
  fingerprint,
  assertStaff,
  resolveReadContext,
  listPresencesPage,
  listNotesPage,
  listPaymentsPage,
};
