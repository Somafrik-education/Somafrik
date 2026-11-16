import assert from "node:assert/strict";
import type { CanonicalEvaluation } from "./evaluationsV2";
import { filterCanonicalEvaluationsByClassAndType } from "./evaluationListFilters";

const rows = [
  { evaluationId: "a1", classId: "uuid-A", className: "6A", evaluationTypeId: "devoir" },
  { evaluationId: "a2", classId: "uuid-A", className: "6A", evaluationTypeId: "exam" },
  { evaluationId: "b1", classId: "uuid-B", className: "6B", evaluationTypeId: "exam" },
  { evaluationId: "none", classId: "", className: "6A", evaluationTypeId: "exam" },
] as CanonicalEvaluation[];
assert.deepEqual(filterCanonicalEvaluationsByClassAndType(rows, "uuid-A", "").map(x=>x.evaluationId), ["a1","a2"]);
assert.deepEqual(filterCanonicalEvaluationsByClassAndType(rows, "uuid-A", "exam").map(x=>x.evaluationId), ["a2"]);
assert.deepEqual(filterCanonicalEvaluationsByClassAndType(rows, "uuid-B", "exam").map(x=>x.evaluationId), ["b1"]);
assert.deepEqual(filterCanonicalEvaluationsByClassAndType(rows, "uuid-Z", "").map(x=>x.evaluationId), []);
console.log("NOTES-1103 mobile evaluation class/type filtering PASS");
