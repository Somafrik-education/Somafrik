export type MobileLoginRole = string;

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

/**
 * Rôles dont le backend lit exclusivement `password` (cf. `authService.resolveLoginSecret`).
 * Les autres rôles sont lus via `pin || password`.
 * AUTH-MOBILE-01 : `student` envoyait `pin` alors que le backend n'attend que `password`
 * → secret vide côté serveur → « Champs manquants » malgré des champs renseignés.
 */
const PASSWORD_FIELD_ROLES = new Set(["parent_student", "student"]);

export function usesPasswordLoginField(role?: string | null): boolean {
  return PASSWORD_FIELD_ROLES.has(String(role ?? ""));
}

export function buildMobileLoginPayload(input: {
  role: MobileLoginRole;
  identifier: string;
  pin?: string;
  password?: string;
  schoolCode?: string | null;
  platformContext?: PlatformLoginContext | null;
}): { role: MobileLoginRole; identifier: string; pin?: string; password?: string; schoolCode?: string } {
  const payload: {
    role: MobileLoginRole;
    identifier: string;
    pin?: string;
    password?: string;
    schoolCode?: string;
  } = {
    role: input.role,
    identifier: input.identifier,
  };
  if (usesPasswordLoginField(input.role)) {
    payload.password = String(input.password ?? "");
  } else {
    payload.pin = String(input.password ?? input.pin ?? "");
  }
  if (input.platformContext || isPlatformMobileRole(input.role)) {
    return payload;
  }
  payload.schoolCode = String(input.schoolCode ?? "").trim();
  return payload;
}
