import { describe, expect, it } from "vitest";
import { rowsToCsv } from "./csv";
import { formatEntityExportRows } from "./financeExportValues";

const COLUMNS = [
  { key: "reference", header: "Référence" },
  { key: "itemsDetail", header: "Détail" },
  { key: "status", header: "Statut" },
];

describe("exports Paiements — vocabulaire #1041 (LOT 4)", () => {
  it("traduit les statuts persistés comme le tableau, sans « imput » dans le fichier", () => {
    const rows = [
      { reference: "P-1", status: "Non imputé", feeType: "Non imputé" },
      { reference: "P-2", status: "Partiellement imputé", items: [{ feeLabel: "Minerval", amount: 10 }] },
      { reference: "P-3", status: "Payé", itemsDetail: "Minerval" },
      { reference: "P-4", status: "Trop-perçu", itemsDetail: "Minerval" },
    ];
    const out = formatEntityExportRows("payments", rows);
    expect(out.map((row) => row.status)).toEqual(["Non affecté", "Encaissement partiel", "Payé", "Trop-perçu"]);
    expect(out[0].itemsDetail).toBe("Non affecté à un frais");
    const csv = rowsToCsv(out, COLUMNS);
    expect(csv).not.toMatch(/imput/i);
  });

  it("ne modifie pas les lignes source (données persistées intactes)", () => {
    const rows = [{ reference: "P-1", status: "Non imputé" }];
    formatEntityExportRows("payments", rows);
    expect(rows[0].status).toBe("Non imputé");
  });

  it("laisse les autres modules inchangés", () => {
    const rows = [{ status: "Non imputé" }];
    expect(formatEntityExportRows("announcements", rows)).toBe(rows);
  });
});
