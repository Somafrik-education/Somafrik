/** Offres MVP Somafrik — miroir de web/src/lib/subscriptionModule.ts */
const DEFAULT_SUBSCRIPTION_OFFERS = [
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

function ensureSubscriptionOffers(offers = [], countries = []) {
  if (!Array.isArray(offers) || !offers.length) {
    if (Array.isArray(countries) && countries.length) {
      return countries.flatMap((country) => buildSubscriptionOffersForCountry(country));
    }
    return DEFAULT_SUBSCRIPTION_OFFERS.map((offer) => ({ ...offer }));
  }
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  if (Array.isArray(countries) && countries.length) {
    for (const country of countries) {
      for (const seed of buildSubscriptionOffersForCountry(country)) {
        if (!byId.has(seed.id)) byId.set(seed.id, seed);
      }
    }
  } else {
    for (const seed of DEFAULT_SUBSCRIPTION_OFFERS) {
      if (!byId.has(seed.id)) byId.set(seed.id, { ...seed });
    }
  }
  return [...byId.values()];
}

function buildSubscriptionOffersForCountry(country) {
  const code = String(country.code ?? "").trim().toUpperCase();
  if (!code) return [];
  const currency = String(country.currency ?? "USD").trim().toUpperCase();
  const policy = country.subscriptionPolicy ?? {};
  const standardMonthly = policy.plans?.Standard?.monthlyPrice ?? 90;
  const standardAnnual = policy.plans?.Standard?.annualPrice ?? 900;
  const premiumMonthly = policy.plans?.Premium?.monthlyPrice ?? 120;
  const premiumAnnual = policy.plans?.Premium?.annualPrice ?? 1200;

  return DEFAULT_SUBSCRIPTION_OFFERS.map((template, index) => {
    const suffix = ["TRIAL", "STANDARD", "PREMIUM", "CUSTOM"][index];
    const monthly =
      suffix === "STANDARD" ? standardMonthly : suffix === "PREMIUM" ? premiumMonthly : template.monthlyPrice;
    const annual =
      suffix === "STANDARD" ? standardAnnual : suffix === "PREMIUM" ? premiumAnnual : template.annualPrice;
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

function ensureSubscriptionModuleState(state = {}) {
  return {
    ...state,
    subscriptionOffers: ensureSubscriptionOffers(state.subscriptionOffers, state.countries),
    subscriptionPayments: Array.isArray(state.subscriptionPayments) ? state.subscriptionPayments : [],
    subscriptionInvoices: Array.isArray(state.subscriptionInvoices) ? state.subscriptionInvoices : [],
    subscriptionDiscounts: Array.isArray(state.subscriptionDiscounts) ? state.subscriptionDiscounts : [],
    subscriptionAuditLog: Array.isArray(state.subscriptionAuditLog) ? state.subscriptionAuditLog : [],
  };
}

module.exports = {
  DEFAULT_SUBSCRIPTION_OFFERS,
  ensureSubscriptionOffers,
  ensureSubscriptionModuleState,
};
