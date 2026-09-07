import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PrivacyPolicyPage } from "./LegalPages";

describe("RED — politique : notification e-mail des demandes d’essai", () => {
  it("informe qu’une demande d’essai notifie contact@somafrik.app par e-mail transactionnel", () => {
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    );
    const text = document.body.textContent ?? "";
    expect(text).toMatch(
      /un e-mail de notification est envoyé à contact@somafrik\.app/i,
    );
    expect(text).not.toMatch(
      /pas de SMS, WhatsApp ou e-mail transactionnel embarqué/i,
    );
    expect(text).not.toMatch(/docs\/compliance/);
  });
});
