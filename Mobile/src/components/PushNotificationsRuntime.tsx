import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useAuth } from "../context/AuthContext";
import { canPersistFullSession } from "../lib/dataTruth";
import {
  consumeInitialPushResponse,
  consumePushTapResponse,
  flushPendingPushNavigation,
  type PushTapResponse,
} from "../lib/pushNotificationTap";
import { registerAuthenticatedPushDevice } from "../services/pushNotifications";
import { navigationRef } from "../navigation/rootNavigation";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function navigateTo(destination: string) {
  navigationRef.navigate(destination as never);
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

  useEffect(() => {
    if (bootstrapping || !session || !canPersistFullSession(session)) return;
    void registerAuthenticatedPushDevice().catch(() => undefined);
  }, [bootstrapping, session]);

  useEffect(() => {
    void consumeInitialPushResponse(readLastNotificationResponse, navigateTo, isNavigationReady).catch(
      () => undefined,
    );
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      consumePushTapResponse(response as PushTapResponse, navigateTo, isNavigationReady);
      flushPendingPushNavigation(navigateTo, isNavigationReady);
    });
    return () => sub.remove();
  }, []);

  return null;
}
