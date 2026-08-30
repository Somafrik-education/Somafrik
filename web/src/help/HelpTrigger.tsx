import { forwardRef, type ButtonHTMLAttributes } from "react";
import { HELP_TRIGGER_ZCLASS } from "./helpZIndex";
import { cn } from "../lib/utils";

interface HelpTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  expanded: boolean;
}

export const HelpTrigger = forwardRef<HTMLButtonElement, HelpTriggerProps>(
  ({ expanded, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Ouvrir l’aide"
        aria-expanded={expanded}
        aria-haspopup="dialog"
        className={cn(
          "no-print fixed bottom-24 right-4 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-brand px-3 text-sm font-semibold text-white shadow-card outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 sm:bottom-20 sm:min-w-0 sm:px-4",
          HELP_TRIGGER_ZCLASS,
          className,
        )}
        {...props}
      >
        <span aria-hidden="true" className="text-base leading-none">
          ?
        </span>
        <span className="hidden sm:inline">Besoin d’aide ?</span>
      </button>
    );
  },
);

HelpTrigger.displayName = "HelpTrigger";
