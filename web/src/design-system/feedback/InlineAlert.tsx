import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";
import type { StatusTone } from "../tokens/roles";

export type InlineAlertTone = StatusTone;

export interface InlineAlertProps extends HTMLAttributes<HTMLDivElement> {
  /** Tone sémantique D1.4. */
  tone?: InlineAlertTone;
  /** Titre court optionnel. */
  title?: string;
  children: ReactNode;
  /** Action contextuelle (lien, bouton tertiaire…). */
  action?: ReactNode;
}

const TONE_SURFACE: Record<InlineAlertTone, string> = {
  neutral: "border-line bg-slate-50",
  success: "border-teal/30 bg-teal/10",
  warning: "border-amber/30 bg-amber/10",
  danger: "border-danger/30 bg-danger/10",
  info: "border-brand/30 bg-brand-50",
};

/**
 * InlineAlert — encart d’alerte / signal inline (DO-005, DO-012).
 * À placer dans les slots Alerts des layouts, pas pour le toast global.
 */
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
  ...props
}: InlineAlertProps) {
  const a11yRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <div
      role={a11yRole}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm text-ink",
        TONE_SURFACE[tone],
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          <div className={title ? "text-sm" : undefined}>{children}</div>
        </div>
        {action ? <div className="no-print shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
