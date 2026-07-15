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
  return user.status === USER_ACCOUNT_STATUSES.ACTIVE || normalizeKey(user.status) === "active";
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

const KNOWN_WEAK_PINS = new Set([
  "000000",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "123456",
  "654321",
  "012345",
  "543210",
  "123123",
  "121212",
  "101010",
  "010101",
]);

function isWeakPin(pin) {
  const value = String(pin ?? "").trim();
  if (!/^\d{6}$/.test(value)) {
    return false;
  }
  if (KNOWN_WEAK_PINS.has(value)) {
    return true;
  }
  if (/^(\d)\1{5}$/.test(value)) {
    return true;
  }
  const digits = value.split("").map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);
  return ascending || descending;
}

function validatePinPolicy(pin) {
  const value = String(pin ?? "").trim();
  if (!/^\d{6}$/.test(value)) {
    return "Le PIN doit contenir exactement 6 chiffres.";
  }
  if (isWeakPin(value)) {
    return "Ce PIN est trop faible. Choisissez un code à 6 chiffres plus difficile à deviner.";
  }
  return null;
}

function validateAccountSecret(secret) {
  const value = String(secret ?? "").trim();
  if (!value) {
    return null;
  }
  if (/^\d{6}$/.test(value)) {
    return validatePinPolicy(value);
  }
  return validatePasswordPolicy(value);
}

function accountRowKey(row = {}) {
  return String(row.id ?? row.identifier ?? row.publicId ?? row.matricule ?? "").trim();
}

function validateIntroducedAccountSecrets(currentState = {}, nextState = {}, touchedKeys = []) {
  const errors = [];

  if (touchedKeys.includes("users")) {
    const currentByKey = new Map((currentState.users ?? []).map((user) => [accountRowKey(user), user]));
    for (const user of nextState.users ?? []) {
      const key = accountRowKey(user);
      const previous = currentByKey.get(key) ?? {};

      const temporaryPassword = String(user.temporaryPassword ?? "").trim();
      const previousTemporaryPassword = String(previous.temporaryPassword ?? "").trim();
      if (
        temporaryPassword &&
        temporaryPassword !== previousTemporaryPassword &&
        !user.passwordHash &&
        !user.pinHash
      ) {
        const message = validateAccountSecret(temporaryPassword);
        if (message) {
          errors.push({ entity: "users", id: key, message });
        }
      }

      const pin = String(user.pin ?? "").trim();
      const previousPin = String(previous.pin ?? "").trim();
      if (pin && pin !== previousPin && !user.pinHash) {
        const message = validatePinPolicy(pin);
        if (message) {
          errors.push({ entity: "users", id: key, message });
        }
      }
    }
  }

  if (touchedKeys.includes("students")) {
    const currentByKey = new Map(
      (currentState.students ?? []).map((student) => [accountRowKey(student), student]),
    );
    for (const student of nextState.students ?? []) {
      const key = accountRowKey(student);
      const previous = currentByKey.get(key) ?? {};
      const pin = String(student.pin ?? "").trim();
      const previousPin = String(previous.pin ?? "").trim();
      if (pin && pin !== previousPin && !student.pinHash) {
        const message = validatePinPolicy(pin);
        if (message) {
          errors.push({ entity: "students", id: key, message });
        }
      }
    }
  }

  if (touchedKeys.includes("teachers")) {
    const currentByKey = new Map(
      (currentState.teachers ?? []).map((teacher) => [accountRowKey(teacher), teacher]),
    );
    for (const teacher of nextState.teachers ?? []) {
      const key = accountRowKey(teacher);
      const previous = currentByKey.get(key) ?? {};
      const password = String(teacher.password ?? "").trim();
      const previousPassword = String(previous.password ?? "").trim();
      if (password && password !== previousPassword && !teacher.passwordHash && !teacher.pinHash) {
        const message = validateAccountSecret(password);
        if (message) {
          errors.push({ entity: "teachers", id: key, message });
        }
      }
    }
  }

  return errors;
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
  isWeakPin,
  validateAccountSecret,
  validateIntroducedAccountSecrets,
  findDuplicateLoginIdentifier,
  softDeleteUserAccount,
};
