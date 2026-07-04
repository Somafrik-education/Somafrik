import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type EventProps,
  type SlotInfo,
  type View,
} from "react-big-calendar";
import withDragAndDrop, {
  type EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import type { CourseScheduleSlot, PlanningCalendarEvent } from "../../lib/coursePlanning";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

export type PlanningCalendarView = "day" | "work_week" | "week" | "month";

interface CoursePlanningCalendarProps {
  className: string;
  events: PlanningCalendarEvent[];
  editable: boolean;
  onSelectSlot: (start: string, end: string) => void;
  onEventClick: (eventId: string) => void;
  onEventMove: (eventId: string, start: string, end: string) => void;
  onEventResize: (eventId: string, start: string, end: string) => void;
}

const locales = { fr };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1, locale: fr }),
  getDay,
  locales,
});

interface BigCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  slot: CourseScheduleSlot;
  color: string;
}

const DnDCalendar = withDragAndDrop<BigCalendarEvent>(Calendar);

const CALENDAR_MESSAGES = {
  date: "Date",
  time: "Heure",
  event: "Créneau",
  allDay: "Journée",
  week: "Semaine",
  work_week: "Semaine",
  day: "Jour",
  month: "Mois",
  previous: "Précédent",
  next: "Suivant",
  today: "Aujourd'hui",
  agenda: "Agenda",
  noEventsInRange: "Aucun créneau sur cette période.",
  showMore: (total: number) => `+${total} de plus`,
};

const VIEW_LABELS: Record<PlanningCalendarView, string> = {
  day: "Vue jour",
  work_week: "Vue semaine",
  week: "Planning avec heures",
  month: "Vue mois",
};

const VIEW_ORDER: PlanningCalendarView[] = ["day", "work_week", "week", "month"];

const CALENDAR_COMPONENTS = {
  toolbar: () => null,
  event: PlanningEvent,
};

function toDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
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

function mapEvents(events: PlanningCalendarEvent[]): BigCalendarEvent[] {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    start: toDate(event.start),
    end: toDate(event.end),
    slot: event.extendedProps,
    color: event.backgroundColor ?? "#2563eb",
  }));
}

function formatRangeLabel(view: PlanningCalendarView, date: Date): string {
  if (view === "month") {
    return format(date, "MMMM yyyy", { locale: fr });
  }
  if (view === "day") {
    return format(date, "EEEE d MMMM yyyy", { locale: fr });
  }
  const start = startOfWeek(date, { weekStartsOn: 1, locale: fr });
  const end =
    view === "work_week"
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 4)
      : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return `${format(start, "d MMM", { locale: fr })} – ${format(end, "d MMM yyyy", { locale: fr })}`;
}

function PlanningEvent({ event }: EventProps<BigCalendarEvent>) {
  const subject = event.slot.subject || event.title;
  const teacher = event.slot.teacherName || "Non assigné";
  const room = event.slot.room;

  return (
    <div className="rbc-planning-event">
      <span className="rbc-planning-event__subject">{subject}</span>
      <span className="rbc-planning-event__teacher">{teacher}</span>
      {room ? <span className="rbc-planning-event__room">{room}</span> : null}
    </div>
  );
}

