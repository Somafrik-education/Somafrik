import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import type { FeaturePermissions, PermissionContext } from "./permissions";
import { getFeaturePermissions } from "./permissions";

export function usePermissionContext(): PermissionContext {
  const { session, permissionsReady, permissionsBootstrap, permissionsBootstrapError } = useAuth();

  return useMemo(
    () => ({
      user: session?.user ?? null,
      rolePermissions: {},
      permissionsReady,
      permissionsBootstrap,
      permissionsBootstrapError,
    }),
    [session?.user, permissionsReady, permissionsBootstrap, permissionsBootstrapError],
  );
}

/** Droits CRUD d'un module — chaque bouton UI doit s'aligner sur ces flags. */
export function useFeaturePermissions(feature: string): FeaturePermissions {
  const ctx = usePermissionContext();
  return useMemo(() => getFeaturePermissions(ctx, feature), [ctx, feature]);
}
