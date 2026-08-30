import { createHelpContext, HELP_PLATFORM, type HelpContext } from "@somafrik/help-catalog";

export interface MobileHelpContextInput {
  routeName?: string | null;
  role?: string | null;
  permissions?: readonly string[] | null;
}

/**
 * Construit le HelpContext Mobile avec uniquement les champs autorisés.
 * Ne jamais y passer de secret, de session complète ou d'identifiant élève.
 * Les permissions viennent de la session live, jamais d'un rôle supposé.
 */
export function buildMobileHelpContext(input: MobileHelpContextInput): HelpContext {
  const permissions = Array.isArray(input.permissions)
    ? input.permissions.filter((token): token is string => typeof token === "string" && token.trim() !== "")
    : [];

  return createHelpContext({
    platform: HELP_PLATFORM.MOBILE,
    routeName: typeof input.routeName === "string" ? input.routeName : undefined,
    role: typeof input.role === "string" ? input.role : undefined,
    permissions,
  });
}

export function liveHelpPermissions(session: {
  permissions?: readonly string[] | null;
  user?: { permissions?: readonly string[] | null } | null;
} | null): string[] {
  if (Array.isArray(session?.permissions)) {
    return session.permissions.filter((token): token is string => typeof token === "string" && token.trim() !== "");
  }
  if (Array.isArray(session?.user?.permissions)) {
    return session.user.permissions.filter((token): token is string => typeof token === "string" && token.trim() !== "");
  }
  return [];
}

export function liveHelpRole(session: {
  role?: string | null;
  roleLabel?: string | null;
  user?: { role?: string | null } | null;
} | null): string | undefined {
  if (typeof session?.role === "string" && session.role.trim()) return session.role;
  if (typeof session?.user?.role === "string" && session.user.role.trim()) return session.user.role;
  if (typeof session?.roleLabel === "string" && session.roleLabel.trim()) return session.roleLabel;
  return undefined;
}
