import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CourseScheduleSlot } from "../../lib/coursePlanning";
import {
  PLANNING_HOUR_END,
  PLANNING_HOUR_START,
  PLANNING_ROW_HEIGHT,
  PLANNING_SLOT_MINUTES,
  eventBlockStyle,
  formatDayHeader,
  formatHourLabel,
  isToday,
  minutesFromMidnight,
  pointerToDayIndex,
  pointerToSlot,
  setMinutesFromMidnight,
  slotCount,
  snapMinutes,
  toValidDate,
} from "../../lib/planningCalendarUtils";

export interface PlanningGridEvent {
  id: string;
  start: Date;
  end: Date;
  color: string;
  slot: CourseScheduleSlot;
}

interface PlanningTimeGridProps {
  days: Date[];
  events: PlanningGridEvent[];
  editable: boolean;
  onSelectSlot: (start: string, end: string) => void;
  onEventClick: (eventId: string) => void;
  onEventMove: (eventId: string, start: string, end: string) => void;
  onEventResize: (eventId: string, start: string, end: string) => void;
}

type DragMode = "move" | "resize" | "select";

interface ActiveDrag {
  mode: DragMode;
  eventId?: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  pointerId: number;
}

function eventsForDay(events: PlanningGridEvent[], day: Date): PlanningGridEvent[] {
  return events.filter((event) => {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    return event.start <= dayEnd && event.end >= dayStart && event.start.toDateString() === day.toDateString();
  });
}

function PlanningEventBlock({
  event,
  editable,
  onClick,
  onMoveStart,
  onResizeStart,
}: {
  event: PlanningGridEvent;
  editable: boolean;
  onClick: () => void;
  onMoveStart: (pointerId: number) => void;
  onResizeStart: (pointerId: number) => void;
}) {
  const { top, height } = eventBlockStyle(event.start, event.end);
  const subject = event.slot.subject || "Créneau";
  const teacher = event.slot.teacherName || "Non assigné";
  const room = event.slot.room;

  return (
    <button
      type="button"
      className={`planning-event ${editable ? "is-editable" : ""}`}
      style={{ top, height, backgroundColor: event.color, borderColor: event.color }}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onClick();
      }}
      onPointerDown={(pointerEvent) => {
        if (!editable || pointerEvent.button !== 0) return;
        pointerEvent.stopPropagation();
        pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
        onMoveStart(pointerEvent.pointerId);
      }}
    >
      <span className="planning-event__subject">{subject}</span>
      <span className="planning-event__teacher">{teacher}</span>
      {room ? <span className="planning-event__room">{room}</span> : null}
      {editable ? (
        <span
          className="planning-event__resize"
          onPointerDown={(pointerEvent) => {
            pointerEvent.stopPropagation();
            pointerEvent.preventDefault();
            pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
            onResizeStart(pointerEvent.pointerId);
          }}
        />
      ) : null}
    </button>
  );
}

