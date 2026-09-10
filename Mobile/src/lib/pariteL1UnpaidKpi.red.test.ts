/**
 * PR #577 — Lot L1 Impayés — tests ROUGES causaux, neutres vis-à-vis de la solution.
 *
 * Options encore ouvertes (#577 §4.11 L1) :
 *   A) brancher le ledger GET unpaid (recommandation CTO, pas exigence de ce fichier)
 *   B) retirer le KPI / libellé « Impayés »
 *
 * Ces tests passent dès que « Impayés » n'est plus une vérité de reçus pending.
 * Ils n'exigent pas l'URL dans HomeScreen ni PaymentsScreen.
 */
import assert from "node:assert/strict";
import { UX_V1_VIEWPORTS, tabLabelFitsViewport } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import { MAQUETTE_L0_L1_VIEWPORTS_DP, MAQUETTE_MIN_TOUCH_DP } from "./pariteL0L1UxContract";
import { L1_EXPECTED_IDS, runRedCases, type RedCase } from "./pariteL0L1RedReport";
import {
  inspectShippedImpayesWiring,
  ledgerStudentCount,
  payment,
  shippedImpayesView,
  type UnpaidLedgerRow,
} from "./pariteL1Unpaid.shipped";

const SCHOOL_A = "CD-IN-26-001";
const SCHOOL_B = "BI-EC-26-001";

const paidReceiptsOnly = [
  payment("p-paid-1", { status: "Payé", studentId: "stu-a" }),
  payment("p-paid-2", { status: "Payé", studentId: "stu-b" }),
];

const ledgerAThree: UnpaidLedgerRow[] = [
  { studentId: "stu-a", schoolCode: SCHOOL_A, amountDue: 50_000 },
  { studentId: "stu-c", schoolCode: SCHOOL_A, amountDue: 80_000 },
  { studentId: "stu-d", schoolCode: SCHOOL_A, amountDue: 20_000 },
];

