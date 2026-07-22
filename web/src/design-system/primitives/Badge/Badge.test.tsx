import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders with neutral tone by default", () => {
    render(<Badge>Actif</Badge>);
    expect(screen.getByText("Actif")).toHaveClass("bg-slate-100");
  });

  it("supports status tones from D1.4 roles", () => {
    const { rerender } = render(<Badge tone="success">OK</Badge>);
    expect(screen.getByText("OK")).toHaveClass("text-teal");

    rerender(<Badge tone="warning">Attente</Badge>);
    expect(screen.getByText("Attente")).toHaveClass("text-amber");

    rerender(<Badge tone="danger">Retard</Badge>);
    expect(screen.getByText("Retard")).toHaveClass("text-danger");

    rerender(<Badge tone="info">Info</Badge>);
    expect(screen.getByText("Info")).toHaveClass("text-brand");
  });
});
