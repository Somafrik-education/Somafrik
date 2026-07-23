import { describe, expect, it } from "vitest";
import { getEntityModule } from "../../lib/entityModules";
import {
  resolveEntitySelectOptions,
  resolveTeacherAssignmentFieldOptions,
  type ResolveEntitySelectOptionsContext,
} from "./entitySelectOptions";

function emptyAcademicLists() {
  return {
    levels: ["6ème", "5ème"],
    tracks: ["Général"],
    classNames: ["6ème A", "5ème B", "Archivée X"],
    subjects: ["Maths", "Français"],
    subjectsByClass: {},
    userRoles: [],
  };
}

function baseCtx(
  overrides: Partial<ResolveEntitySelectOptionsContext> = {},
): ResolveEntitySelectOptionsContext {
  return {
    module: getEntityModule("classes"),
    field: { key: "level", label: "Niveau", optionsKey: "levels" },
    academicLists: emptyAcademicLists(),
    assignmentOptions: null,
    schoolCode: "SCH-001",
    effectiveSchoolCode: "SCH-001",
    editing: null,
    state: {
      classes: [
        { id: "c1", name: "6ème A", schoolCode: "SCH-001", status: "Active" },
        { id: "c2", name: "Archivée X", schoolCode: "SCH-001", status: "Archivée" },
      ],
      students: [],
      teachers: [],
      users: [],
      academicConfigs: {},
    } as unknown as ResolveEntitySelectOptionsContext["state"],
    scopeUser: {
      id: "u1",
      role: "Admin School",
      schoolCode: "SCH-001",
      name: "Admin",
    } as unknown as ResolveEntitySelectOptionsContext["scopeUser"],
    ...overrides,
  };
}

describe("entitySelectOptions (D2.8b)", () => {
  it("résout levels / tracks depuis academicLists", () => {
    const levels = resolveEntitySelectOptions(
      baseCtx({ field: { key: "level", label: "Niveau", optionsKey: "levels" } }),
    );
    expect(levels).toEqual([
      { value: "6ème", label: "6ème" },
      { value: "5ème", label: "5ème" },
    ]);

    const tracks = resolveEntitySelectOptions(
      baseCtx({ field: { key: "track", label: "Filière", optionsKey: "tracks" } }),
    );
    expect(tracks.map((o) => o.value)).toEqual(["Général"]);
  });

  it("pour Classes, ne propose que les classNames encore disponibles", () => {
    const options = resolveEntitySelectOptions(
      baseCtx({
        module: getEntityModule("classes"),
        field: { key: "name", label: "Nom", optionsKey: "classNames" },
        editing: null,
      }),
    );
    // 6ème A et Archivée X existent déjà → seuls les noms non pris restent
    expect(options.map((o) => o.value)).toEqual(["5ème B"]);
  });

  it("filtre les classes archivées hors module Classes (CLASSE-003)", () => {
    const options = resolveEntitySelectOptions(
      baseCtx({
        module: getEntityModule("students"),
        field: { key: "className", label: "Classe", optionsKey: "classNames" },
        editing: { className: "" },
      }),
    );
    expect(options.map((o) => o.value).sort()).toEqual(["5ème B", "6ème A"]);
    expect(options.map((o) => o.value)).not.toContain("Archivée X");
  });

  it("conserve la classe archivée courante à l’édition", () => {
    const options = resolveEntitySelectOptions(
      baseCtx({
        module: getEntityModule("students"),
        field: { key: "className", label: "Classe", optionsKey: "classNames" },
        editing: { className: "Archivée X" },
      }),
    );
    expect(options.map((o) => o.value)).toContain("Archivée X");
  });

  it("retourne selectOptions statiques en priorité", () => {
    const options = resolveEntitySelectOptions(
      baseCtx({
        field: {
          key: "status",
          label: "Statut",
          selectOptions: [
            { value: "Active", label: "Active" },
            { value: "Archivée", label: "Archivée" },
          ],
        },
      }),
    );
    expect(options).toEqual([
      { value: "Active", label: "Active" },
      { value: "Archivée", label: "Archivée" },
    ]);
  });

  it("résout les options d’affectation enseignant (classes / périodes)", () => {
    const classes = resolveTeacherAssignmentFieldOptions({
      field: { key: "className", label: "Classe", optionsKey: "classes" },
      teacherAssignmentOptions: {
        classes: [{ value: "6ème A", label: "6ème A" }],
        subjects: [],
        teachers: [],
      },
      state: {} as ResolveEntitySelectOptionsContext["state"],
      effectiveSchoolCode: "SCH-001",
    });
    expect(classes).toEqual([{ value: "6ème A", label: "6ème A" }]);

    const periods = resolveTeacherAssignmentFieldOptions({
      field: { key: "period", label: "Période", optionsKey: "periods" },
      teacherAssignmentOptions: null,
      state: {
        academicConfigs: {
          "SCH-001": {
            periods: [{ name: "T1" }, { name: "T2" }],
          },
        },
      } as unknown as ResolveEntitySelectOptionsContext["state"],
      effectiveSchoolCode: "SCH-001",
    });
    expect(periods.map((o) => o.value)).toEqual(["T1", "T2"]);
  });
});
