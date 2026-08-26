/**
 * Densité KPI écran Paiements élève — layout only.
 *   npx tsx Mobile/src/lib/studentPaymentsKpiDensity.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_BODY_FONT_SIZE } from "./mobileAccessibilitySpec";
import { RESPONSIVE_VIEWPORTS } from "./responsiveMobileSpec";
import {
  estimateStudentPaymentsKpiStackHeight,
  STUDENT_PAYMENTS_KPI_DENSITY,
} from "./studentSubScreensSpec";

/** Densité historique (summaryCard 22/34 + cartes 16/18). */
const LEGACY_KPI_DENSITY = {
  heroPaddingVertical: 22,
  heroLabelFontSize: 15,
  heroValueFontSize: 34,
  heroValueMarginTop: 6,
  heroMarginBottom: 18,
  kpiPaddingVertical: 16,
  kpiLabelFontSize: 14,
  kpiValueFontSize: 18,
  kpiValueMarginTop: 6,
  kpiGap: 12,
  kpiBlockMarginBottom: 18,
};

/** Chrome hors KPI : retour, switcher, titre, élève, CTA « Saisir un paiement ». */
const HEADER_CHROME_PX = 320;

function readStudentPaymentsScreen() {
  const candidates = [
    join(process.cwd(), "Mobile/src/screens/StudentPaymentsScreen.tsx"),
    join(process.cwd(), "src/screens/StudentPaymentsScreen.tsx"),
  ];
  const path = candidates.find((item) => existsSync(item));
  assert.ok(path, "StudentPaymentsScreen.tsx introuvable");
  return readFileSync(path, "utf8");
}

function run() {
  const next = estimateStudentPaymentsKpiStackHeight();
  const previous = estimateStudentPaymentsKpiStackHeight(LEGACY_KPI_DENSITY);

  assert.equal(next, estimateStudentPaymentsKpiStackHeight(STUDENT_PAYMENTS_KPI_DENSITY));
  assert.ok(next < previous, `bloc KPI plus compact (${next}px vs ${previous}px)`);
  assert.ok(previous - next >= 100, `gain vertical insuffisant: ${previous - next}px`);
  assert.ok(next <= 160, `bloc KPI trop haut pour un petit Android: ${next}px`);

  const density = STUDENT_PAYMENTS_KPI_DENSITY;
  assert.ok(density.heroLabelFontSize >= MIN_BODY_FONT_SIZE);
  assert.ok(density.kpiLabelFontSize >= MIN_BODY_FONT_SIZE);
  assert.ok(density.kpiValueFontSize >= MIN_BODY_FONT_SIZE);
  assert.ok(density.heroValueFontSize > density.kpiValueFontSize);

  const smallAndroid = RESPONSIVE_VIEWPORTS.find((item) => item.category === "small-android");
  const mediumAndroid = RESPONSIVE_VIEWPORTS.find((item) => item.category === "large-android");
  assert.ok(smallAndroid && mediumAndroid);

  for (const viewport of [smallAndroid, mediumAndroid]) {
    const peek = viewport.height - HEADER_CHROME_PX - next;
    const legacyPeek = viewport.height - HEADER_CHROME_PX - previous;
    assert.ok(peek > legacyPeek, `${viewport.name}: historique plus visible (${peek}px vs ${legacyPeek}px)`);
    assert.ok(peek >= 80, `${viewport.name}: premier reçu trop bas (${peek}px)`);
  }

  const screen = readStudentPaymentsScreen();
  assert.match(screen, /getPaymentRateKpi\(studentFees\)/);
  assert.match(screen, /getPaymentCashKpi\(paiementsEleve\)/);
  assert.match(screen, /ListHeaderComponent=\{financeHeader\}/);
  assert.match(screen, /Frais scolaires attendus/);
  assert.match(screen, /label="Imputé"/);
  assert.match(screen, /label="Reste à payer"/);
  assert.match(screen, /label="Encaissé"/);
  assert.match(screen, /label="Non imputé"/);
  assert.match(screen, /STUDENT_SUB_SCREENS_COPY\.paymentsSectionTitle/);
  assert.doesNotMatch(screen, /styles\.summaryCard/);
  assert.doesNotMatch(screen, /styles\.summaryValue/);
  assert.match(screen, /Math\.max\(0, paymentRateKpi\.expectedAmount - paymentRateKpi\.collectedAmount\)/);

  console.log(`OK: KPI ${previous}px → ${next}px (gain ${previous - next}px)`);
}

run();
