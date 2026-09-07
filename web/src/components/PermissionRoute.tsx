import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canReadView } from "../lib/permissions";
import { getDefaultAppPath } from "../lib/superAdminAccess";
import { usePermissionContext } from "../lib/usePermissionContext";
import { RouteFallback } from "./RouteFallback";
import { InlineAlert } from "@/design-system";

export function PermissionRoute({
  view,
  children,
  fallbackPath,
}: {
  /** Une vue, ou plusieurs vues en OU (ex. shell Finances : payments | fees | unpaid). */
  view: string | readonly string[];
  children: ReactNode;
  fallbackPath?: string;
}) {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const views = typeof view === "string" ? [view] : view;

  if (ctx.permissionsBootstrap === "loading" || ctx.permissionsBootstrap === "idle") {
    if (session?.accessToken) {
      return <RouteFallback />;
    }
  }
  if (ctx.permissionsBootstrap === "error") {
    return (
      <div className="p-6">
        <InlineAlert tone="danger" title="Permissions indisponibles">
          {ctx.permissionsBootstrapError ||
            "Les permissions effectives n'ont pas pu être chargées. Réessayez."}
        </InlineAlert>
      </div>
    );
  }

  if (!views.some((item) => canReadView(ctx, item))) {
    return <Navigate to={fallbackPath ?? getDefaultAppPath(session?.user?.role)} replace />;
  }

  return <>{children}</>;
}
