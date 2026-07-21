import type { HistoryIconKey } from "../../lib/studentHistory";
import type { StudentHistoryEventViewModel } from "../../lib/studentHistoryViewModel";
import { cn } from "../../lib/utils";

const ICON_GLYPH: Record<HistoryIconKey, string> = {
  enrollment: "🎓",
  documents: "📄",
  medical: "❤️",
  guardian: "👨‍👩‍👧",
  identity: "👤",
  archive: "📦",
  system: "•",
};

interface StudentHistoryTimelineProps {
  events: readonly StudentHistoryEventViewModel[];
}

export function StudentHistoryTimeline({
  events,
}: StudentHistoryTimelineProps) {
  if (events.length === 0) return null;

  return (
    <ul className="space-y-4" data-testid="student-history-timeline">
      {events.map((event) => (
        <li
          key={event.id}
          className={cn(
            "flex gap-3 rounded-xl border border-line px-4 py-3",
            event.isImportant && "border-brand/30 bg-brand-50/30",
            event.severity === "WARNING" && "border-amber-200 bg-amber-50/40",
          )}
        >
          <span
            className="mt-0.5 text-lg leading-none"
            aria-hidden="true"
            data-icon-key={event.iconKey}
          >
            {ICON_GLYPH[event.iconKey]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{event.title}</p>
            <p className="mt-1 text-sm text-muted">
              {event.descriptionLabel !== "Non renseigné"
                ? event.descriptionLabel
                : event.sourceModuleLabel}
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {event.actorLabel} · {event.severityLabel}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
