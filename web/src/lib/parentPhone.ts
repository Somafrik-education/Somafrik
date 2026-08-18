/**
 * Téléphone parent — mêmes règles que le backend :
 * chiffres, espaces, +, -, () ; 8 à 15 chiffres ; vide = optionnel.
 */

export const PARENT_PHONE_INVALID_MESSAGE =
  "Téléphone parent invalide : saisissez un numéro (chiffres, espaces, +, - ou parenthèses).";

const MAX_PHONE_LENGTH = 40;
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;
const PARENT_PHONE_ALLOWED_RE = /^[0-9+()\s-]+$/;

export function isValidParentPhoneNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_PHONE_LENGTH) return false;
  if (!PARENT_PHONE_ALLOWED_RE.test(trimmed)) return false;
  const plusCount = (trimmed.match(/\+/g) || []).length;
  if (plusCount > 1) return false;
  if (plusCount === 1 && !trimmed.startsWith("+")) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

export function normalizeOptionalParentPhone(
  value: string,
): { ok: true; phone?: string } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true };
  }
  if (!isValidParentPhoneNumber(trimmed)) {
    return { ok: false, message: PARENT_PHONE_INVALID_MESSAGE };
  }
  return { ok: true, phone: trimmed };
}
