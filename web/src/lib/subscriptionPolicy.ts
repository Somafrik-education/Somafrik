import type { Country, CountrySubscriptionPolicy, School, Subscription, SubscriptionPlanName } from "../types";
import { countryScopeMatches, getCountryCodeFromScope, normalize } from "./format";
import { resolveSubscriptionPlan } from "./subscriptions";

export const SUBSCRIPTION_PLAN_NAMES: SubscriptionPlanName[] = ["Essentiel", "Standard", "Premium"];

export const GLOBAL_SUBSCRIPTION_POLICY: CountrySubscriptionPolicy = {
  currency: "USD",
  plans: {
    Essentiel: { monthlyPrice: 60, annualPrice: 600 },
    Standard: { monthlyPrice: 90, annualPrice: 900 },
    Premium: { monthlyPrice: 120, annualPrice: 1200 },
  },
};

export function normalizeSubscriptionPlan(plan?: string): SubscriptionPlanName {
  const value = String(plan ?? "").trim();
  if (value === "Premium") return "Premium";
  if (value === "Essentiel") return "Essentiel";
  return "Standard";
}

export function resolveSchoolCountryCode(
  school?: Pick<School, "country" | "countryCode" | "code"> | null,
): string {
  if (!school) return "";
  const explicit = String(school.countryCode ?? "").trim().toUpperCase();
  if (explicit) return explicit;
  const fromCountry = getCountryCodeFromScope(school.country);
  if (fromCountry) return fromCountry;
  const fromCode = String(school.code ?? "").match(/^([A-Z]{2})-/i)?.[1];
  return fromCode ? fromCode.toUpperCase() : "";
}

export function findCountryForSchool(
  school: Pick<School, "country" | "countryCode" | "code"> | undefined,
  countries: Country[],
): Country | undefined {
  if (!school) return undefined;
  const code = resolveSchoolCountryCode(school);
  if (code) {
    const byCode = countries.find((country) => normalize(country.code) === normalize(code));
    if (byCode) return byCode;
  }
  return countries.find(
    (country) =>
      countryScopeMatches(country.name, school.country) ||
      countryScopeMatches(country.code, school.country),
  );
}

export function findCountryByCode(countries: Country[], countryCode?: string): Country | undefined {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!code) return undefined;
  return countries.find((item) => normalize(item.code) === normalize(code));
}

/** Politique effective : personnalisation pays ou barème global Somafrik. */
export function resolveCountrySubscriptionPolicy(country?: Country | null): CountrySubscriptionPolicy {
  const custom = country?.subscriptionPolicy;
  const currency =
    String(custom?.currency ?? country?.currency ?? GLOBAL_SUBSCRIPTION_POLICY.currency).trim() ||
    GLOBAL_SUBSCRIPTION_POLICY.currency;

  const plans = { ...GLOBAL_SUBSCRIPTION_POLICY.plans };
  for (const planName of SUBSCRIPTION_PLAN_NAMES) {
    const override = custom?.plans?.[planName];
    if (!override) continue;
    plans[planName] = {
      monthlyPrice: Number(override.monthlyPrice ?? plans[planName].monthlyPrice),
      annualPrice: Number(override.annualPrice ?? plans[planName].annualPrice),
    };
  }

  return { currency, plans };
}

export function getPlanPricing(
  plan: string | undefined,
  country?: Country | null,
): { plan: SubscriptionPlanName; monthlyPrice: number; annualPrice: number; currency: string } {
  const planName = normalizeSubscriptionPlan(plan);
  const policy = resolveCountrySubscriptionPolicy(country);
  const pricing = policy.plans[planName];
  return {
    plan: planName,
    monthlyPrice: pricing.monthlyPrice,
    annualPrice: pricing.annualPrice,
    currency: policy.currency ?? GLOBAL_SUBSCRIPTION_POLICY.currency ?? "USD",
  };
}

export function applySubscriptionPolicy(
  subscription: Subscription,
  school: School | undefined,
  countries: Country[],
): Subscription {
  const country =
    findCountryByCode(countries, subscription.countryCode) ??
    findCountryForSchool(school, countries) ??
    findCountryByCode(countries, resolveSchoolCountryCode(school));
  const plan = resolveSubscriptionPlan(school, subscription);
  const pricing = getPlanPricing(plan, country);

  return {
    ...subscription,
    plan: pricing.plan,
    monthlyPrice: pricing.monthlyPrice,
    annualPrice: pricing.annualPrice,
    currency: pricing.currency,
    country: subscription.country || school?.country || country?.name || subscription.country,
    countryCode: subscription.countryCode || country?.code || resolveSchoolCountryCode(school),
  };
}

export function buildCountryPolicyRows(countries: Country[]) {
  return countries.map((country) => ({
    country,
    policy: resolveCountrySubscriptionPolicy(country),
  }));
}

export function updateCountryPlanPrice(
  policy: CountrySubscriptionPolicy,
  plan: SubscriptionPlanName,
  field: "monthlyPrice" | "annualPrice",
  value: string,
): CountrySubscriptionPolicy {
  const amount = Number(value);
  return {
    ...policy,
    plans: {
      ...policy.plans,
      [plan]: {
        ...policy.plans[plan],
        [field]: Number.isFinite(amount) ? amount : policy.plans[plan][field],
      },
    },
  };
}

export function countriesWithResolvedPolicies(countries: Country[]): Country[] {
  return countries.map((country) => ({
    ...country,
    subscriptionPolicy: resolveCountrySubscriptionPolicy(country),
  }));
}
