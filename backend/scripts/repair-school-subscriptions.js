/**
 * Aligne subscriptions[] sur school.subscriptionPlan (ex. Essai gratuit).
 *
 *   docker compose exec -T backend node scripts/repair-school-subscriptions.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { initializeRepository } = require("../db/repositoryFactory");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function normalizeSchoolCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function repairSubscriptions(state = {}) {
  const schools = Array.isArray(state.schools) ? state.schools : [];
  const subscriptions = Array.isArray(state.subscriptions) ? [...state.subscriptions] : [];
  const schoolByCode = new Map(
    schools.map((school) => [normalizeSchoolCode(school.code), school]),
  );
  const fixes = [];

  const nextSubscriptions = subscriptions.map((subscription) => {
    const school = schoolByCode.get(normalizeSchoolCode(subscription.schoolCode));
    const schoolPlan = String(school?.subscriptionPlan ?? "").trim();
    if (!schoolPlan || subscription.plan === schoolPlan) {
      return subscription;
    }
    fixes.push({
      schoolCode: subscription.schoolCode,
      schoolName: school?.name,
      before: subscription.plan,
      after: schoolPlan,
    });
    const isTrial = schoolPlan === "Essai gratuit";
    return {
      ...subscription,
      plan: schoolPlan,
      monthlyPrice: isTrial ? 0 : subscription.monthlyPrice,
      annualPrice: isTrial ? 0 : subscription.annualPrice,
    };
  });

  return { state: { ...state, subscriptions: nextSubscriptions }, fixes };
}

async function main() {
  const { repository } = await initializeRepository();
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });

  try {
    const current = (await repository.getBackOfficeState()) ?? {};
    const { state: next, fixes } = repairSubscriptions(current);

    if (!fixes.length) {
      console.log("Aucune correction d'abonnement nécessaire.");
      return;
    }

    await pool.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET
         state_payload = EXCLUDED.state_payload,
         updated_at = NOW()`,
      [JSON.stringify(next)],
    );

    console.log("Abonnements alignés sur la fiche établissement :");
    for (const fix of fixes) {
      console.log(`  - ${fix.schoolName ?? fix.schoolCode} (${fix.schoolCode}) : ${fix.before} → ${fix.after}`);
    }
  } finally {
    await repository.close?.();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
