/**
 * Contrat UI/UX — parcours connexion mobile (code établissement → identifiant → secret).
 * Parent (`parent_student`) et Élève (`student`) : mot de passe standard.
 */

export const ROLE_SELECTION_COPY = {
  eyebrow: "Connexion établissement",
  title: "Entrez le code de votre école",
  description: "Utilisez le code fourni par votre établissement pour accéder à votre espace.",
  codeLabel: "Code établissement",
  placeholderExample: "CD-IN-26-001",
  verifyButton: "Vérifier le code",
  openLoginButton: "Ouvrir la connexion",
  successMessage: "Établissement trouvé. Vous pouvez continuer.",
  nextStepHint:
    "Saisissez votre téléphone, email ou identifiant de connexion, puis votre mot de passe.",
} as const;

export const LOGIN_SCREEN_COPY = {
  /** AUTH-MOBILE-01 : consigne commune à tous les profils (élève, étudiant, parent, enseignant, administration). */
  identifierHint: "Saisissez le téléphone, l'email ou l'identifiant de connexion lié à votre compte.",
  identifierLabel: "Identifiant",
  identifierPlaceholder: "Ex. +243 8xx xxx xxx",
  roleLabel: "Rôle détecté",
  rolePending: "En attente",
  loginButton: "Se connecter",
  pinLabel: "Mot de passe",
  studentPinLabel: "Mot de passe",
  pinPlaceholder: "Ex. ••••••",
  passwordLabel: "Mot de passe",
  passwordPlaceholder: "Ex. ••••••",
  newPasswordLabel: "Nouveau mot de passe",
  confirmPasswordLabel: "Confirmation",
  emptyFieldsError: "Veuillez saisir votre identifiant et votre mot de passe.",
  accountNotFoundError: "Identifiant invalide.",
  loginFailedTitle: "Connexion impossible",
} as const;

/** Messages utilisateur simples — jamais de détail technique. */
export const ERROR_MESSAGES = {
  invalidSchoolCode: "Code établissement incorrect.",
  invalidIdentifier: "Identifiant invalide.",
  invalidPin: "PIN incorrect.",
  invalidCredentials: "Identifiant ou mot de passe incorrect.",
  emptySchoolCode: "Veuillez saisir le code établissement.",
  emptyFields: "Veuillez saisir votre identifiant et votre mot de passe.",
  emptyIdentifier: "Veuillez saisir votre identifiant.",
  emptyPassword: "Veuillez saisir votre mot de passe.",
  networkError: "Connexion impossible. Vérifiez votre réseau et réessayez.",
  accountLocked: "Trop de tentatives. Réessayez dans quelques minutes.",
  mobileAccessDenied: "Ce compte n'a pas accès à l'application mobile. Contactez votre établissement.",
  serverUnavailable: "Service momentanément indisponible. Réessayez dans quelques instants.",
} as const;

export const ERROR_TEST_IDS = {
  loginErrorBanner: "login-error-banner",
  roleSelectionErrorBanner: "role-error-banner",
} as const;

const TECHNICAL_PATTERN =
  /jwt|stack|undefined|null|port 5000|fetch failed|localhost|EXPO_PUBLIC|\/api\/|backend attendu|scripts\\/i;

export function mapSchoolCodeError(rawMessage = ""): string {
  const message = String(rawMessage).trim();
  const normalized = message.toLowerCase();
  if (!message) return ERROR_MESSAGES.invalidSchoolCode;
  if (normalized.includes("404") || normalized.includes("introuvable") || normalized.includes("invalide")) {
    return ERROR_MESSAGES.invalidSchoolCode;
  }
  if (TECHNICAL_PATTERN.test(message) || message.length > 100) {
    return ERROR_MESSAGES.networkError;
  }
  return ERROR_MESSAGES.invalidSchoolCode;
}

export function usesNumericPinSecret(_role?: string): boolean {
  return false;
}

export function resolveSecretFieldCopy(role?: string): { label: string; placeholder: string } {
  if (usesNumericPinSecret(role)) {
    return {
      label: LOGIN_SCREEN_COPY.studentPinLabel,
      placeholder: LOGIN_SCREEN_COPY.pinPlaceholder,
    };
  }
  return {
    label: LOGIN_SCREEN_COPY.passwordLabel,
    placeholder: LOGIN_SCREEN_COPY.passwordPlaceholder,
  };
}

export function resolveLoginEmptyFieldsError(role?: string): string {
  if (usesNumericPinSecret(role)) return ERROR_MESSAGES.emptyFields;
  return ERROR_MESSAGES.emptyFields;
}

