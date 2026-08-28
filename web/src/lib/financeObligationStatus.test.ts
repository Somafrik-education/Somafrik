import { describe, expect, it } from "vitest";
import {
  financeObligationStatusKey,
  financeObligationStatusLabel,
  financePaymentStatusLabel,
} from "./financeObligationStatus";

describe("financeObligationStatus", () => {
  it("distingue payé, partiel, impayé et annulé", () => {
    expect(financeObligationStatusLabel("Payé")).toBe("Payé");
    expect(financeObligationStatusLabel("Partiellement payé")).toBe("Partiellement payé");
    expect(financeObligationStatusLabel("À payer")).toBe("Impayé");
    expect(financeObligationStatusLabel("En retard")).toBe("Impayé — échéance dépassée");
    expect(financeObligationStatusLabel("Annulé")).toBe("Annulé");
    expect(financeObligationStatusKey("À payer")).toBe("unpaid");
    expect(financeObligationStatusKey("Partiellement payé")).toBe("partial");
  });

  it("traduit les statuts de paiement", () => {
    expect(financePaymentStatusLabel("paid")).toBe("Payé");
    expect(financePaymentStatusLabel("cancelled")).toBe("Annulé");
    expect(financePaymentStatusLabel("pending")).toBe("En attente");
  });
});
