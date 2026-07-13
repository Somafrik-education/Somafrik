import { useEffect } from "react";
import { X } from "lucide-react";
import { BrandLogo } from "../BrandLogo";
import { AppNavContent } from "./AppNavContent";

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu de navigation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Fermer le menu"
      />
      <aside className="relative flex h-full w-[min(18rem,85vw)] flex-col border-r border-line bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <BrandLogo size="lg" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-50 hover:text-ink"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <AppNavContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
