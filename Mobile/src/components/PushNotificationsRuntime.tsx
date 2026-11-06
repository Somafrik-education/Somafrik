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
import { createPushNotificationOpener, registerPushStudentSelector } from "../lib/pushNotificationOpener";
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

function isNavigationReady() {
  return navigationRef.isReady();
}

/** Évite qu'un ancien clic soit rejoué à un démarrage à froid ultérieur. */
function clearLastNotificationResponse() {
  const api = Notifications as {
    clearLastNotificationResponse?: () => void;
    clearLastNotificationResponseAsync?: () => Promise<void>;
  };
  try {
    if (typeof api.clearLastNotificationResponse === "function") {
      api.clearLastNotificationResponse();
    } else if (typeof api.clearLastNotificationResponseAsync === "function") {
      void api.clearLastNotificationResponseAsync().catch(() => undefined);
    }
  } catch {
    // best effort : la déduplication en mémoire reste active
  }
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
  const { session, bootstrapping, setSelectedStudentId } = useAuth();
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
  const navigateScoped = createPushNotificationOpener(() => sessionRef.current);

  useEffect(() => {
    observePushRuntimeEvent("mounted");
  }, []);

  useEffect(() => registerPushStudentSelector(setSelectedStudentId), [setSelectedStudentId]);

  useEffect(() => {
    const from = previousCanonicalRef.current;
    observePushRuntimeEvent("canonical", { from, to: canonical });
    previousCanonicalRef.current = canonical;
    if (!canonical) return;
    void registerAuthenticatedPushDevice().catch(observePushRegistrationFailure);
  }, [canonical]);

  useEffect(() => {
    void consumeInitialPushResponse(readLastNotificationResponse, navigateScoped, gate)
      .then((outcome) => {
        if (outcome !== "ignored") clearLastNotificationResponse();
      })
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (consumePushTapResponse(response as PushTapResponse, navigateScoped, gate) !== "ignored") {
        clearLastNotificationResponse();
      }
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
