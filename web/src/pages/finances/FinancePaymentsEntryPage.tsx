import { useAuth } from "../../context/AuthContext";
import { isParentRole } from "../../lib/format";
import { EntityPage } from "../EntityPage";
import { ParentFinancePage } from "./ParentFinancePage";

export function financePaymentsRouteMode(role?: string): "parent" | "staff" {
  return isParentRole(role) ? "parent" : "staff";
}

export function FinancePaymentsEntryPage() {
  const { session } = useAuth();
  return financePaymentsRouteMode(session?.user?.role) === "parent" ? (
    <ParentFinancePage />
  ) : (
    <EntityPage entity="payments" />
  );
}
