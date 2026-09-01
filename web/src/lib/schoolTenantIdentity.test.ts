import { describe, expect, it } from "vitest";
import {
  attachCanonicalSchoolIdentity,
  resolveSessionSchoolScope,
  schoolCodeKind,
} from "./schoolTenantIdentity";

describe("schoolTenantIdentity", () => {
  it("ne promeut jamais leftover school_code comme autorité", () => {
    expect(schoolCodeKind("CD-2026-0001")).toBe("legacy");
    expect(schoolCodeKind("CD-IN-26-001")).toBe("v2");
    const attached = attachCanonicalSchoolIdentity(
      { schoolCode: "CD-2026-0001", schoolPublicCode: "CD-2026-0001" },
      { code: "CD-2026-0001", loginCode: "CD-IN-26-001", id: "school-a" },
    );
    expect(attached?.schoolId).toBe("school-a");
    expect(attached?.schoolPublicCode).toBe("CD-IN-26-001");
  });

  it("E — session établissement sans schoolId ni login_code → fail closed", () => {
    const scope = resolveSessionSchoolScope({
      role: "Admin School",
      schoolCode: "CD-2026-0001",
    });
    expect(scope).toEqual({ mode: "none", error: "CANONICAL_IDENTITY_MISSING" });
  });
});
