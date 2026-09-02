import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getAccessToken } from "../api/client";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  buildDomainRouteHydrationKey,
  setDomainRouteHydrationStatus,
} from "../lib/domainRouteHydration";
import { domainsForPath } from "../lib/routeDomainMap";
import { usePermissionContext } from "../lib/usePermissionContext";

const OVERVIEW_PATH = "/etablissement/vue-ensemble";

/** Charge les domaines métier requis par la route courante (LOT 8 — filtré RBAC). */
export function DomainRouteBootstrap() {
  const location = useLocation();
  const { ensureDomains } = useData();
  const { activeSchoolCode } = useActiveSchool();
  const { session, permissionsReady } = useAuth();
  const ctx = usePermissionContext();

  useEffect(() => {
    const trackOverviewHydration = location.pathname === OVERVIEW_PATH;
    const hydrationKey = buildDomainRouteHydrationKey(
      location.key,
      location.pathname,
      activeSchoolCode,
    );
    let cancelled = false;

    if (!session?.accessToken || !permissionsReady || !getAccessToken()) {
      if (trackOverviewHydration) {
        setDomainRouteHydrationStatus(hydrationKey, "idle");
      }
      return () => {
        cancelled = true;
      };
    }

    const domains = domainsForPath(location.pathname, ctx);
    if (!domains.length) {
      if (trackOverviewHydration) {
        setDomainRouteHydrationStatus(hydrationKey, "ready");
      }
      return () => {
        cancelled = true;
      };
    }

    if (trackOverviewHydration) {
      setDomainRouteHydrationStatus(hydrationKey, "loading");
    }

    void ensureDomains(domains, { schoolCode: activeSchoolCode })
      .then(() => {
        if (!cancelled && trackOverviewHydration) {
          setDomainRouteHydrationStatus(hydrationKey, "ready");
        }
      })
      .catch(() => {
        if (!cancelled && trackOverviewHydration) {
          setDomainRouteHydrationStatus(hydrationKey, "error");
        }
        /* erreur déjà exposée via DataContext.error */
      });

    return () => {
      cancelled = true;
    };
  }, [
    location.key,
    location.pathname,
    ctx,
    activeSchoolCode,
    ensureDomains,
    session?.accessToken,
    permissionsReady,
  ]);

  return null;
}
