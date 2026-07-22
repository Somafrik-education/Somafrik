/**
 * Rôles sémantiques D1.4 — mapping vers classes Tailwind ERP existantes.
 * Aucun hex nouveau (DO-045, pas de refonte visuelle D2.1).
 */

/** Actions / marque */
export const colorRole = {
  primary: "brand",
  primaryForeground: "white",
  secondary: "white",
  secondaryForeground: "ink",
  danger: "danger",
  dangerForeground: "white",
  success: "teal",
  warning: "amber",
  info: "brand",
  neutral: "slate",
  text: "ink",
  textMuted: "muted",
  border: "line",
  surface: "white",
  background: "canvas",
  focusRing: "brand",
} as const;

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

/** Classes Badge / feedback dérivées des rôles D1.4 */
export const statusToneClasses: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-teal/10 text-teal",
  warning: "bg-amber/10 text-amber",
  danger: "bg-danger/10 text-danger",
  info: "bg-brand-50 text-brand",
};
