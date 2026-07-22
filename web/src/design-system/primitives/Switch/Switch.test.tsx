import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("exposes role=switch and aria-checked", () => {
    render(<Switch checked={false} aria-label="Notifications" />);
    const el = screen.getByRole("switch", { name: "Notifications" });
    expect(el).toHaveAttribute("aria-checked", "false");
  });

  it("calls onCheckedChange when toggled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Activer" />,
    );
    await user.click(screen.getByRole("switch", { name: "Activer" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
