const USER_ACCOUNT_STATUSES = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  SUSPENDED: "Suspendu",
  LOCKED: "Verrouillé",
  DELETED: "Supprimé",
  PENDING: "En attente de validation",
};

const GENERIC_AUTH_ERROR = "Identifiant ou mot de passe incorrect.";

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isUserAccountDeleted(user = {}) {
  return Boolean(user.deletedAt) || user.status === USER_ACCOUNT_STATUSES.DELETED;
}

function canUserAccountLogin(user = {}) {
  if (!user || isUserAccountDeleted(user)) return false;
  if (
    user.validationStatus === USER_ACCOUNT_STATUSES.PENDING ||
    user.status === USER_ACCOUNT_STATUSES.PENDING
  ) {
    return false;
  }
  return user.status === USER_ACCOUNT_STATUSES.ACTIVE;
}

function loginBlockedMessage(user = {}) {
  if (isUserAccountDeleted(user)) {
    return "Ce compte n'est plus actif.";
  }
  if (
    user.validationStatus === USER_ACCOUNT_STATUSES.PENDING ||
    user.status === USER_ACCOUNT_STATUSES.PENDING
  ) {
    return "Compte en attente de validation par le Super Administrateur. Connexion indisponible.";
  }
  if (user.status === USER_ACCOUNT_STATUSES.INACTIVE) {
    return "Ce compte est inactif. Contactez l'administration de votre établissement.";
  }
  if (user.status === USER_ACCOUNT_STATUSES.SUSPENDED) {
    return "Compte suspendu. Connexion indisponible.";
  }
  if (user.status === USER_ACCOUNT_STATUSES.LOCKED) {
    return "Compte verrouillé. Contactez l'administration de votre établissement.";
  }
  return "Compte suspendu ou désactivé.";
}

function validatePasswordPolicy(password) {
  const value = String(password ?? "").trim();
  if (value.length < 8) {
    return "Le mot de passe doit contenir au moins 8 caractères.";
  }
  if (!/[A-Za-z]/.test(value)) {
    return "Le mot de passe doit contenir au moins une lettre.";
  }
  if (!/\d/.test(value)) {
    return "Le mot de passe doit contenir au moins un chiffre.";
  }
  return null;
}

function validatePinPolicy(pin) {
  const value = String(pin ?? "").trim();
  if (!/^\d{6}$/.test(value)) {
    return "Le PIN doit contenir exactement 6 chiffres.";
  }
  return null;
}

function findDuplicateLoginIdentifier(users = [], candidate = {}, options = {}) {
  const identifier = String(candidate.identifier ?? "").trim();
  const email = String(candidate.email ?? "").trim();
  const phone = String(candidate.phone ?? "").trim();
  const schoolCode = normalizeKey(candidate.schoolCode);
  const excludeId = String(candidate.id ?? "");

  return (users ?? []).find((user) => {
    if (!user || String(user.id ?? "") === excludeId || isUserAccountDeleted(user)) return false;
    const sameSchool =
      !schoolCode ||
      !user.schoolCode ||
      user.schoolCode === "*" ||
      normalizeKey(user.schoolCode) === schoolCode;
    if (!sameSchool) return false;

    const keys = [
      normalizeKey(user.identifier),
      normalizeKey(user.publicId),
      normalizeKey(user.email),
      normalizeKey(user.phone),
    ].filter(Boolean);

    if (identifier && keys.includes(normalizeKey(identifier))) return true;
    if (email && keys.includes(normalizeKey(email))) return true;
    if (phone && keys.includes(normalizeKey(phone))) return true;
    return false;
  });
}

function softDeleteUserAccount(user = {}, actor = "Administrateur") {
  const now = new Date().toISOString();
  return {
    ...user,
    status: USER_ACCOUNT_STATUSES.DELETED,
    deletedAt: now,
    history: [
      ...(Array.isArray(user.history) ? user.history : []),
      `Compte supprimé (logique) le ${now.slice(0, 10)} par ${actor}`,
    ],
  };
}

module.exports = {
  USER_ACCOUNT_STATUSES,
  GENERIC_AUTH_ERROR,
  canUserAccountLogin,
  isUserAccountDeleted,
  loginBlockedMessage,
  validatePasswordPolicy,
  validatePinPolicy,
  findDuplicateLoginIdentifier,
  softDeleteUserAccount,
};
