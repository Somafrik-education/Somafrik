import type {
  BackOfficeState,
  Country,
  School,
  Subscription,
  SubscriptionAuditEntry,
  SubscriptionBillingCycle,
  SubscriptionInvoice,
  SubscriptionLifecycleStatus,
  SubscriptionOffer,
  SubscriptionPayment,
} from "../types";
import { normalize } from "./format";
import { applySubscriptionPolicy, resolveCountrySubscriptionPolicy } from "./subscriptionPolicy";

/** Politique de retard recommandée Somafrik (jours après échéance). */
export const DELINQUENCY_POLICY = {
  reminderDay: 0,
  lateStatusDay: 3,
  adminRelanceDay: 7,
  limitedAccessDay: 14,
  suspensionDay: 30,
} as const;

export const PAYMENT_METHODS = [
  "Mobile Money",
  "Orange Money",
  "MTN Mobile Money",
  "Airtel Money",
  "Carte bancaire",
  "Virement bancaire",
  "Paiement manuel",
  "Partenaire local",
] as const;

export const SUBSCRIPTION_MODULE_LABELS: Record<string, string> = {
  students: "Gestion élèves",
  classes: "Classes",
  presences: "Présences",
  notes: "Notes",
  bulletins: "Bulletins",
  payments: "Paiements scolaires",
  communication: "Communication",
  statistics: "Statistiques",
  api: "API / intégrations",
  support: "Support prioritaire",
};

/** Offres MVP Somafrik (Essai, Standard, Premium, Sur mesure). */
export const DEFAULT_SUBSCRIPTION_OFFERS: SubscriptionOffer[] = [
  {
    id: "OFFER-TRIAL",
    name: "Essai gratuit",
    targetAudience: "Nouvel établissement",
    monthlyPrice: 0,
    annualPrice: 0,
    currency: "EUR",
    maxStudents: 200,
    maxTeachers: 20,
    maxUsers: 30,
    storageGb: 1,
    trialDays: 30,
    active: true,
    modules: {
      students: true,
      classes: true,
      presences: true,
      notes: "limited",
      bulletins: false,
      payments: false,
      communication: "limited",
      statistics: false,
      api: false,
      support: false,
    },
    notes: "Une seule période d'essai par établissement.",
  },
  {
    id: "OFFER-STANDARD",
    name: "Standard",
    targetAudience: "École privée petite / moyenne",
    monthlyPrice: 28,
    quarterlyPrice: 80,
    annualPrice: 300,
    currency: "EUR",
    maxStudents: 500,
    maxTeachers: 50,
    maxUsers: 80,
    storageGb: 5,
    active: true,
    modules: {
      students: true,
      classes: true,
      presences: true,
      notes: true,
      bulletins: true,
      payments: true,
      communication: true,
      statistics: "limited",
      api: false,
      support: false,
    },
  },
  {
    id: "OFFER-PREMIUM",
    name: "Premium",
    targetAudience: "Grande école / université",
    monthlyPrice: 65,
    quarterlyPrice: 180,
    annualPrice: 650,
    currency: "EUR",
    maxStudents: null,
    maxTeachers: null,
    maxUsers: null,
    storageGb: 20,
    active: true,
    modules: {
      students: true,
      classes: true,
      presences: true,
      notes: true,
      bulletins: true,
      payments: true,
      communication: true,
      statistics: true,
      api: true,
      support: true,
    },
  },
  {
    id: "OFFER-CUSTOM",
    name: "Sur mesure",
    targetAudience: "Groupe scolaire / université",
    monthlyPrice: 0,
    annualPrice: 0,
    currency: "EUR",
    maxStudents: null,
    maxTeachers: null,
    maxUsers: null,
    storageGb: 50,
    active: true,
    modules: {
      students: true,
      classes: true,
      presences: true,
      notes: true,
      bulletins: true,
      payments: true,
      communication: true,
      statistics: true,
      api: true,
      support: true,
    },
    notes: "Contrat personnalisé — tarif négocié.",
  },
];

