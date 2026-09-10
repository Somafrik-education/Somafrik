import { canReadRoute } from "../domain/security/permissions";
import { ALL_SCHOOLS_CODE } from "./activeSchool";

export type NotificationsInboxRoute = "InternalNotifications";

export function schoolCodeFromSession(session: { user?: { schoolCode?: string }; school?: { code?: string } } | null): string {
  return String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
}

/**
 * Contexte établissement actif : école sélectionnée, ou école liée à la session.
 * Un privilège plateforme ne convertit pas ce contexte en catalogue plateforme.
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
 * Inbox CTA / cloche Mobile : uniquement la boîte C4 d'un établissement actif.
 * Les notifications plateforme restent réservées au Web (#577 L0).
 */
export function resolveNotificationsInboxRoute(
  session: unknown,
  activeSchoolCode?: string | null,
): NotificationsInboxRoute | null {
  if (!hasSchoolNotificationContext(session, activeSchoolCode)) return null;
  return canReadRoute(session, "InternalNotifications") ? "InternalNotifications" : null;
}
