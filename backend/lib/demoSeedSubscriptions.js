"use strict";

/**
 * Normalise les abonnements de démonstration pour respecter le contrat PostgreSQL :
 * exactement un abonnement par établissement et aucun schoolCode orphelin.
 */
function buildDemoSubscriptions({ subscriptions = [], platformSchools = [], countries = [] }) {
  const schoolByCode = new Map(platformSchools.map((school) => [school.code, school]));
  const result = [];
  const seen = new Set();

  // Conserve les fixtures explicites valides, ignore les orphelins et doublons.
  for (const subscription of subscriptions) {
    const school = schoolByCode.get(subscription.schoolCode);
    if (!school || seen.has(subscription.schoolCode)) continue;
    result.push({
      ...subscription,
      countryCode: school.countryCode,
      country: school.country,
    });
    seen.add(subscription.schoolCode);
  }

  // Complète ensuite exactement une souscription pour chaque établissement restant.
  for (const school of platformSchools) {
    if (seen.has(school.code)) continue;
    const index = result.length + 1;
    const country =
      countries.find((item) => item.code === school.countryCode)
      ?? countries.find((item) => item.name === school.country)
      ?? null;

    if (!country) {
      throw new Error(`DEMO_SEED_SUBSCRIPTION_COUNTRY_NOT_FOUND: ${school.code}`);
    }

    result.push({
      id: `SUB-${school.code}`,
      schoolCode: school.code,
      countryCode: school.countryCode,
      country: school.country,
      plan: school.subscriptionPlan,
      monthlyPrice: [60, 90, 120][index % 3],
      annualPrice: [600, 900, 1200][index % 3],
      currency: "USD",
      status: school.status,
      paymentStatus: index % 8 === 0 ? "En retard" : "À jour",
      startDate: "01-09-2025",
      endDate: index % 8 === 0 ? "31-05-2026" : "31-08-2026",
      lastPaymentDate: `${String((index % 27) + 1).padStart(2, "0")}-05-2026`,
    });
    seen.add(school.code);
  }

  if (result.length !== platformSchools.length) {
    throw new Error(
      `DEMO_SEED_SUBSCRIPTION_CARDINALITY_MISMATCH: schools=${platformSchools.length} subscriptions=${result.length}`,
    );
  }

  return result;
}

module.exports = { buildDemoSubscriptions };
