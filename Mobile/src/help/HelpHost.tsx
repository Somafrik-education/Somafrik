import { useCallback, useEffect, useMemo, useState } from "react";
import { isHelpAvailable } from "../../../packages/help-catalog/src/index.js";
import { useAuth } from "../context/AuthContext";
import { navigationRef } from "../navigation/rootNavigation";
import { buildMobileHelpContext, isMobileHelpSessionReady } from "./buildMobileHelpContext";
import { HelpSheet } from "./HelpSheet";
import { HelpTrigger } from "./HelpTrigger";

export function HelpHost() {
  const { session, permissionsBootstrap } = useAuth();
  const [routeName, setRouteName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncRouteName = () => {
      if (!navigationRef.isReady()) {
        setRouteName(null);
        return;
      }
      setRouteName(navigationRef.getCurrentRoute()?.name ?? null);
    };

    syncRouteName();
    const unsubscribe = navigationRef.addListener("state", syncRouteName);
    return unsubscribe;
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

  const close = useCallback(() => setOpen(false), []);

  const goTo = useCallback((mobileRoute: string) => {
    setOpen(false);
    if (!navigationRef.isReady()) return;
    navigationRef.navigate(mobileRoute as never);
  }, []);

  if (!available) return null;

  return (
    <>
      <HelpTrigger expanded={open} onPress={() => setOpen(true)} />
      {open ? <HelpSheet context={context} onClose={close} onNavigate={goTo} /> : null}
    </>
  );
}