/** Génère les offres par défaut pour un pays (tarifs = politique pays ou barème global). */
export function buildDefaultOffersForCountry(country: Country): SubscriptionOffer[] {
  const code = String(country.code ?? "").trim().toUpperCase();
  if (!code) return [];

  const policy = resolveCountrySubscriptionPolicy(country);
  const currency = String(policy.currency ?? country.currency ?? "USD").trim().toUpperCase();

  const tiers: { suffix: string; template: SubscriptionOffer; planKey?: "Standard" | "Premium" }[] = [
    { suffix: "TRIAL", template: DEFAULT_SUBSCRIPTION_OFFERS[0] },
    { suffix: "STANDARD", template: DEFAULT_SUBSCRIPTION_OFFERS[1], planKey: "Standard" },
    { suffix: "PREMIUM", template: DEFAULT_SUBSCRIPTION_OFFERS[2], planKey: "Premium" },
    { suffix: "CUSTOM", template: DEFAULT_SUBSCRIPTION_OFFERS[3] },
  ];

  return tiers.map(({ suffix, template, planKey }) => {
    const monthly = planKey ? policy.plans[planKey].monthlyPrice : template.monthlyPrice;
    const annual = planKey ? policy.plans[planKey].annualPrice : template.annualPrice;
    return {
      ...template,
      id: `OFFER-${suffix}-${code}`,
      monthlyPrice: monthly,
      annualPrice: annual,
      quarterlyPrice: monthly > 0 ? Math.round(monthly * 2.85) : template.quarterlyPrice,
      currency,
      countryCodes: [code],
    };
  });
}

export function bootstrapOffersForCountries(
  countries: Country[] | undefined,
): SubscriptionOffer[] {
  return (countries ?? [])
    .filter((country) => String(country.code ?? "").trim())
    .flatMap((country) => buildDefaultOffersForCountry(country));
}

export function ensureSubscriptionOffers(
  offers: SubscriptionOffer[] | undefined,
  countries?: Country[],
): SubscriptionOffer[] {
  const existing = offers ?? [];
  const byId = new Map<string, SubscriptionOffer>();

  if (!existing.length) {
    const seeded = countries?.length ? bootstrapOffersForCountries(countries) : [...DEFAULT_SUBSCRIPTION_OFFERS];
    for (const offer of seeded) byId.set(offer.id, offer);
    return [...byId.values()];
  }

  for (const offer of existing) byId.set(offer.id, offer);

  if (countries?.length) {
    for (const seed of bootstrapOffersForCountries(countries)) {
      if (!byId.has(seed.id)) byId.set(seed.id, seed);
    }
  } else {
    for (const seed of DEFAULT_SUBSCRIPTION_OFFERS) {
      if (!byId.has(seed.id)) byId.set(seed.id, seed);
    }
  }

  return [...byId.values()];
}

/** Offres visibles pour un pays (countryCodes vide = offre globale legacy). */
export function filterOffersForCountry(
  offers: SubscriptionOffer[],
  countryCode?: string,
): SubscriptionOffer[] {
  if (!countryCode) return offers;
  return offers.filter((offer) => isOfferEligibleForCountry(offer, countryCode));
}

export function formatOfferCountries(
  offer: SubscriptionOffer,
  countries: Country[],
): string {
  const codes = offer.countryCodes ?? [];
  if (!codes.length) return "Tous les pays";
  const names = codes.map((code) => {
    const country = countries.find((c) => normalize(c.code) === normalize(code));
    return country ? `${country.name} (${code})` : code;
  });
  return names.join(", ");
}

export function findOfferForSubscription(
  offers: SubscriptionOffer[] | undefined,
  subscription: Pick<Subscription, "offerId" | "plan" | "countryCode">,
  school?: School,
): SubscriptionOffer | undefined {
  const byId = findOffer(offers, subscription.offerId);
  if (byId) return byId;

  const countryCode = subscription.countryCode ?? school?.countryCode;
  const matches = ensureSubscriptionOffers(offers).filter(
    (offer) => normalize(offer.name) === normalize(subscription.plan),
  );
  if (matches.length === 1) return matches[0];
  if (countryCode) {
    return matches.find((offer) => isOfferEligibleForCountry(offer, countryCode));
  }
  return matches[0];
}

