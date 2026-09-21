import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useAuth } from "../context/AuthContext";
import { canPersistFullSession } from "../lib/dataTruth";
import {
  consumeInitialPushResponse,
  consumePushTapResponse,
  flushPendingPushNavigation,
  type PushTapGate,
  type PushTapResponse,
} from "../lib/pushNotificationTap";
import { constrainParentPushNavigation, type AllowedPushNavigationParams } from "../lib/pushNotificationDestinations";
import { dispatchRegisteredPushNavigation } from "../lib/pushNotificationNavigate";
import {
  observePushRegistrationFailure,
  observePushRuntimeEvent,
  registerAuthenticatedPushDevice,
} from "../services/pushNotifications";
import { navigationRef } from "../navigation/rootNavigation";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function navigateTo(
  destination: string,
  params?: AllowedPushNavigationParams,
  session?: { role?: string | null; user?: { children?: unknown } | null } | null,
) {
  const scoped = constrainParentPushNavigation({ destination: destination as never, params }, session);
  dispatchRegisteredPushNavigation(navigationRef, scoped.destination, scoped.params);
}

function isNavigationReady() {
  return navigationRef.isReady();
}

async function readLastNotificationResponse(): Promise<PushTapResponse> {
  const asyncFn = (Notifications as { getLastNotificationResponseAsync?: () => Promise<unknown> })
    .getLastNotificationResponseAsync;
  if (typeof asyncFn === "function") {
    return (await asyncFn.call(Notifications)) as PushTapResponse;
  }
  const syncFn = (Notifications as { getLastNotificationResponse?: () => unknown }).getLastNotificationResponse;
  if (typeof syncFn === "function") {
    return syncFn.call(Notifications) as PushTapResponse;
  }
  return null;
}

export default function PushNotificationsRuntime() {
  const { session, bootstrapping } = useAuth();
  const canonical = !bootstrapping && Boolean(session) && canPersistFullSession(session);
  const canonicalRef = useRef(canonical);
  const sessionRef = useRef(session);
  const previousCanonicalRef = useRef(false);
  canonicalRef.current = canonical;
  sessionRef.current = session;

  const gate: PushTapGate = {
    isReady: isNavigationReady,
    isAuthenticated: () => canonicalRef.current,
  };
  const navigateScoped = (destination: string, params?: AllowedPushNavigationParams) => {
    navigateTo(destination, params, sessionRef.current);
  };

  useEffect(() => {
    observePushRuntimeEvent("mounted");
  }, []);

  useEffect(() => {
    const from = previousCanonicalRef.current;
    observePushRuntimeEvent("canonical", { from, to: canonical });
    previousCanonicalRef.current = canonical;
    if (!canonical) return;
    void registerAuthenticatedPushDevice().catch(observePushRegistrationFailure);
  }, [canonical]);

  useEffect(() => {
    void consumeInitialPushResponse(readLastNotificationResponse, navigateScoped, gate).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      consumePushTapResponse(response as PushTapResponse, navigateScoped, gate);
    });
    return () => sub.remove();
    // Intentionally once: the gate reads canonicalRef for later session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canonical) return;
    flushPendingPushNavigation(navigateScoped, gate);
  }, [canonical]);

  return null;
}
