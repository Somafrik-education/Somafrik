import type { School, Subscription } from "../types";
import { createSubscriptionFromOffer, DEFAULT_SUBSCRIPTION_OFFERS } from "./subscriptionModule";

const STANDARD_OFFER_ID = "OFFER-STANDARD";

/**
 * Raccord d'activation depuis une demande publique :
 * offre Standard complète + startTrial: true (30 jours). Pas d'offre d'essai limitée.
 */
export function buildStandardTrialSubscriptionPayload(school: School): Subscription {
  const offer = DEFAULT_SUBSCRIPTION_OFFERS.find((item) => item.id === STANDARD_OFFER_ID);
  if (!offer) {
    throw new Error("OFFER-STANDARD est absente du catalogue.");
  }
  return createSubscriptionFromOffer(school, offer, { startTrial: true });
}
