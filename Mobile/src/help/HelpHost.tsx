import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { computeFloatingTabBarLayout } from "../lib/screenLayout";
import { shouldShowMobileHelp, buildHelpContextFromSession } from "./helpAvailability";
import { subscribeHelpBusinessModal } from "./helpBusinessModal";
import { computeHelpTriggerLayout } from "./helpOverlayPolicy";
import HelpPanel from "./HelpPanel";
import HelpTrigger from "./HelpTrigger";
import { getLeafRouteName } from "./resolveMobileHelpRoute";

const TAB_ROOT = "Home";

export default function HelpHost() {
  const { session, permissionsBootstrap } = useAuth();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [businessModalOpen, setBusinessModalOpen] = useState(false);

  const routeName = useNavigationState((state) => getLeafRouteName(state));
  const rootName = useNavigationState((state) => {
    const routes = state?.routes ?? [];
    const index = Number.isInteger(state?.index) ? Number(state?.index) : 0;
    return routes[index]?.name ?? null;
  });
  const hasTabBar = rootName === TAB_ROOT;

  const available = shouldShowMobileHelp({
    session,
    permissionsBootstrap,
    routeName,
  });

  const context = useMemo(
    () => buildHelpContextFromSession(session, routeName),
    [session, routeName],
  );

  useEffect(() => {
    setOpen(false);
  }, [routeName]);

  useEffect(() => subscribeHelpBusinessModal(setBusinessModalOpen), []);

  useEffect(() => {
    if (businessModalOpen) setOpen(false);
  }, [businessModalOpen]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => {
      setKeyboardVisible(true);
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
      setKeyboardVisible(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const tabLayout = computeFloatingTabBarLayout(insets);
  const triggerLayout = computeHelpTriggerLayout({
    hasTabBar,
    tabBarOccupiedHeight: tabLayout.tabBarOccupiedHeight,
    safeBottom: insets.bottom,
    keyboardVisible,
    businessModalOpen,
    helpOpen: open,
  });

  const openPanel = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const goTo = useCallback(
    (target: string) => {
      setOpen(false);
      (navigation as { navigate: (name: string) => void }).navigate(target);
    },
    [navigation],
  );

  if (!available) return null;

  return (
    <>
      {triggerLayout.visible ? (
        <HelpTrigger
          expanded={open}
          onPress={openPanel}
          bottom={triggerLayout.bottom}
          right={triggerLayout.right}
        />
      ) : null}
      {open ? <HelpPanel context={context} onClose={close} onNavigate={goTo} /> : null}
    </>
  );
}