export function PlanningTimeGrid({
  days,
  events,
  editable,
  onSelectSlot,
  onEventClick,
  onEventMove,
  onEventResize,
}: PlanningTimeGridProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [preview, setPreview] = useState<{ dayIndex: number; start: number; end: number } | null>(null);

  const setDragState = useCallback((next: ActiveDrag | null) => {
    activeDragRef.current = next;
    setActiveDrag(next);
  }, []);

  const hours = useMemo(
    () => Array.from({ length: PLANNING_HOUR_END - PLANNING_HOUR_START }, (_, i) => PLANNING_HOUR_START + i),
    [],
  );
  const totalHeight = slotCount() * PLANNING_ROW_HEIGHT;

  const getColumnRects = useCallback(() => {
    return columnRefs.current.filter(Boolean).map((node) => node!.getBoundingClientRect());
  }, []);

  const finishDrag = useCallback(
    (drag: ActiveDrag) => {
      const start = Math.min(drag.startMinutes, drag.endMinutes);
      const end = Math.max(drag.startMinutes, drag.endMinutes) + PLANNING_SLOT_MINUTES;
      const day = days[drag.dayIndex];
      if (!day) return;

      const startDate = setMinutesFromMidnight(day, start);
      const endDate = setMinutesFromMidnight(day, end);

      if (drag.mode === "select") {
        onSelectSlot(startDate.toISOString(), endDate.toISOString());
        return;
      }

      if (!drag.eventId) return;
      const event = events.find((item) => item.id === drag.eventId);
      if (!event) return;

      if (drag.mode === "move") {
        const duration = minutesFromMidnight(event.end) - minutesFromMidnight(event.start);
        const nextStart = setMinutesFromMidnight(day, start);
        const nextEnd = new Date(nextStart.getTime() + duration * 60_000);
        onEventMove(drag.eventId, nextStart.toISOString(), nextEnd.toISOString());
        return;
      }

      onEventResize(drag.eventId, event.start.toISOString(), endDate.toISOString());
    },
    [days, events, onEventMove, onEventResize, onSelectSlot],
  );

  useEffect(() => {
    if (!activeDrag) return;

    const handleMove = (nativeEvent: PointerEvent) => {
      const drag = activeDragRef.current;
      if (!drag || nativeEvent.pointerId !== drag.pointerId) return;
      const body = bodyRef.current;
      if (!body) return;

      const columnRects = getColumnRects();
      const dayIndex = pointerToDayIndex(nativeEvent.clientX, columnRects);
      const minutes = pointerToSlot(nativeEvent.clientY, body.getBoundingClientRect().top, body.scrollTop);

      let nextDrag = drag;
      if (drag.mode === "move") {
        const event = events.find((item) => item.id === drag.eventId);
        const duration = event
          ? minutesFromMidnight(event.end) - minutesFromMidnight(event.start)
          : PLANNING_SLOT_MINUTES;
        nextDrag = {
          ...drag,
          dayIndex,
          startMinutes: minutes,
          endMinutes: minutes + duration,
        };
        setPreview({ dayIndex, start: minutes, end: minutes + duration });
      } else if (drag.mode === "resize") {
        nextDrag = {
          ...drag,
          dayIndex,
          endMinutes: Math.max(drag.startMinutes + PLANNING_SLOT_MINUTES, minutes),
        };
        setPreview({
          dayIndex,
          start: drag.startMinutes,
          end: Math.max(drag.startMinutes + PLANNING_SLOT_MINUTES, minutes),
        });
      } else {
        const start = Math.min(drag.startMinutes, minutes);
        const end = Math.max(drag.startMinutes, minutes);
        nextDrag = { ...drag, dayIndex, startMinutes: start, endMinutes: end };
        setPreview({ dayIndex, start, end: end + PLANNING_SLOT_MINUTES });
      }
      setDragState(nextDrag);
    };

    const handleUp = (nativeEvent: PointerEvent) => {
      const drag = activeDragRef.current;
      if (!drag || nativeEvent.pointerId !== drag.pointerId) return;
      finishDrag(drag);
      setDragState(null);
      setPreview(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [activeDrag, events, finishDrag, getColumnRects, setDragState]);

  const startSelect = (dayIndex: number, minutes: number, pointerId: number) => {
    if (!editable) return;
    const snapped = snapMinutes(minutes);
    setDragState({
      mode: "select",
      dayIndex,
      startMinutes: snapped,
      endMinutes: snapped,
      pointerId,
    });
    setPreview({ dayIndex, start: snapped, end: snapped + PLANNING_SLOT_MINUTES });
  };

  return (
    <div className="planning-time-grid">
      <div className="planning-time-grid__header" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}>
        <div className="planning-time-grid__corner" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`planning-time-grid__day-label ${isToday(day) ? "is-today" : ""}`}
          >
            {formatDayHeader(day)}
          </div>
        ))}
      </div>

      <div ref={bodyRef} className="planning-time-grid__body">
        <div className="planning-time-grid__hours" style={{ height: totalHeight }}>
          {hours.map((hour) => (
            <div key={hour} className="planning-time-grid__hour" style={{ height: PLANNING_ROW_HEIGHT * 2 }}>
              {formatHourLabel(hour)}
            </div>
          ))}
        </div>

        <div className="planning-time-grid__columns" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
          {days.map((day, dayIndex) => (
            <div
              key={day.toISOString()}
              ref={(node) => {
                columnRefs.current[dayIndex] = node;
              }}
              className={`planning-time-grid__column ${isToday(day) ? "is-today" : ""}`}
              style={{ height: totalHeight }}
              onPointerDown={(pointerEvent) => {
                if (!editable || pointerEvent.button !== 0) return;
                if ((pointerEvent.target as HTMLElement).closest(".planning-event")) return;
                const body = bodyRef.current;
                if (!body) return;
                const minutes = pointerToSlot(
                  pointerEvent.clientY,
                  body.getBoundingClientRect().top,
                  body.scrollTop,
                );
                pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
                startSelect(dayIndex, minutes, pointerEvent.pointerId);
              }}
            >
              {Array.from({ length: slotCount() }).map((_, slotIndex) => (
                <div
                  key={slotIndex}
                  className="planning-time-grid__slot"
                  style={{ height: PLANNING_ROW_HEIGHT }}
                />
              ))}

              {preview && preview.dayIndex === dayIndex ? (
                <div
                  className="planning-time-grid__preview"
                  style={{
                    top: ((preview.start - PLANNING_HOUR_START * 60) / PLANNING_SLOT_MINUTES) * PLANNING_ROW_HEIGHT,
                    height:
                      ((preview.end - preview.start) / PLANNING_SLOT_MINUTES) * PLANNING_ROW_HEIGHT - 2,
                  }}
                />
              ) : null}

              {eventsForDay(events, day)
                .filter((event) => {
                  if (!preview || activeDrag?.eventId !== event.id) return true;
                  return activeDrag.mode === "move" || activeDrag.mode === "resize" ? false : true;
                })
                .map((event) => (
                <PlanningEventBlock
                  key={event.id}
                  event={event}
                  editable={editable}
                  onClick={() => onEventClick(event.id)}
                  onMoveStart={(pointerId) => {
                    setDragState({
                      mode: "move",
                      eventId: event.id,
                      dayIndex,
                      startMinutes: minutesFromMidnight(event.start),
                      endMinutes: minutesFromMidnight(event.end),
                      pointerId,
                    });
                  }}
                  onResizeStart={(pointerId) => {
                    setDragState({
                      mode: "resize",
                      eventId: event.id,
                      dayIndex,
                      startMinutes: minutesFromMidnight(event.start),
                      endMinutes: minutesFromMidnight(event.end),
                      pointerId,
                    });
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function mapPlanningGridEvents(
  events: { id: string; start: string; end: string; backgroundColor?: string; extendedProps: CourseScheduleSlot }[],
  getColor: (subject: string) => string,
): PlanningGridEvent[] {
  return events.map((event) => {
    const subject = event.extendedProps.subject?.trim() || "";
    return {
      id: event.id,
      start: toValidDate(event.start),
      end: toValidDate(event.end),
      color: event.backgroundColor ?? getColor(subject),
      slot: event.extendedProps,
    };
  });
}
