import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { PlanningGridEvent } from "./PlanningTimeGrid";
import {
  formatEventTime,
  formatMonthDay,
  getMonthGridDays,
  isCurrentMonth,
  isToday,
} from "../../lib/planningCalendarUtils";

interface PlanningMonthGridProps {
  anchor: Date;
  events: PlanningGridEvent[];
  onEventClick: (eventId: string) => void;
  onDayClick: (day: Date) => void;
}

const WEEKDAY_LABELS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

function eventsForDay(events: PlanningGridEvent[], day: Date): PlanningGridEvent[] {
  return events.filter((event) => event.start.toDateString() === day.toDateString());
}

export function PlanningMonthGrid({ anchor, events, onEventClick, onDayClick }: PlanningMonthGridProps) {
  const days = getMonthGridDays(anchor);

  return (
    <div className="planning-month-grid">
      <div className="planning-month-grid__weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="planning-month-grid__weekday">
            {label}
          </div>
        ))}
      </div>
      <div className="planning-month-grid__cells">
        {days.map((day) => {
          const dayEvents = eventsForDay(events, day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={`planning-month-grid__cell ${isToday(day) ? "is-today" : ""} ${
                isCurrentMonth(day, anchor) ? "" : "is-outside"
              }`}
              onClick={() => onDayClick(day)}
            >
              <span className="planning-month-grid__day">{formatMonthDay(day)}</span>
              <div className="planning-month-grid__events">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className="planning-month-grid__event"
                    style={{ backgroundColor: event.color, borderColor: event.color }}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onEventClick(event.id);
                    }}
                  >
                    <span className="planning-month-grid__event-time">{formatEventTime(event.start)}</span>
                    <span className="planning-month-grid__event-subject">{event.slot.subject}</span>
                  </button>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="planning-month-grid__more">+{dayEvents.length - 3} de plus</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
      <p className="planning-month-grid__hint">
        {format(anchor, "MMMM yyyy", { locale: fr })} — cliquez sur un jour pour voir le détail horaire.
      </p>
    </div>
  );
}
