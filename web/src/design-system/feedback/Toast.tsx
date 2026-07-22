import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../utils/cn";

/**
 * Toast tones — compatibles legacy (`info` | `success` | `error`)
 * + `warning` (D1.4). `error` reste l’alias API (≠ StatusTone `danger`).
 */
export type ToastTone = "info" | "success" | "error" | "warning";

export interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

interface ToastState {
  message: string;
  tone: ToastTone;
  visible: boolean;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  error: "bg-danger",
  success: "bg-teal",
  warning: "bg-amber",
  info: "bg-ink",
};

const TOAST_DURATION_MS = 3200;

/**
 * ToastProvider — feedback global non bloquant (DO-005 synchronisation / succès court).
 * Coexistence : `components/ui/Toast` reste le provider runtime jusqu’à migration.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({
    message: "",
    tone: "info",
    visible: false,
  });
  const timeoutRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setToast({ message, tone, visible: true });
    timeoutRef.current = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          "pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-all duration-300",
          toast.visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        )}
      >
        <div
          className={cn(
            "rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-card",
            TONE_CLASS[toast.tone],
          )}
        >
          {toast.message}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé dans <ToastProvider>");
  return ctx;
}
