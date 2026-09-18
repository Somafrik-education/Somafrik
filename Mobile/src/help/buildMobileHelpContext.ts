import { createHelpContext, HELP_PLATFORM, type HelpContext } from "../../../packages/help-catalog/src/index.js";
import { isMetierRenderable, type PermissionsBootstrapState } from "../lib/livePermissionsRefresh";

export interface MobileHelpContextInput {
  routeName?: string | null;
  role?: string | null;
  permissions?: readonly string[] | null;
}

const PERMISSIONS_BOOTSTRAP_STATES = new Set<PermissionsBootstrapState>([
  "idle",
  "loading",
  "ready",
  "ready_offline",
  "error",
]);

export function isMobileHelpSessionReady(input: {
  session?: object | null;
  permissionsBootstrap?: string | null;
  mustChangePassword?: boolean;
}): boolean {
  if (input.mustChangePassword) return false;
  const bootstrap = input.permissionsBootstrap;
  if (!bootstrap || !PERMISSIONS_BOOTSTRAP_STATES.has(bootstrap as PermissionsBootstrapState)) {
    return false;
  }
  return isMetierRenderable(input.session, bootstrap as PermissionsBootstrapState);
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
