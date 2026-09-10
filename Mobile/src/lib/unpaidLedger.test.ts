import assert from "node:assert/strict";
import {
  classifyUnpaidError,
  parseUnpaidPayload,
  unpaidClassLabel,
  unpaidStatusLabel,
  unpaidStudentCount,
} from "./unpaidLedger";

const payload = {
  rows: [
    {
      studentId: "stu-a",
      studentName: "Awa Diallo",
      className: "6e A",
      schoolCode: "CD-IN-26-001",
      amountDue: 50_000,
      status: "En retard",
      severity: "Retard moyen",
      currency: "CDF",
    },
    {
      studentId: "stu-b",
      studentName: "Jean K.",
      className: "",
      schoolCode: "CD-IN-26-001",
      amountDue: 0,
      status: "Payé",
    },
  ],
};

const rows = parseUnpaidPayload(payload);
assert.equal(rows.length, 1, "les soldés (amountDue=0) sont exclus");
assert.equal(rows[0].studentName, "Awa Diallo");
assert.equal(rows[0].className, "6e A");
assert.equal(unpaidStudentCount(rows), 1);
assert.equal(unpaidClassLabel(null), "—");
assert.equal(unpaidClassLabel(""), "—");
assert.equal(unpaidClassLabel("6e A"), "6e A");
assert.equal(unpaidStatusLabel({ status: "", severity: null }), "—");
assert.equal(unpaidStatusLabel({ status: "En retard", severity: "Retard critique" }), "En retard");

const forbidden = classifyUnpaidError({ status: 403, message: "FORBIDDEN" });
assert.equal(forbidden.gate, "forbidden");
const unauth = classifyUnpaidError({ status: 401, message: "UNAUTHORIZED" });
assert.equal(unauth.gate, "unauthenticated");
const boom = classifyUnpaidError({ status: 500, message: "INTERNAL" });
assert.equal(boom.gate, "ok");
assert.equal(boom.status, "error");

console.log("OK: unpaidLedger parse / labels / 401 / 403");
