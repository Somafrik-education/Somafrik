import type { DomainKey } from "./domainLoaders";

const ESTABLISHMENT_DEMO_DASHBOARD_DOMAINS: DomainKey[] = [
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
  "documents",
  "messages",
  "studentFees",
];

const PLATFORM_DEMO_DASHBOARD_DOMAINS: DomainKey[] = [
  "schools",
  "countries",
  "subscriptions",
  "users",
  "notifications",
  "dashboardChartConfig",
];

export function dashboardDomainsForDemo(internalSchool: boolean): DomainKey[] {
  return internalSchool
    ? [...ESTABLISHMENT_DEMO_DASHBOARD_DOMAINS]
    : [...PLATFORM_DEMO_DASHBOARD_DOMAINS];
}
