import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AccountDeletionPage, PrivacyPolicyPage } from "./LegalPages";

describe("pages légales publiques", () => {
  it("publie la politique de confidentialité et le contact", () => {
    render(<MemoryRouter><PrivacyPolicyPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "contact@somafrik.app" })).toHaveAttribute("href", "mailto:contact@somafrik.app");
    expect(screen.getAllByText(/Baudouin Okito/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /cnil\.fr/i })).toHaveAttribute("href", expect.stringContaining("cnil.fr"));
    expect(screen.getByRole("link", { name: "Suppression de compte" })).toHaveAttribute("href", "/suppression-compte");
    expect(document.body.textContent).not.toMatch(/docs\/compliance/);
  });

  it("expose une demande de suppression sans mot de passe et décrit la rétention", () => {
    render(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Demander la suppression d’un compte" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Envoyer la demande" })).toHaveAttribute("href", expect.stringMatching(/^mailto:contact@somafrik\.app/));
    expect(screen.getByText(/Ne transmettez jamais votre mot de passe/i)).toBeInTheDocument();
    expect(screen.getByText(/journaux d.audit peuvent être conservés/i)).toBeInTheDocument();
  });
});
