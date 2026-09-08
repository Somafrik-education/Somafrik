import { canReadRoute, canReadView } from "../domain/security/permissions";
import { ALL_SCHOOLS_CODE } from "./activeSchool";

export type NotificationsInboxRoute = "InternalNotifications" | "PlatformNotifications";

export function schoolCodeFromSession(session: { user?: { schoolCode?: string }; school?: { code?: string } } | null): string {
  return String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
}

/**
 * Contexte établissement actif : école sélectionnée, ou école liée à la session.
 * Un privilège plateforme ne convertit pas ce contexte en catalogue B.
 */
export function hasSchoolNotificationContext(
  session: unknown,
  activeSchoolCode?: string | null,
): boolean {
  const active = String(activeSchoolCode ?? "").trim();
  if (active && active !== ALL_SCHOOLS_CODE) return true;
  const bound = schoolCodeFromSession(session as { user?: { schoolCode?: string }; school?: { code?: string } } | null);
  return Boolean(bound && bound !== ALL_SCHOOLS_CODE);
}

/**
 * Inbox CTA / cloche : routage par contexte actif, pas par union de privilèges.
 * École → C4 InternalNotifications. Plateforme sans école → PlatformNotifications.
 */
export function resolveNotificationsInboxRoute(
  session: unknown,
  activeSchoolCode?: string | null,
): NotificationsInboxRoute | null {
  if (hasSchoolNotificationContext(session, activeSchoolCode)) {
    return canReadRoute(session, "InternalNotifications") ? "InternalNotifications" : null;
  }
  if (canReadView(session, "PlatformNotifications")) {
    return "PlatformNotifications";
  }
  return null;
}
