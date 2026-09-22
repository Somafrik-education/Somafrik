import { useAuth } from "../context/AuthContext";
import { isParentDashboardRole } from "../lib/parentDashboard";
import { OverviewPage } from "./OverviewPage";
import { ParentDashboardPage } from "./ParentDashboardPage";

/** Tableau de bord par rôle : Parent dédié, sinon dashboard plateforme/établissement existant. */
export function DashboardEntryPage() {
  const { session } = useAuth();

  if (isParentDashboardRole(session?.user)) {
    return <ParentDashboardPage />;
  }

  return <OverviewPage />;
}
