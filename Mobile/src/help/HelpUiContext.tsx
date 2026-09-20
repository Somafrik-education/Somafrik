import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readHelpTriggerVisible, writeHelpTriggerVisible } from "./helpTriggerPreference";

export type HelpUiValue = {
  available: boolean;
  setAvailable: (available: boolean) => void;
  open: boolean;
  triggerVisible: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  hideTrigger: () => void;
  showTrigger: () => void;
};

const noopHelpUi: HelpUiValue = {
  available: false,
  setAvailable: () => {},
  open: false,
  triggerVisible: true,
  openHelp: () => {},
  closeHelp: () => {},
  hideTrigger: () => {},
  showTrigger: () => {},
};

const HelpUiContext = createContext<HelpUiValue>(noopHelpUi);

export function HelpUiProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [triggerVisible, setTriggerVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readHelpTriggerVisible().then((visible) => {
      if (!cancelled) setTriggerVisible(visible);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openHelp = useCallback(() => setOpen(true), []);
  const closeHelp = useCallback(() => setOpen(false), []);

  const hideTrigger = useCallback(() => {
    setTriggerVisible(false);
    void writeHelpTriggerVisible(false);
  }, []);

  const showTrigger = useCallback(() => {
    setTriggerVisible(true);
    void writeHelpTriggerVisible(true);
  }, []);

  const value = useMemo<HelpUiValue>(
    () => ({
      available,
      setAvailable,
      open,
      triggerVisible,
      openHelp,
      closeHelp,
      hideTrigger,
      showTrigger,
    }),
    [available, open, triggerVisible, openHelp, closeHelp, hideTrigger, showTrigger],
  );

  return <HelpUiContext.Provider value={value}>{children}</HelpUiContext.Provider>;
}

export function useHelpUi(): HelpUiValue {
  return useContext(HelpUiContext);
}
