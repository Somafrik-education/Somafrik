/**
 * Règles métier abonnement établissement (alignées schoolSubscriptionAccessService.js).
 */
const { normalize } = require("./e2e-api-helpers");

const FEATURE_RULES = {
  connect: ["full", "limited"],
  read: ["full", "limited", "readonly"],
  create_student: ["full"],
  create_teacher: ["full"],
  announcements: ["full"],
  notifications: ["full"],
  premium_documents: ["full"],
  write_presence: ["full", "limited"],
  write_notes: ["full", "limited"],
};

function parseFrDate(value) {
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

function computeDelinquencyDays(subscription, today = new Date()) {
  const due = parseFrDate(subscription?.endDate ?? subscription?.nextRenewalDate);
  if (!due) return 0;
  const diff = today.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

function resolveLifecycleStatus(subscription = {}, school = {}) {
  if (subscription.lifecycleStatus) return subscription.lifecycleStatus;
  const status = String(subscription.status ?? school.subscriptionStatus ?? "").trim();
  const payment = String(subscription.paymentStatus ?? "").trim();
  if (/suspendu/i.test(status) || /suspendu/i.test(payment)) return "Suspendu";
  if (/retard/i.test(payment)) return "En retard";
  if (/actif/i.test(status)) return "Actif";
  if (/expir/i.test(status)) return "Expiré";
  return "Actif";
}

function resolveAccessLevel(subscription = {}, school = {}) {
  if (subscription.accessLevel) return subscription.accessLevel;
  const lifecycle = resolveLifecycleStatus(subscription, school);
  if (lifecycle === "Suspendu" || lifecycle === "Expiré" || lifecycle === "Annulé") return "blocked";
  const daysLate = computeDelinquencyDays(subscription);
  if (daysLate >= 30) return "blocked";
  if (daysLate >= 14 || lifecycle === "En retard") return "limited";
  if (String(school.status ?? "").trim().toLowerCase() === "suspendu") return "blocked";
  return "full";
}

function resolveSchoolAccess(schoolCode, state = {}) {
  const code = String(schoolCode ?? "").trim().toUpperCase();
  const school = (state.schools ?? []).find(
    (row) =>
      String(row.code ?? "").trim().toUpperCase() === code ||
      String(row.publicId ?? "").trim().toUpperCase() === code,
  );
  const subscription = (state.subscriptions ?? []).find(
    (row) => String(row.schoolCode ?? "").trim().toUpperCase() === code,
  );
  const level = resolveAccessLevel(subscription ?? {}, school ?? {});
  return {
    schoolCode: code,
    level,
    lifecycle: resolveLifecycleStatus(subscription ?? {}, school ?? {}),
    daysLate: computeDelinquencyDays(subscription ?? {}),
    plan: subscription?.plan ?? school?.subscriptionPlan ?? "",
  };
}

function canUseFeature(access, feature) {
  const allowed = FEATURE_RULES[feature] ?? ["full"];
  return allowed.includes(access.level);
}

function upsertSubscription(subscriptions, schoolCode, patch) {
  const code = String(schoolCode ?? "").trim().toUpperCase();
  const rows = [...(subscriptions ?? [])];
  const index = rows.findIndex((row) => String(row.schoolCode ?? "").trim().toUpperCase() === code);
  if (index >= 0) {
    rows[index] = { ...rows[index], ...patch, schoolCode: rows[index].schoolCode ?? schoolCode };
    return rows;
  }
  return [...rows, { id: `SUB-${code}`, schoolCode, ...patch }];
}

function patchSchoolSubscription(schools, schoolCode, patch) {
  const code = String(schoolCode ?? "").trim().toUpperCase();
  return (schools ?? []).map((school) =>
    String(school.code ?? "").trim().toUpperCase() === code ? { ...school, ...patch } : school,
  );
}

module.exports = {
  resolveSchoolAccess,
  canUseFeature,
  resolveAccessLevel,
  computeDelinquencyDays,
  upsertSubscription,
  patchSchoolSubscription,
};
