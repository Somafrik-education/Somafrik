/**
 * KPI Accueil Mobile — valeur + libellé (actifs / nombre de paiements).
 *   npx tsx Mobile/src/lib/homeDashboardKpis.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import {
  ACTIVE_USERS_KPI_LABEL,
  PAYMENT_RATE_KPI_LABEL,
  PAYMENTS_KPI_LABEL,
  formatHomeActiveUsersKpi,
  formatHomePaymentRateKpi,
  formatHomePaymentsKpi,
} from "./homeDashboardKpis";
import { formatPaymentRateKpi, type StudentFeeObligation } from "./paymentRateKpi";

function users(statuses: string[]) {
  return statuses.map((status, index) => ({ id: `u-${index}`, status }));
}

function payment(id: string, studentId: string, status = "Payé") {
  return { id, studentId, amount: 1000, status };
}

function fee(
  studentId: string,
  extras: Partial<StudentFeeObligation> = {},
): StudentFeeObligation {
  return {
    studentId,
    amountDue: 1000,
    amountPaid: 0,
    exemption: 0,
    status: "À payer",
    ...extras,
  };
}

function run() {
  const seventeenActive = users(Array.from({ length: 17 }, () => "Actif"));
  const usersKpiAllActive = formatHomeActiveUsersKpi(seventeenActive);
  assert.equal(usersKpiAllActive.label, "Utilisateurs actifs");
  assert.equal(usersKpiAllActive.label, ACTIVE_USERS_KPI_LABEL);
  assert.equal(usersKpiAllActive.value, "17");

  const withArchived = users(["Archivé", ...Array.from({ length: 16 }, () => "Actif")]);
  assert.equal(formatHomeActiveUsersKpi(withArchived).value, "16");
  assert.equal(formatHomeActiveUsersKpi(withArchived).label, ACTIVE_USERS_KPI_LABEL);

  const withSuspended = users(["Suspendu", ...Array.from({ length: 16 }, () => "Actif")]);
  assert.equal(formatHomeActiveUsersKpi(withSuspended).value, "16");

  const withDisabled = users(["Désactivé", ...Array.from({ length: 16 }, () => "Actif")]);
  assert.equal(formatHomeActiveUsersKpi(withDisabled).value, "16");

  const withInactive = users(["inactive", ...Array.from({ length: 16 }, () => "Actif")]);
  assert.equal(formatHomeActiveUsersKpi(withInactive).value, "16");

  assert.equal(formatHomeActiveUsersKpi([{ status: "Archivé" }]).value, "0");

  const emptyPayments = formatHomePaymentsKpi([]);
  assert.equal(emptyPayments.label, "Paiements");
  assert.equal(emptyPayments.label, PAYMENTS_KPI_LABEL);
  assert.equal(emptyPayments.value, "0");
  assert.doesNotMatch(emptyPayments.value, /%/);

  const onePaid = formatHomePaymentsKpi([payment("p1", "stu-1", "Payé")]);
  assert.equal(onePaid.value, "1");
  assert.doesNotMatch(onePaid.value, /%/);

  const several = formatHomePaymentsKpi([
    payment("p1", "stu-1", "Payé"),
    payment("p2", "stu-2", "En attente"),
    payment("p3", "stu-3", "Payé"),
  ]);
  assert.equal(several.value, "3");
  assert.doesNotMatch(several.value, /%/);

  const orphanPayment = [payment("p-orphan", "student-absent-from-snapshot", "Payé")];
  const studentsData = [{ id: "other-student-in-snapshot" }];
  const homeCount = formatHomePaymentsKpi(orphanPayment);
  assert.equal(homeCount.value, "1", "paiement canonique hors studentsData toujours compté");
  const filteredLegacy = getPaymentStats(
    orphanPayment,
    studentsData.map((row) => row.id),
  );
  assert.equal(filteredLegacy.total, 0, "l'ancien filtre studentsData excluait à tort ce paiement");
  const canonicalStats = getPaymentStats(orphanPayment);
  assert.equal(canonicalStats.total, 1);
  assert.notEqual(homeCount.value, `${canonicalStats.rate}%`);
  assert.doesNotMatch(homeCount.value, /%/);

  const rateEmpty = formatHomePaymentRateKpi([]);
  assert.equal(rateEmpty.label, PAYMENT_RATE_KPI_LABEL);
  assert.equal(rateEmpty.value, "—");
  assert.equal(formatPaymentRateKpi([]).value, "—");

  const fiveFeesOnePaid = [
    fee("s1", { amountPaid: 1000, status: "Payé" }),
    fee("s2"),
    fee("s3"),
    fee("s4"),
    fee("s5"),
  ];
  const rateTwenty = formatHomePaymentRateKpi(fiveFeesOnePaid);
  assert.equal(rateTwenty.label, "Taux de paiement");
  assert.equal(rateTwenty.value, "20 %");

  const rateNonePaid = formatHomePaymentRateKpi(["s1", "s2", "s3", "s4", "s5"].map((id) => fee(id)));
  assert.equal(rateNonePaid.value, "0 %");

  const rateAllPaid = formatHomePaymentRateKpi(
    ["s1", "s2", "s3", "s4", "s5"].map((id) => fee(id, { amountPaid: 1000, status: "Payé" })),
  );
  assert.equal(rateAllPaid.value, "100 %");

  const singlePaymentRow = [payment("p1", "stu-1", "PAYE")];
  assert.equal(formatHomePaymentsKpi(singlePaymentRow).value, "1");
  assert.notEqual(
    rateTwenty.value,
    "100 %",
    "1 paiement en base parmi 5 obligations ne peut pas afficher 100 %",
  );

  const homeSrc = fs.readFileSync(path.join(process.cwd(), "src", "screens", "HomeScreen.tsx"), "utf8");
  assert.match(homeSrc, /ACTIVE_USERS_KPI_LABEL/);
  assert.match(homeSrc, /PAYMENTS_KPI_LABEL/);
  assert.match(homeSrc, /PAYMENT_RATE_KPI_LABEL/);
  assert.match(homeSrc, /TODAY_PRESENCE_KPI_LABEL/);
  assert.match(homeSrc, /formatHomePaymentsKpi/);
  assert.match(homeSrc, /formatHomePaymentRateKpi/);
  assert.match(homeSrc, /studentFeesSnapshot/);
  assert.match(homeSrc, /loadStudentFees/);
  assert.match(homeSrc, /getTodayEstablishmentPresenceKpi/);
  assert.doesNotMatch(homeSrc, /usersValue, "Utilisateurs"/);
  assert.doesNotMatch(homeSrc, /paymentStats\.rate/);
  assert.doesNotMatch(homeSrc, /function isActiveUserAccount/);
  assert.doesNotMatch(homeSrc, /getPaymentStats\([^)]*studentIds/);

  const roleHome = fs.readFileSync(path.join(process.cwd(), "src", "lib", "roleHomeConfig.ts"), "utf8");
  assert.match(roleHome, /kpiKeys: \["users", "presence", "students", "paymentRate"\]/);
  assert.doesNotMatch(roleHome, /kpiKeys: \["users", "classes", "students"/);

  console.log("OK: homeDashboardKpis valeur+libellé utilisateurs actifs / paiements");
}

run();
