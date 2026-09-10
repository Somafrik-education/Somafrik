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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UX_V1_VIEWPORTS, tabLabelFitsViewport } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import { MAQUETTE_L0_L1_VIEWPORTS_DP, MAQUETTE_MIN_TOUCH_DP } from "./pariteL0L1UxContract";
import { L1_EXPECTED_IDS, runRedCases, type RedCase } from "./pariteL0L1RedReport";
import {
  inspectShippedImpayesWiring,
  ledgerStudentCount,
  liveFinanceSession,
  payment,
  shippedImpayesSurfaceVisible,
  shippedImpayesView,
  type UnpaidLedgerRow,
} from "./pariteL1Unpaid.shipped";
import { canReadEntity, hasSecurityPermission } from "../domain/security/permissions";
import { getRoleHomeShell, MAX_HOME_KPIS, selectHomeKpis } from "./roleHomeConfig";

const homeScreenSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/HomeScreen.tsx"),
  "utf8",
);

const SCHOOL_A = "CD-IN-26-001";
const SCHOOL_B = "BI-EC-26-001";

const paidReceiptsOnly = [
  payment("p-paid-1", { status: "Payé", studentId: "stu-a" }),
  payment("p-paid-2", { status: "Payé", studentId: "stu-b" }),
];

const pendingReceiptsFour = [
  payment("p-pend-1", { status: "En attente", studentId: "stu-w" }),
  payment("p-pend-2", { status: "En attente", studentId: "stu-x" }),
  payment("p-pend-3", { status: "En attente", studentId: "stu-y" }),
  payment("p-pend-4", { status: "En attente", studentId: "stu-z" }),
];

const ledgerAThree: UnpaidLedgerRow[] = [
  { studentId: "stu-a", schoolCode: SCHOOL_A, amountDue: 50_000 },
  { studentId: "stu-c", schoolCode: SCHOOL_A, amountDue: 80_000 },
  { studentId: "stu-d", schoolCode: SCHOOL_A, amountDue: 20_000 },
];

const ledgerAOne: UnpaidLedgerRow[] = [{ studentId: "stu-a", schoolCode: SCHOOL_A, amountDue: 10_000 }];

const ledgerBFive: UnpaidLedgerRow[] = [
  { studentId: "stu-b1", schoolCode: SCHOOL_B, amountDue: 11_000 },
  { studentId: "stu-b2", schoolCode: SCHOOL_B, amountDue: 22_000 },
  { studentId: "stu-b3", schoolCode: SCHOOL_B, amountDue: 33_000 },
  { studentId: "stu-b4", schoolCode: SCHOOL_B, amountDue: 44_000 },
  { studentId: "stu-b5", schoolCode: SCHOOL_B, amountDue: 55_000 },
];

