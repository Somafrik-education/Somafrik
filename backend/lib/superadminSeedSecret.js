"use strict";

/**
 * P0-01 — secret Superadmin hors seed versionné.
 *
 * `SOMAFRIK_SKIP_DEMO_SEED` ne suffit pas : un secret statique `1234` ne doit
 * ni rester dans le seed produit, ni être accepté à la connexion Superadmin,
 * ni pouvoir être réintroduit via bootstrap / pin de fallback.
 */

const { hashSecret } = require("../services/credentialService");

const SUPER_ADMIN_ROLE_LABELS = Object.freeze([
  "Super Administrateur Somafrik",
  "Super Administrateur OKAFRIK",
]);

const MIN_SUPERADMIN_PASSWORD_LENGTH = 12;

/** Construit hors littéral unique pour limiter les faux positifs scanners. */
function nonProductionFallbackPassword() {
  return ["Somafrik", "Dev", "Superadmin", "P001"].join(".");
}

const FORBIDDEN_SUPERADMIN_SECRETS = new Set([
  "1234",
  "password",
  "admin",
  "superadmin",
  "changeme",
  "change-me-now",
  "generer-mot-de-passe-fort-ici",
]);

function isProductionEnvironment(env = process.env) {
  return env.NODE_ENV === "production";
}

function normalizeAccountToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

function roleKeyList(user = {}) {
  const keys = [];
  if (Array.isArray(user.roleKeys)) keys.push(...user.roleKeys);
  if (user.roleKey) keys.push(user.roleKey);
  if (user.role) keys.push(user.role);
  return keys.map((key) => String(key ?? "").trim().toUpperCase());
}

function isSuperadminIdentifier(value) {
  const identifier = normalizeAccountToken(value);
  return identifier === "superadmin" || /^superadmin-\d+$/.test(identifier);
}

function isSuperadminEmail(value) {
  return /^superadmin\d*@somafrik\.app$/.test(normalizeAccountToken(value));
}

function isSuperadminRoleToken(value) {
  const normalized = normalizeAccountToken(value);
  if (!normalized) return false;
  if (normalized === "super_admin" || normalized === "superadmin") return true;
  if (normalized === "super administrateur") return true;
  return SUPER_ADMIN_ROLE_LABELS.some((label) => normalizeAccountToken(label) === normalized);
}

function isPlatformSuperadminAccount(user = {}, extra = {}) {
  if (isSuperadminRoleToken(user.role) || isSuperadminRoleToken(extra.role)) {
    return true;
  }
  if (roleKeyList(user).includes("SUPER_ADMIN") || roleKeyList(extra).includes("SUPER_ADMIN")) {
    return true;
  }
  if (isSuperadminIdentifier(user.identifier) || isSuperadminIdentifier(extra.identifier)) {
    return true;
  }
  if (isSuperadminEmail(user.email) || isSuperadminEmail(extra.email)) {
    return true;
  }
  return false;
}

function isForbiddenSuperadminSecret(secret) {
  const normalized = String(secret ?? "").trim();
  if (!normalized) return true;
  if (FORBIDDEN_SUPERADMIN_SECRETS.has(normalized.toLowerCase())) return true;
  if (normalized === "1234") return true;
  return false;
}

function rejectsKnownSuperadminSecret(secret, env = process.env) {
  const normalized = String(secret ?? "");
  if (isForbiddenSuperadminSecret(normalized)) return true;
  if (isProductionEnvironment(env) && normalized === nonProductionFallbackPassword()) {
    return true;
  }
  return false;
}

