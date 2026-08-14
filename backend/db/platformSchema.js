"use strict";

/**
 * LOT 6 — schéma PostgreSQL canonique pour la plateforme.
 * Idempotent ; aucun backfill ni lecture de backoffice_state pour l'écriture.
 */

const PLATFORM_SCHEMA_SQL = `
ALTER TABLE countries ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_name TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard_chart_config (
  scope_key TEXT PRIMARY KEY,
  chart_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_code TEXT NOT NULL UNIQUE,
  country_codes TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  subscription_id UUID REFERENCES subscriptions(id),
  payment_code TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  subscription_id UUID REFERENCES subscriptions(id),
  invoice_code TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  offer_id UUID REFERENCES subscription_offers(id),
  status TEXT NOT NULL DEFAULT 'pending',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  subscription_id UUID REFERENCES subscriptions(id),
  action TEXT NOT NULL,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_school
  ON subscription_payments (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_school
  ON subscription_invoices (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_discounts_school
  ON subscription_discounts (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_audit_log_school
  ON subscription_audit_log (school_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_school_id
  ON subscriptions (school_id);
`;

const SUBSCRIPTION_DUPLICATE_PREFLIGHT_SQL = `
  SELECT school_id, COUNT(*)::int AS count
  FROM subscriptions
  WHERE school_id IS NOT NULL
  GROUP BY school_id
  HAVING COUNT(*) > 1
`;

/**
 * Fail-closed avant création de uq_subscriptions_school_id sur une base peuplée.
 * @param {{ all: (sql: string) => Promise<Array<{ school_id: string, count: number }>> }} repo
 */
async function assertPlatformSchemaPreflight(repo) {
  let duplicates = [];
  try {
    duplicates = await repo.all(SUBSCRIPTION_DUPLICATE_PREFLIGHT_SQL);
  } catch (error) {
    if (/relation "subscriptions" does not exist/i.test(String(error?.message ?? ""))) {
      return;
    }
    throw error;
  }

  if (!duplicates.length) {
    return;
  }

  const error = new Error(
    `PLATFORM_SCHEMA_PREFLIGHT_FAILED: ${duplicates.length} école(s) avec plusieurs abonnements. ` +
      "Exécuter SELECT school_id, COUNT(*) FROM subscriptions GROUP BY school_id HAVING COUNT(*) > 1;",
  );
  error.code = "PLATFORM_SUBSCRIPTION_DUPLICATES";
  error.statusCode = 500;
  error.details = { duplicates };
  throw error;
}

module.exports = {
  PLATFORM_SCHEMA_SQL,
  SUBSCRIPTION_DUPLICATE_PREFLIGHT_SQL,
  assertPlatformSchemaPreflight,
};
