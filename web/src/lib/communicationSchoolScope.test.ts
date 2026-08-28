import { beforeEach, describe, expect, it } from "vitest";
import {
  hasCommunicationSchoolScope,
  resolveCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "./communicationSchoolScope";

const STORAGE_KEY = "somafrik.activeSchoolCode";

describe("communicationSchoolScope", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("Superadmin + établissement A actif → URLs/payloads contiennent A", () => {
    sessionStorage.setItem(STORAGE_KEY, "SCH-COM-A");
    expect(withCommunicationSchoolScope("/backoffice/messages/recipients")).toBe(
      "/backoffice/messages/recipients?effectiveSchoolCode=SCH-COM-A",
    );
    expect(withCommunicationSchoolScope("/backoffice/conversations")).toContain("effectiveSchoolCode=SCH-COM-A");
    expect(withCommunicationSchoolScope("/backoffice/messages/id/read")).toContain("SCH-COM-A");
    expect(withCommunicationSchoolPayload({ message: "x" })).toMatchObject({
      message: "x",
      effectiveSchoolCode: "SCH-COM-A",
    });
  });

  it("changement actif A → B → appels contiennent B", () => {
    sessionStorage.setItem(STORAGE_KEY, "SCH-COM-A");
    expect(withCommunicationSchoolScope("/backoffice/conversations")).toContain("SCH-COM-A");
    sessionStorage.setItem(STORAGE_KEY, "SCH-COM-B");
    expect(withCommunicationSchoolScope("/backoffice/conversations")).toContain("effectiveSchoolCode=SCH-COM-B");
    expect(withCommunicationSchoolScope("/backoffice/conversations")).not.toContain("SCH-COM-A");
    expect(withCommunicationSchoolPayload({ message: "x" } as Record<string, unknown>).effectiveSchoolCode).toBe(
      "SCH-COM-B",
    );
  });

  it("aucun établissement actif → fail-closed, pas de wildcard", () => {
    expect(hasCommunicationSchoolScope("")).toBe(false);
    expect(hasCommunicationSchoolScope("*")).toBe(false);
    expect(resolveCommunicationSchoolScope("*")).toBe("");
    expect(withCommunicationSchoolScope("/backoffice/conversations", "*")).toBe("/backoffice/conversations");
    expect(withCommunicationSchoolPayload({ message: "x" }, "*")).toEqual({ message: "x" });
  });

  it("School Admin normal → aucun élargissement global", () => {
    expect(withCommunicationSchoolScope("/backoffice/conversations", "CD-2026-0001")).toBe(
      "/backoffice/conversations?effectiveSchoolCode=CD-2026-0001",
    );
    expect(withCommunicationSchoolScope("/backoffice/conversations", "*")).toBe("/backoffice/conversations");
    expect(withCommunicationSchoolPayload({ message: "x" } as Record<string, unknown>, "CD-2026-0001")).toMatchObject({
      effectiveSchoolCode: "CD-2026-0001",
    });
  });
});
