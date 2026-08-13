import { describe, expect, it } from "vitest";
import { stripClientStudentsFromPutPayload } from "./stripClientStudents";

describe("stripClientStudentsFromPutPayload", () => {
  it("retire students d'un snapshot complet", () => {
    expect(
      stripClientStudentsFromPutPayload({
        students: [{ id: "STUDENT-HACK" }],
        users: [{ id: "USER-OK" }],
      }),
    ).toEqual({ users: [{ id: "USER-OK" }] });
  });

  it("retire students même vide ou null", () => {
    expect(stripClientStudentsFromPutPayload({ students: [], notes: [] })).toEqual({ notes: [] });
    expect(stripClientStudentsFromPutPayload({ students: null, notes: [] })).toEqual({ notes: [] });
  });

  it("conserve la même référence si students est absent", () => {
    const payload = { notes: [] };
    expect(stripClientStudentsFromPutPayload(payload)).toBe(payload);
  });
});
