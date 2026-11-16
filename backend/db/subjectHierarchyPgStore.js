"use strict";

/**
 * BULLETIN-MODEL-01 — catalogue des matières d'UN établissement avec sa
 * hiérarchie (matière principale → sous-matières). Toutes les requêtes sont
 * filtrées par school_id ; un code d'un autre établissement est introuvable.
 * Aucune création de cours, d'affectation ni de note.
 */

class SubjectHierarchyError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SubjectHierarchyError";
    this.code = code;
  }
}

function requireText(value, code) {
  const text = String(value ?? "").trim();
  if (!text) throw new SubjectHierarchyError(code);
  return text;
}

function mapPgError(error) {
  if (error?.code === "23514" && /SUBJECT_NESTING_TOO_DEEP/.test(String(error.message))) {
    return new SubjectHierarchyError("SUBJECT_NESTING_TOO_DEEP");
  }
  if (error?.code === "23514" && error.constraint === "subjects_parent_not_self") {
    return new SubjectHierarchyError("SUBJECT_PARENT_INVALID");
  }
  if (error?.code === "23505" && error.constraint === "uq_subjects_parent_child_name") {
    return new SubjectHierarchyError("SUBJECT_DUPLICATE_CHILD");
  }
  if (error?.code === "23503" && error.constraint === "subjects_parent_same_school_fk") {
    return new SubjectHierarchyError("SUBJECT_PARENT_NOT_FOUND");
  }
  return error;
}

function createSubjectHierarchyPgStore(db) {
  if (!db || typeof db.query !== "function") throw new Error("PostgreSQL requis.");

  async function listSchoolSubjectCatalog(schoolId) {
    const tenant = requireText(schoolId, "TENANT_REQUIRED");
    const result = await db.query(
      `SELECT s.school_id::text AS school_id, s.subject_code, s.name, s.status, s.display_order,
              p.subject_code AS parent_subject_code
         FROM subjects s
         LEFT JOIN subjects p ON p.id = s.parent_subject_id AND p.school_id = s.school_id
        WHERE s.school_id::text = $1
        ORDER BY s.subject_code COLLATE "C"`,
      [tenant],
    );
    return result.rows.map((row) => ({ ...row, parent_subject_code: row.parent_subject_code ?? null }));
  }

  /**
   * Rattache (ou détache avec parentSubjectCode = null) une sous-matière à une
   * matière principale du MÊME établissement.
   */
  async function setSubjectParent({ schoolId, subjectCode, parentSubjectCode = null, displayOrder } = {}) {
    const tenant = requireText(schoolId, "TENANT_REQUIRED");
    const code = requireText(subjectCode, "SUBJECT_NOT_FOUND");
    const child = await db.query("SELECT id FROM subjects WHERE school_id::text = $1 AND subject_code = $2", [tenant, code]);
    if (!child.rowCount) throw new SubjectHierarchyError("SUBJECT_NOT_FOUND");
    let parentId = null;
    if (parentSubjectCode != null) {
      const parentCode = requireText(parentSubjectCode, "SUBJECT_PARENT_NOT_FOUND");
      if (parentCode === code) throw new SubjectHierarchyError("SUBJECT_PARENT_INVALID");
      const parent = await db.query("SELECT id FROM subjects WHERE school_id::text = $1 AND subject_code = $2", [tenant, parentCode]);
      if (!parent.rowCount) throw new SubjectHierarchyError("SUBJECT_PARENT_NOT_FOUND");
      parentId = parent.rows[0].id;
    }
    if (displayOrder !== undefined && displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 0)) {
      throw new SubjectHierarchyError("SUBJECT_DISPLAY_ORDER_INVALID");
    }
    try {
      await db.query(
        `UPDATE subjects
            SET parent_subject_id = $3,
                display_order = CASE WHEN $4::boolean THEN $5::integer ELSE display_order END,
                updated_at = NOW()
          WHERE id = $2 AND school_id::text = $1`,
        [tenant, child.rows[0].id, parentId, displayOrder !== undefined, displayOrder ?? null],
      );
    } catch (error) {
      throw mapPgError(error);
    }
  }

  return { listSchoolSubjectCatalog, setSubjectParent };
}

module.exports = {
  SubjectHierarchyError,
  createSubjectHierarchyPgStore,
};
