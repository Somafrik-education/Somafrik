type MobileLoginRole =
  | "super_admin"
  | "country_admin"
  | "school_admin"
  | "principal"
  | "prefet"
  | "secretary"
  | "teacher"
  | "parent_student"
  | "student";

export type PlatformLoginContext = {
  kind: "global" | "country";
  countryCode?: string;
};

export function isPlatformMobileRole(role?: string | null): boolean {
  return role === "super_admin" || role === "country_admin";
}

export function buildPlatformLoginParams(kind: "global" | "country", countryCode?: string) {
  if (kind === "global") {
    return {
      platformContext: { kind: "global" as const },
      accessIdentifier: "superadmin",
      accessRole: "super_admin" as const,
      accessRoleLabel: "Super Administrateur",
    };
  }
  const scope = String(countryCode ?? "").trim().toUpperCase();
  return {
    platformContext: { kind: "country" as const, countryCode: scope },
    accessIdentifier: scope === "CD" ? "admin-rdc" : `admin-${scope.toLowerCase()}`,
    accessRole: "country_admin" as const,
    accessRoleLabel: "Admin Pays",
  };
}

export function platformLoginTitle(context?: PlatformLoginContext | null): string {
  if (!context) return "Somafrik";
  if (context.kind === "country") {
    return `Somafrik ${context.countryCode ?? ""}`.trim();
  }
  return "Somafrik";
}

export function platformLoginSubtitle(context?: PlatformLoginContext | null): string {
  if (context?.kind === "country") {
    return `Admin Pays ${context.countryCode ?? ""}`.trim();
  }
  return "Plateforme";
}

export function buildMobileLoginPayload(input: {
  role: MobileLoginRole;
  identifier: string;
  pin: string;
  schoolCode?: string | null;
  platformContext?: PlatformLoginContext | null;
}): { role: MobileLoginRole; identifier: string; pin: string; schoolCode?: string } {
  const payload: { role: MobileLoginRole; identifier: string; pin: string; schoolCode?: string } = {
    role: input.role,
    identifier: input.identifier,
    pin: input.pin,
  };
  if (input.platformContext || isPlatformMobileRole(input.role)) {
    return payload;
  }
  payload.schoolCode = String(input.schoolCode ?? "").trim();
  return payload;
}
