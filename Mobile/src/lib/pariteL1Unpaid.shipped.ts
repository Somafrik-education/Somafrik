/**
 * Miroir du comportement Mobile *livré* pour Impayés (L1).
 * Aucun écran de production n'importe ce fichier.
 *
 * Sert à simuler 401/403 et le scope établissement contre getPaymentStats
 * (source actuelle du KPI) sans exiger l'URL dans les écrans.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { getRoleHomeShell } from "./roleHomeConfig";
import type { PaymentItem } from "../data/catalog";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readMobile(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

export type UnpaidApiResult =
  | { status: 200; rows: UnpaidLedgerRow[] }
  | { status: 401 | 403; message: string }
  | { status: "not-called" };

export type UnpaidLedgerRow = { studentId: string; schoolCode: string; amountDue: number };

export type ImpayesView = {
  presentsImpayes: boolean;
  kind: "hidden" | "success" | "forbidden" | "unauthenticated" | "error";
  value: string | null;
  destination: "Payments" | "Unpaid" | "none";
  ignoredUnpaidApi: boolean;
};

export function ledgerStudentCount(rows: UnpaidLedgerRow[], schoolCode: string) {
  return new Set(
    rows.filter((row) => row.schoolCode === schoolCode && row.amountDue > 0).map((row) => row.studentId),
  ).size;
}

export function inspectShippedImpayesWiring() {
  const home = readMobile("screens/HomeScreen.tsx");
  const payments = readMobile("screens/PaymentsScreen.tsx");
  const api = readMobile("services/api.ts");
  const accountant = getRoleHomeShell({ role: "accountant" });

  const homeKpiLabeledImpayes = /unpaidPayments[\s\S]{0,500}"Impayés"/.test(home);
  const homeKpiUsesReceiptPending = /unpaidPayments[\s\S]{0,500}paymentStats\.pending/.test(home);
  const homeKpiNavigatesToPayments = /unpaidPayments[\s\S]{0,500}navigate\("Payments"\)/.test(home);
  const homeKpiGatedOnPaymentsEntity = /unpaidPayments:\s*canReadEntity\(session,\s*"payments"\)/.test(home);
  const paymentsCardLabeledImpayes = /smallLabel\}>Impayés/.test(payments) || />Impayés<\//.test(payments);
  const paymentsCardUsesReceiptPending =
    paymentsCardLabeledImpayes && /paymentStats\.pending/.test(payments);
  const unpaidClientInApiLayer = /backoffice\/finance\/unpaid|listUnpaid|getUnpaid/.test(api);

  return {
    accountantCatalogHasUnpaidKpi: accountant.kpiKeys.includes("unpaidPayments"),
    homeKpiLabeledImpayes,
    homeKpiUsesReceiptPending,
    homeKpiNavigatesToPayments,
    homeKpiGatedOnPaymentsEntity,
    paymentsCardLabeledImpayes,
    paymentsCardUsesReceiptPending,
    unpaidClientInApiLayer,
    presentsImpayes:
      (accountant.kpiKeys.includes("unpaidPayments") && homeKpiLabeledImpayes) || paymentsCardLabeledImpayes,
    valueTiedToReceiptPending: homeKpiUsesReceiptPending || paymentsCardUsesReceiptPending,
  };
}

/**
 * Comportement livré : si « Impayés » est encore affiché, le chiffre suit les reçus
 * pending et ignore unpaidApi (401/403/200 scopé).
 */
export function shippedImpayesView(input: {
  receipts: PaymentItem[];
  unpaidApi: UnpaidApiResult;
  schoolCode: string;
}): ImpayesView {
  const wiring = inspectShippedImpayesWiring();
  if (!wiring.presentsImpayes) {
    return {
      presentsImpayes: false,
      kind: "hidden",
      value: null,
      destination: "none",
      ignoredUnpaidApi: false,
    };
  }

  if (!wiring.valueTiedToReceiptPending && wiring.unpaidClientInApiLayer) {
    if (input.unpaidApi.status === 401) {
      return {
        presentsImpayes: true,
        kind: "unauthenticated",
        value: null,
        destination: "Unpaid",
        ignoredUnpaidApi: false,
      };
    }
    if (input.unpaidApi.status === 403) {
      return {
        presentsImpayes: true,
        kind: "forbidden",
        value: null,
        destination: "Unpaid",
        ignoredUnpaidApi: false,
      };
    }
    if (input.unpaidApi.status === 200) {
      return {
        presentsImpayes: true,
        kind: "success",
        value: String(ledgerStudentCount(input.unpaidApi.rows, input.schoolCode)),
        destination: "Unpaid",
        ignoredUnpaidApi: false,
      };
    }
  }

  return {
    presentsImpayes: true,
    kind: "success",
    value: String(getPaymentStats(input.receipts).pending),
    destination: wiring.homeKpiNavigatesToPayments ? "Payments" : "none",
    ignoredUnpaidApi: true,
  };
}

export function payment(
  id: string,
  extras: Partial<PaymentItem> & { studentId?: string; amount?: number; status?: string } = {},
): PaymentItem {
  return {
    id,
    studentId: extras.studentId ?? "stu-a",
    amount: extras.amount ?? 1000,
    status: extras.status ?? "Payé",
    ...extras,
  } as PaymentItem;
}
