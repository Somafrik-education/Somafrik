"use strict";

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

const PLAN_PRICING = Object.freeze({
  Essentiel: Object.freeze({ monthlyPrice: 60, annualPrice: 600 }),
  Standard: Object.freeze({ monthlyPrice: 90, annualPrice: 900 }),
  Premium: Object.freeze({ monthlyPrice: 120, annualPrice: 1200 }),
});

function buildGeneratedSubscription(school, country, position) {
  const schoolCode = normalizeCode(school?.code);
  const countryCode = normalizeCode(school?.countryCode || country?.code);
  const plan = String(school?.subscriptionPlan ?? "Standard").trim() || "Standard";
  const pricing = PLAN_PRICING[plan] ?? PLAN_PRICING.Standard;
  const paymentStatus = String(school?.subscriptionStatus ?? "À jour").trim() || "À jour";
  const late = paymentStatus.toLocaleLowerCase("fr-FR").includes("retard");

  return {
    id: `SUB-${schoolCode}`,
    schoolCode,
    countryCode,
    country: school?.country ?? country?.name ?? "",
    plan,
    monthlyPrice: pricing.monthlyPrice,
    annualPrice: pricing.annualPrice,
    currency: "USD",
    status: school?.status ?? "Actif",
    lifecycleStatus: school?.status ?? "Actif",
    paymentStatus,
    startDate: "01-09-2025",
    endDate: late ? "31-05-2026" : "31-08-2026",
    lastPaymentDate: `${String((position % 27) + 1).padStart(2, "0")}-05-2026`,
  };
}

function assertDemoSubscriptionIntegrity(platformSchools, subscriptions) {
  const expectedCodes = platformSchools.map((school) => normalizeCode(school?.code));
  const actualCodes = subscriptions.map((subscription) => normalizeCode(subscription?.schoolCode));
  const uniqueCodes = new Set(actualCodes);

  if (subscriptions.length !== platformSchools.length || uniqueCodes.size !== subscriptions.length) {
    throw new Error("Demo seed subscriptions: expected exactly one subscription per platform school.");
  }

  for (const schoolCode of expectedCodes) {
    if (!uniqueCodes.has(schoolCode)) {
      throw new Error(`Demo seed subscriptions: missing subscription for ${schoolCode}.`);
    }
  }

  return true;
}

function reconcileDemoSubscriptions({ platformSchools, countries, subscriptions }) {
  if (!Array.isArray(platformSchools) || !Array.isArray(countries) || !Array.isArray(subscriptions)) {
    throw new TypeError("Demo seed subscriptions: platformSchools, countries and subscriptions must be arrays.");
  }

  const schoolCodes = new Set();
  for (const school of platformSchools) {
    const schoolCode = normalizeCode(school?.code);
    if (!schoolCode) {
      throw new Error("Demo seed subscriptions: every platform school must have a code.");
    }
    if (schoolCodes.has(schoolCode)) {
      throw new Error(`Demo seed subscriptions: duplicate platform school code ${schoolCode}.`);
    }
    schoolCodes.add(schoolCode);
  }

  // Historical fixtures can contain orphan or duplicate subscription rows.
  // Keep the first explicit row for a real platform school, then fill every
  // missing school from platformSchools. Consumers always receive one row
  // per school, which matches uq_subscriptions_school_id.
  const explicitBySchoolCode = new Map();
  for (const subscription of subscriptions) {
    const schoolCode = normalizeCode(subscription?.schoolCode);
    if (!schoolCodes.has(schoolCode) || explicitBySchoolCode.has(schoolCode)) continue;
    explicitBySchoolCode.set(schoolCode, subscription);
  }

  const countryByCode = new Map(countries.map((country) => [normalizeCode(country?.code), country]));

  const reconciled = platformSchools.map((school, index) => {
    const schoolCode = normalizeCode(school.code);
    const countryCode = normalizeCode(school.countryCode);
    const country = countryByCode.get(countryCode);
    const explicit = explicitBySchoolCode.get(schoolCode);

    if (!explicit) {
      return buildGeneratedSubscription(school, country, index + 1);
    }

    return {
      ...explicit,
      schoolCode,
      countryCode: countryCode || normalizeCode(explicit.countryCode),
      country: school.country ?? explicit.country ?? country?.name ?? "",
    };
  });

  assertDemoSubscriptionIntegrity(platformSchools, reconciled);
  return reconciled;
}

module.exports = {
  reconcileDemoSubscriptions,
  assertDemoSubscriptionIntegrity,
};
