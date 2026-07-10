import { describe, it, expect } from "vitest";

import { validateUniqueClassName, validateClassDeletion } from "../src/lib/classRules";
import type { BackOfficeState } from "../src/types";

describe("classRules", () => {
  const classes = [
    { id: "CLASS-1", name: "6A", schoolCode: "SCH1" },
    { id: "CLASS-2", name: "6B", schoolCode: "SCH1" },
  ];

  it("accepte une classe valide", () => {
    expect(validateUniqueClassName("5A", classes)).toBeNull();
  });

  it("rejette un nom vide", () => {
    expect(validateUniqueClassName("", classes)).toMatch(/requis/i);
  });

  it("rejette une classe déjà existante dans l'établissement", () => {
    expect(validateUniqueClassName("6A", classes)).toMatch(/existe déjà/i);
  });

  it("autorise la modification de la même classe", () => {
    expect(validateUniqueClassName("6A", classes, "CLASS-1")).toBeNull();
  });

  it("refuse la suppression d'une classe avec élèves", () => {
    const state = {
      students: [{ className: "6A", schoolCode: "SCH1" }],
    } as BackOfficeState;
    expect(validateClassDeletion("6A", state, "SCH1")).toMatch(/élève/i);
  });

  it("autorise la suppression d'une classe vide", () => {
    const state = { students: [] } as BackOfficeState;
    expect(validateClassDeletion("6A", state, "SCH1")).toBeNull();
  });
});