const cases: RedCase[] = [
  {
    id: "L1-01",
    title: "Si Impayés est affiché, le chiffre ne peut pas être les reçus pending (ledger ou retrait)",
    run() {
      const problems: string[] = [];
      const direct = shippedImpayesView({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 200, rows: ledgerAThree },
        schoolCode: SCHOOL_A,
      });
      if (direct.presentsImpayes) {
        const webCount = ledgerStudentCount(ledgerAThree, SCHOOL_A);
        if (direct.value !== String(webCount)) {
          problems.push(
            `ledger 3 / reçus 0 → vue=${direct.value} ≠ ${webCount}. Neutralité : brancher le ledger OU retirer le libellé.`,
          );
        }
      }
      const inverse = shippedImpayesView({
        receipts: pendingReceiptsFour,
        unpaidApi: { status: 200, rows: [] },
        schoolCode: SCHOOL_A,
      });
      if (inverse.presentsImpayes) {
        if (inverse.value !== "0") {
          problems.push(
            `ledger 0 / reçus pending 4 → vue=${inverse.value} ≠ 0. Un compteur de reçus ne peut pas être présenté comme Impayés.`,
          );
        }
      }
      assert.equal(problems.length, 0, `#577 P1-04 / P0-CAND : ${problems.join(" | ")}`);
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
      const mixedLedger: UnpaidLedgerRow[] = [...ledgerAOne, ...ledgerBFive];
      const view = shippedImpayesView({
        receipts: [
          payment("p-b1", { status: "En attente", studentId: "stu-b1" }),
          payment("p-b2", { status: "En attente", studentId: "stu-b2" }),
          payment("p-b3", { status: "En attente", studentId: "stu-b3" }),
          payment("p-b4", { status: "En attente", studentId: "stu-b4" }),
          payment("p-b5", { status: "En attente", studentId: "stu-b5" }),
        ],
        unpaidApi: { status: 200, rows: mixedLedger.filter((row) => row.schoolCode === SCHOOL_A) },
        schoolCode: SCHOOL_A,
      });
      if (!view.presentsImpayes) return;
      const schoolA = ledgerStudentCount(ledgerAOne, SCHOOL_A);
      assert.equal(
        view.value,
        String(schoolA),
        `#577 L1 : isolation établissement — session école A attend ${schoolA}, vue=${view.value} (reçus pending école B=${ledgerBFive.length}).`,
      );
    },
  },
  {
    id: "L1-08",
    title: "Coque Admin établissement : Impayés:READ sélectionne unpaidPayments (fail-closed, Unpaid, pas pending)",
    run() {
      const wiring = inspectShippedImpayesWiring();
      if (!wiring.presentsImpayes) return;
      const problems: string[] = [];
      if (wiring.homeKpiGatedOnPaymentsEntity && wiring.homeKpiLabeledImpayes) {
        problems.push(
          "KPI Accueil « Impayés » encore gated sur canReadEntity(payments) au lieu de Impayés:READ",
        );
      }

      const paymentsOnlySecretary = liveFinanceSession("secretary", ["Paiements:READ"]);
      const paymentsOnlyAdmin = liveFinanceSession("school_admin", ["Paiements:READ"]);
      const unpaidAdmin = liveFinanceSession("school_admin", ["Impayés:READ", "Paiements:READ"]);
      const accountant = liveFinanceSession("accountant", ["Paiements:READ", "Impayés:READ"]);

      assert.equal(hasSecurityPermission(paymentsOnlySecretary, "Impayés", "READ"), false);
      assert.equal(canReadEntity(paymentsOnlySecretary, "payments"), true);
      assert.equal(hasSecurityPermission(paymentsOnlyAdmin, "Impayés", "READ"), false);
      assert.equal(canReadEntity(paymentsOnlyAdmin, "payments"), true);
      assert.equal(hasSecurityPermission(unpaidAdmin, "Impayés", "READ"), true);
      assert.equal(hasSecurityPermission(accountant, "Impayés", "READ"), true);

      if (shippedImpayesSurfaceVisible(paymentsOnlySecretary)) {
        problems.push("Secrétaire Paiements:READ sans Impayés:READ voit encore une surface Impayés");
      }
      if (shippedImpayesSurfaceVisible(paymentsOnlyAdmin)) {
        problems.push("Admin établissement Paiements:READ sans Impayés:READ voit encore une surface Impayés");
      }
      if (!shippedImpayesSurfaceVisible(unpaidAdmin)) {
        problems.push("Admin établissement Impayés:READ ne voit pas Impayés");
      }

      assert.equal(MAX_HOME_KPIS, 4, "MAX_HOME_KPIS ne doit pas augmenter");
      const schoolAdminShell = getRoleHomeShell(unpaidAdmin);
      const expectedAdminCatalog = ["users", "presence", "students", "unpaidPayments"];
      if (JSON.stringify(schoolAdminShell.kpiKeys) !== JSON.stringify(expectedAdminCatalog)) {
        problems.push(
          `coque Admin établissement kpiKeys=${JSON.stringify(schoolAdminShell.kpiKeys)} ≠ ${JSON.stringify(expectedAdminCatalog)}`,
        );
      }

      const visibleWithRead = selectHomeKpis(schoolAdminShell.kpiKeys);
      if (!visibleWithRead.includes("unpaidPayments") || visibleWithRead.indexOf("unpaidPayments") >= MAX_HOME_KPIS) {
        problems.push(
          `Admin établissement + Impayés:READ : unpaidPayments absent des ${MAX_HOME_KPIS} KPI visibles (${JSON.stringify(visibleWithRead)})`,
        );
      }

      const visibleWithoutRead = selectHomeKpis(
        schoolAdminShell.kpiKeys.filter((key) => key !== "unpaidPayments"),
      );
      if (JSON.stringify(visibleWithoutRead) !== JSON.stringify(["users", "presence", "students"])) {
        problems.push(
          `sans Impayés:READ la carte Impayés doit disparaître (${JSON.stringify(visibleWithoutRead)})`,
        );
      }

      if (!/kpi\("unpaidPayments"[\s\S]{0,180}navigate\("Unpaid"\)/.test(homeScreenSrc)) {
        problems.push("KPI unpaidPayments ne navigue pas vers Unpaid");
      }
      if (/kpi\("unpaidPayments"[\s\S]{0,180}navigate\("Payments"\)/.test(homeScreenSrc)) {
        problems.push("KPI unpaidPayments navigue encore vers Payments");
      }
      if (wiring.homeKpiUsesReceiptPending) {
        problems.push("KPI Impayés encore alimenté par paymentStats.pending");
      }
      const view = shippedImpayesView({
        receipts: pendingReceiptsFour,
        unpaidApi: { status: 200, rows: ledgerAThree },
        schoolCode: SCHOOL_A,
      });
      if (view.presentsImpayes && view.destination !== "Unpaid") {
        problems.push(`KPI Impayés destination=${view.destination} ≠ Unpaid`);
      }
      if (view.presentsImpayes && view.value === String(pendingReceiptsFour.length)) {
        problems.push("KPI Impayés reprend le compteur de reçus pending");
      }

      assert.equal(problems.length, 0, `#577 L1 RBAC Admin établissement : ${problems.join(" | ")}`);
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
