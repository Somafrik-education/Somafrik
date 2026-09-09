/**
 * PR #577 — Lot L1 Impayés + vérité KPI — tests ROUGES causaux.
 *   npx --yes tsx src/lib/pariteL1UnpaidKpi.red.test.ts
 *
 * Critères uniquement : PR #577 P0-CAND-UNPAID-KPI / P1-04 / §4.11 L1.
 * Web canonique : GET /backoffice/finance/unpaid (ledger d'obligations).
 * Mobile actuel : compteur de reçus payment pending libellé « Impayés ».
 *
 * Hors lot (ne pas tester ici) : PSP / Mobile Money.
 * Aucune correction applicative dans cette passe.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { getRoleHomeShell } from "./roleHomeConfig";
import type { PaymentItem } from "../data/catalog";
import { UX_V1_VIEWPORTS, tabLabelFitsViewport } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(srcRoot, "..", "..");

function readMobile(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function payment(id: string, extras: Partial<PaymentItem> = {}): PaymentItem {
  return {
    id,
    studentId: extras.studentId ?? "stu-a",
    amount: extras.amount ?? 1000,
    status: extras.status ?? "Payé",
    ...extras,
  } as PaymentItem;
}

/** Contrat Web Impayés (#577) : élèves avec reste dû d'obligation, pas des reçus pending. */
type UnpaidLedgerRow = { studentId: string; schoolCode: string; amountDue: number };

function unpaidLedgerStudentCount(rows: UnpaidLedgerRow[], schoolCode: string) {
  return new Set(
    rows.filter((row) => row.schoolCode === schoolCode && row.amountDue > 0).map((row) => row.studentId),
  ).size;
}

function currentMobileUnpaidKpi(payments: PaymentItem[]) {
  const stats = getPaymentStats(payments);
  return { label: "Impayés" as const, value: String(stats.pending) };
}

type Case = { id: string; title: string; run: () => void };

