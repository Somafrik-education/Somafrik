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

/**
 * Statuts d'abonnement : valeurs stockées (anglais, colonne subscriptions.status)
 * et libellés métier historiques (français) → statut canonique.
 * Toute valeur non vide absente de cette table est « Inconnu » (aucun accès).
 */
const SUBSCRIPTION_STATUS_ALIASES = Object.freeze({
  actif: "Actif",
  active: "Actif",
  essai: "Essai",
  trial: "Essai",
  brouillon: "Brouillon",
  draft: "Brouillon",
  en_retard: "En retard",
  late: "En retard",
  past_due: "En retard",
  overdue: "En retard",
  suspendu: "Suspendu",
  suspended: "Suspendu",
  expire: "Expiré",
  expired: "Expiré",
  annule: "Annulé",
  cancelled: "Annulé",
  canceled: "Annulé",
  resilie: "Résilié",
  terminated: "Résilié",
});
const UNKNOWN_STATUS = "Inconnu";
const BLOCKED_LIFECYCLES = new Set(["Suspendu", "Expiré", "Annulé", "Résilié", UNKNOWN_STATUS]);
const ACCESS_LEVELS = new Set(["full", "limited", "readonly", "blocked"]);

function statusKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** Statut canonique, null si vide, « Inconnu » si la valeur n'est pas reconnue. */
function canonicalSubscriptionStatus(value) {
  const key = statusKey(value);
  if (!key) return null;
  return SUBSCRIPTION_STATUS_ALIASES[key] ?? UNKNOWN_STATUS;
}

function isSuspendedSchool(school = {}) {
  return ["suspendu", "suspended"].includes(statusKey(school.status));
}

/**
 * Cycle de vie de l'abonnement (MONO-FIX-O9).
 *
 * Signaux lus : dbStatus (colonne subscriptions.status, transmise telle quelle
 * par les projections), status, lifecycleStatus (profil) et paymentStatus.
 *   1. « Suspendu » dans n'importe quel signal l'emporte toujours ;
 *   2. statut bloquant dans n'importe quel signal (inconnu, annulé, résilié,
 *      expiré) : un cycle de vie « Actif » resté dans le profil JSON ou un
 *      paiement en retard ne le masquent pas ;
 *   3. lifecycleStatus explicite (profil), sinon paiement en retard ⇒ « En retard » ;
 *   4. sinon essai / brouillon / actif ; sans aucun statut (abonnement absent) :
 *      « Actif », comme avant.
 */
function resolveLifecycleStatus(subscription = {}, school = {}) {
  const storage = canonicalSubscriptionStatus(subscription.dbStatus);
  const declared = canonicalSubscriptionStatus(subscription.status ?? school.subscriptionStatus);
  const lifecycle = canonicalSubscriptionStatus(subscription.lifecycleStatus);
  const payment = statusKey(subscription.paymentStatus);
  const signals = [storage, declared, lifecycle].filter(Boolean);
  if (signals.includes("Suspendu") || payment.includes("suspendu") || payment.includes("suspended")) {
    return "Suspendu";
  }
  for (const status of [UNKNOWN_STATUS, "Annulé", "Résilié", "Expiré"]) {
    if (signals.includes(status)) return status;
  }
  if (lifecycle) return lifecycle;
  if (payment.includes("retard")) return "En retard";
  return [storage, declared].find((status) => status && status !== "Actif") ?? "Actif";
}

/** Ordre de restriction des niveaux d'accès. */
const ACCESS_LEVEL_RANK = Object.freeze({ full: 0, limited: 1, readonly: 2, blocked: 3 });

function mostRestrictive(...levels) {
  return levels.reduce((current, level) => (ACCESS_LEVEL_RANK[level] > ACCESS_LEVEL_RANK[current] ? level : current));
}

/**
 * Niveau d'accès (MONO-FIX-O9). Ordre de priorité :
 *   1. abonnement ou établissement suspendu ⇒ blocked ;
 *   2. statut bloquant (expiré, annulé, résilié, inconnu) ⇒ blocked ;
 *   3. échéance dépassée de 30 jours ou plus ⇒ blocked ;
 *   4. politique de retard : J+14 ou paiement en retard ⇒ limited, sinon full ;
 *   5. surcharge accessLevel du profil : ne peut que RESTREINDRE le niveau
 *      calculé, jamais l'élever ; valeur non reconnue ⇒ blocked.
 */
function resolveAccessLevel(subscription = {}, school = {}) {
  const lifecycle = resolveLifecycleStatus(subscription, school);
  if (lifecycle === "Suspendu" || isSuspendedSchool(school)) return "blocked";
  if (BLOCKED_LIFECYCLES.has(lifecycle)) return "blocked";
  const daysLate = computeDelinquencyDays(subscription);
  if (daysLate >= 30) return "blocked";
  const computed = daysLate >= 14 || lifecycle === "En retard" ? "limited" : "full";
  if (subscription.accessLevel === undefined || subscription.accessLevel === null || subscription.accessLevel === "") {
    return computed;
  }
  if (!ACCESS_LEVELS.has(subscription.accessLevel)) return "blocked";
  return mostRestrictive(computed, subscription.accessLevel);
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
  canonicalSubscriptionStatus,
  resolveLifecycleStatus,
  resolveAccessLevel,
};
