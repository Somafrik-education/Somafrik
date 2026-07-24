import { DoorOpen, Repeat } from "lucide-react";
import { ComingSoonState } from "../../design-system";

export function PlanningRoomsPage() {
  return (
    <ComingSoonState
      icon={<DoorOpen className="h-7 w-7" />}
      title="Salles"
      description="Gestion des salles et de leur occupation : capacité, équipements et disponibilités par créneau."
    />
  );
}

export function PlanningSubstitutionsPage() {
  return (
    <ComingSoonState
      icon={<Repeat className="h-7 w-7" />}
      title="Remplacements"
      description="Déclaration des absences enseignants et affectation des remplaçants, avec impact automatique sur l'emploi du temps."
    />
  );
}

export function TimetableByRoomPage() {
  return (
    <ComingSoonState
      icon={<DoorOpen className="h-7 w-7" />}
      title="Emploi du temps par salle"
      description="Occupation d'une salle sur la semaine. Disponible une fois le module Salles activé."
    />
  );
}
