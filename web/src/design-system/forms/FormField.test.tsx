import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequiredMark } from "./RequiredMark";
import { FormField } from "./FormField";

describe("RequiredMark", () => {
  it("renders a red asterisk without colouring surrounding text", () => {
    render(
      <span>
        Nom
        <RequiredMark />
      </span>,
    );
    const mark = screen.getByTestId("required-mark");
    expect(mark).toHaveTextContent("*");
    expect(mark).toHaveClass("text-danger");
    expect(screen.getByText(/Nom/)).toBeInTheDocument();
    expect(screen.getByText("(obligatoire)")).toHaveClass("sr-only");
  });
});

describe("FormField required", () => {
  it("shows a red asterisk only when required", () => {
    const { rerender } = render(
      <FormField label="Nom de l'établissement" htmlFor="school-name" required>
        <input id="school-name" />
      </FormField>,
    );
    const mark = screen.getByTestId("required-mark");
    expect(mark).toHaveTextContent("*");
    expect(mark).toHaveClass("text-danger");
    expect(mark.parentElement).toHaveClass("text-muted");
    expect(mark.parentElement).not.toHaveClass("text-danger");

    rerender(
      <FormField label="Ville" htmlFor="school-city">
        <input id="school-city" />
      </FormField>,
    );
    expect(screen.queryByTestId("required-mark")).toBeNull();
    expect(screen.getByText("Ville").textContent).not.toContain("*");
  });
});
