import { DoorOpen } from "lucide-react";
import { ComingSoonState } from "../../design-system";

export function TimetableByRoomPage() {
  return (
    <ComingSoonState
      icon={<DoorOpen className="h-7 w-7" />}
      title="Emploi du temps par salle"
      description="Occupation d'une salle sur la semaine. Disponible une fois les salles affectées aux créneaux."
    />
  );
}
