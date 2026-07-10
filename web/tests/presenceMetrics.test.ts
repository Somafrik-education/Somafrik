import { describe, it, expect } from "vitest";

import {
  normalizePresenceStatus,
  getPresenceStats,
  presenceMatchesStudent,
  sameAttendanceDay,
} from "../src/lib/presenceMetrics";

describe("presenceMetrics", () => {
  it("enregistre un élève présent", () => {
    expect(normalizePresenceStatus({ status: "Présent" })).toBe("Présent");
    expect(normalizePresenceStatus({ present: true })).toBe("Présent");
  });

  it("enregistre un élève absent", () => {
    expect(normalizePresenceStatus({ status: "Absent" })).toBe("Absent");
    expect(normalizePresenceStatus({ present: false })).toBe("Absent");
  });

  it("enregistre un élève en retard", () => {
    expect(normalizePresenceStatus({ status: "Retard" })).toBe("Retard");
  });

  it("enregistre un élève excusé", () => {
    expect(normalizePresenceStatus({ status: "Justifié" })).toBe("Justifié");
  });

  it("calcule les statistiques de présence", () => {
    const presences = [
      { status: "Présent" },
      { status: "Absent" },
      { status: "Retard" },
      { status: "Justifié" },
    ];
    const stats = getPresenceStats(presences);
    expect(stats.present).toBe(1);
    expect(stats.absent).toBe(1);
    expect(stats.late).toBe(1);
    expect(stats.justified).toBe(1);
    expect(stats.rate).toBe(50);
  });

  it("associe une présence à un élève via matricule ou id", () => {
    expect(
      presenceMatchesStudent({ studentId: "ELE-001" }, { id: "STU-1", matricule: "ELE-001" }),
    ).toBe(true);
    expect(
      presenceMatchesStudent({ studentId: "STU-2" }, { id: "STU-1", matricule: "ELE-001" }),
    ).toBe(false);
  });

  it("compare les dates d'appel sur le même jour", () => {
    expect(sameAttendanceDay("10-07-2026", "10-07-2026")).toBe(true);
    expect(sameAttendanceDay("10-07-2026", "11-07-2026")).toBe(false);
  });
});
