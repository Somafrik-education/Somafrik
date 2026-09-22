import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { reportCardRouteMode } from "../lib/parentReportCards";
import { EntityPage } from "./EntityPage";
import { ParentReportCardsPage } from "./ParentReportCardsPage";

export function ReportCardsEntryPage() {
  const { session } = useAuth();
  return reportCardRouteMode(session?.user?.role) === "parent" ? (
    <ParentReportCardsPage />
  ) : (
    <EntityPage entity="bulletins" />
  );
}

export function ReportCardStaffRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (reportCardRouteMode(session?.user?.role) === "parent") {
    return <Navigate to="/bulletins" replace />;
  }
  return <>{children}</>;
}
