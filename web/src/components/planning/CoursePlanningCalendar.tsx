import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  buildSubjectColorLegend,
  getCourseColor,
  type PlanningCalendarEvent,
} from "../../lib/coursePlanning";
import {
  formatRangeLabel,
  getViewDays,
  shiftAnchorDate,
  VIEW_LABELS,
  VIEW_ORDER,
  type PlanningCalendarView,
} from "../../lib/planningCalendarUtils";
import { PlanningMonthGrid } from "./PlanningMonthGrid";
import { mapPlanningGridEvents, PlanningTimeGrid } from "./PlanningTimeGrid";

export type { PlanningCalendarView };

interface CoursePlanningCalendarProps {
  className: string;
  events: PlanningCalendarEvent[];
  legendSubjects?: string[];
  editable: boolean;
  onSelectSlot: (start: string, end: string) => void;
  onEventClick: (eventId: string) => void;
  onEventMove: (eventId: string, start: string, end: string) => void;
  onEventResize: (eventId: string, start: string, end: string) => void;
}

function eventInstant(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function eventsSignature(events: PlanningCalendarEvent[]): string {
  return events
    .map(
      (event) =>
        `${event.id}:${eventInstant(event.start)}:${eventInstant(event.end)}:${event.extendedProps.subject}`,
    )
    .join("|");
}

function legendSignature(subjects: string[]): string {
  return subjects.join("\u0000");
}

function CoursePlanningCalendarInner({
  className,
  events,
  legendSubjects = [],
  editable,
  onSelectSlot,
  onEventClick,
  onEventMove,
  onEventResize,
}: CoursePlanningCalendarProps) {
  const [view, setView] = useState<PlanningCalendarView>("work_week");
  const [date, setDate] = useState(() => new Date());

  const onSelectRef = useRef(onSelectSlot);
  onSelectRef.current = onSelectSlot;
  const onEventClickRef = useRef(onEventClick);
  onEventClickRef.current = onEventClick;
  const onEventMoveRef = useRef(onEventMove);
  onEventMoveRef.current = onEventMove;
  const onEventResizeRef = useRef(onEventResize);
  onEventResizeRef.current = onEventResize;

  const gridEvents = useMemo(
    () => mapPlanningGridEvents(events, getCourseColor),
    [eventsSignature(events)],
  );

  const colorLegend = useMemo(() => {
    const subjects = [
      ...legendSubjects,
      ...events.map((event) => event.extendedProps.subject?.trim() || ""),
    ];
    return buildSubjectColorLegend(subjects);
  }, [legendSubjects, eventsSignature(events)]);

  const viewDays = useMemo(() => getViewDays(view, date), [view, date]);
  const rangeLabel = useMemo(() => formatRangeLabel(view, date), [view, date]);

  const shiftDate = useCallback(
    (action: "PREV" | "NEXT" | "TODAY") => {
      setDate((current) => shiftAnchorDate(view, current, action));
    },
    [view],
  );

  const handleSelectSlot = useCallback((start: string, end: string) => {
    if (!editable) return;
    onSelectRef.current(start, end);
  }, [editable]);

  const handleEventClick = useCallback((eventId: string) => {
    onEventClickRef.current(eventId);
  }, []);

  const handleEventMove = useCallback((eventId: string, start: string, end: string) => {
    if (!editable) return;
    onEventMoveRef.current(eventId, start, end);
  }, [editable]);

  const handleEventResize = useCallback((eventId: string, start: string, end: string) => {
    if (!editable) return;
    onEventResizeRef.current(eventId, start, end);
  }, [editable]);

  const openDayView = useCallback((day: Date) => {
    setDate(day);
    setView("day");
  }, []);

  return (
    <div className="planning-calendar min-h-[560px] rounded-xl border border-line bg-white p-2">
      <div className="planning-toolbar mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="planning-toolbar__btn" onClick={() => shiftDate("TODAY")}>
            Aujourd&apos;hui
          </button>
          <button type="button" className="planning-toolbar__btn" onClick={() => shiftDate("PREV")}>
            Précédent
          </button>
          <button type="button" className="planning-toolbar__btn" onClick={() => shiftDate("NEXT")}>
            Suivant
          </button>
          <span className="planning-toolbar__label px-2 text-sm font-bold capitalize text-ink">{rangeLabel}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {VIEW_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              className={`planning-toolbar__view ${view === item ? "is-active" : ""}`}
              onClick={() => setView(item)}
            >
              {VIEW_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      {colorLegend.length ? (
        <div className="planning-legend mb-3 flex flex-wrap gap-2">
          {colorLegend.map((entry) => (
            <span key={entry.subject} className="planning-legend__item">
              <span
                className="planning-legend__swatch"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="planning-legend__label">{entry.subject}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="planning-calendar__viewport">
        {view === "month" ? (
          <PlanningMonthGrid
            anchor={date}
            events={gridEvents}
            onEventClick={handleEventClick}
            onDayClick={openDayView}
          />
        ) : (
          <PlanningTimeGrid
            days={viewDays}
            events={gridEvents}
            editable={editable}
            onSelectSlot={handleSelectSlot}
            onEventClick={handleEventClick}
            onEventMove={handleEventMove}
            onEventResize={handleEventResize}
          />
        )}
      </div>

      <p className="mt-2 px-2 text-xs text-muted">
        Emploi du temps — {className} · matière dans chaque créneau · glisser-déposer et redimensionnement{" "}
        {editable ? "activés" : "désactivés"}
      </p>
    </div>
  );
}

export const CoursePlanningCalendar = memo(
  CoursePlanningCalendarInner,
  (prev, next) =>
    prev.className === next.className &&
    prev.editable === next.editable &&
    legendSignature(prev.legendSubjects ?? []) === legendSignature(next.legendSubjects ?? []) &&
    eventsSignature(prev.events) === eventsSignature(next.events),
);
