import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ReportCardSnapshotView } from "./ReportCardSnapshotView";

const ROOT = path.resolve(__dirname, "../../../..");
const CATALOG_DIR = path.join(ROOT, "backend/lib/reportCard/qualification");

describe("LOT 10 web snapshot qualification", () => {
  it("report-card-lot10-web-renders-qualified-a-and-b-snapshots", () => {
    const cases = [
      {
        model: "model-a.json",
        must: ["FRANCAIS", "COMPONENT_PERIOD", "Domaines"],
        mustNot: [/^TJ$/],
      },
      {
        model: "model-b.json",
        must: ["TPA", "TJ", "EX", "N/A", "RELIGION_MORALE"],
        mustNot: [/^COMPONENT_PERIOD$/],
      },
    ];
    for (const row of cases) {
      const fixture = JSON.parse(readFileSync(path.join(CATALOG_DIR, row.model), "utf8"));
      const expected = JSON.parse(readFileSync(path.join(CATALOG_DIR, "expected", row.model), "utf8"));
      expect(expected.snapshot?.students?.length, `RED: snapshot golden missing for ${row.model}`).toBeGreaterThan(0);
      const { unmount } = render(
        <ReportCardSnapshotView
          payload={{
            report_card_id: `rc-${row.model}`,
            published_snapshot_version: expected.snapshot.published_snapshot_version || 1,
            students: expected.snapshot.students,
          }}
          template={fixture.template}
        />
      );
      for (const text of row.must) {
        expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
      }
      for (const re of row.mustNot) {
        expect(screen.queryByText(re)).toBeNull();
      }
      unmount();
    }
  });
});
