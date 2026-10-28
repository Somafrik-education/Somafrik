import { describe, expect, it } from "vitest";
import { computeDelinquencyDays, parseSubscriptionDate } from "./subscriptionModule";

// Correctif MONO-T1-A2 : l'API renvoie endDate en ISO « AAAA-MM-JJ ».
describe("dates d'échéance d'abonnement", () => {
  it("lit l'ISO et le français comme le même jour local", () => {
    for (const value of ["2027-08-31", "31-08-2027", "31/08/2027", "2027-08-31T10:00:00"]) {
      const date = parseSubscriptionDate(value);
      expect(date && [date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2027, 7, 31]);
    }
  });

  it("rejette les dates vides ou impossibles", () => {
    for (const value of ["", "pas une date", "31-02-2027", "2027-13-01"]) {
      expect(parseSubscriptionDate(value)).toBeNull();
    }
  });

  it("calcule le retard identiquement en ISO et en français", () => {
    const today = new Date(2027, 8, 10, 12);
    for (const [endDate, expected] of [
      ["2027-12-31", 0],
      ["2027-09-01", 9],
      ["01-09-2027", 9],
    ] as const) {
      expect(computeDelinquencyDays({ endDate } as never, today)).toBe(expected);
    }
  });
});
