import { useAuth } from "../../context/AuthContext";
import { financePaymentsRouteMode } from "../../lib/parentFinanceRoute";
import { EntityPage } from "../EntityPage";
import { ParentFinancePage } from "./ParentFinancePage";

export function FinancePaymentsEntryPage() {
  const { session } = useAuth();
  return financePaymentsRouteMode(session?.user?.role) === "parent" ? (
    <ParentFinancePage />
  ) : (
    <EntityPage entity="payments" />
  );
}
