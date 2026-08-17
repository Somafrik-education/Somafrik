import { describe, expect, it } from "vitest";
import { getSchoolAcademicLists } from "./academicConfig";

describe("getSchoolAcademicLists — fail-closed multi-pays", () => {
  it("ne substitue aucun DEFAULT_LEVELS / DEFAULT_TRACKS quand l'activation est vide", () => {
    const lists = getSchoolAcademicLists({ academicConfigs: { "BI-1": {} } }, "BI-1");
    expect(lists.levels).toEqual([]);
    expect(lists.tracks).toEqual([]);
  });

  it("projette uniquement les listes canoniques présentes", () => {
    const lists = getSchoolAcademicLists(
      {
        academicConfigs: {
          "CD-1": { levels: ["4ème"], tracks: ["Scientifique"] },
        },
      },
      "CD-1",
    );
    expect(lists.levels).toEqual(["4ème"]);
    expect(lists.tracks).toEqual(["Scientifique"]);
  });
});
