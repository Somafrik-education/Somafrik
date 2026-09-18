import { createHelpContext, HELP_PLATFORM, type HelpContext } from "../../../packages/help-catalog/src/index.js";

export interface MobileHelpContextInput {
  routeName?: string | null;
  role?: string | null;
  permissions?: readonly string[] | null;
}

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