function CoursePlanningCalendarInner({
  className,
  events,
  editable,
  onSelectSlot,
  onEventClick,
  onEventMove,
  onEventResize,
}: CoursePlanningCalendarProps) {
  const [view, setView] = useState<PlanningCalendarView>("work_week");
  const [date, setDate] = useState(() => new Date());

  const editableRef = useRef(editable);
  editableRef.current = editable;

  const onSelectRef = useRef(onSelectSlot);
  onSelectRef.current = onSelectSlot;

  const onEventClickRef = useRef(onEventClick);
  onEventClickRef.current = onEventClick;

  const onEventMoveRef = useRef(onEventMove);
  onEventMoveRef.current = onEventMove;

  const onEventResizeRef = useRef(onEventResize);
  onEventResizeRef.current = onEventResize;

  const calendarEvents = useMemo(() => mapEvents(events), [eventsSignature(events)]);

  const handleSelectSlot = useCallback((slotInfo: SlotInfo) => {
    if (!editableRef.current) return;
    onSelectRef.current(slotInfo.start.toISOString(), slotInfo.end.toISOString());
  }, []);

  const handleSelectEvent = useCallback((event: BigCalendarEvent) => {
    onEventClickRef.current(event.id);
  }, []);

  const handleEventDrop = useCallback((args: EventInteractionArgs<BigCalendarEvent>) => {
    if (!editableRef.current || !args.start || !args.end) return;
    onEventMoveRef.current(args.event.id, toIso(args.start), toIso(args.end));
  }, []);

  const handleEventResize = useCallback((args: EventInteractionArgs<BigCalendarEvent>) => {
    if (!editableRef.current || !args.start || !args.end) return;
    onEventResizeRef.current(args.event.id, toIso(args.start), toIso(args.end));
  }, []);

  const eventPropGetter = useCallback((event: BigCalendarEvent) => {
    return {
      style: {
        backgroundColor: event.color,
        borderColor: event.color,
        color: "#fff",
      },
    };
  }, []);

  const draggableAccessor = useCallback(() => editableRef.current, []);
  const resizableAccessor = useCallback(() => editableRef.current, []);

  const rangeLabel = useMemo(() => formatRangeLabel(view, date), [view, date]);

  const shiftDate = useCallback((action: "PREV" | "NEXT" | "TODAY") => {
    if (action === "TODAY") {
      setDate(new Date());
      return;
    }
    setDate((current) => {
      const next = new Date(current);
      const delta =
        view === "month" ? (action === "PREV" ? -1 : 1) : action === "PREV" ? -7 : 7;
      if (view === "month") {
        next.setMonth(next.getMonth() + delta);
      } else if (view === "day") {
        next.setDate(next.getDate() + (action === "PREV" ? -1 : 1));
      } else {
        next.setDate(next.getDate() + delta);
      }
      return next;
    });
  }, [view]);

  return (
    <div className="planning-calendar min-h-[560px] rounded-xl border border-line bg-white p-2">
      <div className="rbc-planning-toolbar mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rbc-planning-toolbar__btn" onClick={() => shiftDate("TODAY")}>
            Aujourd&apos;hui
          </button>
          <button type="button" className="rbc-planning-toolbar__btn" onClick={() => shiftDate("PREV")}>
            Précédent
          </button>
          <button type="button" className="rbc-planning-toolbar__btn" onClick={() => shiftDate("NEXT")}>
            Suivant
          </button>
          <span className="rbc-planning-toolbar__label px-2 text-sm font-bold capitalize text-ink">{rangeLabel}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {VIEW_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              className={`rbc-planning-toolbar__view ${view === item ? "is-active" : ""}`}
              onClick={() => setView(item)}
            >
              {VIEW_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      <DnDCalendar
        localizer={localizer}
        culture="fr"
        messages={CALENDAR_MESSAGES}
        events={calendarEvents}
        view={view as View}
        date={date}
        onView={(nextView: View) => setView(nextView as PlanningCalendarView)}
        onNavigate={setDate}
        views={VIEW_ORDER as View[]}
        defaultView="work_week"
        step={30}
        timeslots={2}
        min={new Date(1970, 0, 1, 7, 0, 0)}
        max={new Date(1970, 0, 1, 20, 0, 0)}
        scrollToTime={new Date(1970, 0, 1, 8, 0, 0)}
        selectable={editable}
        resizable={editable}
        draggableAccessor={draggableAccessor}
        resizableAccessor={resizableAccessor}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={handleSelectEvent}
        onEventDrop={handleEventDrop}
        onEventResize={handleEventResize}
        eventPropGetter={eventPropGetter}
        components={CALENDAR_COMPONENTS}
        popup
        style={{ height: 560 }}
      />
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
    eventsSignature(prev.events) === eventsSignature(next.events),
);
