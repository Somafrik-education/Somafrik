import { describe, expect, it } from "vitest";
import { stripClientSchoolsFromPutPayload } from "./stripClientSchools";

describe("stripClientSchoolsFromPutPayload (LOT 1)", () => {
  it("retire schools et conserve subscriptions", () => {
    const payload = {
      schools: [{ code: "CD-2026-0001", name: "Lycée" }],
      subscriptions: [{ id: "SUB-1" }],
    };
    expect(stripClientSchoolsFromPutPayload(payload)).toEqual({
      subscriptions: [{ id: "SUB-1" }],
    });
  });

  it("no-op si schools absent", () => {
    const payload = { users: [{ id: "U-1" }] };
    expect(stripClientSchoolsFromPutPayload(payload)).toEqual(payload);
  });
});
