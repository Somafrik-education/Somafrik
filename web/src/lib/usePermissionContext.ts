import { useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { FeaturePermissions, PermissionContext } from "./permissions";
import { getFeaturePermissions } from "./permissions";

export function usePermissionContext(): PermissionContext {
  const { session } = useAuth();
  const { state, ensureDomains } = useData();

  useEffect(() => {
    if (!session?.accessToken) return;
    void ensureDomains(["rolePermissions"]);
  }, [session?.accessToken, ensureDomains]);

  return useMemo(
    () => ({
      user: session?.user ?? null,
      rolePermissions: state.rolePermissions ?? session?.rolePermissions ?? {},
    }),
    [session?.user, session?.rolePermissions, state.rolePermissions],
  );
}

/** Droits CRUD d'un module — chaque bouton UI doit s'aligner sur ces flags. */
export function useFeaturePermissions(feature: string): FeaturePermissions {
  const ctx = usePermissionContext();
  return useMemo(() => getFeaturePermissions(ctx, feature), [ctx, feature]);
}
