import type { BackOfficeState } from "../types";
import { normalize } from "./format";
import { findSubscriptionForSchool } from "./subscriptions";
import { enrichSubscription, resolveAccessLevel } from "./subscriptionModule";

export type SubscriptionFeature =
  | "create_student"
  | "create_teacher"
  | "announcements"
  | "notifications"
  | "premium_documents";

const FEATURE_RULES: Record<SubscriptionFeature, Array<"full" | "limited" | "readonly" | "blocked">> = {
  create_student: ["full"],
  create_teacher: ["full"],
  announcements: ["full"],
  notifications: ["full"],
  premium_documents: ["full"],
};

/** Retourne un message d'erreur si la fonctionnalité est bloquée par l'abonnement. */
export function subscriptionFeatureBlocked(
  state: BackOfficeState,
  schoolCode: string | undefined,
  feature: SubscriptionFeature,
): string | null {
  const code = String(schoolCode ?? "").trim();
  if (!code || code === "*") return null;

  const school = state.schools.find((item) => normalize(item.code) === normalize(code));
  const raw = findSubscriptionForSchool(state.subscriptions, code);
  const subscription = enrichSubscription(
    raw ?? { schoolCode: code, plan: school?.subscriptionPlan },
    school,
    state.countries,
    state.subscriptionOffers,
  );
  const level = resolveAccessLevel(subscription) ?? "full";
  const allowed = FEATURE_RULES[feature] ?? ["full"];
  if (allowed.includes(level)) return null;

  return (
    subscription.accessLevel === "blocked"
      ? "Accès suspendu — abonnement expiré ou impayé. Contactez l'administration."
      : "Accès limité — cette action nécessite un abonnement à jour. Régularisez votre abonnement."
  );
}
