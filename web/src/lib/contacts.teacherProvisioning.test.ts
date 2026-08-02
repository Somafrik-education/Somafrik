import { describe, expect, it } from "vitest";
import { linkContactToOperationalRecord } from "./contacts";
import type { BackOfficeState } from "../types";

const state = (teachers: Record<string, unknown>[]): BackOfficeState => ({
  users: [],
  contacts: [],
  teachers,
} as unknown as BackOfficeState);

describe("contact teacher provisioning", () => {
  it("ne rattache jamais un homonyme par nom/prénom seuls", () => {
    const result = linkContactToOperationalRecord(
      {
        id: "CONTACT-2",
        contactType: "Enseignant",
        schoolCode: "SCH-001",
        lastName: "Diallo",
        firstName: "Awa",
      },
      state([{ id: "TEACHERS-1", schoolCode: "SCH-001", name: "Diallo", firstName: "Awa" }]),
      "SCH-001",
    );
    expect(result.teachers).toHaveLength(2);
    expect(result.created).toBe(true);
  });

  it("refuse plusieurs fiches portant le même contactId", () => {
    const teachers = [
      { id: "TEACHERS-1", schoolCode: "SCH-001", contactId: "CONTACT-1" },
      { id: "TEACHERS-2", schoolCode: "SCH-001", contactId: "CONTACT-1" },
    ];
    expect(() => linkContactToOperationalRecord(
      { id: "CONTACT-1", contactType: "Enseignant", schoolCode: "SCH-001" },
      state(teachers),
      "SCH-001",
    )).toThrowError(expect.objectContaining({ code: "TEACHER_CANON_AMBIGUOUS" }));
    expect(teachers).toHaveLength(2);
  });
});
