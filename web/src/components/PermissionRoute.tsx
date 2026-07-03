import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canReadView } from "../lib/permissions";
import { getDefaultAppPath } from "../lib/superAdminAccess";
import { usePermissionContext } from "../lib/usePermissionContext";

export function PermissionRoute({
  view,
  children,
  fallbackPath,
}: {
  view: string;
  children: ReactNode;
  fallbackPath?: string;
}) {
  const ctx = usePermissionContext();
  const { session } = useAuth();

  if (!canReadView(ctx, view)) {
    return <Navigate to={fallbackPath ?? getDefaultAppPath(session?.user?.role)} replace />;
  }

  return <>{children}</>;
}