const cases: RedCase[] = [
  {
    id: "L1-01",
    title: "Si Impayés est affiché, le chiffre ne peut pas être les reçus pending (ledger ou retrait)",
    run() {
      const view = shippedImpayesView({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 200, rows: ledgerAThree },
        schoolCode: SCHOOL_A,
      });
      if (!view.presentsImpayes) return;
      const webCount = ledgerStudentCount(ledgerAThree, SCHOOL_A);
      assert.equal(
        view.value,
        String(webCount),
        `#577 P1-04 / P0-CAND : surface « Impayés » encore visible avec valeur=${view.value} (reçus pending) ≠ ledger ${webCount}. Neutralité : brancher le ledger OU retirer le libellé.`,
      );
    },
  },
  {
    id: "L1-02",
    title: "Pas de libellé Impayés alimenté par les reçus pending",
    run() {
      const wiring = inspectShippedImpayesWiring();
      assert.equal(
        wiring.presentsImpayes && wiring.valueTiedToReceiptPending,
        false,
        "#577 L1 : « Impayés » est encore la sémantique des reçus pending — brancher le ledger (client API) ou retirer le libellé",
      );
    },
  },
  {
    id: "L1-03",
    title: "Si le libellé Impayés reste, la destination ne doit pas être l'écran des reçus",
    run() {
      const view = shippedImpayesView({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 200, rows: ledgerAThree },
        schoolCode: SCHOOL_A,
      });
      if (!view.presentsImpayes) return;
      assert.notEqual(
        view.destination,
        "Payments",
        "#577 L1 : KPI Impayés ouvre encore Payments (reçus). Ledger unpaid, ou retrait du mot Impayés.",
      );
    },
  },
  {
    id: "L1-04",
    title: "Carte Payments « Impayés » : pas de pending receipts sous ce libellé",
    run() {
      const wiring = inspectShippedImpayesWiring();
      assert.equal(
        wiring.paymentsCardUsesReceiptPending,
        false,
        "#577 P1-04 : PaymentsScreen couple encore paymentStats.pending et le libellé Impayés — retirer le mot ou le brancher au ledger",
      );
    },
  },
  {
    id: "L1-05",
    title: "Si Impayés reste affiché, un client unpaid doit exister dans la couche API (pas dans les écrans)",
    run() {
      const wiring = inspectShippedImpayesWiring();
      if (!wiring.presentsImpayes) return;
      assert.equal(
        wiring.unpaidClientInApiLayer,
        true,
        "#577 L1 : surface Impayés encore visible sans client GET unpaid dans services/api (encapsulation OK ; l'URL n'est pas exigée dans HomeScreen/PaymentsScreen)",
      );
    },
  },
  {
    id: "L1-06",
    title: "401/403 unpaid : pas de faux succès numérique (simulation API)",
    run() {
      const fakeSuccesses: string[] = [];
      for (const status of [401, 403] as const) {
        const view = shippedImpayesView({
          receipts: paidReceiptsOnly,
          unpaidApi: { status, message: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
          schoolCode: SCHOOL_A,
        });
        if (!view.presentsImpayes) continue;
        if (view.kind === "success" && view.value != null) {
          fakeSuccesses.push(`${status}:kind=${view.kind}:value=${view.value}`);
        }
      }
      assert.equal(
        fakeSuccesses.length,
        0,
        `#577 L1 : 401/403 unpaid encore rendus comme succès numérique (${fakeSuccesses.join(" ; ")}). Attendu : forbidden/unauthenticated/error, ou retrait du KPI.`,
      );
    },
  },
  {
    id: "L1-07",
    title: "Isolation établissement : Impayés ne mélange pas l'école B (simulation API 200 scopée)",
    run() {
      const receiptsSchoolB = [
        payment("p-b1", { status: "En attente", studentId: "stu-school-b-1" }),
        payment("p-b2", { status: "En attente", studentId: "stu-school-b-2" }),
        payment("p-b3", { status: "En attente", studentId: "stu-school-b-3" }),
      ];
      const mixedLedger: UnpaidLedgerRow[] = [
        { studentId: "stu-a", schoolCode: SCHOOL_A, amountDue: 10_000 },
        { studentId: "stu-other-1", schoolCode: SCHOOL_B, amountDue: 99_000 },
        { studentId: "stu-other-2", schoolCode: SCHOOL_B, amountDue: 40_000 },
      ];
      const view = shippedImpayesView({
        receipts: receiptsSchoolB,
        unpaidApi: { status: 200, rows: mixedLedger.filter((row) => row.schoolCode === SCHOOL_A) },
        schoolCode: SCHOOL_A,
      });
      if (!view.presentsImpayes) return;
      const schoolA = ledgerStudentCount(
        mixedLedger.filter((row) => row.schoolCode === SCHOOL_A),
        SCHOOL_A,
      );
      assert.equal(
        view.value,
        String(schoolA),
        `#577 L1 : isolation établissement — vue=${view.value} (reçus pending école B) ≠ ledger école A=${schoolA} renvoyé par l'API scopée`,
      );
    },
  },
  {
    id: "L1-08",
    title: "Si Impayés reste, le gate RBAC ne doit pas être seulement Paiements:READ",
    run() {
      const wiring = inspectShippedImpayesWiring();
      if (!wiring.presentsImpayes) return;
      assert.equal(
        wiring.homeKpiGatedOnPaymentsEntity && wiring.homeKpiLabeledImpayes,
        false,
        "#577 L1 : le module Web Impayés exige Impayés:READ ; le KPI Mobile « Impayés » est encore gated sur l'entité payments — ou retirer le libellé",
      );
    },
  },
  {
    id: "L1-09",
    title: "Coque Comptable : pas d'unpaidPayments alimenté par les reçus (le KPI peut disparaître)",
    run() {
      const wiring = inspectShippedImpayesWiring();
      assert.equal(
        wiring.accountantCatalogHasUnpaidKpi && wiring.homeKpiUsesReceiptPending,
        false,
        "#577 L1 : unpaidPayments est encore au catalogue Comptable et alimenté par paymentStats.pending — brancher le ledger ou retirer la clé/KPI",
      );
    },
  },
  {
    id: "L1-10",
    title: "Si Impayés reste visible, lisibilité 360/390/430 et cible 44 dp (maquette)",
    run() {
      const wiring = inspectShippedImpayesWiring();
      if (!wiring.presentsImpayes) return;
      assert.equal(MIN_TOUCH_TARGET_DP >= MAQUETTE_MIN_TOUCH_DP, true);
      for (const width of MAQUETTE_L0_L1_VIEWPORTS_DP) {
        assert.equal(
          tabLabelFitsViewport("Impayés", width),
          true,
          `Maquette L1 : « Impayés » doit tenir à ${width} dp sans ellipsis`,
        );
        assert.equal(
          (UX_V1_VIEWPORTS as readonly number[]).includes(width),
          true,
          `Maquette L1 : ${width} dp doit valider la coque Accueil si le KPI Impayés reste affiché`,
        );
      }
    },
  },
];

const report = runRedCases("L1", L1_EXPECTED_IDS, cases);
if (report.failedIds.length) process.exit(1);
console.log("OK: L1 Impayés (écart #577 P1-04 / P0-CAND clos)");