export function findOffer(
  offers: SubscriptionOffer[] | undefined,
  offerId?: string,
): SubscriptionOffer | undefined {
  const id = String(offerId ?? "").trim();
  if (!id) return undefined;
  return ensureSubscriptionOffers(offers).find((o) => o.id === id);
}

export function findOfferByName(
  offers: SubscriptionOffer[] | undefined,
  name?: string,
): SubscriptionOffer | undefined {
  const value = normalize(name);
  return ensureSubscriptionOffers(offers).find((o) => normalize(o.name) === value);
}

export function resolveLifecycleStatus(subscription: Subscription): SubscriptionLifecycleStatus {
  if (subscription.lifecycleStatus) return subscription.lifecycleStatus;
  const status = normalize(subscription.status);
  const payment = normalize(subscription.paymentStatus);
  if (status === "suspendu" || payment === "en retard") {
    return payment === "en retard" ? "En retard" : "Suspendu";
  }
  if (status === "actif") return "Actif";
  if (status === "expire") return "Expiré";
  return "Actif";
}

export function resolveAccessLevel(subscription: Subscription): Subscription["accessLevel"] {
  if (subscription.accessLevel) return subscription.accessLevel;
  const lifecycle = resolveLifecycleStatus(subscription);
  if (lifecycle === "Suspendu" || lifecycle === "Expiré" || lifecycle === "Annulé") return "blocked";
  if (lifecycle === "En retard") return "limited";
  if (lifecycle === "Essai") return "full";
  return "full";
}

export function formatBillingCycle(cycle?: SubscriptionBillingCycle): string {
  if (cycle === "quarterly") return "Trimestriel";
  if (cycle === "annual") return "Annuel";
  return "Mensuel";
}

export function billingAmount(
  offer: SubscriptionOffer,
  cycle: SubscriptionBillingCycle = "monthly",
): number {
  if (cycle === "annual") return offer.annualPrice ?? offer.monthlyPrice * 10;
  if (cycle === "quarterly") return offer.quarterlyPrice ?? offer.monthlyPrice * 3;
  return offer.monthlyPrice;
}

