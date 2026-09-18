/**
 * Caractérisation GREEN — contrats déjà alignés Web / Mobile.
 *
 *   npx --yes tsx scripts/web-mobile-parity-audit.green.test.ts
 *
 * Objectif : pour une même donnée backend, les deux clients interprètent
 * Finance KPI, dates civiles et moyennes pédagogiques de la même façon.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDateForDisplay as webFormatDate, DISPLAY_DATE_HINT as webHint } from "../web/src/lib/dates.ts";
import { getPaymentRateKpi as webPaymentRate } from "../web/src/lib/paymentRateKpi.ts";
import { formatFinanceAmount as webFinanceAmount } from "../web/src/lib/financeCurrency.ts";
import { rollCallInitialStatus, presenceIsAttended, TODAY_PRESENCE_KPI_LABEL as webPresenceLabel } from "../web/src/lib/presenceMetrics.ts";
import { CRUD_PERMISSION_MODULES as webCrudModules } from "../web/src/lib/constants.ts";

import { formatDateForDisplay as mobileFormatDate, DISPLAY_DATE_HINT as mobileHint } from "../Mobile/src/lib/dates.ts";
import { getPaymentRateKpi as mobilePaymentRate } from "../Mobile/src/lib/paymentRateKpi.ts";
import { formatFinanceAmount as mobileFinanceAmount } from "../Mobile/src/lib/financeCurrency.ts";
import { hydrateRollCallStatus, isAttendedStatus } from "../Mobile/src/lib/attendanceTruth.ts";
import { TODAY_PRESENCE_KPI_LABEL as mobilePresenceLabel } from "../Mobile/src/lib/todayPresenceKpi.ts";
import { canonicalStudentGeneralAverage } from "../Mobile/src/lib/pedagogyAverage.ts";
import { CRUD_PERMISSION_MODULES as mobileCrudModules } from "../Mobile/src/lib/constants.ts";

const FEES = [
  { studentId: "ELE-1", amountDue: 100_000, amountPaid: 40_000, exemption: 10_000, currency: "CDF", status: "partial" },
  { studentId: "ELE-1", amountDue: 50_000, amountPaid: 50_000, exemption: 0, currency: "CDF", status: "paid" },
  { studentId: "ELE-2", amountDue: 80_000, amountPaid: 0, exemption: 0, currency: "CDF", status: "unpaid", archivedAt: "2026-01-01" },
];

const MIXED_CURRENCY = [
  { amountDue: 100, amountPaid: 50, exemption: 0, currency: "CDF" },
  { amountDue: 20, amountPaid: 10, exemption: 0, currency: "USD" },
];

const PARITY_NOTES = [
  { studentId: "stu-a", subject: "Mathématiques", value: 10, scale: 20, evaluationCoefficient: 1, coefficient: 2, gradeStatus: "Validée" },
  { studentId: "stu-a", subject: "Mathématiques", value: 20, scale: 20, evaluationCoefficient: 3, coefficient: 2, gradeStatus: "Validée" },
  { studentId: "stu-a", subject: "Français", value: 12, scale: 20, evaluationCoefficient: 1, coefficient: 1, gradeStatus: "Validée" },
];

test("GREEN-FIN-01 même assiette student-fees → même taux de paiement Web/Mobile", () => {
  const web = webPaymentRate(FEES);
  const mobile = mobilePaymentRate(FEES);
  assert.deepEqual(web, mobile);
  assert.equal(web.value, "64 %");
  assert.equal(web.expectedAmount, 140_000);
  assert.equal(web.collectedAmount, 90_000);
});

test("GREEN-FIN-02 fail-closed multidevise identique Web/Mobile", () => {
  const web = webPaymentRate(MIXED_CURRENCY);
  const mobile = mobilePaymentRate(MIXED_CURRENCY);
  assert.equal(web.rate, null);
  assert.equal(mobile.rate, null);
  assert.equal(web.value, "—");
  assert.equal(mobile.value, web.value);
});

test("GREEN-FIN-03 formatage montant identique Web/Mobile", () => {
  assert.equal(webFinanceAmount(15000, "CDF"), mobileFinanceAmount(15000, "CDF"));
  assert.equal(webFinanceAmount("12,5", "FC"), mobileFinanceAmount("12,5", "FC"));
});

test("GREEN-DATE-01 contrat UI JJ-MM-AAAA identique Web/Mobile", () => {
  assert.equal(webHint, "JJ-MM-AAAA");
  assert.equal(mobileHint, webHint);
  assert.equal(webFormatDate("2026-09-17"), "17-09-2026");
  assert.equal(mobileFormatDate("2026-09-17"), webFormatDate("2026-09-17"));
  assert.equal(mobileFormatDate("2026-09-17"), "17-09-2026");
  assert.equal(webFormatDate("05-01-2026"), mobileFormatDate("05-01-2026"));
  assert.equal(webFormatDate("2026-01-05T08:00:00.000Z"), "05-01-2026");
  assert.equal(mobileFormatDate("2026-01-05T08:00:00.000Z"), "05-01-2026");
});

test("GREEN-ATT-01 statuts assistés identiques (Présent+Retard)", () => {
  assert.equal(presenceIsAttended("Présent"), true);
  assert.equal(presenceIsAttended("Retard"), true);
  assert.equal(presenceIsAttended("Absent"), false);
  assert.equal(presenceIsAttended("Justifié"), false);
  assert.equal(isAttendedStatus("Présent"), presenceIsAttended("Présent"));
  assert.equal(isAttendedStatus("Retard"), presenceIsAttended("Retard"));
  assert.equal(isAttendedStatus("Justifié"), presenceIsAttended("Justifié"));
  assert.equal(webPresenceLabel, mobilePresenceLabel);
});

test("GREEN-ATT-02 ligne persistée → même hydratation Web/Mobile", () => {
  const persisted = { present: false, status: "Absent" as const };
  assert.equal(rollCallInitialStatus(persisted), "Absent");
  assert.equal(hydrateRollCallStatus(persisted), "Absent");
});

test("GREEN-PED-01 moyenne générale Mobile = formule canonique (17,5×2+12×1)/3", () => {
  const result = canonicalStudentGeneralAverage(PARITY_NOTES as never);
  const expected = (17.5 * 2 + 12 * 1) / 3;
  const flatForbidden = (10 * 1 + 20 * 3 + 12 * 1) / 5;
  assert.equal(result.available, true);
  assert.ok(result.average != null);
  assert.ok(Math.abs((result.average as number) - expected) < 1e-9);
  assert.notEqual(Number(result.average?.toFixed(1)), Number(flatForbidden.toFixed(1)));
});

test("GREEN-RBAC-01 catalogues CRUD : intersection métier commune présente", () => {
  const shared = [
    "Pays",
    "Établissements",
    "Utilisateurs",
    "Classes",
    "Élèves",
    "Enseignants",
    "Présences",
    "Notes",
    "Bulletins",
    "Paiements",
    "Messages",
  ];
  for (const moduleName of shared) {
    assert.ok(webCrudModules.includes(moduleName as never), `Web manque ${moduleName}`);
    assert.ok((mobileCrudModules as readonly string[]).includes(moduleName), `Mobile manque ${moduleName}`);
  }
});
