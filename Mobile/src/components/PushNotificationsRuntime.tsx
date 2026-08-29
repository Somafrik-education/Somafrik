import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useAuth } from "../context/AuthContext";
import { canPersistFullSession } from "../lib/dataTruth";
import {
  destinationFromNotificationData,
  registerAuthenticatedPushDevice,
} from "../services/pushNotifications";
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

export default function PushNotificationsRuntime() {
  const { session, bootstrapping } = useAuth();

  useEffect(() => {
    if (bootstrapping || !session || !canPersistFullSession(session)) return;
    void registerAuthenticatedPushDevice().catch(() => undefined);
  }, [bootstrapping, session]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const destination = destinationFromNotificationData(response.notification.request.content.data);
      if (navigationRef.isReady()) {
        navigationRef.navigate(destination as never);
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}
