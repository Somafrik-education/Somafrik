import { useAuth } from "../context/AuthContext";
import { isParentRole } from "../lib/format";
import { OverviewPage } from "./OverviewPage";
import { ParentDashboardPage } from "./ParentDashboardPage";

/** Tableau de bord unique : graphiques plateforme ou établissement selon le rôle. */
export function DashboardEntryPage() {
  const { session } = useAuth();
  if (isParentRole(session?.user?.role)) return <ParentDashboardPage />;
  return <OverviewPage />;
}
