import { describe, it, expect } from "vitest";

import { prepareContactForSave, validateContactDuplicate } from "../src/lib/contacts";
import type { BackOfficeState } from "../src/types";

const state = {
  schools: [{ code: "SCH1", name: "École 1" }],
} as BackOfficeState;

describe("contacts", () => {
  it("prépare un contact valide pour sauvegarde", () => {
    const prepared = prepareContactForSave(
      {
        lastName: " Kabila ",
        firstName: " Marie ",
        contactType: "Parent",
        schoolCode: "SCH1",
        phone: "+243820111111",
        email: "parent@test.app",
      },
      state,
    );
    expect(prepared.lastName).toBe("Kabila");
    expect(prepared.firstName).toBe("Marie");
    expect(prepared.accountName).toBe("École 1");
    expect(prepared.status).toBe("Actif");
  });

  it("rejette un doublon téléphone dans le même compte", () => {
    const result = validateContactDuplicate(
      { schoolCode: "SCH1", phone: "+243820111111" },
      [{ id: "C1", schoolCode: "SCH1", phone: "+243820111111" }],
    );
    expect(result.block).toMatch(/téléphone/i);
  });

  it("rejette un doublon email dans le même compte", () => {
    const result = validateContactDuplicate(
      { schoolCode: "SCH1", email: "parent@test.app" },
      [{ id: "C1", schoolCode: "SCH1", email: "parent@test.app" }],
    );
    expect(result.block).toMatch(/email/i);
  });

  it("avertit pour un téléphone déjà utilisé dans un autre compte", () => {
    const result = validateContactDuplicate(
      { schoolCode: "SCH2", phone: "+243820111111" },
      [{ id: "C1", schoolCode: "SCH1", phone: "+243820111111" }],
    );
    expect(result.warn).toMatch(/autre compte/i);
  });

  it("accepte un contact sans doublon", () => {
    expect(
      validateContactDuplicate(
        { schoolCode: "SCH1", phone: "+243820999999", email: "nouveau@test.app" },
        [{ id: "C1", schoolCode: "SCH1", phone: "+243820111111" }],
      ),
    ).toEqual({});
  });
});
