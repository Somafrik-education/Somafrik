import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser } from "../types";
import { courseOptionsForClass, subjectOptionsForClass } from "./evaluations";

const emptyState = {
  courses: [],
  assignments: [],
  classes: [],
} as unknown as BackOfficeState;

const CLASS_A = "uuid-a";
const CLASS_B = "uuid-b";
const CODE_A = "CLS-2A";
const CODE_B = "CLS-2B";

function sekeUser(assignments: Record<string, unknown>[]): SessionUser {
  return {
    id: "ens-seke",
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    assignments,
  };
}

const sekeTwoCourses: Record<string, unknown>[] = [
  {
    classId: CLASS_A,
    classCode: CODE_A,
    className: "2ème A",
    course: "Mathématiques",
    status: "active",
  },
  {
    classId: CLASS_A,
    classCode: CODE_A,
    className: "2ème A",
    course: "Physique",
    status: "active",
  },
];

describe("courseOptionsForClass — JWT enseignant (P0 Notes)", () => {
  it("A — JWT 2 cours actifs même classe, state.assignments=[] state.courses=[] → 2 options", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser(sekeTwoCourses),
      schoolCode: "CD-2026-0001",
      classId: CLASS_A,
      classCode: CODE_A,
      className: "2ème A",
    });
    expect(options).toEqual(["Mathématiques", "Physique"]);
  });

  it("A bis — Seke via className seul, catalogues globaux vides → 2 cours (identité unique)", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser(sekeTwoCourses),
      schoolCode: "CD-2026-0001",
      className: "2ème A",
    });
    expect(options).toEqual(["Mathématiques", "Physique"]);
  });

  it("B — affectation inactive → cours absent", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser([
        ...sekeTwoCourses,
        {
          classId: CLASS_A,
          classCode: CODE_A,
          className: "2ème A",
          course: "Chimie",
          status: "inactive",
        },
      ]),
      schoolCode: "CD-2026-0001",
      classId: CLASS_A,
      className: "2ème A",
    });
    expect(options).toEqual(["Mathématiques", "Physique"]);
    expect(options).not.toContain("Chimie");
  });

  it("C — affectation d'une autre classe → cours absent", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser([
        {
          classId: CLASS_B,
          classCode: CODE_B,
          className: "2ème B",
          course: "Histoire",
          status: "active",
        },
        sekeTwoCourses[0],
      ]),
      schoolCode: "CD-2026-0001",
      classId: CLASS_A,
      className: "2ème A",
    });
    expect(options).toEqual(["Mathématiques"]);
    expect(options).not.toContain("Histoire");
  });

  it("D — même cours présent deux fois → une seule option", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser([
        sekeTwoCourses[0],
        { ...sekeTwoCourses[0], id: "dup-math" },
      ]),
      schoolCode: "CD-2026-0001",
      classId: CLASS_A,
      className: "2ème A",
    });
    expect(options).toEqual(["Mathématiques"]);
  });

  it("E — deux classes homonymes UUID différents → ne pas mélanger les cours", () => {
    const user = sekeUser([
      {
        classId: CLASS_A,
        classCode: CODE_A,
        className: "2ème A",
        course: "Mathématiques",
        status: "active",
      },
      {
        classId: CLASS_B,
        classCode: CODE_B,
        className: "2ème A",
        course: "Histoire",
        status: "active",
      },
    ]);
    expect(
      courseOptionsForClass({
        state: emptyState,
        user,
        schoolCode: "CD-2026-0001",
        classId: CLASS_A,
        className: "2ème A",
      }),
    ).toEqual(["Mathématiques"]);
    expect(
      courseOptionsForClass({
        state: emptyState,
        user,
        schoolCode: "CD-2026-0001",
        classId: CLASS_B,
        className: "2ème A",
      }),
    ).toEqual(["Histoire"]);
  });

  it("F — enseignant avec Math + Physique même classId → 2 cours", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser(sekeTwoCourses),
      schoolCode: "CD-2026-0001",
      classId: CLASS_A,
    });
    expect(options).toHaveLength(2);
    expect(options).toEqual(["Mathématiques", "Physique"]);
  });

  it("G — Admin/Préfet → catalogue classe continue de fonctionner", () => {
    const catalog = {
      courses: [
        { schoolCode: "CD-2026-0001", className: "2ème A", name: "Français" },
        { schoolCode: "CD-2026-0001", className: "2ème A", name: "Anglais" },
      ],
      assignments: [],
      classes: [],
    } as unknown as BackOfficeState;
    const admin = courseOptionsForClass({
      state: catalog,
      user: { id: "admin-1", role: "Admin School", schoolCode: "CD-2026-0001" },
      schoolCode: "CD-2026-0001",
      className: "2ème A",
    });
    const prefet = courseOptionsForClass({
      state: catalog,
      user: { id: "prefet-1", role: "Préfet des études", schoolCode: "CD-2026-0001" },
      schoolCode: "CD-2026-0001",
      className: "2ème A",
    });
    expect(admin).toEqual(["Anglais", "Français"]);
    expect(prefet).toEqual(["Anglais", "Français"]);
  });

  it("H — aucun cours affecté → liste vide, pas de fallback catalogue global", () => {
    const poisoned = {
      courses: [{ schoolCode: "CD-2026-0001", className: "2ème A", name: "Philosophie" }],
      assignments: [
        {
          teacherId: "autre-ens",
          classId: CLASS_A,
          className: "2ème A",
          course: "SVT",
          status: "active",
        },
      ],
      classes: [],
    } as unknown as BackOfficeState;
    const options = courseOptionsForClass({
      state: poisoned,
      user: sekeUser([]),
      schoolCode: "CD-2026-0001",
      classId: CLASS_A,
      className: "2ème A",
    });
    expect(options).toEqual([]);
    expect(options).not.toContain("Philosophie");
    expect(options).not.toContain("SVT");
  });

  it("ignore une affectation className-only sans classId/classCode", () => {
    const options = courseOptionsForClass({
      state: emptyState,
      user: sekeUser([
        { className: "2ème A", course: "Intrus", status: "active" },
        sekeTwoCourses[0],
      ]),
      schoolCode: "CD-2026-0001",
      className: "2ème A",
    });
    expect(options).toEqual(["Mathématiques"]);
    expect(options).not.toContain("Intrus");
  });

  it("subjectOptionsForClass reste un alias Cours (compat P1)", () => {
    expect(
      subjectOptionsForClass(emptyState, "CD-2026-0001", "2ème A", sekeUser(sekeTwoCourses)),
    ).toEqual(["Mathématiques", "Physique"]);
  });
});
