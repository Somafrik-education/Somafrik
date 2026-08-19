/**
 * Contrat UI/UX — parcours connexion mobile (code établissement → identifiant → PIN).
 */

export const ROLE_SELECTION_COPY = {
  eyebrow: "Connexion établissement",
  title: "Entrez le code de votre école",
  description:
    "Utilisez le code fourni par l'administration pour ouvrir les espaces élève, parent, enseignant et direction.",
  codeLabel: "Code établissement",
  placeholderExample: "CD-IN-26-001",
  verifyButton: "Vérifier le code",
  openLoginButton: "Ouvrir la connexion",
  successMessage: "Établissement trouvé. Vous pouvez continuer.",
  nextStepHint:
    "Saisissez votre téléphone, email ou identifiant enseignant, puis votre PIN ou mot de passe.",
} as const;

export const LOGIN_SCREEN_COPY = {
  identifierHint: "Saisissez le téléphone, l'email ou l'identifiant enseignant lié à votre compte.",
  identifierPlaceholder: "Téléphone, email ou identifiant",
  roleLabel: "Rôle détecté",
  rolePending: "En attente",
  loginButton: "Se connecter",
  pinPlaceholder: "PIN",
  passwordPlaceholder: "Mot de passe",
  emptyFieldsError: "Veuillez saisir votre identifiant et votre code PIN.",
  accountNotFoundError: "Identifiant invalide.",
  loginFailedTitle: "Connexion impossible",
} as const;

/** Messages utilisateur simples — jamais de détail technique. */
export const ERROR_MESSAGES = {
  invalidSchoolCode: "Code établissement incorrect.",
  invalidIdentifier: "Identifiant invalide.",
  invalidPin: "PIN incorrect.",
  invalidCredentials: "Identifiant ou PIN incorrect.",
  emptySchoolCode: "Veuillez saisir le code établissement.",
  emptyFields: "Veuillez saisir votre identifiant et votre code PIN.",
  networkError: "Connexion impossible. Vérifiez votre réseau et réessayez.",
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

export function mapLoginApiError(rawMessage = "", role?: string): string {
  const message = String(rawMessage).trim();
  const normalized = message.toLowerCase();
  if (!message) {
    return role === "parent_student" || role === "student"
      ? ERROR_MESSAGES.invalidPin
      : ERROR_MESSAGES.invalidCredentials;
  }
  if (normalized.includes("identifiant") && normalized.includes("incorrect")) {
    return role === "parent_student" || role === "student"
      ? ERROR_MESSAGES.invalidPin
      : ERROR_MESSAGES.invalidCredentials;
  }
  if (normalized.includes("mot de passe incorrect") || normalized.includes("pin incorrect")) {
    return role === "parent_student" || role === "student"
      ? ERROR_MESSAGES.invalidPin
      : ERROR_MESSAGES.invalidCredentials;
  }
  if (normalized.includes("identifiant invalide") || normalized.includes("compte introuvable")) {
    return ERROR_MESSAGES.invalidIdentifier;
  }
  if (TECHNICAL_PATTERN.test(message) || message.length > 100 || message.includes("\n")) {
    return role === "parent_student" || role === "student"
      ? ERROR_MESSAGES.invalidPin
      : ERROR_MESSAGES.invalidCredentials;
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
  openLoginButton: "role-open-login-button",
  nextStepHint: "role-next-step-hint",
  errorBanner: ERROR_TEST_IDS.roleSelectionErrorBanner,
} as const;

export const LOGIN_TEST_IDS = {
  screen: "login-screen",
  schoolName: "login-school-name",
  schoolLogo: "login-school-logo",
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
  adminDashboard: "home-admin-dashboard",
} as const;

export const MENU_TEST_IDS = {
  logoutButton: "menu-logout-button",
} as const;

export const TAB_TEST_IDS = {
  accueil: "tab-accueil",
  menu: "tab-menu",
  classes: "tab-classes",
  teachers: "tab-enseignants",
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
  if (role === "parent_student" || role === "student") return "number-pad";
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
