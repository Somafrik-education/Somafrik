/**
 * BULLETIN-UI-01 — Mobile natif : lecture téléphone d'un bulletin publié.
 *
 *   npx --yes tsx --test Mobile/src/lib/reportCardPresentationMobile.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ANNUAL_VIEW,
  defaultPhoneView,
  phoneReportCard,
  phoneViewOptions,
  reportCardPresentationPath,
  type ReportCardPresentation,
} from "./reportCardPresentationMobile";

const ROOT = path.resolve(__dirname, "../../..");

function berceau(overrides: Partial<ReportCardPresentation> = {}): ReportCardPresentation {
  return {
    official: true,
    style: "hierarchical",
    school: { name: "École Le Berceau de la Sagesse" },
    class_name: "6ème A",
    academic_year: "2026-2027",
    student: { code: "BSG-001", name: "Hakizimana Ama" },
    periods: [
      { id: "T1", label: "Trimestre 1" },
      { id: "T2", label: "Trimestre 2" },
      { id: "T3", label: "Trimestre 3" },
    ],
    components: [
      { id: "TJ", label: "TJ" },
      { id: "EX", label: "EX" },
    ],
    rows: [
      { subject_id: "FRANCAIS", parent_id: null, kind: "composite", level: 0, label: "Français", periods: { T1: { status: "COMPLETE", points: 153, max: 200, percentage: 76.5 } }, annual: { status: "COMPLETE", points: 459, max: 600, percentage: 76.5 } },
      {
        subject_id: "FR_ECRIT", parent_id: "FRANCAIS", kind: "simple", level: 1, label: "Écrit",
        periods: { T1: { status: "COMPLETE", points: 75, max: 100, percentage: 75, components: { TJ: { state: "NUMERIC", value: 30, max: 40 }, EX: { state: "NUMERIC", value: 45, max: 60 } } } },
        annual: { status: "COMPLETE", points: 225, max: 300, percentage: 75 },
      },
      {
        subject_id: "EPS", parent_id: "ARTS", kind: "simple", level: 1, label: "EPS",
        periods: { T1: { status: "INCOMPLETE", points: 0, max: 20, percentage: 0, components: { TJ: { state: "MISSING", value: null, max: 20 }, EX: { state: "NOT_APPLICABLE", value: null, max: null } } } },
        annual: { status: "INCOMPLETE", points: 34, max: 60, percentage: 56.67 },
      },
    ],
    totals: {
      periods: { T1: { status: "COMPLETE", points: 358, max: 460, percentage: 77.83, rank: { value: 1, ranked: 3 } } },
      annual: { status: "COMPLETE", points: 1074, max: 1380, percentage: 77.83, rank: { value: null, reason: "INCOMPLETE" } },
    },
    status: "INCOMPLETE",
    cohort_size: 3,
    ...overrides,
  };
}

test("sélection de période : trimestres du bulletin + bilan annuel, annuel par défaut", () => {
  const view = berceau();
  assert.deepEqual(phoneViewOptions(view).map((o) => o.label), ["Trimestre 1", "Trimestre 2", "Trimestre 3", "Bilan annuel"]);
  assert.equal(defaultPhoneView(view), ANNUAL_VIEW);
  const trimester = berceau({ periods: [{ id: "T1", label: "Trimestre 1" }], totals: { periods: { T1: null }, annual: null } });
  assert.deepEqual(phoneViewOptions(trimester).map((o) => o.id), ["T1"]);
  assert.equal(defaultPhoneView(trimester), "T1");
});

test("lecture téléphone d'une période : toutes les matières, sous-matières et maxima conservés", () => {
  const card = phoneReportCard(berceau(), "T1");
  assert.equal(card.periodLabel, "Trimestre 1");
  assert.deepEqual(card.subjects.map((s) => s.key), ["FRANCAIS", "FR_ECRIT", "EPS"], "aucune ligne supprimée");
  const francais = card.subjects[0];
  assert.equal(francais.kind, "composite");
  assert.equal(francais.total, "153 / 200", "sous-total du moteur");
  assert.deepEqual(francais.components, [], "une matière principale n'a pas de note propre");
  const ecrit = card.subjects[1];
  assert.equal(ecrit.level, 1);
  assert.deepEqual(ecrit.components.map((c) => `${c.label} ${c.text}`), ["TJ 30 / 40", "EX 45 / 60"]);
  const eps = card.subjects[2];
  assert.equal(eps.components[0].missing, true);
  assert.equal(eps.components[0].text, "Manquante / 20", "note manquante jamais affichée comme zéro, maximum conservé");
  assert.equal(eps.components[1].text, "—");
  assert.equal(card.incomplete, true);
  assert.deepEqual(card.summary.map((s) => s.value), ["358 / 460", "77.83 %", "1 / 3"]);
});

test("bilan annuel : total annuel par matière et rang non classé explicite", () => {
  const card = phoneReportCard(berceau(), ANNUAL_VIEW);
  assert.equal(card.periodLabel, "Bilan annuel");
  assert.equal(card.subjects[0].total, "459 / 600");
  assert.equal(card.summary[2].value, "Non classé");
  assert.deepEqual(card.identity.map((i) => i.value), ["École Le Berceau de la Sagesse", "Hakizimana Ama", "BSG-001", "6ème A", "2026-2027"]);
});

test("officiel / brouillon : l'indicateur provient du serveur", () => {
  assert.equal(phoneReportCard(berceau(), "T1").official, true);
  assert.equal(phoneReportCard(berceau({ official: false }), "T1").official, false);
});

test("garde-fous : route publiée en lecture seule, aucun calcul, aucune WebView, bandeau brouillon", () => {
  assert.equal(reportCardPresentationPath("rc/1", 2), "/report-card/publications/rc%2F1/presentation?version=2");
  const files = [
    "Mobile/src/lib/reportCardPresentationMobile.ts",
    "Mobile/src/components/bulletin/ReportCardPresentationView.tsx",
    "Mobile/src/screens/ReportCardsScreen.tsx",
  ];
  for (const rel of files) {
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(/computeReportCard|raw_score|weighted_sum|\bpass_rule\b/.test(src), false, rel);
    assert.equal(/WebView|react-native-webview/.test(src), false, `${rel} : navigation native, pas de WebView`);
    assert.equal(/method:\s*["']POST["']/.test(src), false, `${rel} : aucune écriture`);
  }
  const lib = readFileSync(path.join(ROOT, files[0]), "utf8");
  assert.doesNotMatch(lib, /\.reduce\(|\+=/, "aucune somme côté mobile");
  const component = readFileSync(path.join(ROOT, files[1]), "utf8");
  assert.match(component, /BROUILLON/);
});

test("notes en échec : la valeur seule est marquée (jamais le maximum ni une note manquante)", () => {
  const view = berceau({
    rows: [
      {
        subject_id: "MATH", parent_id: null, kind: "simple", level: 0, label: "Mathématiques",
        periods: {
          T1: {
            status: "COMPLETE", points: 19, max: 40, percentage: 47.5, failing: true,
            components: { TJ: { state: "NUMERIC", value: 9, max: 20, failing: true }, EX: { state: "NUMERIC", value: 10, max: 20, failing: false } },
          },
        },
        annual: null,
      },
      {
        subject_id: "SCI", parent_id: null, kind: "simple", level: 0, label: "Sciences",
        periods: {
          T1: {
            status: "INCOMPLETE", points: 4, max: 20, percentage: 20, failing: false,
            components: { TJ: { state: "NUMERIC", value: 4, max: 10, failing: true }, EX: { state: "MISSING", value: null, max: 10, failing: false } },
          },
        },
        annual: null,
      },
    ],
    totals: { periods: { T1: { status: "INCOMPLETE", points: 23, max: 60, percentage: 38.33, failing: false } }, annual: null },
  });
  const card = phoneReportCard(view, "T1");
  const [math, sci] = card.subjects;
  assert.deepEqual(math.components.map((c) => [c.value, c.max, c.failing]), [["9", "20", true], ["10", "20", false]]);
  assert.equal(math.totalFailing, true);
  assert.equal(math.totalValue, "19");
  assert.equal(math.totalMax, "40");
  assert.deepEqual(sci.components.map((c) => [c.value, c.failing]), [["4", true], ["Manquante", false]]);
  assert.equal(sci.totalFailing, false, "total incomplet : non marqué");
  assert.equal(card.summary[0].failing, false);
  const component = readFileSync(path.join(ROOT, "Mobile/src/components/bulletin/ReportCardPresentationView.tsx"), "utf8");
  assert.match(component, /failing: \{ color: "#B91C1C", textDecorationLine: "underline" \}/);
});
