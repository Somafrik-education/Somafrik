import { describe, expect, it } from "vitest";
import { activeLinkedParents } from "./studentParentRelations";
import { buildStudentWorkspaceFromDossier } from "./studentDossierFromApi";
import type { SchoolStudent } from "./studentsApi";

const schoolStudent = {
  id: "CD-TEST-01",
  publicId: "CD-TEST-01",
  studentCode: "CD-TEST-01",
  matricule: "CD-TEST-01",
  schoolCode: "CD-2026-0001",
  firstName: "Awa",
  lastName: "Diallo",
  name: "Awa Diallo",
  gender: "F",
  birthDate: "10-02-2010",
  parentPhone: "+243800000001",
  parentEmail: "parent@example.test",
  status: "active",
  enrollmentId: null,
  enrollmentDate: "",
  academicYearName: "2026-2027",
} as SchoolStudent;

describe("FICHE-RESP-02 — affichage Web PostgreSQL strict", () => {
  it("ne fabrique plus de responsable à partir du seul parentPhone historique", () => {
    const result = buildStudentWorkspaceFromDossier({ ...schoolStudent, guardians: [] });
    expect(result?.guardians).toEqual([]);
    expect(result?.overview.guardiansCount).toBe(0);
    expect(result?.overview.hasGuardians).toBe(false);
  });
  it("n'affiche que les relations actives confirmées, sans doubler les identifiants", () => {
    const items = activeLinkedParents([
      { id: "r-1", status: "Actif", name: "Parent A", phone: "01", isPrincipal: "Oui" },
      { id: "r-2", status: "archived", name: "Parent B", phone: "02" },
      { id: "r-1", status: "Actif", name: "Doublon" },
      { id: "r-3", status: "active", firstName: "Tuteur", lastName: "C", email: "c@test.local" },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "r-1", name: "Parent A", isPrincipal: true });
    expect(items[1]).toMatchObject({ id: "r-3", name: "Tuteur C" });
  });
  it("ne transforme pas une réponse invalide ou un statut inconnu en parent", () => {
    expect(activeLinkedParents({ items: [{ id: "fake", status: "Actif" }] })).toEqual([]);
    expect(activeLinkedParents([{ id: "r-3", status: "inconnu" }])).toEqual([]);
    expect(activeLinkedParents([{ id: "r-3", status: "Active?" }])).toEqual([]);
  });
});
