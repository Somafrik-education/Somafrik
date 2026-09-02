import { describe, expect, it } from "vitest";
import { buildPresenceClassCards, findPresenceClassCard, toPresenceClassCard } from "./presenceRoster";

describe("presenceRoster — identité classId/classCode", () => {
  it("conserve deux classes homonymes (cas C)", () => {
    const cards = buildPresenceClassCards({
      role: "Admin School",
      classes: [
        { id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 },
        { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "2ème A", students: 0 },
      ],
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.classId).sort()).toEqual(["uuid-a", "uuid-b"]);
    expect(cards.every((card) => card.className === "2ème A")).toBe(true);
    expect(cards.find((card) => card.classId === "uuid-a")?.studentCount).toBe(1);
    expect(cards.find((card) => card.classId === "uuid-b")?.studentCount).toBe(0);
  });

  it("ne fusionne pas par nom et compte depuis le roster PG (students)", () => {
    const cards = buildPresenceClassCards({
      role: "Préfet des études",
      classes: [
        { id: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 },
      ],
    });
    expect(cards[0].studentCount).toBe(1);
    expect(cards[0].classId).toBe("uuid-a");
  });

  it("scope enseignant par class_id, y compris sans className (cas E/F)", () => {
    const assigned = buildPresenceClassCards({
      role: "Enseignant",
      currentUser: { id: "ens-1", role: "Enseignant" },
      classes: [
        { id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 },
        { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "2ème A", students: 4 },
      ],
      assignments: [
        { teacherId: "ens-1", classId: "uuid-a", classCode: "CLS-A", className: "", status: "active" },
      ],
    });
    expect(assigned).toHaveLength(1);
    expect(assigned[0].classId).toBe("uuid-a");

    const denied = buildPresenceClassCards({
      role: "Enseignant",
      currentUser: { id: "ens-2", role: "Enseignant" },
      classes: [{ id: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 }],
      assignments: [{ teacherId: "ens-2", className: "2ème A", status: "active" }],
    });
    expect(denied).toHaveLength(0);
  });

  it("sélectionne par classId, pas par libellé", () => {
    const cards = buildPresenceClassCards({
      classes: [
        { id: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 },
        { id: "uuid-b", classCode: "CLS-B", name: "2ème A", students: 0 },
      ],
    });
    expect(findPresenceClassCard(cards, { classId: "uuid-b" })?.classCode).toBe("CLS-B");
    expect(findPresenceClassCard(cards, { classCode: "CLS-A" })?.classId).toBe("uuid-a");
  });

  it("refuse une carte sans identité stable", () => {
    expect(toPresenceClassCard({ name: "2ème A", students: 3 })).toBeNull();
  });
});

const CLASS_A = { id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 3 };
const CLASS_B = { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "2ème B", students: 2 };
const CLASS_B_HOMONYM = { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "2ème A", students: 2 };

describe("presenceRoster — scope JWT session enseignant", () => {
  it("A — currentUser.assignments canoniques, state.assignments vide, teacherRecord null → 2 cartes", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      assignments: [],
      teacherRecord: null,
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignments: [
          { classId: "uuid-a", classCode: "CLS-A", status: "active" },
          { classId: "uuid-b", classCode: "CLS-B", status: "active" },
        ],
      },
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.classId).sort()).toEqual(["uuid-a", "uuid-b"]);
  });

  it("B — assignedClassIds JWT, state.assignments indisponible → classe A visible", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignedClassIds: ["uuid-a"],
        assignedClassCodes: ["CLS-A"],
      },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].classId).toBe("uuid-a");
  });

  it("C — assignment className-only → aucune autorisation", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      assignments: [],
      teacherRecord: null,
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignments: [{ className: "2ème A", course: "Mathématiques", status: "active" }],
      },
    });
    expect(cards).toHaveLength(0);
  });

  it("D — assignment inactive → classe absente", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      assignments: [],
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignments: [{ classId: "uuid-a", classCode: "CLS-A", status: "inactive" }],
      },
    });
    expect(cards).toHaveLength(0);
  });

  it("E — classe non affectée dans state.classes → non visible", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      assignments: [],
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignments: [{ classId: "uuid-a", classCode: "CLS-A", status: "active" }],
      },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].classId).toBe("uuid-a");
  });

  it("F — même classe + deux matières → une seule carte", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      assignments: [],
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignments: [
          { id: "asg-math", classId: "uuid-a", classCode: "CLS-A", course: "Mathématiques", status: "active" },
          { id: "asg-phys", classId: "uuid-a", classCode: "CLS-A", course: "Physique", status: "active" },
        ],
      },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].classId).toBe("uuid-a");
  });

  it("G — deux classes homonymes UUID distincts → deux cartes", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B_HOMONYM],
      assignments: [],
      currentUser: {
        id: "ens-seke",
        role: "Enseignant",
        assignments: [
          { classId: "uuid-a", classCode: "CLS-A", status: "active" },
          { classId: "uuid-b", classCode: "CLS-B", status: "active" },
        ],
      },
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.classId).sort()).toEqual(["uuid-a", "uuid-b"]);
    expect(cards.every((card) => card.className === "2ème A")).toBe(true);
  });

  it("H — Seke-like : login JWT 2 assignments, GET /api/classes 2, state.assignments []", () => {
    const cards = buildPresenceClassCards({
      role: "Enseignant",
      classes: [CLASS_A, CLASS_B],
      assignments: [],
      teacherRecord: { id: "ENS-0099", assignments: [{ className: "2ème A", course: "Mathématiques" }] },
      currentUser: {
        id: "user-seke",
        role: "Enseignant",
        assignments: [
          { classId: "uuid-a", classCode: "CLS-A", status: "active" },
          { classId: "uuid-b", classCode: "CLS-B", status: "active" },
        ],
        assignedClassIds: ["uuid-a", "uuid-b"],
        assignedClassCodes: ["CLS-A", "CLS-B"],
      },
    });
    expect(cards).toHaveLength(2);
  });
});
