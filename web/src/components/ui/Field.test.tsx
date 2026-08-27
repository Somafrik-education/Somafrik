import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";

describe("Field required mark", () => {
  it("marks only the asterisk as danger when required", () => {
    render(
      <Field label="Prénom" htmlFor="first-name" required>
        <input id="first-name" />
      </Field>,
    );
    const mark = screen.getByTestId("required-mark");
    expect(mark).toHaveTextContent("*");
    expect(mark).toHaveClass("text-danger");
    expect(screen.getByText("Prénom")).not.toHaveClass("text-danger");
  });

  it("does not render an asterisk for optional fields", () => {
    render(
      <Field label="Téléphone" htmlFor="phone">
        <input id="phone" />
      </Field>,
    );
    expect(screen.queryByTestId("required-mark")).toBeNull();
    expect(screen.getByText("Téléphone").textContent).not.toContain("*");
  });
});
