import type { DomainKey } from "./domainLoaders";
import { userRequiresSchoolSelection } from "./activeSchool";
import { isPlatformCommunicationUser } from "./establishmentCommunication";
import {
  canManageRolePermissions,
  canReadView,
  type PermissionContext,
} from "./permissions";

const DOMAIN_VIEW_MAP: Partial<Record<DomainKey, string>> = {
  schools: "schools",
  countries: "countries",
  subscriptions: "subscriptions",
  notifications: "notifications",
  messages: "messages",
  announcements: "announcements",
  dashboardChartConfig: "chartSettings",
  users: "users",
  contacts: "contacts",
  relations: "relations",
  students: "students",
  teachers: "teachers",
  classes: "classes",
  courses: "courses", // lecture catalogue Matières — pas une dépendance Planning
  courseSchedules: "planning",
  assignments: "assignments",
  payments: "payments",
  paymentStatuses: "payments",
  feeGrids: "fees",
  studentFees: "fees",
  notes: "notes",
  evaluations: "notes",
  presences: "presences",
  academicConfigs: "configuration",
  exams: "exams",
  bulletins: "bulletins",
  documents: "documents",
};

export function canLoadDomain(ctx: PermissionContext, domain: DomainKey): boolean {
  if (domain === "schools") {
    if (userRequiresSchoolSelection(ctx.user)) return true;
    if (canReadView(ctx, "schools")) return true;
    // SCHOOL_ADMIN : profil mono-tenant (GET /establishments/:code), pas le catalogue.
    const schoolCode = String(ctx.user?.schoolCode ?? "").trim();
    return Boolean(schoolCode && schoolCode !== "*" && canReadView(ctx, "configuration"));
  }

  if (domain === "notifications") {
    // GET /backoffice/notifications = catalogue plateforme (ALL/COUNTRY).
    // L'établissement lit /internal-notifications, pas ce domaine.
    return isPlatformCommunicationUser(ctx);
  }

  if (domain === "rolePermissions") {
    return canManageRolePermissions(ctx);
  }

  if (domain === "dashboardChartConfig") {
    return canReadView(ctx, "chartSettings");
  }

  if (domain === "studentFees") {
    return canReadView(ctx, "fees") || canReadView(ctx, "payments");
  }

  const view = DOMAIN_VIEW_MAP[domain];
  if (!view) return true;
  return canReadView(ctx, view);
}

export function filterDomainsByPermissions(
  domains: DomainKey[],
  ctx: PermissionContext,
): DomainKey[] {
  return [...new Set(domains)].filter((domain) => canLoadDomain(ctx, domain));
}

/** Domaines topbar / recherche — uniquement ceux autorisés pour le rôle courant. */
export function layoutDomainsForContext(ctx: PermissionContext): DomainKey[] {
  const candidates: DomainKey[] = ["schools", "notifications", "messages", "announcements"];
  return filterDomainsByPermissions(candidates, ctx);
}
