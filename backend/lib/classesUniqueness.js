"use strict";

/**
 * Unicité Classes V2.
 *
 * Le nom est une projection d'affichage (niveau + filière) et n'est PAS une clé
 * métier : plusieurs groupes distincts peuvent donc porter le même nom affiché.
 * L'unicité canonique est structurelle : établissement + année + niveau +
 * filière + groupe.
 */

const CLASSES_NAME_UNIQUE_INDEX = "uq_classes_school_year_normalized_name";
const CLASSES_STRUCTURAL_UNIQUE_INDEX = "uq_classes_structural_offering";
const CLASSES_STATUS_CHECK = "classes_status_check";
const CLASSES_CLASS_CODE_UNIQUE = "classes_class_code_key";
const STRUCTURAL_NULL_STREAM_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * Compatibilité avec ensureClassesDomainConstraints() historique : depuis que
 * le code groupe n'est plus dans le nom, les doublons de nom sont légitimes.
 * Le préflight ne doit donc plus bloquer le boot sur cette projection.
 */
const COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL = `
  SELECT 0::int AS duplicate_groups
`;

const LIST_CLASSES_NAME_DUPLICATE_GROUPS_SQL = `
  SELECT NULL::text AS school_code,
         NULL::text AS academic_year_name,
         NULL::text AS normalized_name,
         0::int AS duplicate_count,
         ARRAY[]::text[] AS class_codes
  WHERE FALSE
`;

/**
 * Migration idempotente : retire l'ancien index qui imposait à tort
 * l'unicité du nom d'affichage. La contrainte structurelle est créée ensuite
 * par ensureClassesStructuralOffering().
 */
const CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL = `
DROP INDEX IF EXISTS ${CLASSES_NAME_UNIQUE_INDEX}
`;

const ADD_CLASSES_STRUCTURAL_COLUMNS_SQL = `
ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES education_levels(id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS stream_id UUID REFERENCES education_streams(id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES education_class_groups(id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_code TEXT;
`;

const DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL = `
DROP INDEX IF EXISTS ${CLASSES_STRUCTURAL_UNIQUE_INDEX}
`;

const CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${CLASSES_STRUCTURAL_UNIQUE_INDEX}
  ON classes (
    school_id,
    academic_year_id,
    level_id,
    COALESCE(stream_id, '${STRUCTURAL_NULL_STREAM_SENTINEL}'::uuid),
    COALESCE(group_id, '${STRUCTURAL_NULL_STREAM_SENTINEL}'::uuid)
  )
  WHERE level_id IS NOT NULL AND group_id IS NOT NULL
`;

const ENSURE_CLASSES_STATUS_CHECK_SQL = `
DO $$ BEGIN
  ALTER TABLE classes
    ADD CONSTRAINT ${CLASSES_STATUS_CHECK}
    CHECK (status IN ('active', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$
`;

const NORMALIZE_CLASSES_STATUS_SQL = `
UPDATE classes
SET status = CASE
  WHEN lower(btrim(status)) IN ('active', 'actif') THEN 'active'
  WHEN lower(btrim(status)) IN ('inactive', 'inactif', 'archived', 'archivée', 'archivee') THEN 'inactive'
  ELSE 'inactive'
END
WHERE status IS NULL
   OR status NOT IN ('active', 'inactive')
`;

/**
 * Conservé pour compatibilité des anciens diagnostics/tests. Un doublon de nom
 * n'est plus une anomalie métier en V2 ; ce message ne doit plus être appelé au
 * boot puisque COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL retourne zéro.
 */
function formatClassesNameDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => {
      const codes = Array.isArray(row.class_codes)
        ? row.class_codes.join(",")
        : String(row.class_codes ?? "");
      return `${row.school_code}/${row.academic_year_name}/${row.normalized_name}×${row.duplicate_count}[${codes}]`;
    })
    .join("; ");
  return (
    `Classes : ${duplicateGroups} groupe(s) partageant le même nom d'affichage. ` +
    `Le nom n'est plus une clé d'unicité ; la clé canonique est structurelle ` +
    `(établissement + année + niveau + filière + groupe). ` +
    (samples ? `Exemples: ${samples}` : "")
  );
}

function isClassStructuralUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  const message = String(error.message ?? "");
  return (
    constraint === CLASSES_STRUCTURAL_UNIQUE_INDEX ||
    detail.includes(CLASSES_STRUCTURAL_UNIQUE_INDEX) ||
    message.includes(CLASSES_STRUCTURAL_UNIQUE_INDEX)
  );
}

/**
 * Classification legacy uniquement : utile pour reconnaître une base qui n'a
 * pas encore exécuté le DROP. Aucune nouvelle écriture ne doit dépendre de cet
 * index.
 */
function isClassNameUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  const message = String(error.message ?? "");
  return (
    constraint === CLASSES_NAME_UNIQUE_INDEX ||
    detail.includes(CLASSES_NAME_UNIQUE_INDEX) ||
    message.includes(CLASSES_NAME_UNIQUE_INDEX) ||
    /lower\(btrim\(name\)\)/i.test(detail)
  );
}

function isClassCodeUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  return (
    constraint === CLASSES_CLASS_CODE_UNIQUE ||
    /Key \(class_code\)=/i.test(detail) ||
    /unique constraint .*class_code/i.test(String(error.message ?? ""))
  );
}

module.exports = {
  CLASSES_NAME_UNIQUE_INDEX,
  CLASSES_STRUCTURAL_UNIQUE_INDEX,
  CLASSES_STATUS_CHECK,
  CLASSES_CLASS_CODE_UNIQUE,
  STRUCTURAL_NULL_STREAM_SENTINEL,
  COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
  LIST_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
  ADD_CLASSES_STRUCTURAL_COLUMNS_SQL,
  DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  ENSURE_CLASSES_STATUS_CHECK_SQL,
  NORMALIZE_CLASSES_STATUS_SQL,
  formatClassesNameDuplicateDiagnostic,
  isClassNameUniquenessViolation,
  isClassStructuralUniquenessViolation,
  isClassCodeUniquenessViolation,
};