function parseFrDate(value?: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(/[-/]/);
  if (parts.length === 3) {
    const [d, m, y] = parts.map(Number);
    if (d && m && y) return new Date(y, m - 1, d);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatFrDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}-${m}-${date.getFullYear()}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function computeDelinquencyDays(subscription: Subscription, today = new Date()): number {
  const due = parseFrDate(subscription.endDate ?? subscription.nextRenewalDate);
  if (!due) return 0;
  const diff = today.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

/** Applique la politique J+3 / J+14 / J+30 sur le statut (sans persister). */
export function applyDelinquencyPolicy(subscription: Subscription, today = new Date()): Subscription {
  const daysLate = computeDelinquencyDays(subscription, today);
  const lifecycle = resolveLifecycleStatus(subscription);
  if (lifecycle === "Essai" || lifecycle === "Brouillon" || lifecycle === "Résilié" || lifecycle === "Annulé") {
    return subscription;
  }
  if (daysLate <= 0) return subscription;

  let next: Subscription = { ...subscription };
  if (daysLate >= DELINQUENCY_POLICY.suspensionDay) {
    next = {
      ...next,
      lifecycleStatus: "Suspendu",
      status: "Suspendu",
      paymentStatus: "En retard",
      accessLevel: "blocked",
      suspensionReason: `Impayé depuis ${daysLate} jours`,
    };
  } else if (daysLate >= DELINQUENCY_POLICY.limitedAccessDay) {
    next = {
      ...next,
      lifecycleStatus: "En retard",
      paymentStatus: "En retard",
      accessLevel: "limited",
    };
  } else if (daysLate >= DELINQUENCY_POLICY.lateStatusDay) {
    next = {
      ...next,
      lifecycleStatus: "En retard",
      paymentStatus: "En retard",
      accessLevel: "full",
    };
  }
  return next;
}

export function canDowngradeToOffer(
  activeStudentCount: number,
  offer: SubscriptionOffer,
): { allowed: boolean; reason?: string } {
  const max = offer.maxStudents;
  if (max == null) return { allowed: true };
  if (activeStudentCount <= max) return { allowed: true };
  return {
    allowed: false,
    reason: `L'établissement compte ${activeStudentCount} élèves actifs, limite ${max} pour l'offre « ${offer.name} ».`,
  };
}

export function countActiveStudents(state: BackOfficeState, schoolCode: string): number {
  const code = normalize(schoolCode);
  return (state.students as { schoolCode?: string; status?: string }[]).filter(
    (row) =>
      normalize(String(row.schoolCode ?? "")) === code &&
      !["inactif", "archive", "archivé"].includes(normalize(row.status)),
  ).length;
}

export function createSubscriptionFromOffer(
  school: School,
  offer: SubscriptionOffer,
  options: {
    billingCycle?: SubscriptionBillingCycle;
    startTrial?: boolean;
    paymentMethod?: string;
  } = {},
): Subscription {
  const today = new Date();
  const startDate = formatFrDate(today);
  const trial = options.startTrial ?? (offer.trialDays ?? 0) > 0;
  const end = trial
    ? addDays(today, offer.trialDays ?? 30)
    : addDays(today, options.billingCycle === "annual" ? 365 : options.billingCycle === "quarterly" ? 90 : 30);

  return {
    id: `SUB-${school.code}-${Date.now()}`,
    schoolCode: school.code,
    country: school.country,
    countryCode: school.countryCode,
    offerId: offer.id,
    plan: offer.name,
    monthlyPrice: offer.monthlyPrice,
    annualPrice: offer.annualPrice,
    currency: offer.currency,
    billingCycle: options.billingCycle ?? "monthly",
    paymentMethod: options.paymentMethod ?? "Paiement manuel",
    startDate,
    endDate: formatFrDate(end),
    nextRenewalDate: formatFrDate(end),
    lifecycleStatus: trial ? "Essai" : "Actif",
    status: trial ? "Actif" : "Actif",
    paymentStatus: trial ? "À jour" : "En attente",
    maxStudents: offer.maxStudents,
    maxTeachers: offer.maxTeachers,
    maxUsers: offer.maxUsers,
    activatedModules: Object.entries(offer.modules)
      .filter(([, v]) => v === true || v === "limited")
      .map(([k]) => k),
    trialUsed: trial,
    accessLevel: "full",
  };
}

export function appendSubscriptionAudit(
  log: SubscriptionAuditEntry[] | undefined,
  entry: Omit<SubscriptionAuditEntry, "id" | "createdAt">,
): SubscriptionAuditEntry[] {
  const next: SubscriptionAuditEntry = {
    ...entry,
    id: `SAUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toLocaleString("fr-FR"),
  };
  return [next, ...(log ?? [])].slice(0, 200);
}

export function validateSubscriptionPayment(
  state: BackOfficeState,
  paymentId: string,
  validatorName: string,
): Partial<BackOfficeState> {
  const payments = [...(state.subscriptionPayments ?? [])];
  const payment = payments.find((p) => p.id === paymentId);
  if (!payment || payment.status === "Validé") return {};

  const validated: SubscriptionPayment = {
    ...payment,
    status: "Validé",
    validatedBy: validatorName,
    validatedAt: new Date().toLocaleString("fr-FR"),
    receiptId: payment.receiptId ?? `REC-${payment.id}`,
  };

  const subscriptions = (state.subscriptions ?? []).map((sub) => {
    if (normalize(sub.schoolCode) !== normalize(payment.schoolCode)) return sub;
    const today = new Date();
    const end = addDays(today, 30);
    return applyDelinquencyPolicy({
      ...sub,
      lifecycleStatus: "Actif",
      status: "Actif",
      paymentStatus: "À jour",
      accessLevel: "full",
      lastPaymentDate: formatFrDate(today),
      endDate: formatFrDate(end),
      nextRenewalDate: formatFrDate(end),
      suspensionReason: undefined,
    });
  });

  const invoices = [...(state.subscriptionInvoices ?? [])];
  const invoiceIdx = invoices.findIndex(
    (inv) =>
      normalize(inv.schoolCode) === normalize(payment.schoolCode) &&
      inv.status !== "Payée" &&
      inv.status !== "Annulée",
  );
  if (invoiceIdx >= 0) {
    invoices[invoiceIdx] = {
      ...invoices[invoiceIdx],
      status: "Payée",
      paidAt: validated.validatedAt,
      paymentId: payment.id,
    };
  }

  const auditLog = appendSubscriptionAudit(state.subscriptionAuditLog, {
    action: "Paiement validé",
    schoolCode: payment.schoolCode,
    author: validatorName,
    details: `${payment.amount} ${payment.currency} — ref. ${payment.reference}`,
  });

  return {
    subscriptionPayments: payments.map((p) => (p.id === paymentId ? validated : p)),
    subscriptions,
    subscriptionInvoices: invoices,
    subscriptionAuditLog: auditLog,
  };
}

export function registerManualPayment(
  state: BackOfficeState,
  payload: {
    schoolCode: string;
    amount: number;
    currency: string;
    method: string;
    reference: string;
    notes?: string;
    author?: string;
  },
): Partial<BackOfficeState> {
  const payment: SubscriptionPayment = {
    id: `SPAY-${Date.now()}`,
    schoolCode: payload.schoolCode,
    amount: payload.amount,
    currency: payload.currency,
    method: payload.method,
    reference: payload.reference,
    status: "En attente",
    notes: payload.notes,
    createdAt: new Date().toLocaleString("fr-FR"),
  };

  const auditLog = appendSubscriptionAudit(state.subscriptionAuditLog, {
    action: "Paiement enregistré",
    schoolCode: payload.schoolCode,
    author: payload.author,
    details: `${payload.amount} ${payload.currency} — ${payload.method}`,
  });

  return {
    subscriptionPayments: [payment, ...(state.subscriptionPayments ?? [])],
    subscriptionAuditLog: auditLog,
  };
}

export function generateInvoice(
  subscription: Subscription,
  offer?: SubscriptionOffer,
): SubscriptionInvoice {
  const cycle = subscription.billingCycle ?? "monthly";
  const amount =
    cycle === "annual"
      ? (subscription.annualPrice ?? offer?.annualPrice ?? 0)
      : cycle === "quarterly"
        ? (offer?.quarterlyPrice ?? (subscription.monthlyPrice ?? 0) * 3)
        : (subscription.monthlyPrice ?? offer?.monthlyPrice ?? 0);

  const today = new Date();
  const end = parseFrDate(subscription.endDate) ?? addDays(today, 30);

  return {
    id: `SINV-${subscription.schoolCode}-${Date.now()}`,
    schoolCode: subscription.schoolCode,
    subscriptionId: subscription.id,
    amount,
    currency: subscription.currency ?? offer?.currency ?? "EUR",
    periodStart: subscription.startDate ?? formatFrDate(today),
    periodEnd: subscription.endDate ?? formatFrDate(end),
    dueDate: subscription.endDate ?? formatFrDate(end),
    status: subscription.paymentStatus === "À jour" ? "Payée" : "Émise",
    issuedAt: formatFrDate(today),
  };
}

export function subscriptionReports(state: BackOfficeState) {
  const subs = (state.subscriptions ?? []).map((s) => applyDelinquencyPolicy(s));
  const offers = ensureSubscriptionOffers(state.subscriptionOffers);

  const byStatus = (status: SubscriptionLifecycleStatus) =>
    subs.filter((s) => resolveLifecycleStatus(s) === status).length;

  const monthlyRevenue = subs
    .filter((s) => resolveLifecycleStatus(s) === "Actif")
    .reduce((sum, s) => sum + Number(s.monthlyPrice ?? 0), 0);

  const trialCount = byStatus("Essai");
  const activeCount = byStatus("Actif");
  const lateCount = byStatus("En retard");
  const suspendedCount = byStatus("Suspendu");

  const expiringSoon = subs.filter((s) => {
    const due = parseFrDate(s.endDate);
    if (!due) return false;
    const until = (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return until >= 0 && until <= 7;
  }).length;

  return {
    totalSchools: subs.length,
    trialCount,
    activeCount,
    lateCount,
    suspendedCount,
    monthlyRevenue,
    offerCount: offers.filter((o) => o.active).length,
    pendingPayments: (state.subscriptionPayments ?? []).filter((p) => p.status === "En attente")
      .length,
    expiringSoon,
    conversionRate: trialCount + activeCount > 0 ? Math.round((activeCount / (trialCount + activeCount)) * 100) : 0,
  };
}

export function enrichSubscription(
  subscription: Subscription,
  school: School | undefined,
  countries: BackOfficeState["countries"],
  offers: SubscriptionOffer[] | undefined,
): Subscription {
  const withPolicy = school
    ? applySubscriptionPolicy(subscription, school, countries)
    : subscription;
  const offer =
    findOfferForSubscription(offers, subscription, school) ??
    findOfferByName(offers, subscription.plan);
  const enriched = applyDelinquencyPolicy({
    ...withPolicy,
    plan: offer?.name ?? withPolicy.plan,
    maxStudents: withPolicy.maxStudents ?? offer?.maxStudents,
    maxUsers: withPolicy.maxUsers ?? offer?.maxUsers,
  });
  return enriched;
}

export function isOfferEligibleForCountry(offer: SubscriptionOffer, countryCode?: string): boolean {
  if (!offer.active) return false;
  const codes = offer.countryCodes ?? [];
  if (!codes.length) return true;
  const code = String(countryCode ?? "").trim().toUpperCase();
  return codes.some((c) => c.toUpperCase() === code);
}

export function requestSubscriptionCancellation(
  state: BackOfficeState,
  schoolCode: string,
  reason: string,
  author?: string,
): Partial<BackOfficeState> {
  const subscriptions = (state.subscriptions ?? []).map((sub) => {
    if (normalize(sub.schoolCode) !== normalize(schoolCode)) return sub;
    return {
      ...sub,
      cancellationRequestedAt: new Date().toLocaleString("fr-FR"),
      cancellationReason: reason,
    };
  });

  const auditLog = appendSubscriptionAudit(state.subscriptionAuditLog, {
    action: "Demande de résiliation",
    schoolCode,
    author,
    details: reason,
  });

  return { subscriptions, subscriptionAuditLog: auditLog };
}

export function requestOfferChange(
  state: BackOfficeState,
  schoolCode: string,
  offerId: string,
  author?: string,
): Partial<BackOfficeState> & { error?: string } {
  const offer = findOffer(state.subscriptionOffers, offerId);
  if (!offer) return { error: "Offre introuvable." };

  const studentCount = countActiveStudents(state, schoolCode);
  const check = canDowngradeToOffer(studentCount, offer);
  if (!check.allowed) return { error: check.reason };

  const subscriptions = (state.subscriptions ?? []).map((sub) => {
    if (normalize(sub.schoolCode) !== normalize(schoolCode)) return sub;
    return {
      ...sub,
      offerId: offer.id,
      plan: offer.name,
      monthlyPrice: offer.monthlyPrice,
      annualPrice: offer.annualPrice,
      maxStudents: offer.maxStudents,
      maxTeachers: offer.maxTeachers,
      maxUsers: offer.maxUsers,
      activatedModules: Object.entries(offer.modules)
        .filter(([, v]) => v === true || v === "limited")
        .map(([k]) => k),
    };
  });

  const auditLog = appendSubscriptionAudit(state.subscriptionAuditLog, {
    action: "Changement d'offre demandé",
    schoolCode,
    author,
    details: offer.name,
  });

  return { subscriptions, subscriptionAuditLog: auditLog };
}
