import { DoorOpen, Repeat } from "lucide-react";
import { PagePlaceholder } from "../../components/ui/PagePlaceholder";

export function PlanningRoomsPage() {
  return (
    <PagePlaceholder
      icon={DoorOpen}
      title="Salles"
      description="Gestion des salles et de leur occupation : capacité, équipements et disponibilités par créneau."
    />
  );
}

export function PlanningSubstitutionsPage() {
  return (
    <PagePlaceholder
      icon={Repeat}
      title="Remplacements"
      description="Déclaration des absences enseignants et affectation des remplaçants, avec impact automatique sur l'emploi du temps."
    />
  );
}

export function TimetableByRoomPage() {
  return (
    <PagePlaceholder
      icon={DoorOpen}
      title="Emploi du temps par salle"
      description="Occupation d'une salle sur la semaine. Disponible une fois le module Salles activé."
    />
  );
}
