import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import {
  buildLinkParentPayload,
  defaultLinkParentDraft,
  parentLinkErrorMessage,
  relationIdsFromParentChildRow,
  validateLinkParentDraft,
} from "./linkParentWorkflow";

describe("linkParentWorkflow", () => {
  it("exige élève et identité", () => {
    expect(validateLinkParentDraft(defaultLinkParentDraft(), false)).toMatch(/élève/i);
    expect(
      validateLinkParentDraft({ ...defaultLinkParentDraft(), studentId: "s1" }, false),
    ).toMatch(/téléphone ou un email/i);
    expect(
      validateLinkParentDraft(
        { studentId: "s1", phone: "+243", email: "", firstName: "", lastName: "", relationType: "parent_student" },
        false,
      ),
    ).toMatch(/Nom et prénom/);
    expect(
      validateLinkParentDraft(
        { studentId: "s1", phone: "+243", email: "", firstName: "", lastName: "", relationType: "parent_student" },
        true,
      ),
    ).toBeNull();
  });

  it("normalise le payload métier", () => {
    expect(
      buildLinkParentPayload({
        studentId: " stu ",
        firstName: "Baudouin",
        lastName: "OKITO",
        phone: "+243",
        email: "a@b.c",
      }),
    ).toEqual({
      studentId: "stu",
      firstName: "Baudouin",
      lastName: "OKITO",
      phone: "+243",
      email: "a@b.c",
      relationType: "parent_student",
    });
  });

  it("mappe 409 ambigu et 403", () => {
    expect(parentLinkErrorMessage(new ApiError("x", 409, "PARENT_IDENTITY_AMBIGUOUS"))).toMatch(/deux comptes/);
    expect(parentLinkErrorMessage(new ApiError("nope", 403))).toMatch(/non autorisée/);
    expect(parentLinkErrorMessage(new ApiError("boom", 500))).toMatch(/serveur/i);
  });

  it("extrait les ids de relation du bundle", () => {
    expect(relationIdsFromParentChildRow({ relationIds: ["r1", "r2"] })).toEqual(["r1", "r2"]);
  });
});
