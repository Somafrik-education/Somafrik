import { describe, expect, it } from "vitest";
import { assertNoStrippedCanonicalWrites, strippedTopLevelKeys } from "./canonicalStateWriteGuard";
import type { BackOfficeState } from "../types";

describe("canonicalStateWriteGuard", () => {
  it("détecte les domaines canoniques retirés du patch résiduel", () => {
    const original = {
      users: [{ id: "u-1" }],
      auditLog: [{ id: "a-1" }],
    } as unknown as Partial<BackOfficeState>;
    const residual = {
      auditLog: original.auditLog,
    } as Partial<BackOfficeState>;

    expect(strippedTopLevelKeys(original, residual)).toEqual(["users"]);
    expect(() => assertNoStrippedCanonicalWrites(original, residual)).toThrow(/users/);
  });

  it("autorise un patch strictement résiduel", () => {
    const patch = {
      auditLog: [{ id: "a-1" }],
    } as unknown as Partial<BackOfficeState>;

    expect(() => assertNoStrippedCanonicalWrites(patch, patch)).not.toThrow();
  });
});
