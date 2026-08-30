import { isHelpAvailable, type HelpContext } from "@somafrik/help-catalog";
import { buildMobileHelpContext, liveHelpPermissions, liveHelpRole } from "./buildMobileHelpContext";
import { catalogRouteName, isPublicOrBootstrapRoute } from "./resolveMobileHelpRoute";

export type HelpPermissionsBootstrap = "idle" | "loading" | "ready" | "ready_offline" | "error";

export interface MobileHelpSessionLike {
  role?: string | null;
  roleLabel?: string | null;
  permissions?: readonly string[] | null;
  user?: {
    role?: string | null;
    permissions?: readonly string[] | null;
    mustChangePassword?: boolean;
  } | null;
}

export interface HelpAvailabilityInput {
  session: MobileHelpSessionLike | null;
  permissionsBootstrap: HelpPermissionsBootstrap;
  routeName: string | null;
}

/**
 * HELP n'apparaît qu'après session authentifiée + permissions live
 * (ready ou ready_offline pour le hors-ligne) et sur un écran catalogue.
 */
export function shouldShowMobileHelp(input: HelpAvailabilityInput): boolean {
  if (!input.session) return false;
  if (input.session.user?.mustChangePassword) return false;
  if (input.permissionsBootstrap !== "ready" && input.permissionsBootstrap !== "ready_offline") {
    return false;
  }
  if (isPublicOrBootstrapRoute(input.routeName)) return false;
  const context = buildHelpContextFromSession(input.session, input.routeName);
  return isHelpAvailable(context);
}

export function buildHelpContextFromSession(
  session: MobileHelpSessionLike | null,
  routeName: string | null,
): HelpContext {
  return buildMobileHelpContext({
    routeName: catalogRouteName(routeName),
    role: liveHelpRole(session),
    permissions: liveHelpPermissions(session),
  });
}
