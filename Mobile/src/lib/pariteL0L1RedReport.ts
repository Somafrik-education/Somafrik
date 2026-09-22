/**
 * Harnais tests rouges L0/L1 — sortie machine pour le vérificateur 22/22.
 */
export type RedCase = { id: string; title: string; run: () => void };

export type RedReport = {
  lot: "L0" | "L1";
  expectedIds: string[];
  failedIds: string[];
  passedIds: string[];
  failed: { id: string; title: string; message: string }[];
};

export const L0_EXPECTED_IDS = [
  "L0-01",
  "L0-02",
  "L0-03",
  "L0-04",
  "L0-05",
  "L0-06",
  "L0-07",
  "L0-08",
  "L0-09",
  "L0-10",
  "L0-11",
  "L0-12",
] as const;

export const L1_EXPECTED_IDS = [
  "L1-01",
  "L1-02",
  "L1-03",
  "L1-04",
  "L1-05",
  "L1-06",
  "L1-07",
  "L1-08",
  "L1-09",
  "L1-10",
] as const;

export function runRedCases(lot: "L0" | "L1", expectedIds: readonly string[], cases: RedCase[]): RedReport {
  const caseIds = cases.map((item) => item.id);
  if (JSON.stringify(caseIds) !== JSON.stringify([...expectedIds])) {
    throw new Error(
      `${lot} : identifiants déclarés ${JSON.stringify(caseIds)} ≠ attendus ${JSON.stringify(expectedIds)}`,
    );
  }

  const failed: RedReport["failed"] = [];
  const passedIds: string[] = [];

  for (const testCase of cases) {
    try {
      testCase.run();
      passedIds.push(testCase.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: testCase.id, title: testCase.title, message });
    }
  }

  const report: RedReport = {
    lot,
    expectedIds: [...expectedIds],
    failedIds: failed.map((item) => item.id),
    passedIds,
    failed,
  };

  console.log(`parite ${lot} — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
  for (const id of passedIds) console.log(`  PASS ${id}`);
  for (const item of failed) {
    console.error(`  FAIL [${item.id}] ${item.title}\n    ${item.message}`);
  }
  console.log(`PARITE_RED_REPORT ${JSON.stringify({
    lot: report.lot,
    expectedIds: report.expectedIds,
    failedIds: report.failedIds,
    passedIds: report.passedIds,
  })}`);

  return report;
}
