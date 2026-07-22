import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("announces loading status to assistive tech", () => {
    render(<Spinner label="Chargement des élèves" />);
    expect(screen.getByRole("status", { name: "Chargement des élèves" })).toBeInTheDocument();
  });
});
