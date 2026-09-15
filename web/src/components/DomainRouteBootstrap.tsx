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
const NOTES_PATH = "/notes";

export function tracksDomainRouteHydration(pathname: string): boolean {
  return (
    pathname === OVERVIEW_PATH ||
    pathname === NOTES_PATH ||
    pathname.startsWith(`${NOTES_PATH}/`)
  );
}

/** Charge les domaines métier requis par la route courante (LOT 8 — filtré RBAC). */
export function DomainRouteBootstrap() {
  const location = useLocation();
  const { ensureDomains } = useData();
  const { activeSchoolCode } = useActiveSchool();
  const { session, permissionsReady } = useAuth();
  const ctx = usePermissionContext();

  useEffect(() => {
    const trackHydration = tracksDomainRouteHydration(location.pathname);
    const hydrationKey = buildDomainRouteHydrationKey(
      location.key,
      location.pathname,
      activeSchoolCode,
    );
    let cancelled = false;

    if (!session?.accessToken || !permissionsReady || !getAccessToken()) {
      if (trackHydration) {
        setDomainRouteHydrationStatus(hydrationKey, "idle");
      }
      return () => {
        cancelled = true;
      };
    }

    const domains = domainsForPath(location.pathname, ctx);
    if (!domains.length) {
      if (trackHydration) {
        setDomainRouteHydrationStatus(hydrationKey, "ready");
      }
      return () => {
        cancelled = true;
      };
    }

    if (trackHydration) {
      setDomainRouteHydrationStatus(hydrationKey, "loading");
    }

    void ensureDomains(domains, { schoolCode: activeSchoolCode })
      .then(() => {
        if (!cancelled && trackHydration) {
          setDomainRouteHydrationStatus(hydrationKey, "ready");
        }
      })
      .catch(() => {
        if (!cancelled && trackHydration) {
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
