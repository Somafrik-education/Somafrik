import type { UserAccount } from "../types";
import { normalize } from "./format";

export const USER_ACCOUNT_STATUSES = [
  "Actif",
  "Inactif",
  "Suspendu",
  "Verrouillé",
  "Supprimé",
  "En attente de validation",
] as const;

export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

export const USER_ACCOUNT_STATUS_OPTIONS = USER_ACCOUNT_STATUSES.filter(
  (status) => status !== "Supprimé" && status !== "En attente de validation",
).map((value) => ({ value, label: value }));

export function isUserAccountDeleted(user: Pick<UserAccount, "status" | "deletedAt">): boolean {
  return Boolean(user.deletedAt) || user.status === "Supprimé";
}

export function isUserAccountVisible(user: Pick<UserAccount, "status" | "deletedAt">): boolean {
  return !isUserAccountDeleted(user);
}

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

export function findDuplicateLoginIdentifier(
  users: UserAccount[],
  candidate: Pick<UserAccount, "id" | "identifier" | "email" | "phone" | "schoolCode" | "publicId">,
): UserAccount | undefined {
  const identifier = String(candidate.identifier ?? "").trim();
  const email = String(candidate.email ?? "").trim();
  const phone = String(candidate.phone ?? "").trim();
  const schoolCode = normalize(candidate.schoolCode ?? "");
  const excludeId = String(candidate.id ?? "");

  return users.find((user) => {
    if (isUserAccountDeleted(user)) return false;
    if (excludeId && user.id === excludeId) return false;
    const sameSchool =
      !schoolCode ||
      !user.schoolCode ||
      user.schoolCode === "*" ||
      normalize(user.schoolCode) === schoolCode;
    if (!sameSchool) return false;

    const keys = [
      normalize(user.identifier ?? ""),
      normalize(user.publicId ?? ""),
      normalize(user.email ?? ""),
      normalize(user.phone ?? ""),
    ].filter(Boolean);

    if (identifier && keys.includes(normalize(identifier))) return true;
    if (email && keys.includes(normalize(email))) return true;
    if (phone && keys.includes(normalize(phone))) return true;
    return false;
  });
}

export function softDeleteUserAccount(user: UserAccount): UserAccount {
  const now = new Date().toISOString();
  return {
    ...user,
    status: "Supprimé",
    deletedAt: now,
  };
}
