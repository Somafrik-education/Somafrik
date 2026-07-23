import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser } from "../types";
import {
  getRelationParentUserOptions,
  prepareRelationForSave,
  resolveParentContactId,
} from "./relations";

const admin = {
  id: "u-admin",
  role: "Admin School",
  schoolCode: "SCH-001",
} as unknown as SessionUser;

const state = {
  schools: [{ code: "SCH-001", name: "École" }],
  users: [
    {
      id: "USER-1",
      contactId: "CNT-1",
      firstName: "Awa",
      lastName: "Diallo",
      role: "Parent",
      schoolCode: "SCH-001",
      identifier: "+2431",
    },
    {
      id: "USER-NO-CONTACT",
      firstName: "Sans",
      lastName: "Contact",
      role: "Parent",
      schoolCode: "SCH-001",
    },
  ],
  students: [{ id: "STU-1", firstName: "Jean", name: "Dupont", schoolCode: "SCH-001" }],
  relations: [],
} as unknown as BackOfficeState;

describe("relations parent identity (D3.4b)", () => {
  it("options parent utilisent contactId et excluent les comptes sans contactId", () => {
    const options = getRelationParentUserOptions(admin, state);
    expect(options).toEqual([
      expect.objectContaining({ value: "CNT-1" }),
    ]);
    expect(options.some((row) => row.value === "USER-1")).toBe(false);
    expect(options.some((row) => row.value === "USER-NO-CONTACT")).toBe(false);
  });

  it("prepareRelationForSave normalise user.id → contact.id", () => {
    const prepared = prepareRelationForSave(
      {
        relationType: "Parent → Élève",
        fromContactId: "USER-1",
        toStudentId: "STU-1",
        status: "Actif",
      },
      state,
    );
    expect(prepared.fromContactId).toBe("CNT-1");
    expect(prepared.fromContactName).toBe("Awa Diallo");
    expect(resolveParentContactId(state, "USER-1")).toBe("CNT-1");
    expect(resolveParentContactId(state, "CNT-1")).toBe("CNT-1");
  });
});
