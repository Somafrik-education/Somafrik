import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

const payload = {
  report_card_id: "rc-1",
  published_snapshot_version: 1,
  students: [
    {
      student_id: "STU-1",
      cells: [{ subject_id: "MATH", period_id: "T1", score_component_id: "TJ", exposed: "12" }],
      slots: [
        { slot: "TOTAL", exposed: "99.00", section_id: "SUMMARY" },
        { slot: "PERCENTAGE", exposed: "70", section_id: "SUMMARY" },
        { slot: "RANK", exposed: "1", section_id: "SUMMARY" },
        { slot: "DECISION", exposed: "70", passed: true, section_id: "SUMMARY" },
      ],
      presence: [
        {
          section_id: "APPLICABILITY",
          column_id: "COL_EX",
          row_id: "SUBJECT_LINE",
          field_kind: "score",
          field_id: "EX",
          applicable: true,
        },
      ],
    },
  ],
};

const template = {
  paper: "A4",
  orientation: "portrait",
  qr_required: true,
  sections: [
    { id: "SUMMARY", order: 1, label: "Totaux", source: "slots" },
    { id: "SUBJECTS", order: 2, label: "Disciplines", source: "cells" },
    { id: "APPLICABILITY", order: 3, label: "Presence", source: "presence" },
  ],
};

describe("LOT 7 snapshot renderer", () => {
  it("report-card-lot7-web-render-total-percentage-rank-decision-presence", async () => {
    const mod = await import("./ReportCardSnapshotView");
    render(<mod.ReportCardSnapshotView payload={payload} template={template} />);
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
    expect(screen.getByText("99.00")).toBeInTheDocument();
    expect(screen.getByText("PERCENTAGE")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("RANK")).toBeInTheDocument();
    expect(screen.getByText("DECISION")).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
    expect(screen.getByText(/APPLICABILITY/)).toBeInTheDocument();
  });

  it("report-card-lot7-web-published-snapshot-no-recalculation", async () => {
    const mod = await import("./ReportCardSnapshotView");
    render(<mod.ReportCardSnapshotView payload={payload} template={template} />);
    expect(screen.getByText("99.00")).toBeInTheDocument();
    expect(screen.queryByText("111")).not.toBeInTheDocument();
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./ReportCardSnapshotView.tsx", import.meta.url), "utf8"),
    );
    expect(/\+|reduce\(|average|moyenne/i.test(src) && /\braw_score\b/.test(src)).toBe(false);
    expect(src.includes("computeReportCard")).toBe(false);
  });
});
