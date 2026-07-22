import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanningRoomsPage } from "./PlanningPlaceholders";

describe("PlanningPlaceholders (D2.5)", () => {
  it("renders Salles with ComingSoonState", () => {
    render(<PlanningRoomsPage />);
    expect(screen.getByRole("heading", { name: "Salles" })).toBeInTheDocument();
    expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
  });
});
