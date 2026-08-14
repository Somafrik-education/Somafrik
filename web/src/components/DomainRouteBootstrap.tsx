import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useData } from "../context/DataContext";
import { domainsForPath } from "../lib/routeDomainMap";
import { usePermissionContext } from "../lib/usePermissionContext";

/** Charge les domaines métier requis par la route courante (LOT 8 — filtré RBAC). */
export function DomainRouteBootstrap() {
  const location = useLocation();
  const { ensureDomains } = useData();
  const { activeSchoolCode } = useActiveSchool();
  const ctx = usePermissionContext();

  useEffect(() => {
    const domains = domainsForPath(location.pathname, ctx);
    if (!domains.length) return;
    void ensureDomains(domains, { schoolCode: activeSchoolCode }).catch(() => {
      /* erreur déjà exposée via DataContext.error */
    });
  }, [location.pathname, ctx, activeSchoolCode, ensureDomains]);

  return null;
}
