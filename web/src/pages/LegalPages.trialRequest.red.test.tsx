import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PrivacyPolicyPage } from "./LegalPages";

describe("Politique de confidentialité — prospects essai (RED)", () => {
  it("annonce le traitement des demandes d'essai et la rétention 24 mois", () => {
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    );
    const text = document.body.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeInTheDocument();
    expect(text).toMatch(/demande d.essai|essai gratuit/i);
    expect(text).toMatch(/24 mois/);
    expect(text).toMatch(/contact@somafrik\.app/);
  });
});
