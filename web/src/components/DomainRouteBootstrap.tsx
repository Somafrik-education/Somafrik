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
import { demoRuntimeEnabled } from "../lib/featureFlags";
import type { DomainKey } from "../lib/domainLoaders";

const OVERVIEW_PATH = "/etablissement/vue-ensemble";
const NOTES_PATH = "/notes";

// Ces domaines appartiennent au chrome / annuaire global et peuvent être plus
// lents que la donnée de route. En Démo ils continuent à charger, mais ne
// doivent jamais retenir Notes ou Vue d'ensemble derrière leur latence.
const DEMO_NON_BLOCKING_ROUTE_DOMAINS = new Set<DomainKey>([
  "schools",
  "notifications",
  "users",
]);

export function tracksDomainRouteHydration(pathname: string): boolean {
  return (
    pathname === OVERVIEW_PATH ||
    pathname === NOTES_PATH ||
    pathname.startsWith(`${NOTES_PATH}/`)
  );
}

function demoBlockingRouteDomains(domains: DomainKey[]): DomainKey[] {
  return domains.filter((domain) => !DEMO_NON_BLOCKING_ROUTE_DOMAINS.has(domain));
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

    if (demoRuntimeEnabled) {
      // Démo : chaque domaine possède son propre ensure. DataContext fusionne
      // donc classes/élèves/notes dès leur 200 sans attendre un GET schools ou
      // users lent. PROD/PREPROD conservent le batch historique ci-dessous.
      const tasks = new Map<DomainKey, Promise<void>>();
      for (const domain of domains) {
        tasks.set(
          domain,
          ensureDomains([domain], { schoolCode: activeSchoolCode }),
        );
      }

      if (trackHydration) {
        const blockingDomains = demoBlockingRouteDomains(domains);
        const blockingTasks = blockingDomains
          .map((domain) => tasks.get(domain))
          .filter((task): task is Promise<void> => Boolean(task));

        void Promise.allSettled(blockingTasks).then((results) => {
          if (cancelled) return;
          const failed = results.some((result) => result.status === "rejected");
          setDomainRouteHydrationStatus(hydrationKey, failed ? "error" : "ready");
        });
      }

      // Les domaines non bloquants restent surveillés par DataContext.error ;
      // on évite seulement une rejection non observée côté effet React.
      for (const task of tasks.values()) {
        void task.catch(() => undefined);
      }

      return () => {
        cancelled = true;
      };
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
