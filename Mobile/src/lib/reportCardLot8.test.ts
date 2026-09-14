/**
 * LOT 8 — Mobile Bulletins natif (guards + renderer).
 *
 *   npx --yes tsx --test Mobile/src/lib/reportCardLot8.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const LOT8_FILES = [
  "Mobile/src/lib/reportCardPublicationApi.ts",
  "Mobile/src/lib/reportCardSnapshotDisplay.ts",
  "Mobile/src/components/bulletin/ReportCardSnapshotView.tsx",
  "Mobile/src/screens/ReportCardsScreen.tsx",
];

const BRANCH_IDENT =
  "(?:country|countryCode|country_code|iso_code|isoCode|school|schoolCode|school_code|schoolName|school_name)";

const FORBIDDEN_BRANCH = [
  new RegExp(String.raw`if\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`switch\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`\b${BRANCH_IDENT}\s*===?\s*['"]`),
  new RegExp(String.raw`['"][^'"]+['"]\s*===?\s*${BRANCH_IDENT}\b`),
];

function readRel(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) acc.push(full);
  }
  return acc;
}

function requireLot8Files() {
  for (const rel of LOT8_FILES) {
    assert.equal(existsSync(path.join(ROOT, rel)), true, `missing ${rel} (RED)`);
  }
}

test("report-card-lot8-mobile-list-tenant-scoped", () => {
  requireLot8Files();
  const api = readRel("Mobile/src/lib/reportCardPublicationApi.ts");
  assert.match(api, /\/report-card\/publications/);
  assert.equal(api.includes('"/report-cards"') || api.includes("'/report-cards'"), false);
  assert.equal(/schoolId\s*:/.test(api) && /query/.test(api), false);
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  assert.match(screen, /listReportCardPublications|reportCardPublicationApi|\/report-card\/publications/);
});

test("report-card-lot8-mobile-published-snapshot-only", () => {
  requireLot8Files();
  const api = readRel("Mobile/src/lib/reportCardPublicationApi.ts");
  assert.match(api, /\/report-card\/publications\/.+snapshot|publications\/\$\{.*\}\/snapshot/);
  assert.doesNotMatch(api, /computeReportCard/);
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  assert.match(screen, /template=\{/);
  assert.doesNotMatch(screen, /getReportCards/);
});

test("report-card-lot8-mobile-no-live-grade-fallback", () => {
  requireLot8Files();
  const api = readRel("Mobile/src/lib/reportCardPublicationApi.ts");
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  const joined = `${api}\n${screen}`;
  assert.equal(joined.includes("/report-cards"), false);
  assert.equal(joined.includes("/students/") && joined.includes("report.pdf"), false);
  assert.doesNotMatch(screen, /getReportCards/);
  assert.doesNotMatch(screen, /card\.average/);
  assert.doesNotMatch(api, /raw_score/);
});

test("report-card-lot8-mobile-no-recalculation", () => {
  requireLot8Files();
  for (const rel of LOT8_FILES) {
    const src = readRel(rel);
    assert.equal(src.includes("computeReportCard"), false, rel);
    assert.equal(/\braw_score\b/.test(src), false, rel);
    assert.equal(/\bpass_rule\b/.test(src), false, rel);
    assert.equal(src.includes("weighted_sum"), false, rel);
  }
});

test("report-card-lot8-mobile-render-total-percentage-rank-decision-presence", async () => {
  requireLot8Files();
  const display = readRel("Mobile/src/lib/reportCardSnapshotDisplay.ts");
  assert.match(display, /TOTAL/);
  assert.match(display, /PERCENTAGE/);
  assert.match(display, /RANK/);
  assert.match(display, /DECISION/);
  assert.match(display, /presence/);
  const mod = await import("./reportCardSnapshotDisplay");
  const student = {
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
  };
  const text = mod.formatStudentSnapshot(student);
  assert.match(text, /TOTAL/);
  assert.match(text, /99\.00/);
  assert.match(text, /PERCENTAGE/);
  assert.match(text, /70/);
  assert.match(text, /RANK/);
  assert.match(text, /DECISION/);
  assert.match(text, /PASS/);
  assert.match(text, /APPLICABILITY/);
  assert.equal(text.includes("111"), false);
});

test("report-card-lot8-mobile-pdf-reuses-lot5", () => {
  requireLot8Files();
  const api = readRel("Mobile/src/lib/reportCardPublicationApi.ts");
  assert.match(api, /\/report-card\/publications\/.+pdf|publications\/\$\{.*\}\/pdf/);
  assert.match(api, /downloadReportCardPdf|FileSystem\.downloadAsync|downloadAsync/);
  assert.doesNotMatch(api, /students\/\$\{.*\}\/report\.pdf/);
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  assert.match(screen, /downloadReportCardPdf/);
});

test("report-card-lot8-mobile-rbac-server-authoritative", () => {
  requireLot8Files();
  const api = readRel("Mobile/src/lib/reportCardPublicationApi.ts");
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  const joined = `${api}\n${screen}`;
  assert.equal(joined.includes("REPORT_CARD_CONFIGURE"), false);
  assert.equal(joined.includes("REPORT_CARD_PUBLISH"), false);
  assert.doesNotMatch(screen, /role\s*===\s*["']Admin School["']/);
  assert.doesNotMatch(api, /method:\s*["']POST["']/);
  assert.doesNotMatch(api, /method:\s*["']PUT["']/);
  assert.doesNotMatch(api, /method:\s*["']PATCH["']/);
  assert.doesNotMatch(api, /method:\s*["']DELETE["']/);
});

test("report-card-lot8-mobile-loading-empty-error-states", () => {
  requireLot8Files();
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  const copy = readRel("Mobile/src/lib/dataTruth.ts");
  assert.match(screen, /QueryStateView/);
  assert.match(`${screen}\n${copy}`, /forbiddenBulletins|Accès refusé/);
  assert.match(`${screen}\n${copy}`, /notFoundBulletins|introuvable/);
  assert.match(`${screen}\n${copy}`, /serverErrorBulletins|errorBulletins/);
  assert.match(screen, /emptyBulletins|emptyMessage/);
});

test("report-card-lot8-mobile-no-country-school-branch", () => {
  requireLot8Files();
  for (const rel of LOT8_FILES) {
    const src = readRel(rel);
    for (const re of FORBIDDEN_BRANCH) {
      assert.equal(re.test(src), false, `${rel} matched ${re}`);
    }
  }
});

test("report-card-lot8-no-lot9-plus", () => {
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardHistory.tsx")), false);
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardCorrection.tsx")), false);
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardSuperadmin.tsx")), false);
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardVerify.tsx")), false);
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardCountryPack.tsx")), false);
  const bulletinFiles = walk(path.join(ROOT, "Mobile/src")).filter((file) =>
    /reportCard|ReportCard|bulletin/i.test(file),
  );
  const mobileHits = bulletinFiles.filter((file) => {
    const src = readFileSync(file, "utf8");
    return /\/verify\/rc\/|REPORT_CARD_CONFIGURE|ReportCardHistory|publicationHistory|countryPack/.test(src);
  });
  assert.deepEqual(mobileHits, []);
});
