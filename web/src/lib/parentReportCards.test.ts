import { describe, expect, it } from "vitest";
import {
  cardsFromPublishedSnapshot,
  filterParentPublishedReportCards,
  parentReportCardPeriods,
  reportCardRouteMode,
  snapshotForParentStudent,
} from "./parentReportCards";

const childA = {
  id: "stu-a",
  matricule: "ELE-A",
  name: "Enfant A",
};
const childB = {
  id: "stu-b",
  matricule: "ELE-B",
  name: "Enfant B",
};

const snapshot = {
  payload: {
    report_card_id: "rc-1",
    published_snapshot_version: 2,
    published_at: "2026-09-22T10:00:00Z",
    students: [
      {
        student_id: "stu-a",
        cells: [{ subject_id: "MATH", period_id: "T1", exposed: "16" }],
        slots: [{ slot: "PERCENTAGE", exposed: "80%" }],
      },
      {
        student_id: "stu-b",
        cells: [{ subject_id: "MATH", period_id: "T2", exposed: "9" }],
        slots: [{ slot: "PERCENTAGE", exposed: "45%" }],
      },
    ],
  },
  template: {
    sections: [{ id: "SUBJECTS", label: "Disciplines", source: "cells" as const }],
  },
};

describe("parentReportCards — lecture publiée enfant-scopée", () => {
  it("produit uniquement des cartes issues d'un snapshot publié", () => {
    const rows = cardsFromPublishedSnapshot(
      {
        report_card_id: "rc-1",
        published_snapshot_version: 2,
        verification_status: "ACTIVE",
      },
      snapshot,
      [
        {
          report_card_id: "rc-1",
          published_snapshot_version: 2,
          verification_status: "ACTIVE",
        },
      ],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].version).toBe(2);
    expect(rows[0].verificationStatus).toBe("ACTIVE");
    expect(rows[0].period).toBe("T1");
  });

  it("exclut les bulletins d'un autre enfant", () => {
    const rows = cardsFromPublishedSnapshot(
      {
        report_card_id: "rc-1",
        published_snapshot_version: 2,
      },
      snapshot,
    );

    expect(
      filterParentPublishedReportCards(rows, childA).map((row) => row.studentId),
    ).toEqual(["stu-a"]);
    expect(
      filterParentPublishedReportCards(rows, childB).map((row) => row.studentId),
    ).toEqual(["stu-b"]);
  });

  it("filtre par période sans réintroduire un autre enfant", () => {
    const rows = cardsFromPublishedSnapshot(
      {
        report_card_id: "rc-1",
        published_snapshot_version: 2,
      },
      snapshot,
    );

    expect(filterParentPublishedReportCards(rows, childA, "T1")).toHaveLength(1);
    expect(filterParentPublishedReportCards(rows, childA, "T2")).toEqual([]);
    expect(parentReportCardPeriods(rows, childA)).toEqual(["T1"]);
  });

  it("filtre aussi l'aperçu snapshot sur l'enfant sélectionné", () => {
    const scoped = snapshotForParentStudent(snapshot.payload, childA);
    expect(scoped?.students).toHaveLength(1);
    expect(scoped?.students?.[0]?.student_id).toBe("stu-a");
  });

  it("fail-closed sans enfant sélectionné", () => {
    const rows = cardsFromPublishedSnapshot(
      { report_card_id: "rc-1", published_snapshot_version: 2 },
      snapshot,
    );
    expect(filterParentPublishedReportCards(rows, null)).toEqual([]);
    expect(snapshotForParentStudent(snapshot.payload, null)).toBeNull();
  });

  it("sépare strictement route Parent et staff", () => {
    expect(reportCardRouteMode("parent_student")).toBe("parent");
    expect(reportCardRouteMode("Parent")).toBe("parent");
    expect(reportCardRouteMode("Admin School")).toBe("staff");
  });
});
