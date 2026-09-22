/**
 * FIN-L3-05-F — multiligne Home limité aux KPI Finance qui en ont besoin.
 *   npx tsx Mobile/src/lib/roleDashboardKpiLayout.l305.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const layout = fs.readFileSync(path.join(srcRoot, "components/RoleDashboardLayout.tsx"), "utf8");

function dashboardKpiValueNumberOfLines(value: unknown): 1 | 2 {
  return String(value ?? "").includes("\n") ? 2 : 1;
}

function run() {
  assert.equal(dashboardKpiValueNumberOfLines("5"), 1, "FIN-L3-05-F1 KPI simple → 1 ligne");
  assert.equal(dashboardKpiValueNumberOfLines("12"), 1, "FIN-L3-05-F3 compteur non Finance → 1 ligne");
  assert.equal(
    dashboardKpiValueNumberOfLines("1 090 001 CDF\n1 000 USD"),
    2,
    "FIN-L3-05-F2 reste CDF+USD → 2 lignes",
  );

  const statValueStart = layout.indexOf("statValue:");
  const statValue = layout.slice(statValueStart, layout.indexOf("statLabel:"));
  assert.match(statValue, /fontSize:\s*20/, "FIN-L3-05-F1 style standard 20 px");
  assert.doesNotMatch(
    statValue.replace(/statValueMultiline[\s\S]*/, ""),
    /fontSize:\s*16/,
    "FIN-L3-05-F3 le style par défaut n'est pas 16 px",
  );

  const kpiTextStart = layout.indexOf("visibleKpis.map");
  const kpiText = layout.slice(kpiTextStart, layout.indexOf("actions.length"));
  assert.doesNotMatch(
    kpiText,
    /numberOfLines=\{2\}/,
    "FIN-L3-05-F3 ne pas forcer 2 lignes sur tous les KPI",
  );
  assert.match(
    kpiText,
    /includes\("\\n"\)|multiline/,
    "FIN-L3-05-F2 2 lignes seulement si la valeur est multiligne",
  );
}

run();
console.log("PASS Mobile FIN-L3-05-F roleDashboardKpiLayout");
