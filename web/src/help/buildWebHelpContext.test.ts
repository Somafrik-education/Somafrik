import { describe, expect, it } from "vitest";
import { createHelpContext } from "@somafrik/help-catalog";
import { buildWebHelpContext } from "./buildWebHelpContext";

describe("buildWebHelpContext", () => {
  it("exposes only platform, screen, module, role and permissions", () => {
    const context = buildWebHelpContext({
      pathname: "/etablissement/classes",
      role: "Admin School",
      permissions: ["Classes:READ"],
    });
    expect(Object.keys(context).sort()).toEqual(["module", "permissions", "platform", "role", "screen"]);
    expect(context.platform).toBe("web");
    expect(context.role).toBe("SCHOOL_ADMIN");
    expect(context.screen).toBe("classes");
    expect(context.permissions).toEqual(["Classes:READ"]);
    expect(JSON.stringify(context)).not.toMatch(/jwt|accessToken|password|studentId/i);
  });

  it("does not accept JWT, password or studentId in the help context", () => {
    expect(() =>
      createHelpContext({
        platform: "web",
        pathname: "/etablissement/classes",
        role: "Enseignant",
        jwt: "secret",
      } as never),
    ).toThrow(/jwt/i);
    expect(() =>
      createHelpContext({
        platform: "web",
        pathname: "/etablissement/classes",
        role: "Enseignant",
        password: "secret",
      } as never),
    ).toThrow(/password/i);
    expect(() =>
      createHelpContext({
        platform: "web",
        pathname: "/etablissement/eleves",
        role: "Admin School",
        studentId: "stu-1",
      } as never),
    ).toThrow(/studentId/i);
  });
});
