import { canReadView, type PermissionContext } from "./permissions";

/** Vues du module Finances — accès au shell si au moins une est lisible. */
export const FINANCE_MODULE_VIEWS = ["payments", "fees", "unpaid"] as const;

export type FinanceModuleView = (typeof FINANCE_MODULE_VIEWS)[number];

export function canReadFinanceModule(ctx: PermissionContext): boolean {
  return FINANCE_MODULE_VIEWS.some((view) => canReadView(ctx, view));
}

/** Feuille d'atterrissage : Paiements en priorité, sinon Frais, sinon Impayés. */
export function firstAllowedFinanceLeaf(ctx: PermissionContext): "paiements" | "frais" | "impayes" | null {
  if (canReadView(ctx, "payments")) return "paiements";
  if (canReadView(ctx, "fees")) return "frais";
  if (canReadView(ctx, "unpaid")) return "impayes";
  return null;
}
