import { Outlet } from "react-router-dom";
import { CalendarDays, DoorOpen, GraduationCap, User } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const TIMETABLE_TABS: TabItem[] = [
  { to: "/planning/emploi-du-temps/par-classe", label: "Par classe", icon: GraduationCap },
  { to: "/planning/emploi-du-temps/par-enseignant", label: "Par enseignant", icon: User },
  { to: "/planning/emploi-du-temps/par-salle", label: "Par salle", icon: DoorOpen },
  { to: "/planning/emploi-du-temps/calendrier", label: "Vue calendrier", icon: CalendarDays },
];

/** Onglet « Emploi du temps » : sous-onglets + contenu via <Outlet />. */
export function TimetableLayout() {
  return (
    <div className="space-y-4">
      <TabNav tabs={TIMETABLE_TABS} variant="sub" />
      <Outlet />
    </div>
  );
}
