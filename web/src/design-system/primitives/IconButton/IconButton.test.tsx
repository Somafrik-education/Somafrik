import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("requires accessible name via aria-label", () => {
    render(
      <IconButton aria-label="Fermer">
        <span>×</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Fermer" })).toBeInTheDocument();
  });

  it("uses min touch-friendly size by default", () => {
    render(
      <IconButton aria-label="Menu">
        <span>☰</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Menu" })).toHaveClass(
      "min-h-10",
      "min-w-10",
    );
  });
});
