import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PromptProvider, usePrompt } from "./PromptDialog";

function Harness() {
  const { prompt } = usePrompt();
  return (
    <button
      type="button"
      onClick={() =>
        void prompt({
          title: "Réinitialiser le mot de passe",
          placeholder: "Mot de passe temporaire",
          inputType: "password",
          required: true,
        })
      }
    >
      Ouvrir
    </button>
  );
}

describe("PromptDialog — visibilité du mot de passe", () => {
  it("reste masqué par défaut puis peut être affiché sans perdre la saisie", async () => {
    const user = userEvent.setup();
    render(
      <PromptProvider>
        <Harness />
      </PromptProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    const input = screen.getByLabelText(/mot de passe temporaire/i);
    await user.type(input, "Temp#1234");

    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("Temp#1234");

    await user.click(screen.getByRole("button", { name: "Masquer le mot de passe" }));
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("Temp#1234");
  });
});
