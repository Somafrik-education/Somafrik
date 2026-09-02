import { describe, expect, it } from "vitest";
import { upsertTeacherFromUser } from "./userTeacherSync";
import type { UserAccount } from "../types";

const user = (overrides: Partial<UserAccount> = {}): UserAccount => ({
  id: "USERS-1",
  role: "Enseignant",
  schoolCode: "SCH-001",
  identifier: "ENS-0001",
  firstName: "Ada",
  lastName: "Lovelace",
  status: "Actif",
  ...overrides,
} as UserAccount);

describe("teacher provisioning idempotency", () => {
  it("conserve une seule fiche et le même id après 10 syncs", () => {
    let teachers: Record<string, unknown>[] = [];
    for (let index = 0; index < 10; index += 1) {
      teachers = upsertTeacherFromUser(teachers, user({ contactId: "CONTACT-1" }));
    }
    expect(teachers).toHaveLength(1);
    const id = teachers[0]?.id;
    teachers = upsertTeacherFromUser(teachers, user({ contactId: "CONTACT-1" }));
    expect(teachers[0]?.id).toBe(id);
  });

  it("rattache par contactId unique puis par identifiant métier unique", () => {
    const byContact = upsertTeacherFromUser(
      [{ id: "TEACHERS-contact", contactId: "CONTACT-1", schoolCode: "SCH-001" }],
      user({ id: "USERS-new", contactId: "CONTACT-1" }),
    );
    expect(byContact).toHaveLength(1);
    expect(byContact[0]?.id).toBe("TEACHERS-contact");

    const byIdentifier = upsertTeacherFromUser(
      [{ id: "TEACHERS-identifier", identifier: "ENS-0001", schoolCode: "SCH-001" }],
      user(),
    );
    expect(byIdentifier).toHaveLength(1);
    expect(byIdentifier[0]?.id).toBe("TEACHERS-identifier");
  });

  it("refuse deux candidats fiables sans créer", () => {
    const teachers = [
      { id: "TEACHERS-a", contactId: "CONTACT-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", contactId: "CONTACT-1", schoolCode: "SCH-001" },
    ];
    expect(() => upsertTeacherFromUser(teachers, user({ id: "USERS-new", contactId: "CONTACT-1" })))
      .toThrowError(expect.objectContaining({ code: "TEACHER_CANON_AMBIGUOUS" }));
    expect(teachers).toHaveLength(2);
  });

  it("ne fusionne jamais deux homonymes distincts", () => {
    const next = upsertTeacherFromUser(
      [{ id: "TEACHERS-a", identifier: "ENS-0099", schoolCode: "SCH-001", name: "Lovelace", firstName: "Ada" }],
      user({ id: "USERS-distinct" }),
    );
    expect(next).toHaveLength(2);
  });
});
