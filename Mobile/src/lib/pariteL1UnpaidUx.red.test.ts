/**
 * PR #577 — Lot L1 Impayés — tests ROUGES UX (écran dédié + états).
 * Aucun écran de production n'est créé par ce fichier.
 */
import assert from "node:assert/strict";
import { UX_V1_VIEWPORTS, tabLabelFitsViewport } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import { MAQUETTE_L0_L1_VIEWPORTS_DP, MAQUETTE_KPI_A11Y_ROLE, MAQUETTE_MIN_TOUCH_DP } from "./pariteL0L1UxContract";
import { L1_UX_EXPECTED_IDS, runRedCases, type RedCase } from "./pariteL0L1RedReport";
import {
  inspectShippedImpayesUx,
  payment,
  shippedImpayesUxState,
  type UnpaidLedgerRow,
} from "./pariteL1Unpaid.shipped";

const SCHOOL_A = "CD-IN-26-001";

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
    id: "L1-UX-01",
    title: "Une destination Mobile distincte de Payments doit exister pour Impayés",
    run() {
      const ux = inspectShippedImpayesUx();
      assert.equal(
        ux.presentsDedicatedUnpaid,
        true,
        `#577 L1 UX : écran dédié absent (route=${ux.dedicatedRouteRegistered} fichier=${ux.dedicatedScreenRel ?? "∅"} screens=${ux.registeredScreens.join(",")})`,
      );
      assert.equal(
        ux.registeredScreens.includes("Payments") && ux.presentsDedicatedUnpaid,
        true,
        "Payments existe déjà ; Impayés doit être une autre route enregistrée",
      );
    },
  },
  {
    id: "L1-UX-02",
    title: "Le KPI Impayés doit viser une destination réelle Unpaid enregistrée dans le navigator",
    run() {
      const ux = inspectShippedImpayesUx();
      const view = shippedImpayesUxState({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 200, rows: ledgerAThree },
        schoolCode: SCHOOL_A,
      });
      assert.equal(
        view.destination === "Unpaid" && ux.dedicatedRouteRegistered,
        true,
        `#577 L1 UX : destination KPI=${view.destination} ; Unpaid enregistré=${ux.dedicatedRouteRegistered}. Interdit : bouton Impayés sans destination Impayés.`,
      );
    },
  },
  {
    id: "L1-UX-03",
    title: "Paiements et Impayés doivent être deux concepts visuellement et fonctionnellement distincts",
    run() {
      const ux = inspectShippedImpayesUx();
      assert.equal(
        ux.presentsDedicatedUnpaid && !ux.paymentsLabelsImpayes,
        true,
        `#577 L1 UX : PaymentsScreen libellé Impayés=${ux.paymentsLabelsImpayes} (pending=${ux.paymentsUsesReceiptPending}) ; écran dédié=${ux.presentsDedicatedUnpaid}`,
      );
    },
  },
  {
    id: "L1-UX-04",
    title: "Chargement ledger : état loading explicite, pas un 0 provisoire",
    run() {
      const view = shippedImpayesUxState({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: "loading" },
        schoolCode: SCHOOL_A,
      });
      assert.equal(view.kind, "loading", `#577 L1 UX : loading encore kind=${view.kind} value=${view.value}`);
      assert.equal(view.value, null, `#577 L1 UX : loading ne doit pas afficher un chiffre (value=${view.value})`);
    },
  },
  {
    id: "L1-UX-05",
    title: "Ledger 200 vide : vrai état vide, pas une erreur ni une liste fantôme",
    run() {
      const view = shippedImpayesUxState({
        receipts: [
          payment("p-pend-1", { status: "En attente", studentId: "stu-w" }),
          payment("p-pend-2", { status: "En attente", studentId: "stu-x" }),
          payment("p-pend-3", { status: "En attente", studentId: "stu-y" }),
          payment("p-pend-4", { status: "En attente", studentId: "stu-z" }),
        ],
        unpaidApi: { status: 200, rows: [] },
        schoolCode: SCHOOL_A,
      });
      assert.equal(
        view.presentsDedicatedUnpaid && view.kind === "empty" && view.listRows.length === 0,
        true,
        `#577 L1 UX : vide ledger → dedicated=${view.presentsDedicatedUnpaid} kind=${view.kind} value=${view.value} rows=${view.listRows.length} (4 reçus pending ne doivent pas peupler Impayés)`,
      );
      assert.notEqual(view.kind, "error", "un ledger vide n'est pas une erreur");
    },
  },
  {
    id: "L1-UX-06",
    title: "Erreur réseau/500 : état erreur + reprise, jamais repli reçus",
    run() {
      const problems: string[] = [];
      for (const unpaidApi of [
        { status: 500 as const, message: "INTERNAL" },
        { status: "network" as const, message: "NETWORK" },
      ]) {
        const view = shippedImpayesUxState({
          receipts: paidReceiptsOnly,
          unpaidApi,
          schoolCode: SCHOOL_A,
        });
        if (view.kind !== "error") {
          problems.push(`${unpaidApi.status}: kind=${view.kind} value=${view.value}`);
        }
        if (!view.retryAvailable) {
          problems.push(`${unpaidApi.status}: pas de reprise`);
        }
        if (view.ignoredUnpaidApi) {
          problems.push(`${unpaidApi.status}: fallback reçus (ignoredUnpaidApi)`);
        }
      }
      assert.equal(problems.length, 0, `#577 L1 UX : 500/réseau encore mal rendus (${problems.join(" ; ")})`);
    },
  },
  {
    id: "L1-UX-07",
    title: "403 : état interdit fail-closed, aucune donnée sensible",
    run() {
      const view = shippedImpayesUxState({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 403, message: "FORBIDDEN" },
        schoolCode: SCHOOL_A,
      });
      assert.equal(view.kind, "forbidden", `#577 L1 UX : 403 encore kind=${view.kind} value=${view.value}`);
      assert.equal(view.value, null, `#577 L1 UX : 403 ne doit pas produire un chiffre (value=${view.value})`);
      assert.equal(view.sensitiveRowsExposed, false, "403 ne doit exposer aucune donnée Impayés");
      assert.equal(view.listRows.length, 0, "403 ne doit pas lister d'élèves");
    },
  },
  {
    id: "L1-UX-08",
    title: "401 : état non authentifié, pas un chiffre 0",
    run() {
      const view = shippedImpayesUxState({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 401, message: "UNAUTHORIZED" },
        schoolCode: SCHOOL_A,
      });
      assert.equal(
        view.kind,
        "unauthenticated",
        `#577 L1 UX : 401 encore kind=${view.kind} value=${view.value}`,
      );
      assert.equal(view.value, null, `#577 L1 UX : 401 ne doit pas produire 0 (value=${view.value})`);
    },
  },
  {
    id: "L1-UX-09",
    title: "Liste compacte : nom, classe, montant restant, statut/retard",
    run() {
      const ux = inspectShippedImpayesUx();
      const view = shippedImpayesUxState({
        receipts: paidReceiptsOnly,
        unpaidApi: { status: 200, rows: ledgerAThree },
        schoolCode: SCHOOL_A,
      });
      assert.equal(
        ux.presentsDedicatedUnpaid,
        true,
        "liste compacte impossible : surface Impayés dédiée absente",
      );
      assert.equal(ux.listFields.studentName, true, "ligne Impayés sans nom/prénom");
      assert.equal(ux.listFields.className, true, "ligne Impayés sans classe");
      assert.equal(ux.listFields.amountDue, true, "ligne Impayés sans montant restant");
      assert.equal(ux.listFields.status, true, "ligne Impayés sans statut/retard");
      assert.equal(view.listRows.length, 3, `liste livrée=${view.listRows.length} ≠ 3 élèves ledger école A`);
      assert.equal(
        view.listRows.every((row) => row.amountDue > 0 && row.studentName),
        true,
        "chaque ligne compacte doit porter un nom et un montant restant",
      );
    },
  },
  {
    id: "L1-UX-10",
    title: "Accessibilité surface Impayés : rôle, libellé, 44 dp, 360/390/430",
    run() {
      const ux = inspectShippedImpayesUx();
      assert.equal(
        ux.presentsDedicatedUnpaid,
        true,
        "accessibilité Impayés : surface dédiée absente",
      );
      assert.equal(ux.accessibilityContract, true, "actions Impayés sans accessibilityRole + accessibilityLabel");
      assert.equal(MIN_TOUCH_TARGET_DP >= MAQUETTE_MIN_TOUCH_DP, true);
      assert.equal(MAQUETTE_KPI_A11Y_ROLE, "button");
      for (const width of MAQUETTE_L0_L1_VIEWPORTS_DP) {
        assert.equal(tabLabelFitsViewport("Impayés", width), true, `« Impayés » doit tenir à ${width} dp`);
        assert.equal((UX_V1_VIEWPORTS as readonly number[]).includes(width), true);
      }
    },
  },
];

const report = runRedCases("L1-UX", L1_UX_EXPECTED_IDS, cases);
if (report.failedIds.length) process.exit(1);
console.log("OK: L1 UX Impayés (écran dédié + états clos)");
