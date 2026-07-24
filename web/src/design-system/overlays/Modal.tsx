import { useEffect, type ReactNode } from "react";
import { Button } from "../primitives/Button/Button";
import { cn } from "../utils/cn";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}

/**
 * Modal — dialogue modal générique (DO-003 / P-009).
 * Parité API avec `components/ui/Modal` (coexistence via re-export).
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="somafrik-modal-title"
        className={cn(
          "relative z-10 w-full rounded-2xl bg-white shadow-card",
          size === "lg" ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h3 id="somafrik-modal-title" className="text-base font-bold text-ink">
              {title}
            </h3>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          <Button variant="tertiary" size="sm" onClick={onClose} aria-label="Fermer">
            ✕
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
