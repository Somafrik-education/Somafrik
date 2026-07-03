import { Navigate } from "react-router-dom";
import { ChartTypeSettingsPanel } from "../components/charts/ChartTypeSettingsPanel";
import { canManageRolePermissions } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";

export function ChartSettingsPage() {
  const ctx = usePermissionContext();

  if (!canManageRolePermissions(ctx)) {
    return <Navigate to="/tableau-de-bord" replace />;
  }

  return <ChartTypeSettingsPanel />;
}