/**
 * Validation locale contextualisée (identifiant vide / mot de passe vide / les deux).
 * Retourne `null` si les deux champs sont renseignés.
 */
export function resolveLoginFieldsError(identifier: string, password: string): string | null {
  const missingIdentifier = !String(identifier ?? "").trim();
  const missingPassword = !String(password ?? "").trim();
  if (missingIdentifier && missingPassword) return ERROR_MESSAGES.emptyFields;
  if (missingIdentifier) return ERROR_MESSAGES.emptyIdentifier;
  if (missingPassword) return ERROR_MESSAGES.emptyPassword;
  return null;
}

function statusOf(status?: number | null): number {
  const value = Number(status);
  return Number.isFinite(value) ? value : 0;
}

/**
 * AUTH-MOBILE-01 (audit CTO) — 403 : liste blanche de catégories métier explicites.
 * Le texte serveur ne sert QU'À classer ; le message affiché est toujours une constante
 * Mobile. Toute réponse non reconnue → message générique (fail-closed).
 * Le statut fin du compte (inactif / suspendu / supprimé / en attente) est volontairement
 * regroupé en une seule catégorie.
 */
export const FORBIDDEN_LOGIN_MESSAGES = {
  schoolSuspended: "Établissement suspendu. Connexion indisponible.",
  schoolPendingValidation: "Établissement en attente de validation. Connexion indisponible.",
  countrySuspended: "Connexion indisponible pour ce pays.",
  schoolSubscription:
    "L'accès est suspendu pour cet établissement. Contactez l'administration de votre établissement.",
  accountInactive: "Ce compte n'est pas actif. Contactez l'administration de votre établissement.",
  mobileAccessDenied: ERROR_MESSAGES.mobileAccessDenied,
} as const;

export type ForbiddenLoginCategory = keyof typeof FORBIDDEN_LOGIN_MESSAGES;

