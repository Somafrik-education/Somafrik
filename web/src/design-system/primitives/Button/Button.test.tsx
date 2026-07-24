import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and defaults to type=button", () => {
    render(<Button>Enregistrer</Button>);
    const btn = screen.getByRole("button", { name: "Enregistrer" });
    expect(btn).toHaveAttribute("type", "button");
  });

  it("applies primary variant by default", () => {
    render(<Button>OK</Button>);
    expect(screen.getByRole("button", { name: "OK" })).toHaveClass("bg-brand");
  });

  it("supports secondary, tertiary and danger variants", () => {
    const { rerender } = render(<Button variant="secondary">S</Button>);
    expect(screen.getByRole("button", { name: "S" })).toHaveClass("border-line");

    rerender(<Button variant="tertiary">T</Button>);
    expect(screen.getByRole("button", { name: "T" })).toHaveClass("text-brand");

    rerender(<Button variant="danger">D</Button>);
    expect(screen.getByRole("button", { name: "D" })).toHaveClass("bg-danger");
  });

  it("maps deprecated ghost alias to tertiary styles", () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button", { name: "Ghost" })).toHaveClass(
      "bg-transparent",
      "text-brand",
    );
  });


  it("respects disabled state", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Off" });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
