import { useCallback, useMemo, useState } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { isHelpAvailable } from "../../../packages/help-catalog/src/index.js";
import { useAuth } from "../context/AuthContext";
import { buildMobileHelpContext, isMobileHelpSessionReady } from "./buildMobileHelpContext";
import { HelpSheet } from "./HelpSheet";
import { HelpTrigger } from "./HelpTrigger";

function activeRouteName(state: { index: number; routes: Array<{ name: string; state?: unknown }> } | undefined): string | null {
  if (!state) return null;
  const route = state.routes[state.index];
  if (!route) return null;
  if (route.state && typeof route.state === "object") {
    return activeRouteName(route.state as { index: number; routes: Array<{ name: string; state?: unknown }> });
  }
  return route.name;
}

export function HelpHost() {
  const { session, permissionsBootstrap } = useAuth();
  const navigation = useNavigation();
  const routeName = useNavigationState((state) => activeRouteName(state));
  const [open, setOpen] = useState(false);

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

  const close = useCallback(() => setOpen(false), []);

  const goTo = useCallback(
    (mobileRoute: string) => {
      setOpen(false);
      navigation.navigate(mobileRoute as never);
    },
    [navigation],
  );

  if (!available) return null;

  return (
    <>
      <HelpTrigger expanded={open} onPress={() => setOpen(true)} />
      {open ? <HelpSheet context={context} onClose={close} onNavigate={goTo} /> : null}
    </>
  );
}