const cases: Case[] = [
  {
    id: "L1-01",
    title: "Mobile_unpaid_kpi_should_match_web_obligation_ledger",
    run() {
      const receipts: PaymentItem[] = [
        payment("p-paid-1", { status: "Payé", studentId: "stu-a" }),
        payment("p-paid-2", { status: "Payé", studentId: "stu-b" }),
      ];
      const ledger: UnpaidLedgerRow[] = [
        { studentId: "stu-a", schoolCode: "CD-IN-26-001", amountDue: 50_000 },
        { studentId: "stu-c", schoolCode: "CD-IN-26-001", amountDue: 80_000 },
        { studentId: "stu-d", schoolCode: "CD-IN-26-001", amountDue: 20_000 },
      ];
      const mobile = currentMobileUnpaidKpi(receipts);
      const webCount = unpaidLedgerStudentCount(ledger, "CD-IN-26-001");
      assert.equal(mobile.label, "Impayés");
      assert.equal(
        mobile.value,
        String(webCount),
        `#577 P1-04 / P0-CAND : KPI « Impayés » Mobile=${mobile.value} (reçus pending) ≠ ledger Web=${webCount} élèves avec reste dû. 0 reçu pending + 3 obligations = faux « tout est payé ».`,
      );
    },
  },
  {
    id: "L1-02",
    title: "HomeScreen doit brancher GET /backoffice/finance/unpaid (ou retirer le libellé Impayés)",
    run() {
      const home = readMobile("screens/HomeScreen.tsx");
      const usesPendingAsUnpaid =
        /unpaidPayments[\s\S]{0,250}paymentStats\.pending/.test(home) &&
        /unpaidPayments[\s\S]{0,400}"Impayés"/.test(home);
      const usesCanonicalUnpaidApi = /backoffice\/finance\/unpaid/.test(home);
      const labelRemoved = !/"Impayés"/.test(home);
      assert.equal(
        usesCanonicalUnpaidApi || labelRemoved,
        true,
        "#577 L1 : HomeScreen libelle encore « Impayés » avec paymentStats.pending et n'appelle pas GET /backoffice/finance/unpaid",
      );
      assert.equal(
        usesPendingAsUnpaid && !usesCanonicalUnpaidApi,
        false,
        "#577 L1 : contradiction sémantique encore présente (pending receipts = Impayés)",
      );
    },
  },
  {
    id: "L1-03",
    title: "CTA Impayés ne doit plus naviguer vers Payments (reçus) si le libellé reste Impayés",
    run() {
      const home = readMobile("screens/HomeScreen.tsx");
      const unpaidBlock = home.slice(
        home.indexOf('unpaidPayments: canReadEntity(session, "payments")'),
        home.indexOf('unpaidPayments: canReadEntity(session, "payments")') + 420,
      );
      assert.doesNotMatch(
        unpaidBlock,
        /navigate\("Payments"\)/,
        "#577 L1 : le KPI Impayés ne doit pas ouvrir l'écran des reçus Payments — ledger unpaid ou retrait du mot Impayés",
      );
    },
  },
  {
    id: "L1-04",
    title: "PaymentsScreen « Impayés » = pending receipts, pas le ledger",
    run() {
      const src = readMobile("screens/PaymentsScreen.tsx");
      assert.doesNotMatch(
        src,
        /smallLabel\}>Impayés/,
        "#577 P1-04 : la carte PaymentsScreen « Impayés » ne doit plus afficher paymentStats.pending",
      );
      assert.doesNotMatch(
        src,
        /\{paymentStats\.pending\}[\s\S]{0,80}Impayés/,
        "#577 P1-04 : PaymentsScreen couple encore pending et le libellé Impayés",
      );
    },
  },
  {
    id: "L1-05",
    title: "Aucun client Mobile ne consomme GET /backoffice/finance/unpaid",
    run() {
      const api = readMobile("services/api.ts");
      const home = readMobile("screens/HomeScreen.tsx");
      const payments = readMobile("screens/PaymentsScreen.tsx");
      for (const [name, src] of [
        ["api.ts", api],
        ["HomeScreen.tsx", home],
        ["PaymentsScreen.tsx", payments],
      ] as const) {
        assert.match(
          src,
          /backoffice\/finance\/unpaid/,
          `#577 L1 : ${name} doit appeler le contrat Web GET /backoffice/finance/unpaid (aujourd'hui absent) — ou le libellé Impayés doit disparaître`,
        );
      }
    },
  },
  {
    id: "L1-06",
    title: "401 / 403 unpaid : pas de faux succès numérique",
    run() {
      const home = readMobile("screens/HomeScreen.tsx");
      assert.match(
        home,
        /unpaidSnapshot|unpaidError|403|401/,
        "#577 L1 + mandat : un 401/403 sur GET /backoffice/finance/unpaid ne doit pas laisser afficher un compteur de reçus comme succès Impayés",
      );
      const paymentsReadyDrivesUnpaid =
        /unpaidPayments[\s\S]{0,200}paymentsReady \? String\(paymentStats\.pending\)/.test(home);
      assert.equal(
        paymentsReadyDrivesUnpaid,
        false,
        "#577 L1 : paymentsReady=success affiche paymentStats.pending sous « Impayés » même si le ledger unpaid est 401/403/absent — faux succès",
      );
    },
  },
  {
    id: "L1-07",
    title: "Cross-tenant : Impayés ne compte que l'établissement du principal",
    run() {
      const receiptsPossiblyLeaked: PaymentItem[] = [
        payment("p-b1", { status: "En attente", studentId: "stu-school-b-1" }),
        payment("p-b2", { status: "En attente", studentId: "stu-school-b-2" }),
        payment("p-b3", { status: "En attente", studentId: "stu-school-b-3" }),
      ];
      const ledger: UnpaidLedgerRow[] = [
        { studentId: "stu-a", schoolCode: "CD-IN-26-001", amountDue: 10_000 },
        { studentId: "stu-other-1", schoolCode: "BI-EC-26-001", amountDue: 99_000 },
        { studentId: "stu-other-2", schoolCode: "BI-EC-26-001", amountDue: 40_000 },
      ];
      const mobile = currentMobileUnpaidKpi(receiptsPossiblyLeaked);
      const schoolA = unpaidLedgerStudentCount(ledger, "CD-IN-26-001");
      assert.equal(
        mobile.value,
        String(schoolA),
        `#577 L1 isolation établissement : Mobile KPI=${mobile.value} (3 reçus pending, hors API unpaid scopée) ≠ ledger école A=${schoolA}. GET /backoffice/finance/unpaid est borné par le principal ; Mobile n'appelle pas cette API.`,
      );
    },
  },
  {
    id: "L1-08",
    title: "RBAC : KPI Impayés ne doit pas se cacher derrière Paiements:READ si le libellé est Impayés",
    run() {
      const home = readMobile("screens/HomeScreen.tsx");
      const unpaidBlock = home.slice(
        home.indexOf("unpaidPayments:"),
        home.indexOf("unpaidPayments:") + 80,
      );
      assert.doesNotMatch(
        unpaidBlock,
        /canReadEntity\(session, "payments"\)/,
        "#577 L1 : le Web module Impayés exige Impayés:READ (canAccessUnpaidModule) ; Mobile gate le KPI Impayés sur l'entité payments",
      );
      const catalog = readRepo("backend/lib/functionalModulesCatalog.js");
      assert.match(
        catalog,
        /moduleKey: "unpaid"[^}]*appliesMobile: false/,
        "garde #577 : Impayés appliesMobile=false — afficher le mot Impayés sans API unpaid viole le catalogue",
      );
    },
  },
  {
    id: "L1-09",
    title: "Coque Comptable : unpaidPayments encore branché sur la sémantique reçus",
    run() {
      const shell = getRoleHomeShell({ role: "accountant" });
      assert.equal(
        shell.kpiKeys.includes("unpaidPayments"),
        true,
        "garde : la coque Comptable expose encore unpaidPayments — le lot L1 doit soit le brancher au ledger, soit le retirer",
      );
      const home = readMobile("screens/HomeScreen.tsx");
      assert.doesNotMatch(
        home,
        /unpaidPayments:[\s\S]{0,300}paymentStats\.pending/,
        "#577 L1 : accountant.kpiKeys contient unpaidPayments toujours alimenté par paymentStats.pending",
      );
    },
  },
  {
    id: "L1-10",
    title: "Libellé Impayés lisible 360 / 390 / 430 dp — cible tactile 44 dp",
    run() {
      assert.equal(MIN_TOUCH_TARGET_DP >= 44, true);
      for (const width of [360, 390, 430] as const) {
        assert.equal(
          tabLabelFitsViewport("Impayés", width),
          true,
          `Mandat Lots 0-1 : « Impayés » doit tenir à ${width} dp sans ellipsis`,
        );
        assert.equal(
          (UX_V1_VIEWPORTS as readonly number[]).includes(width),
          true,
          `Mandat Lots 0-1 : ${width} dp doit faire partie des viewports de validation Accueil/finance`,
        );
      }
      const layout = readMobile("components/RoleDashboardLayout.tsx");
      assert.match(
        layout,
        /minHeight:\s*KPI_ROW_MIN_DP|minHeight:\s*92/,
        "KPI Accueil : hauteur min contrat UX (>= 44 dp tactile via KPI_ROW_MIN_DP)",
      );
    },
  },
];

const failures: { id: string; title: string; message: string }[] = [];
const passed: string[] = [];

for (const testCase of cases) {
  try {
    testCase.run();
    passed.push(testCase.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ id: testCase.id, title: testCase.title, message });
  }
}

console.log(`parite L1 unpaid — ${passed.length} vert / ${failures.length} rouge / ${cases.length} cas`);
for (const id of passed) console.log(`  PASS ${id}`);
for (const failure of failures) {
  console.error(`  FAIL [${failure.id}] ${failure.title}\n    ${failure.message}`);
}

if (failures.length) process.exit(1);
console.log("OK: L1 Impayés (écart #577 P1-04 / P0-CAND clos)");