const FORBIDDEN_CATEGORY_RULES: ReadonlyArray<[ForbiddenLoginCategory, RegExp]> = [
  ["countrySuspended", /^pays suspendu\b/],
  ["schoolPendingValidation", /^etablissement en attente de validation\b/],
  ["schoolSuspended", /^etablissement suspendu\b/],
  ["schoolSubscription", /^l'acces (a la plateforme )?est (suspendu|temporairement limite)\b/],
  ["accountInactive", /^(ce compte n'est plus actif|ce compte est inactif|compte suspendu|compte en attente de validation)\b/],
];

function normalizeForbiddenText(rawMessage: string): string {
  return String(rawMessage ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019`]/g, "'")
    .trim()
    .toLowerCase();
}

export function classifyForbiddenLoginError(rawMessage = ""): ForbiddenLoginCategory {
  const text = normalizeForbiddenText(rawMessage);
  if (!text || text.length > 200 || text.includes("\n")) return "mobileAccessDenied";
  for (const [category, rule] of FORBIDDEN_CATEGORY_RULES) {
    if (rule.test(text)) return category;
  }
  return "mobileAccessDenied";
}

function forbiddenMessage(rawMessage: string): string {
  return FORBIDDEN_LOGIN_MESSAGES[classifyForbiddenLoginError(rawMessage)];
}

/**
 * Erreur d'identification (`POST /identify`) : ne distingue jamais un compte d'un autre
 * établissement d'un compte inexistant (isolation établissement), ni ne relaie le message brut.
 */
export function mapIdentifyApiError(rawMessage = "", status?: number | null): string {
  const code = statusOf(status);
  if (code === 403) return forbiddenMessage(rawMessage);
  if (code === 423 || code === 429) return ERROR_MESSAGES.accountLocked;
  if (code >= 500) return ERROR_MESSAGES.serverUnavailable;
  if (code === 0 && rawMessage && !/introuvable|invalide|aucun compte|champs manquants/i.test(rawMessage)) {
    return ERROR_MESSAGES.networkError;
  }
  return ERROR_MESSAGES.invalidIdentifier;
}

export function mapLoginApiError(rawMessage = "", role?: string, status?: number | null): string {
  const message = String(rawMessage).trim();
  const normalized = message.toLowerCase();
  const pinRole = usesNumericPinSecret(role);
  const code = statusOf(status);
  if (code === 423 || code === 429 || normalized.includes("verrouillé") || normalized.includes("trop de tentatives")) {
    return ERROR_MESSAGES.accountLocked;
  }
  if (code === 403) return forbiddenMessage(message);
  if (code >= 500) return ERROR_MESSAGES.serverUnavailable;
  if (normalized.includes("champs manquants")) {
    // Ne jamais relayer le message brut du serveur : les champs sont validés localement avant envoi.
    return ERROR_MESSAGES.invalidCredentials;
  }
  if (!message) {
    return pinRole ? ERROR_MESSAGES.invalidPin : ERROR_MESSAGES.invalidCredentials;
  }
  if (normalized.includes("identifiant") && normalized.includes("incorrect")) {
    return pinRole ? ERROR_MESSAGES.invalidPin : ERROR_MESSAGES.invalidCredentials;
  }
  if (normalized.includes("mot de passe incorrect") || normalized.includes("pin incorrect")) {
    return pinRole ? ERROR_MESSAGES.invalidPin : ERROR_MESSAGES.invalidCredentials;
  }
  if (normalized.includes("identifiant invalide") || normalized.includes("compte introuvable")) {
    return ERROR_MESSAGES.invalidIdentifier;
  }
  if (code === 401 || code === 400 || code === 404) {
    return pinRole ? ERROR_MESSAGES.invalidPin : ERROR_MESSAGES.invalidCredentials;
  }
  if (TECHNICAL_PATTERN.test(message) || message.length > 100 || message.includes("\n")) {
    return pinRole ? ERROR_MESSAGES.invalidPin : ERROR_MESSAGES.invalidCredentials;
  }
  return message;
}

export function isUserFriendlyErrorMessage(message: string): boolean {
  const text = String(message ?? "").trim();
  if (!text || text.length > 120) return false;
  return !TECHNICAL_PATTERN.test(text);
}

export const ROLE_SELECTION_TEST_IDS = {
  screen: "role-selection-screen",
  schoolCodeInput: "role-school-code-input",
  verifyButton: "role-verify-button",
  statusMessage: "role-status-message",
  schoolCard: "role-school-card",
  schoolName: "role-school-name",
  schoolLogo: "role-school-logo",
  schoolLogoImage: "role-school-logo-image",
  schoolLogoFallback: "role-school-logo-fallback",
  openLoginButton: "role-open-login-button",
  nextStepHint: "role-next-step-hint",
  errorBanner: ERROR_TEST_IDS.roleSelectionErrorBanner,
} as const;

export const LOGIN_TEST_IDS = {
  screen: "login-screen",
  schoolName: "login-school-name",
  schoolLogo: "login-school-logo",
  schoolLogoImage: "login-school-logo-image",
  schoolLogoFallback: "login-school-logo-fallback",
  identifierInput: "login-identifier-input",
  passwordInput: "login-password-input",
  roleBadge: "login-role-badge",
  loginButton: "login-submit-button",
  instructionText: "login-instruction-text",
  errorBanner: ERROR_TEST_IDS.loginErrorBanner,
} as const;

export const HOME_TEST_IDS = {
  parentDashboard: "home-parent-dashboard",
  teacherDashboard: "home-teacher-dashboard",
  /** Exposé uniquement si session.role === "school_admin". Superadmin / Admin Pays : school-selector. */
  adminDashboard: "home-admin-dashboard",
} as const;

export const MENU_TEST_IDS = {
  logoutButton: "menu-logout-button",
} as const;

export const TAB_TEST_IDS = {
  accueil: "tab-accueil",
  classes: "tab-classes",
  students: "tab-eleves",
  attendance: "tab-presences",
  teachers: "tab-enseignants",
  frais: "tab-frais",
  comptes: "tab-comptes",
  schools: "tab-ecoles",
  subscriptions: "tab-offres",
  notifications: "tab-notifs",
  tabBar: "mobile-tab-bar",
} as const;

/** Cible tactile minimum recommandée (dp). */
export const MIN_TOUCH_TARGET = 48;

export type IdentifierKeyboard = "phone-pad" | "email-address" | "default";

export function resolveIdentifierKeyboardType(identifier: string): IdentifierKeyboard {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return "email-address";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 6 && /^[\d+\s().-]+$/.test(trimmed)) return "phone-pad";
  return "default";
}

export function resolveSecretKeyboardType(role?: string): "number-pad" | "default" {
  if (usesNumericPinSecret(role)) return "number-pad";
  return "default";
}

export function canSubmitLogin(
  identity: unknown,
  identifier: string,
  password: string,
  isLoading: boolean,
): boolean {
  if (isLoading) return false;
  if (!identity) return false;
  if (!identifier.trim()) return false;
  if (!password.trim()) return false;
  return true;
}

export function mapKeyboardToInputMode(keyboard: IdentifierKeyboard | "number-pad" | "default"): string {
  switch (keyboard) {
    case "phone-pad":
    case "number-pad":
      return "numeric";
    case "email-address":
      return "email";
    default:
      return "text";
  }
}
