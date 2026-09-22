import { isParentRole } from "./format";

export function financePaymentsRouteMode(role?: string): "parent" | "staff" {
  return isParentRole(role) ? "parent" : "staff";
}

export type ParentFinanceShellDecision =
  | "staff"
  | "content"
  | "payments"
  | "dashboard";

export function parentFinanceShellDecision(
  role: string | undefined,
  pathname: string,
  canReadPayments: boolean,
): ParentFinanceShellDecision {
  if (!isParentRole(role)) return "staff";
  if (!canReadPayments) return "dashboard";
  if (pathname !== "/finances/paiements") return "payments";
  return "content";
}
