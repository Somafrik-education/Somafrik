import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { CourseScheduleSlot, PlanningCalendarEvent, PlanningResource } from "../../lib/coursePlanning";

interface CoursePlanningCalendarProps {
  className: string;
  events: PlanningCalendarEvent[];
  resources: PlanningResource[];
  editable: boolean;
  onSelectSlot: (start: string, end: string, subject: string) => void;
  onEventClick: (eventId: string) => void;
  onEventDrop: (eventId: string, start: string, end: string, subject: string) => void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPlanningEvent(arg: EventContentArg) {
  const slot = arg.event.extendedProps as CourseScheduleSlot;
  const subject = slot.subject || arg.event.title;
  const teacher = slot.teacherName || "Non assigné";
  const room = slot.room ? `<span class="fc-planning-event__room">${escapeHtml(slot.room)}</span>` : "";

  return {
    html: `<div class="fc-planning-event">
      <span class="fc-planning-event__subject">${escapeHtml(subject)}</span>
      <span class="fc-planning-event__teacher">${escapeHtml(teacher)}</span>
      ${room}
    </div>`,
  };
}

export function CoursePlanningCalendar({
  className,
  events,
  resources,
  editable,
  onSelectSlot,
  onEventClick,
  onEventDrop,
}: CoursePlanningCalendarProps) {
  const plugins = useMemo(() => [resourceTimeGridPlugin, interactionPlugin], []);
  const resourceAreaColumns = useMemo(
    () => [
      { field: "subject", headerContent: "Cours" },
      { field: "teacherName", headerContent: "Professeur" },
    ],
    [],
  );

  return (
    <div className="planning-calendar rounded-xl border border-line bg-white p-2">
      <FullCalendar
        plugins={plugins}
        locale={frLocale}
        initialView="resourceTimeGridWeek"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "resourceTimeGridDay,resourceTimeGridWeek",
        }}
        resourceAreaWidth="280px"
        resourceAreaColumns={resourceAreaColumns}
        slotMinTime="07:00:00"
        slotMaxTime="20:00:00"
        allDaySlot={false}
        weekends={false}
        height="auto"
        expandRows
        nowIndicator
        selectable={editable}
        selectMirror={editable}
        editable={editable}
        eventDurationEditable={editable}
        eventStartEditable={editable}
        resources={resources}
        events={events}
        eventContent={renderPlanningEvent}
        select={(info: DateSelectArg) => {
          if (!editable) return;
          const subject = info.resource?.id ?? resources[0]?.id ?? "";
          onSelectSlot(info.startStr, info.endStr, subject);
        }}
        eventClick={(info: EventClickArg) => {
          info.jsEvent.preventDefault();
          onEventClick(info.event.id);
        }}
        eventDrop={(info: EventDropArg) => {
          const subject = info.event.getResources()[0]?.id ?? info.event.extendedProps.subject ?? "";
          onEventDrop(info.event.id, info.event.startStr, info.event.endStr ?? info.event.startStr, subject);
        }}
      />
      <p className="mt-2 px-2 text-xs text-muted">
        Emploi du temps — {className} · lignes : cours et professeur · créneaux : cours et professeur
      </p>
    </div>
  );
}
