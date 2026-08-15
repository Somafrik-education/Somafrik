import { beforeEach, describe, expect, it } from "vitest";
import { buildCreateUserPayload } from "./clientsApi";

const STORAGE_KEY = "somafrik.activeSchoolCode";

describe("buildCreateUserPayload", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("ajoute le code établissement actif si le formulaire ne le transmet pas", () => {
    sessionStorage.setItem(STORAGE_KEY, "CD-2026-0001");

    expect(buildCreateUserPayload({ firstName: "Huguette", lastName: "MUSOMBWA" })).toMatchObject({
      firstName: "Huguette",
      lastName: "MUSOMBWA",
      schoolCode: "CD-2026-0001",
    });
  });

  it("conserve un schoolCode explicitement fourni", () => {
    sessionStorage.setItem(STORAGE_KEY, "CD-2026-0001");

    expect(buildCreateUserPayload({ schoolCode: "CD-2026-0002" }).schoolCode).toBe("CD-2026-0002");
  });

  it("n'envoie jamais le scope global comme établissement", () => {
    sessionStorage.setItem(STORAGE_KEY, "*");

    expect(buildCreateUserPayload({ firstName: "Awa" })).not.toHaveProperty("schoolCode");
  });
});
