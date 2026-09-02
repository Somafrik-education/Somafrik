import { describe, expect, it } from "vitest";
import { stripClientFinanceFromPutPayload } from "./stripClientFinance";

describe("stripClientFinanceFromPutPayload (LOT 4)", () => {
  it("retire toutes les clés Finance et conserve users", () => {
    const payload = {
      payments: [],
      feeGrids: null,
      users: [{ id: "U-1" }],
      studentFees: {},
    };
    expect(stripClientFinanceFromPutPayload(payload)).toEqual({
      users: [{ id: "U-1" }],
    });
  });

  it("no-op si aucune clé Finance", () => {
    const payload = { users: [{ id: "U-1" }] };
    expect(stripClientFinanceFromPutPayload(payload)).toEqual(payload);
  });
});
