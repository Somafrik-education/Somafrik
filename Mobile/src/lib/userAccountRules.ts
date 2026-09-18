/**
 * Politique secret compte — miroir backend `lib/userAccountRules.js`.
 * PIN 6 chiffres ou mot de passe 8 + lettre + chiffre.
 */

export function validatePasswordPolicy(password: string): string | null {
  const value = password.trim();
  if (value.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (!/[A-Za-z]/.test(value)) return "Le mot de passe doit contenir au moins une lettre.";
  if (!/\d/.test(value)) return "Le mot de passe doit contenir au moins un chiffre.";
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

export function isWeakPin(pin: string): boolean {
  const value = pin.trim();
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

export function validatePinPolicy(pin: string): string | null {
  const value = pin.trim();
  if (!/^\d{6}$/.test(value)) return "Le PIN doit contenir exactement 6 chiffres.";
  if (isWeakPin(value)) {
    return "Ce PIN est trop faible. Choisissez un code à 6 chiffres plus difficile à deviner.";
  }
  return null;
}

/** Même contrat que le backend `POST /auth/change-password`. */
export function validateAccountSecret(secret: string): string | null {
  const value = secret.trim();
  if (!value) {
    return null;
  }
  if (/^\d{6}$/.test(value)) {
    return validatePinPolicy(value);
  }
  return validatePasswordPolicy(value);
}
