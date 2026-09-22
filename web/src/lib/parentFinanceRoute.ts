import { isParentRole } from "./format";

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
