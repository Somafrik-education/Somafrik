import type { BackOfficeState, Country, School, Subscription } from "../types";
import { normalize } from "./format";
import { applySubscriptionPolicy } from "./subscriptionPolicy";

export function findSubscriptionForSchool(
  subscriptions: Subscription[] | undefined,
  schoolCode?: string,
): Subscription | undefined {
  const code = String(schoolCode ?? "").trim();
  if (!code) return undefined;
  return (subscriptions ?? []).find(
    (row) => normalize(String(row.schoolCode ?? "")) === normalize(code),
  );
}

/** Plan affichable : priorité abonnement SaaS, repli fiche établissement. */
export function resolveSubscriptionPlan(
  school?: Pick<School, "subscriptionPlan" | "code"> | null,
  subscription?: Pick<Subscription, "plan"> | null,
): string {
  const fromSubscription = String(subscription?.plan ?? "").trim();
  if (fromSubscription) return fromSubscription;
  return String(school?.subscriptionPlan ?? "").trim();
}

export function resolveSubscriptionStatus(
  school?: Pick<School, "subscriptionStatus" | "code"> | null,
  subscription?: Pick<Subscription, "paymentStatus" | "status"> | null,
): string {
  const fromSubscription = String(subscription?.paymentStatus ?? subscription?.status ?? "").trim();
  if (fromSubscription) return fromSubscription;
  return String(school?.subscriptionStatus ?? "").trim();
}

/** Aligne `subscriptions[]` sur les établissements et applique la politique tarifaire par pays. */
export function syncSubscriptionsFromSchools(
  schools: School[],
  subscriptions: Subscription[] = [],
  countries: Country[] = [],
): Subscription[] {
  const schoolByCode = new Map(
    schools.map((school) => [normalize(String(school.code ?? "")), school]),
  );

  const next = subscriptions.map((subscription) => {
    const school = schoolByCode.get(normalize(String(subscription.schoolCode ?? "")));
    const withPlan = school?.subscriptionPlan
      ? { ...subscription, plan: school.subscriptionPlan }
      : subscription;
    return school ? applySubscriptionPolicy(withPlan, school, countries) : withPlan;
  });

  for (const school of schools) {
    const code = normalize(String(school.code ?? ""));
    if (!code) continue;
    const exists = next.some((row) => normalize(String(row.schoolCode ?? "")) === code);
    if (exists || !school.subscriptionPlan) continue;
    next.push(
      applySubscriptionPolicy(
        {
          id: `SUB-${school.code}`,
          schoolCode: school.code,
          country: school.country,
          countryCode: school.countryCode,
          plan: school.subscriptionPlan,
          paymentStatus: school.subscriptionStatus ?? "À jour",
          status: "Actif",
        },
        school,
        countries,
      ),
    );
  }

  return next;
}

export function resolveSchoolSubscription(
  school: School,
  state: Pick<BackOfficeState, "subscriptions">,
) {
  const subscription = findSubscriptionForSchool(state.subscriptions, school.code);
  return {
    subscription,
    plan: resolveSubscriptionPlan(school, subscription),
    status: resolveSubscriptionStatus(school, subscription),
  };
}

/** Lignes abonnement pour l’affichage : fusionne `subscriptions` et plans issus des établissements. */
export function mergeSubscriptionsWithSchools(
  schools: School[],
  subscriptions: Subscription[],
  countries: Country[] = [],
): Subscription[] {
  const schoolByCode = new Map(
    schools.map((school) => [normalize(String(school.code ?? "")), school]),
  );
  const result = new Map<string, Subscription>();

  for (const subscription of subscriptions) {
    const code = normalize(String(subscription.schoolCode ?? ""));
    if (!code) continue;
    const school = schoolByCode.get(code);
    result.set(
      code,
      applySubscriptionPolicy(
        {
          ...subscription,
          plan: resolveSubscriptionPlan(school, subscription),
          paymentStatus:
            resolveSubscriptionStatus(school, subscription) ||
            subscription.paymentStatus ||
            "À jour",
        },
        school,
        countries,
      ),
    );
  }

  for (const school of schools) {
    const code = normalize(String(school.code ?? ""));
    if (!code || result.has(code)) continue;
    if (!String(school.subscriptionPlan ?? "").trim() && !String(school.subscriptionStatus ?? "").trim()) {
      continue;
    }
    result.set(
      code,
      applySubscriptionPolicy(
        {
          id: `SUB-${school.code}`,
          schoolCode: school.code,
          country: school.country,
          countryCode: school.countryCode,
          plan: school.subscriptionPlan ?? "Standard",
          paymentStatus: school.subscriptionStatus ?? "À jour",
          status: "Actif",
        },
        school,
        countries,
      ),
    );
  }

  return [...result.values()];
}
