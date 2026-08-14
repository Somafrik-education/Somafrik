import type { DomainKey } from "./domainLoaders";
import { filterDomainsByPermissions, layoutDomainsForContext } from "./domainPermissions";
import type { PermissionContext } from "./permissions";

const ROUTE_DOMAIN_RULES: { prefix: string; domains: DomainKey[] }[] = [
  {
    prefix: "/tableau-de-bord",
    domains: [
      "schools",
      "users",
      "countries",
      "subscriptions",
      "dashboardChartConfig",
      "rolePermissions",
      "students",
      "teachers",
      "classes",
      "payments",
    ],
  },
  {
    prefix: "/etablissement/vue-ensemble",
    domains: ["schools", "students", "teachers", "classes", "users", "payments", "presences", "notes"],
  },
  { prefix: "/etablissement/comptes-utilisateurs", domains: ["users", "contacts", "schools"] },
  { prefix: "/etablissement/relations-parent-enfant", domains: ["relations", "students", "contacts"] },
  { prefix: "/etablissement/eleves", domains: ["students", "classes", "schools"] },
  { prefix: "/etablissement/enseignants", domains: ["teachers", "assignments", "classes"] },
  { prefix: "/etablissement/classes", domains: ["classes", "students", "teachers"] },
  { prefix: "/planning", domains: ["academicConfigs", "courseSchedules", "exams", "classes", "teachers", "courses"] },
  { prefix: "/finances", domains: ["schools", "feeGrids", "studentFees", "payments", "paymentStatuses", "students"] },
  { prefix: "/notes", domains: ["notes", "students", "classes"] },
  { prefix: "/presences", domains: ["presences", "students", "classes"] },
  { prefix: "/examens", domains: ["exams", "notes", "students", "classes"] },
  { prefix: "/bulletins", domains: ["bulletins", "notes", "students", "classes"] },
  { prefix: "/administration/documents", domains: ["documents", "schools"] },
  { prefix: "/pays", domains: ["countries", "users", "subscriptions"] },
  { prefix: "/etablissements", domains: ["schools", "countries", "users"] },
  { prefix: "/abonnements", domains: ["schools", "subscriptions", "countries"] },
  { prefix: "/notifications", domains: ["notifications"] },
  { prefix: "/messages", domains: ["messages"] },
  { prefix: "/annonces", domains: ["announcements"] },
  { prefix: "/administration/utilisateurs", domains: ["users", "teachers"] },
  { prefix: "/administration/permissions", domains: ["rolePermissions"] },
  { prefix: "/administration/conformite", domains: ["users", "schools"] },
  { prefix: "/parametres/roles-droits", domains: ["academicConfigs", "users", "rolePermissions"] },
  { prefix: "/parametres/annee-scolaire", domains: ["academicConfigs", "schools"] },
  { prefix: "/parametres/documents", domains: ["documents", "academicConfigs"] },
  { prefix: "/parametres/graphiques", domains: ["dashboardChartConfig", "rolePermissions"] },
  { prefix: "/parametres", domains: ["academicConfigs", "schools", "rolePermissions", "users"] },
  { prefix: "/administration", domains: ["users", "schools", "countries"] },
];

export function domainsForPath(pathname: string, ctx: PermissionContext): DomainKey[] {
  const match = ROUTE_DOMAIN_RULES.filter(
    (rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0];

  const routeDomains = match?.domains ?? [];
  const combined = [...new Set([...layoutDomainsForContext(ctx), ...routeDomains])];
  return filterDomainsByPermissions(combined, ctx);
}
