/** Contrôle d'accès selon l'abonnement SaaS établissement (ETB-F14). */
const { BusinessError } = require("./authService");

const LIMITED_MESSAGE =
  "L'accès est temporairement limité. Veuillez contacter l'administration de votre établissement ou régulariser l'abonnement.";
const BLOCKED_MESSAGE =
  "L'accès à la plateforme est suspendu pour cet établissement (abonnement expiré ou impayé).";

/**
 * Date d'échéance d'abonnement → Date locale (minuit), ou null.
 *
 * Formats acceptés :
 *   - ISO « AAAA-MM-JJ » (éventuellement suivi d'une heure) : format renvoyé
 *     par le magasin plateforme (colonne subscriptions.end_date) ;
 *   - français « JJ-MM-AAAA » ou « JJ/MM/AAAA » : saisies et profils hérités.
 * Une date de calendrier impossible (ex. 31-02-2027) est rejetée.
 */
function parseSubscriptionDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  const fr = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (iso || fr) {
    const [y, m, d] = iso ? [iso[1], iso[2], iso[3]].map(Number) : [fr[3], fr[2], fr[1]].map(Number);
    const date = new Date(y, m - 1, d);
    const valid = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    return valid ? date : null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeDelinquencyDays(subscription, today = new Date()) {
  const due = parseSubscriptionDate(subscription?.endDate ?? subscription?.nextRenewalDate);
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

function schoolMatchesCode(school, schoolCode) {
  const code = String(schoolCode ?? "").trim().toUpperCase();
  return [school?.loginCode, school?.code, school?.publicId, school?.legacySchoolCode]
    .some((value) => String(value ?? "").trim().toUpperCase() === code);
}

function findSchool(state, schoolCode) {
  return (state.schools ?? []).find((school) => schoolMatchesCode(school, schoolCode));
}

function findSubscriptionForSchool(subscriptions = [], schoolCode, school = null) {
  const acceptedCodes = new Set(
    [schoolCode, school?.code, school?.legacySchoolCode, school?.loginCode, school?.publicId]
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  return subscriptions.find((row) => acceptedCodes.has(String(row.schoolCode ?? "").trim().toUpperCase()));
}

function resolveSchoolAccess(schoolCode, state = {}) {
  const school = findSchool(state, schoolCode);
  const subscription = findSubscriptionForSchool(state.subscriptions, schoolCode, school);
  const level = resolveAccessLevel(subscription ?? {}, school ?? {});
  const lifecycle = resolveLifecycleStatus(subscription ?? {}, school ?? {});
  const daysLate = computeDelinquencyDays(subscription ?? {});

  let message = "";
  if (level === "blocked") message = BLOCKED_MESSAGE;
  else if (level === "limited") message = LIMITED_MESSAGE;

  return {
    schoolCode: school?.loginCode || schoolCode,
    level,
    lifecycle,
    daysLate,
    message,
    plan: subscription?.plan ?? school?.subscriptionPlan ?? "",
    paymentStatus: subscription?.paymentStatus ?? school?.subscriptionStatus ?? "",
  };
}

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

function canUseFeature(access, feature) {
  const allowed = FEATURE_RULES[feature] ?? ["full"];
  return allowed.includes(access.level);
}

function assertSchoolFeature(schoolCode, state, feature) {
  const access = resolveSchoolAccess(schoolCode, state);
  if (!canUseFeature(access, feature)) {
    throw new BusinessError(403, access.message || BLOCKED_MESSAGE);
  }
  return access;
}

function assertSchoolCanConnect(schoolCode, state, { allowLimited = true } = {}) {
  const access = resolveSchoolAccess(schoolCode, state);
  const allowed = allowLimited ? ["full", "limited"] : ["full"];
  if (!allowed.includes(access.level)) {
    throw new BusinessError(403, access.message || BLOCKED_MESSAGE);
  }
  return access;
}

module.exports = {
  LIMITED_MESSAGE,
  BLOCKED_MESSAGE,
  resolveSchoolAccess,
  canUseFeature,
  assertSchoolFeature,
  assertSchoolCanConnect,
  findSubscriptionForSchool,
  parseSubscriptionDate,
  computeDelinquencyDays,
};
