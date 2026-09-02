import { createHelpContext, HELP_PLATFORM, type HelpContext } from "@somafrik/help-catalog";

export interface WebHelpContextInput {
  pathname: string;
  role?: string | null;
  permissions?: readonly string[] | null;
}

/**
 * Construit le HelpContext Web avec uniquement les champs autorisés.
 * Ne jamais y passer de secret, de session complète ou d'identifiant élève.
 */
export function buildWebHelpContext(input: WebHelpContextInput): HelpContext {
  const permissions = Array.isArray(input.permissions)
    ? input.permissions.filter((token): token is string => typeof token === "string" && token.trim() !== "")
    : [];

  return createHelpContext({
    platform: HELP_PLATFORM.WEB,
    pathname: input.pathname,
    role: typeof input.role === "string" ? input.role : undefined,
    permissions,
  });
}
