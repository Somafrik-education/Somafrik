"use strict";

/**
 * BULLETIN-MODEL-01 — cohérence entre les matières d'un modèle de bulletin
 * (AcademicRuleProfile.subjects) et le catalogue `subjects` de SON établissement.
 *
 * Le catalogue est la source de vérité de la hiérarchie (subjects.parent_subject_id) ;
 * le profil versionné fige les règles de calcul. Toute divergence est refusée :
 * matière absente du catalogue, ligne d'un autre établissement, parent différent,
 * matière désactivée.
 */

class SubjectCatalogError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SubjectCatalogError";
    this.code = code;
  }
}

function asKey(value) {
  return String(value ?? "").trim();
}

/**
 * @param {object} input
 * @param {string} input.schoolId établissement propriétaire du modèle
 * @param {object} input.profileSpec spécification validée (validateSpec) avec `subjects`
 * @param {Array<{school_id:string, subject_code:string, parent_subject_code:?string, status:string}>} input.catalog
 */
function assertProfileSubjectsInCatalog({ schoolId, profileSpec, catalog } = {}) {
  const tenant = asKey(schoolId);
  if (!tenant) throw new SubjectCatalogError("TENANT_REQUIRED");
  const subjects = Array.isArray(profileSpec?.subjects) ? profileSpec.subjects : null;
  if (!subjects) throw new SubjectCatalogError("SUBJECT_RULES_REQUIRED");
  const rows = Array.isArray(catalog) ? catalog : [];
  if (rows.some((row) => asKey(row?.school_id) !== tenant)) {
    throw new SubjectCatalogError("CATALOG_TENANT_MISMATCH");
  }
  const byCode = new Map(rows.map((row) => [asKey(row.subject_code), row]));
  for (const subject of subjects) {
    const row = byCode.get(subject.id);
    if (!row) throw new SubjectCatalogError("SUBJECT_NOT_IN_SCHOOL_CATALOG", `matière ${subject.id}`);
    if (asKey(row.parent_subject_code) !== asKey(subject.parent_id)) {
      throw new SubjectCatalogError("SUBJECT_PARENT_MISMATCH", `matière ${subject.id}`);
    }
    if (asKey(row.status) !== "active") {
      throw new SubjectCatalogError("SUBJECT_INACTIVE", `matière ${subject.id}`);
    }
  }
  return true;
}

module.exports = {
  SubjectCatalogError,
  assertProfileSubjectsInCatalog,
};