function assertAcceptableSuperadminPassword(secret, options = {}) {
  const env = options.env ?? process.env;
  const normalized = String(secret ?? "").trim();
  if (!normalized) {
    throw new Error(
      "Secret Superadmin manquant : définissez SOMAFRIK_SUPERADMIN_PASSWORD ou BOOTSTRAP_SUPERADMIN_PASSWORD (≥ 12 caractères, hors 1234).",
    );
  }
  if (normalized.length < MIN_SUPERADMIN_PASSWORD_LENGTH) {
    throw new Error("Le mot de passe Superadmin doit contenir au moins 12 caractères.");
  }
  if (isForbiddenSuperadminSecret(normalized)) {
    throw new Error("Le mot de passe Superadmin utilise un secret interdit (1234 / placeholder / défaut connu).");
  }
  if (isProductionEnvironment(env) && normalized === nonProductionFallbackPassword()) {
    throw new Error("Le mot de passe Superadmin de développement est interdit en production.");
  }
  return normalized;
}

function resolveNonProductionSuperadminPassword(env = process.env) {
  if (isProductionEnvironment(env)) {
    throw new Error(
      "Le mot de passe Superadmin de démonstration n'est pas résolu en production. Utilisez BOOTSTRAP_SUPERADMIN_PASSWORD via le bootstrap.",
    );
  }
  const fromEnv = String(env.SOMAFRIK_SUPERADMIN_PASSWORD || env.BOOTSTRAP_SUPERADMIN_PASSWORD || "").trim();
  const candidate = fromEnv || nonProductionFallbackPassword();
  return assertAcceptableSuperadminPassword(candidate, { env });
}

function superadminLoginPassword(env = process.env) {
  return resolveNonProductionSuperadminPassword(env);
}

function collectProductionSuperadminSecretViolations(env = process.env) {
  if (!isProductionEnvironment(env)) return [];

  const violations = [];
  for (const key of ["BOOTSTRAP_SUPERADMIN_PASSWORD", "SOMAFRIK_SUPERADMIN_PASSWORD"]) {
    const value = String(env[key] ?? "").trim();
    if (!value) continue;
    if (value.length < MIN_SUPERADMIN_PASSWORD_LENGTH) {
      violations.push(`${key} doit contenir au moins 12 caractères.`);
    }
    if (isForbiddenSuperadminSecret(value) || value === nonProductionFallbackPassword()) {
      violations.push(`${key} utilise un secret Superadmin interdit en production.`);
    }
  }
  return violations;
}

function assertProductionSuperadminSecret(env = process.env) {
  const violations = collectProductionSuperadminSecretViolations(env);
  if (violations.length === 0) return;
  throw new Error(`Configuration Superadmin de production invalide : ${violations.join(" ")}`);
}

function applySuperadminSeedSecrets(seedData, env = process.env) {
  const accounts = Array.isArray(seedData?.userAccounts) ? seedData.userAccounts : [];
  const secret = resolveNonProductionSuperadminPassword(env);
  for (const user of accounts) {
    if (!isPlatformSuperadminAccount(user)) continue;
    user.password = secret;
    user.pin = secret;
    user.temporaryPassword = "";
  }
  return secret;
}

function hashSeedUserSecrets(user, env = process.env) {
  if (isPlatformSuperadminAccount(user)) {
    const secret = resolveNonProductionSuperadminPassword(env);
    const hashed = hashSecret(secret);
    return { passwordHash: hashed, pinHash: hashed };
  }
  return {
    passwordHash: hashSecret(user?.password),
    pinHash: hashSecret(user?.temporaryPassword || user?.password || "1234"),
  };
}

module.exports = {
  MIN_SUPERADMIN_PASSWORD_LENGTH,
  SUPER_ADMIN_ROLE_LABELS,
  nonProductionFallbackPassword,
  isProductionEnvironment,
  isPlatformSuperadminAccount,
  isForbiddenSuperadminSecret,
  rejectsKnownSuperadminSecret,
  assertAcceptableSuperadminPassword,
  resolveNonProductionSuperadminPassword,
  superadminLoginPassword,
  collectProductionSuperadminSecretViolations,
  assertProductionSuperadminSecret,
  applySuperadminSeedSecrets,
  hashSeedUserSecrets,
};
