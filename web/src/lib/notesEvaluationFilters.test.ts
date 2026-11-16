import { describe, expect, it } from "vitest";
import { filterEvaluationsByClassAndType } from "./notesEvaluationFilters";
import type { Evaluation } from "../types";

const rows = [
  { id: "a1", className: "6A", evaluationType: "Devoir" },
  { id: "a2", className: "6A", evaluationType: "Examen" },
  { id: "b1", className: "6B", evaluationType: "Examen" },
  { id: "b2", className: "6B", evaluationType: "Devoir" },
] as Evaluation[];

describe("Notes #1103 — filtres staff", () => {
  it("refuse toute évaluation sans classe sélectionnée", () => {
    expect(filterEvaluationsByClassAndType(rows, "", "")).toEqual([]);
  });
  it("ne mélange jamais deux classes", () => {
    expect(filterEvaluationsByClassAndType(rows, "6A", "").map(r => r.id)).toEqual(["a1", "a2"]);
  });
  it("applique l'intersection classe et type", () => {
    expect(filterEvaluationsByClassAndType(rows, "6B", "Examen").map(r => r.id)).toEqual(["b1"]);
  });
  it("refuse une classe inconnue et un type absent", () => {
    expect(filterEvaluationsByClassAndType(rows, "6C", "")).toEqual([]);
    expect(filterEvaluationsByClassAndType(rows, "6A", "Interrogation")).toEqual([]);
  });
});
