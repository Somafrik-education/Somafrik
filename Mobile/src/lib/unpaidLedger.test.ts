import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReadRoute } from "../domain/security/permissions";
import { getAllowedRoleDrawerItems } from "../navigation/roleDrawerPreferences";
import { isSchoolScopedApiPath } from "./requestSchoolScope";
import {
  EMPTY_UNPAID_LEDGER,
  classifyUnpaidLedgerFailure,
  normalizeUnpaidLedger,
  unpaidLedgerMetricValue,
  type UnpaidLedgerState,
} from "./unpaidLedger";

const SCHOOL_A = "CD-IN-26-001";
const SCHOOL_B = "BI-EC-26-001";

const payload = {
  rows: [
    {
      studentId: "stu-a",
      studentName: "Ester Amena",
      schoolCode: SCHOOL_A,
      amountDue: 50_000,
      currency: "CDF",
    },
    {
      studentId: "stu-a",
      studentName: "Ester Amena",
      schoolCode: SCHOOL_A,
      amountDue: 20_000,
      currency: "CDF",
    },
    {
      studentId: "stu-b",
      studentName: "Autre école",
      schoolCode: SCHOOL_B,
      amountDue: 99_000,
      currency: "CDF",
    },
    {
      studentId: "stu-soldé",
      studentName: "Soldé",
      schoolCode: SCHOOL_A,
      amountDue: 0,
      currency: "CDF",
    },
  ],
};

const scoped = normalizeUnpaidLedger(payload, SCHOOL_A.toLowerCase());
assert.equal(scoped.rows.length, 2, "les lignes d'une autre école et les soldes nuls sont exclus");
assert.equal(scoped.studentCount, 1, "le KPI compte les élèves uniques, pas les obligations");
assert.equal(scoped.totalAmountDue, 70_000, "le reste dû conserve toutes les obligations ouvertes du tenant");
assert.equal(scoped.currency, "CDF");
assert.ok(scoped.rows.every((row) => row.schoolCode === SCHOOL_A), "aucune donnée inter-établissement");

const malformed = normalizeUnpaidLedger({ rows: [{ amountDue: 5 }, null, "x"] }, SCHOOL_A);
assert.deepEqual(malformed, EMPTY_UNPAID_LEDGER, "une réponse sans identité tenant exploitable échoue fermée");

assert.equal(classifyUnpaidLedgerFailure({ status: 401 }).status, "unauthenticated");
assert.match(classifyUnpaidLedgerFailure({ status: 401 }).errorMessage ?? "", /Session expirée/);
assert.equal(classifyUnpaidLedgerFailure({ status: 403 }).status, "forbidden");
assert.match(classifyUnpaidLedgerFailure({ status: 403 }).errorMessage ?? "", /Accès refusé/);
assert.equal(classifyUnpaidLedgerFailure(new Error("Network request failed")).status, "offline");
assert.equal(classifyUnpaidLedgerFailure({ status: 500, message: "Erreur serveur" }).status, "error");

const successState: UnpaidLedgerState = { ...scoped, status: "success" };
const forbiddenState: UnpaidLedgerState = { ...EMPTY_UNPAID_LEDGER, status: "forbidden" };
assert.equal(unpaidLedgerMetricValue(successState), "1");
assert.equal(unpaidLedgerMetricValue(forbiddenState), "—", "403 ne devient jamais un faux zéro");

function session(permissions: string[]) {
  return {
    role: "accountant",
    roleLabel: "Comptable",
    permissions,
    user: { role: "Comptable", permissions, schoolCode: SCHOOL_A },
    school: { code: SCHOOL_A },
  };
}

const unpaidReader = session(["Impayés:READ"]);
const paymentsOnly = session(["Paiements:READ"]);
assert.equal(canReadRoute(unpaidReader, "Unpaid"), true, "Impayés:READ ouvre la route dédiée");
assert.equal(canReadRoute(paymentsOnly, "Unpaid"), false, "Paiements:READ seul n'ouvre pas les impayés");
assert.equal(
  getAllowedRoleDrawerItems(unpaidReader).some((item) => item.route === "Unpaid"),
  true,
  "le Comptable autorisé retrouve Impayés dans son drawer",
);
assert.equal(
  getAllowedRoleDrawerItems(paymentsOnly).some((item) => item.route === "Unpaid"),
  false,
  "le drawer reste fail-closed sans Impayés:READ",
);

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiSource = fs.readFileSync(path.join(srcRoot, "services/api.ts"), "utf8");
const homeSource = fs.readFileSync(path.join(srcRoot, "screens/HomeScreen.tsx"), "utf8");
const paymentsSource = fs.readFileSync(path.join(srcRoot, "screens/PaymentsScreen.tsx"), "utf8");
assert.match(apiSource, /request<unknown>\("\/backoffice\/finance\/unpaid"\)/);
assert.equal(isSchoolScopedApiPath("/backoffice/finance/unpaid"), true, "le header tenant couvre GET unpaid");
assert.match(homeSource, /hasSecurityPermission\(session, "Impayés", "READ"\)/);
assert.match(homeSource, /navigate\("Unpaid"\)/);
assert.doesNotMatch(homeSource, /unpaidPayments[\s\S]{0,500}paymentStats\.pending/);
assert.doesNotMatch(paymentsSource, /paymentStats\.pending/);

console.log("OK L1 unpaid ledger : API canonique, tenant, 401/403, RBAC et surfaces Mobile");
