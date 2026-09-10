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
import { canReadEntity, canReadRoute, hasSecurityPermission } from "../domain/security/permissions";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { getRoleHomeShell } from "./roleHomeConfig";
import type { PaymentItem } from "../data/catalog";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readMobile(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

export type UnpaidApiResult =
  | { status: 200; rows: UnpaidLedgerRow[] }
  | { status: 401 | 403 | 500; message: string }
  | { status: "network"; message: string }
  | { status: "loading" }
  | { status: "not-called" };

export type UnpaidLedgerRow = { studentId: string; schoolCode: string; amountDue: number };

export type ImpayesView = {
  presentsImpayes: boolean;
  kind: "hidden" | "success" | "forbidden" | "unauthenticated" | "error" | "loading" | "empty";
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
    const destination: ImpayesView["destination"] = inspectShippedImpayesUx().dedicatedRouteRegistered
      ? "Unpaid"
      : "none";
    if (input.unpaidApi.status === 401) {
      return {
        presentsImpayes: true,
        kind: "unauthenticated",
        value: null,
        destination,
        ignoredUnpaidApi: false,
      };
    }
    if (input.unpaidApi.status === 403) {
      return {
        presentsImpayes: true,
        kind: "forbidden",
        value: null,
        destination,
        ignoredUnpaidApi: false,
      };
    }
    if (input.unpaidApi.status === 500 || input.unpaidApi.status === "network") {
      return {
        presentsImpayes: true,
        kind: "error",
        value: null,
        destination,
        ignoredUnpaidApi: false,
      };
    }
    if (input.unpaidApi.status === "loading") {
      return {
        presentsImpayes: true,
        kind: "loading",
        value: null,
        destination,
        ignoredUnpaidApi: false,
      };
    }
    if (input.unpaidApi.status === 200) {
      const count = ledgerStudentCount(input.unpaidApi.rows, input.schoolCode);
      return {
        presentsImpayes: true,
        kind: count === 0 ? "empty" : "success",
        value: String(count),
        destination,
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

const DEDICATED_UNPAID_ROUTES = ["Unpaid", "Impayes", "FinanceUnpaid"] as const;

function extractRootStackParamKeys(navigatorSrc: string): string[] {
  const marker = "export type RootStackParamList";
  const start = navigatorSrc.indexOf(marker);
  if (start < 0) return [];
  const brace = navigatorSrc.indexOf("{", start);
  if (brace < 0) return [];
  let depth = 0;
  let end = brace;
  for (let i = brace; i < navigatorSrc.length; i += 1) {
    const ch = navigatorSrc[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = navigatorSrc.slice(brace, end + 1);
  return [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((match) => match[1]);
}

export type UnpaidListRow = {
  studentName: string;
  className: string | null;
  amountDue: number;
  status: string;
};

export function inspectShippedImpayesUx() {
  const navigator = readMobile("navigation/AppNavigator.tsx");
  const registeredScreens = [...navigator.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);
  const paramKeys = extractRootStackParamKeys(navigator);
  const dedicatedRouteRegistered = DEDICATED_UNPAID_ROUTES.some(
    (name) => registeredScreens.includes(name) && paramKeys.includes(name),
  );
  const dedicatedScreenRel =
    ["screens/UnpaidScreen.tsx", "screens/ImpayesScreen.tsx", "screens/FinanceUnpaidScreen.tsx"].find((rel) =>
      fs.existsSync(path.join(srcRoot, rel)),
    ) ?? null;
  const dedicatedSrc = dedicatedScreenRel ? readMobile(dedicatedScreenRel) : "";
  const payments = readMobile("screens/PaymentsScreen.tsx");
  const wiring = inspectShippedImpayesWiring();

  return {
    registeredScreens,
    paramKeys,
    dedicatedRouteRegistered,
    dedicatedScreenRel,
    presentsDedicatedUnpaid: Boolean(dedicatedRouteRegistered && dedicatedScreenRel),
    paymentsLabelsImpayes: /Impayés/.test(payments),
    paymentsUsesReceiptPending: /paymentStats\.pending/.test(payments),
    listFields: {
      studentName: /studentName/.test(dedicatedSrc),
      className: /className/.test(dedicatedSrc),
      amountDue: /amountDue/.test(dedicatedSrc),
      status: /status|severity|retard/i.test(dedicatedSrc),
    },
    loadingContract: /loading|Chargement/.test(dedicatedSrc) || /QueryStateView/.test(dedicatedSrc),
    emptyContract: /empty|Aucun reste|Aucun impay/.test(dedicatedSrc) || /QueryStateView/.test(dedicatedSrc),
    errorRetryContract: /onRetry|Réessayer|retry/i.test(dedicatedSrc) || /QueryStateView/.test(dedicatedSrc),
    accessibilityContract:
      /accessibilityRole/.test(dedicatedSrc) && /accessibilityLabel/.test(dedicatedSrc),
    kpiNavigatesToPayments: wiring.homeKpiNavigatesToPayments,
    unpaidClientInApiLayer: wiring.unpaidClientInApiLayer,
    valueTiedToReceiptPending: wiring.valueTiedToReceiptPending,
  };
}

export function liveFinanceSession(role: string, permissions: string[], schoolCode = "CD-IN-26-001") {
  return attachCanonicalRoleIdentity({
    role,
    permissions,
    user: {
      id: `${role}-l1`,
      name: role,
      schoolCode,
      role,
      permissions,
    },
  });
}

/** Surface Impayés réellement exposée au rôle, d'après le câblage livré + RBAC live. */
export function shippedImpayesSurfaceVisible(session: ReturnType<typeof liveFinanceSession>): boolean {
  const wiring = inspectShippedImpayesWiring();
  const ux = inspectShippedImpayesUx();
  const canPayments = canReadEntity(session, "payments");
  const canUnpaid = hasSecurityPermission(session, "Impayés", "READ");
  const homeCatalog = getRoleHomeShell(session).kpiKeys.includes("unpaidPayments");
  const homeKpi =
    Boolean(wiring.homeKpiLabeledImpayes && homeCatalog) &&
    (wiring.homeKpiGatedOnPaymentsEntity ? canPayments : canUnpaid);
  const paymentsCard = Boolean(wiring.paymentsCardLabeledImpayes && canPayments);
  const unpaidRoute = Boolean(ux.dedicatedRouteRegistered && (canUnpaid || canReadRoute(session, "Unpaid")));
  return homeKpi || paymentsCard || unpaidRoute;
}

export type ImpayesUxState = ImpayesView & {
  presentsDedicatedUnpaid: boolean;
  retryAvailable: boolean;
  sensitiveRowsExposed: boolean;
  listRows: UnpaidListRow[];
};

/**
 * État UX livré de la surface Impayés.
 * Tant qu'il n'y a pas d'écran dédié + client ledger, les 401/403/500/loading
 * restent un succès numérique dérivé des reçus.
 */
export function shippedImpayesUxState(input: {
  receipts: PaymentItem[];
  unpaidApi: UnpaidApiResult;
  schoolCode: string;
}): ImpayesUxState {
  const ux = inspectShippedImpayesUx();
  const view = shippedImpayesView(input);
  const dedicatedReady = ux.presentsDedicatedUnpaid && ux.unpaidClientInApiLayer && !ux.valueTiedToReceiptPending;

  if (!dedicatedReady) {
    const numericSuccess = view.kind === "success" && view.value != null;
    return {
      ...view,
      presentsDedicatedUnpaid: false,
      retryAvailable: false,
      sensitiveRowsExposed: numericSuccess && (input.unpaidApi.status === 403 || input.unpaidApi.status === 401),
      listRows: [],
    };
  }

  const listRows: UnpaidListRow[] =
    input.unpaidApi.status === 200
      ? input.unpaidApi.rows
          .filter((row) => row.schoolCode === input.schoolCode && row.amountDue > 0)
          .map((row) => ({
            studentName: row.studentId,
            className: null,
            amountDue: row.amountDue,
            status: "En retard",
          }))
      : [];

  return {
    ...view,
    presentsDedicatedUnpaid: true,
    retryAvailable: view.kind === "error",
    sensitiveRowsExposed: false,
    listRows,
  };
}
