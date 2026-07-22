import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm, Modal } from "./index";

describe("Modal", () => {
  it("renders dialog when open and closes via Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Titre" onClose={onClose}>
        Contenu
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Contenu");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("returns null when closed", () => {
    const { container } = render(
      <Modal open={false} title="X" onClose={() => undefined}>
        Hidden
      </Modal>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

function ConfirmProbe() {
  const { confirm } = useConfirm();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm({ title: "Supprimer ?", tone: "danger", confirmLabel: "Oui" });
      }}
    >
      Ask
    </button>
  );
}

describe("ConfirmDialog", () => {
  it("opens confirm modal from useConfirm", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <ConfirmProbe />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Supprimer ?");
    expect(screen.getByRole("button", { name: "Oui" })).toBeInTheDocument();
  });
});
