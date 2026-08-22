/** Couleurs et libellés canoniques des champs Mobile — jamais le thème Android. */

export const FORM_PLACEHOLDER_COLOR = "#94A3B8";
export const FORM_VALUE_COLOR = "#0F172A";
export const FORM_BORDER_COLOR = "#E2E8F0";
export const FORM_BORDER_ERROR_COLOR = "#DC2626";
export const FORM_LABEL_COLOR = "#334155";
export const FORM_ERROR_COLOR = "#B91C1C";
export const FORM_HELPER_COLOR = "#64748B";
export const FORM_SURFACE_COLOR = "#F8FAFC";

export type FormFieldType =
  | "text"
  | "name"
  | "email"
  | "phone"
  | "date"
  | "time"
  | "password"
  | "amount"
  | "multiline"
  | "code"
  | "search"
  | "url";

export function formatFieldLabel(
  label: string,
  options?: { required?: boolean; optional?: boolean },
): string {
  const trimmed = String(label ?? "").trim();
  if (options?.required) return `${trimmed} *`;
  if (options?.optional) return `${trimmed} — facultatif`;
  return trimmed;
}
