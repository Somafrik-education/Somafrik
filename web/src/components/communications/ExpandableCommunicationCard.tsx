import { useState, type ReactNode } from "react";

type Tone = "default" | "info";

export function ExpandableCommunicationCard({
  title,
  subtitle,
  badge,
  badgeTone = "default",
  children,
  testID,
  defaultExpanded = false,
}: {
  title: string;
  subtitle?: string;
  badge: string;
  badgeTone?: Tone;
  children: ReactNode;
  testID?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <article
      data-testid={testID}
      className={`rounded-lg border ${expanded ? "border-brand/40 bg-white" : "border-line bg-white"}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
        aria-label={`${title}, ${badge}. ${expanded ? "Masquer" : "Afficher"} les détails`}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{title}</span>
          {subtitle ? <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span> : null}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            badgeTone === "info" ? "bg-brand-50 text-brand" : "bg-slate-100 text-muted"
          }`}
        >
          {badge}
        </span>
        <span className="shrink-0 text-xs text-muted" aria-hidden>
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {expanded ? <div className="space-y-2 border-t border-line px-3 py-3">{children}</div> : null}
    </article>
  );
}
