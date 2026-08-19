import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimetableByRoomPage } from "./PlanningPlaceholders";

describe("PlanningPlaceholders (emploi du temps par salle)", () => {
  it("garde ComingSoonState pour la vue par salle", () => {
    render(<TimetableByRoomPage />);
    expect(screen.getByRole("heading", { name: "Emploi du temps par salle" })).toBeInTheDocument();
    expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
  });
});
