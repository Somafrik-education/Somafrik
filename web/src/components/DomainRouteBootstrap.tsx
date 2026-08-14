import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useData } from "../context/DataContext";
import { domainsForPath } from "../lib/routeDomainMap";

/** Charge les domaines métier requis par la route courante (LOT 8 — pas de snapshot global au login). */
export function DomainRouteBootstrap() {
  const location = useLocation();
  const { ensureDomains } = useData();

  useEffect(() => {
    const domains = domainsForPath(location.pathname);
    void ensureDomains(domains);
  }, [location.pathname, ensureDomains]);

  return null;
}
