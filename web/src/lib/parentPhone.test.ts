import { describe, expect, it } from "vitest";
import {
  isValidParentPhoneNumber,
  normalizeOptionalParentPhone,
  PARENT_PHONE_INVALID_MESSAGE,
} from "./parentPhone";

describe("parentPhone", () => {
  it("accepte un numéro international", () => {
    expect(isValidParentPhoneNumber("+243 820 000 001")).toBe(true);
    expect(isValidParentPhoneNumber("+33 6 12 34 56 78")).toBe(true);
    expect(normalizeOptionalParentPhone("").ok).toBe(true);
    expect(normalizeOptionalParentPhone("   ")).toEqual({ ok: true });
  });

  it("refuse une valeur alphabétique", () => {
    expect(isValidParentPhoneNumber("Baudouin OKITO")).toBe(false);
    expect(normalizeOptionalParentPhone("Baudouin OKITO")).toEqual({
      ok: false,
      message: PARENT_PHONE_INVALID_MESSAGE,
    });
  });
});
