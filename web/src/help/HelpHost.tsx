import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isHelpAvailable } from "@somafrik/help-catalog";
import { useAuth } from "../context/AuthContext";
import { buildWebHelpContext } from "./buildWebHelpContext";
import { HelpPanel } from "./HelpPanel";
import { HelpTrigger } from "./HelpTrigger";

export function HelpHost() {
  const { session, permissionsReady, permissionsBootstrap } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const context = useMemo(
    () =>
      buildWebHelpContext({
        pathname: location.pathname,
        role: session?.user?.role,
        permissions: session?.user?.permissions ?? session?.permissions,
      }),
    [location.pathname, session?.user?.role, session?.user?.permissions, session?.permissions],
  );

  const available =
    permissionsBootstrap === "ready" &&
    permissionsReady &&
    !session?.user?.mustChangePassword &&
    isHelpAvailable(context);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
  }, []);

  const goTo = useCallback(
    (webPath: string) => {
      setOpen(false);
      navigate(webPath);
    },
    [navigate],
  );

  if (!available) return null;

  return (
    <>
      <HelpTrigger ref={triggerRef} expanded={open} onClick={openPanel} />
      {open ? <HelpPanel context={context} onClose={close} onNavigate={goTo} /> : null}
    </>
  );
}
