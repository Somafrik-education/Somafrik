import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "../primitives/Button/Button";
import { Modal } from "./Modal";

export type ConfirmTone = "default" | "danger";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

const EMPTY_STATE: ConfirmState = {
  open: false,
  title: "",
};

/**
 * ConfirmProvider — confirmation destructive / impactante (DO-003).
 * Parité API avec `components/ui/ConfirmDialog`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>(EMPTY_STATE);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(EMPTY_STATE);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel ?? "Confirmer",
        cancelLabel: options.cancelLabel ?? "Annuler",
        tone: options.tone ?? "default",
      });
    });
  }, []);

  const confirmVariant = state.tone === "danger" ? "danger" : "primary";

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        open={state.open}
        title={state.title}
        description={state.description}
        onClose={() => close(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => close(false)}>
              {state.cancelLabel ?? "Annuler"}
            </Button>
            <Button type="button" variant={confirmVariant} onClick={() => close(true)}>
              {state.confirmLabel ?? "Confirmer"}
            </Button>
          </>
        }
      >
        {state.description ? null : (
          <p className="text-sm text-muted">Confirmez-vous cette action ?</p>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm doit être utilisé dans <ConfirmProvider>");
  return ctx;
}
