import type { DomainKey } from "./domainLoaders";

/** KPI / pédagogie nécessaires pour rendre le dashboard établissement sans attendre Communication. */
const ESTABLISHMENT_DEMO_CRITICAL_DOMAINS: DomainKey[] = [
  "schools",
  "users",
  "students",
  "teachers",
  "classes",
  "payments",
  "presences",
  "notes",
  "exams",
  "bulletins",
  "studentFees",
];

/** Graphique Administration : hydratation indépendante, ne doit pas bloquer Notes. */
const ESTABLISHMENT_DEMO_DEFERRED_DOMAINS: DomainKey[] = ["documents", "messages"];

const PLATFORM_DEMO_DASHBOARD_DOMAINS: DomainKey[] = [
  "schools",
  "countries",
  "subscriptions",
  "users",
  "notifications",
  "dashboardChartConfig",
];

export function dashboardCriticalDomainsForDemo(internalSchool: boolean): DomainKey[] {
  return internalSchool
    ? [...ESTABLISHMENT_DEMO_CRITICAL_DOMAINS]
    : [...PLATFORM_DEMO_DASHBOARD_DOMAINS];
}

export function dashboardDeferredDomainsForDemo(internalSchool: boolean): DomainKey[] {
  return internalSchool ? [...ESTABLISHMENT_DEMO_DEFERRED_DOMAINS] : [];
}

export function dashboardDomainsForDemo(internalSchool: boolean): DomainKey[] {
  return [
    ...dashboardCriticalDomainsForDemo(internalSchool),
    ...dashboardDeferredDomainsForDemo(internalSchool),
  ];
}
