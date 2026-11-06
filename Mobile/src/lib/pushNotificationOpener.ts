import { navigationRef } from "../navigation/rootNavigation";
import { markInternalNotificationRead } from "../services/internalNotificationsApi";
import { notifyInternalNotificationsChanged } from "./internalNotificationsRead";
import { openResolvedNotification } from "./notificationNavigationOpen";
import type {
  AllowedPushDestination,
  AllowedPushNavigationParams,
  ResolvedNotificationNavigation,
} from "./pushNotificationDestinations";

/**
 * NOTIF-MOBILE-NAV — point d'ouverture unique des Push.
 * Utilisé par `PushNotificationsRuntime` (premier plan, arrière-plan, démarrage à froid)
 * et par `AppNavigator.onReady` (navigation en attente après connexion).
 */

type SessionGetter = () => Parameters<typeof openResolvedNotification>[1];

let studentSelector: ((studentId: string) => void) | undefined;

/** Branché par le runtime (AuthContext) pour présélectionner l'enfant d'un parent. */
export function registerPushStudentSelector(selector: (studentId: string) => void): () => void {
  studentSelector = selector;
  return () => {
    if (studentSelector === selector) studentSelector = undefined;
  };
}

export function createPushNotificationOpener(getSession: SessionGetter) {
  return (
    destination: AllowedPushDestination,
    params?: AllowedPushNavigationParams,
    resolved?: ResolvedNotificationNavigation,
  ) => {
    const target: ResolvedNotificationNavigation =
      resolved ?? { destination, params, resolved: destination !== "Home", meta: {} };
    openResolvedNotification(target, getSession(), {
      navigation: navigationRef,
      markRead: (notificationId, schoolCode) => markInternalNotificationRead(notificationId, schoolCode),
      onReadChanged: notifyInternalNotificationsChanged,
      selectStudent: (studentId) => studentSelector?.(studentId),
    });
  };
}
