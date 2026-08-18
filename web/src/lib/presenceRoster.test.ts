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
