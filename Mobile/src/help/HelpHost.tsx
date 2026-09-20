import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isHelpAvailable } from "../../../packages/help-catalog/src/index.js";
import { useAuth } from "../context/AuthContext";
import { navigationRef } from "../navigation/rootNavigation";
import { buildMobileHelpContext, isMobileHelpSessionReady } from "./buildMobileHelpContext";
import { HelpSheet } from "./HelpSheet";
import { HelpTrigger } from "./HelpTrigger";
import { helpTriggerBottomOffset } from "./helpTriggerLayout";
import { useHelpUi } from "./HelpUiContext";

export function HelpHost() {
  const { session, permissionsBootstrap } = useAuth();
  const { setAvailable, closeHelp, openHelp, hideTrigger, triggerVisible, open } = useHelpUi();
  const insets = useSafeAreaInsets();
  const [routeName, setRouteName] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const syncRouteName = () => {
      if (!navigationRef.isReady()) {
        setRouteName(null);
        return;
      }
      const currentRoute = navigationRef.getCurrentRoute() as { name: string } | undefined;
      setRouteName(currentRoute?.name ?? null);
    };

    syncRouteName();
    const unsubscribe = navigationRef.addListener("state", syncRouteName);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const context = useMemo(
    () =>
      buildMobileHelpContext({
        routeName,
        role: session?.user?.role ?? session?.role,
        permissions: session?.user?.permissions ?? session?.permissions,
      }),
    [routeName, session?.user?.role, session?.role, session?.user?.permissions, session?.permissions],
  );

  const available =
    isMobileHelpSessionReady({
      session,
      permissionsBootstrap,
      mustChangePassword: session?.user?.mustChangePassword,
    }) && isHelpAvailable(context);

  useEffect(() => {
    setAvailable(available);
    if (!available) closeHelp();
  }, [available, setAvailable, closeHelp]);

  const goTo = useCallback(
    (mobileRoute: string) => {
      closeHelp();
      if (!navigationRef.isReady()) return;
      navigationRef.navigate(mobileRoute as never);
    },
    [closeHelp],
  );

  if (!available) return null;

  const showTrigger = triggerVisible && !keyboardVisible;

  return (
    <>
      {showTrigger ? (
        <HelpTrigger
          expanded={open}
          onPress={openHelp}
          onHide={hideTrigger}
          bottom={helpTriggerBottomOffset(insets.bottom)}
        />
      ) : null}
      {open ? <HelpSheet context={context} onClose={closeHelp} onNavigate={goTo} /> : null}
    </>
  );
}
