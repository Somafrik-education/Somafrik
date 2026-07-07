import { describe, it, expect } from "vitest";

import type { CourseScheduleSlot } from "../src/data/catalog";
import {
  detectConflicts,
  groupSlotsByDay,
  isExamSlot,
  scopeSlots,
  slotTimeRange,
  weekdayOf,
} from "../src/lib/coursePlanning";

/**
 * Fige les règles de consultation du planning mobile :
 * scoping par école/classe, groupement par jour, et détection des
 * chevauchements enseignant / classe pour la bannière d'alerte.
 */

const base: CourseScheduleSlot = {
  id: "CS-1",
  schoolCode: "CD-2026-0001",
  className: "6ème A",
  subject: "Mathématiques",
  teacherId: "T1",
  teacherName: "Seke Kilombo",
  start: "2026-09-14T10:00:00.000Z", // lundi 10:00
  end: "2026-09-14T11:00:00.000Z",
  kind: "course",
  periodName: "Trimestre 1",
  periodStart: "10-09-2026",
  periodEnd: "23-12-2026",
};

describe("scopeSlots", () => {
  const slots: CourseScheduleSlot[] = [
    base,
    { ...base, id: "CS-2", schoolCode: "CD-2026-0002", className: "5ème B" },
    { ...base, id: "CS-3", className: "5ème B" },
  ];

  it("filtre par établissement", () => {
    const scoped = scopeSlots(slots, { schoolCode: "CD-2026-0001" });
    expect(scoped.map((s) => s.id).sort()).toEqual(["CS-1", "CS-3"]);
  });

  it("filtre par classes autorisées (normalisé)", () => {
    const scoped = scopeSlots(slots, {
      schoolCode: "CD-2026-0001",
      classNames: new Set(["5eme b"]),
    });
    expect(scoped.map((s) => s.id)).toEqual(["CS-3"]);
  });

  it("schoolCode « * » ne filtre pas par école", () => {
    const scoped = scopeSlots(slots, { schoolCode: "*" });
    expect(scoped).toHaveLength(3);
  });
});

describe("groupSlotsByDay", () => {
  it("regroupe par jour et trie par heure de début", () => {
    const slots: CourseScheduleSlot[] = [
      { ...base, id: "A", start: "2026-09-14T14:00:00.000Z", end: "2026-09-14T15:00:00.000Z" },
      { ...base, id: "B", start: "2026-09-14T08:00:00.000Z", end: "2026-09-14T09:00:00.000Z" },
      { ...base, id: "C", start: "2026-09-15T09:00:00.000Z", end: "2026-09-15T10:00:00.000Z" }, // mardi
    ];
    const groups = groupSlotsByDay(slots);
    const monday = groups.find((g) => g.weekday === 1);
    const tuesday = groups.find((g) => g.weekday === 2);
    expect(monday?.slots.map((s) => s.id)).toEqual(["B", "A"]);
    expect(tuesday?.slots.map((s) => s.id)).toEqual(["C"]);
    // Aucun groupe vide n'est renvoyé.
    expect(groups.every((g) => g.slots.length > 0)).toBe(true);
  });
});

describe("detectConflicts — chevauchement enseignant / classe", () => {
  it("détecte la double réservation d'un enseignant (deux classes)", () => {
    const other: CourseScheduleSlot = {
      ...base,
      id: "CS-2",
      className: "5ème B",
      subject: "Physique",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
    };
    const conflicts = detectConflicts([base, other]);
    expect(conflicts.some((c) => c.message.includes("Seke Kilombo"))).toBe(true);
  });

  it("détecte le chevauchement sur une même classe", () => {
    const other: CourseScheduleSlot = {
      ...base,
      id: "CS-2",
      subject: "Français",
      teacherId: "T2",
      teacherName: "Autre Prof",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
    };
    const conflicts = detectConflicts([base, other]);
    expect(conflicts.some((c) => c.message.includes("6ème A"))).toBe(true);
  });

  it("aucun conflit si enseignants et classes diffèrent", () => {
    const other: CourseScheduleSlot = {
      ...base,
      id: "CS-2",
      className: "5ème B",
      subject: "Physique",
      teacherId: "T2",
      teacherName: "Autre Prof",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
    };
    expect(detectConflicts([base, other])).toHaveLength(0);
  });

  it("aucun conflit pour des créneaux adjacents (10-11 / 11-12)", () => {
    const other: CourseScheduleSlot = {
      ...base,
      id: "CS-2",
      className: "5ème B",
      start: "2026-09-14T11:00:00.000Z",
      end: "2026-09-14T12:00:00.000Z",
    };
    expect(detectConflicts([base, other])).toHaveLength(0);
  });

  it("aucun conflit sur des jours de semaine différents", () => {
    const other: CourseScheduleSlot = {
      ...base,
      id: "CS-2",
      className: "5ème B",
      start: "2026-09-15T10:30:00.000Z", // mardi
      end: "2026-09-15T11:30:00.000Z",
    };
    expect(detectConflicts([base, other])).toHaveLength(0);
  });

  it("aucun conflit si les périodes sont disjointes", () => {
    const other: CourseScheduleSlot = {
      ...base,
      id: "CS-2",
      className: "5ème B",
      start: "2026-09-14T10:30:00.000Z",
      end: "2026-09-14T11:30:00.000Z",
      periodName: "Trimestre 2",
      periodStart: "06-01-2027",
      periodEnd: "31-03-2027",
    };
    expect(detectConflicts([base, other])).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("weekdayOf renvoie le jour de semaine (lundi = 1)", () => {
    expect(weekdayOf(base)).toBe(1);
  });

  it("slotTimeRange formate la plage horaire", () => {
    expect(slotTimeRange(base)).toContain("–");
  });

  it("isExamSlot distingue cours et examen", () => {
    expect(isExamSlot(base)).toBe(false);
    expect(isExamSlot({ ...base, kind: "exam" })).toBe(true);
  });
});
