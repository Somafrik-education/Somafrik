import { describe, expect, it } from "vitest";
import { formatFinanceAmount, formatFinanceDate, resolveFinanceCurrency } from "./financeCurrency";

describe("financeCurrency", () => {
  it("prend la première devise canonique fournie", () => {
    expect(resolveFinanceCurrency("", "cdf", "USD")).toBe("CDF");
    expect(resolveFinanceCurrency("FC")).toBe("CDF");
  });

  it("n'invente pas USD/EUR/CDF si le contexte est vide", () => {
    expect(resolveFinanceCurrency(undefined, null, "")).toBe("");
    expect(formatFinanceAmount(12000, "")).toBe("—");
  });

  it("formate montant + devise", () => {
    expect(formatFinanceAmount(25000, "CDF")).toMatch(/25[\s\u00a0]?000 CDF/);
  });

  it("formate les dates de façon cohérente", () => {
    expect(formatFinanceDate("2026-08-19")).toBe("19/08/2026");
    expect(formatFinanceDate("19-08-2026")).toBe("19/08/2026");
    expect(formatFinanceDate("")).toBe("—");
  });
});
