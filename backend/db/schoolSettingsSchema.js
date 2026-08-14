"use strict";

/**
 * LOT 4 — Paramètres établissement canoniques.
 *
 * school_settings = scalaires (period_mode, default_scale, report_card_mode).
 * periods = projection de terms ; classNames = classes ; subjects = subjects.
 */

const SCHOOL_SETTINGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS school_settings (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  period_mode TEXT NOT NULL DEFAULT 'trimestre',
  default_scale NUMERIC(6,2) NOT NULL DEFAULT 20,
  report_card_mode TEXT NOT NULL DEFAULT 'period',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_settings_period_mode_check CHECK (period_mode IN ('trimestre', 'semestre', 'periode')),
  CONSTRAINT school_settings_report_card_mode_check CHECK (report_card_mode IN ('period', 'annual', 'custom')),
  CONSTRAINT school_settings_default_scale_check CHECK (default_scale > 0 AND default_scale <= 100)
);
`;

const STRIP_LEGACY_SCHOOL_SETTINGS_SQL = `
-- Appliqué uniquement après inventaire legacy propre (boot postgresRepository).
UPDATE school_academic_configs
SET config_payload = config_payload
  - 'periods' - 'periodMode' - 'defaultScale' - 'reportCardMode'
  - 'allowCustomClasses' - 'allowCustomCourses' - 'allowCustomReportCards'
  - 'classNames' - 'subjects' - 'subjectsByClass' - 'bulletinDesignByClass'
  - 'schoolYear' - 'academicYear' - 'defaultGradeScale',
    updated_at = NOW()
WHERE (config_payload ? 'periods')
   OR (config_payload ? 'periodMode')
   OR (config_payload ? 'defaultScale')
   OR (config_payload ? 'reportCardMode')
   OR (config_payload ? 'allowCustomClasses')
   OR (config_payload ? 'allowCustomCourses')
   OR (config_payload ? 'allowCustomReportCards')
   OR (config_payload ? 'classNames')
   OR (config_payload ? 'subjects')
   OR (config_payload ? 'subjectsByClass')
   OR (config_payload ? 'bulletinDesignByClass')
   OR (config_payload ? 'schoolYear')
   OR (config_payload ? 'academicYear')
   OR (config_payload ? 'defaultGradeScale');
`;

async function assertSchoolSettingsSchemaPreflight(db) {
  const schools = await db.one("SELECT to_regclass('public.schools') AS ref");
  const years = await db.one("SELECT to_regclass('public.academic_years') AS ref");
  const terms = await db.one("SELECT to_regclass('public.terms') AS ref");
  if (!schools?.ref || !years?.ref || !terms?.ref) {
    const error = new Error("Schéma de base requis (schools, academic_years, terms) avant school_settings.");
    error.code = "SCHOOL_SETTINGS_SCHEMA_PREFLIGHT";
    throw error;
  }
}

module.exports = {
  SCHOOL_SETTINGS_SCHEMA_SQL,
  STRIP_LEGACY_SCHOOL_SETTINGS_SQL,
  assertSchoolSettingsSchemaPreflight,
};
