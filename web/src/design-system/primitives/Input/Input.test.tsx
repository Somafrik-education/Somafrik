import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("forwards disabled and aria-disabled", () => {
    render(<Input aria-label="Nom" disabled />);
    const input = screen.getByRole("textbox", { name: "Nom" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-disabled", "true");
  });
});
