import type { CanonicalEvaluation } from "./evaluationsV2";

/** La classe canonique est une identité, jamais une comparaison floue de libellés. */
export function filterCanonicalEvaluationsByClassAndType(
  rows: readonly CanonicalEvaluation[],
  classId: string,
  typeKey: string,
): CanonicalEvaluation[] {
  return rows.filter((row) => {
    if (classId && (!row.classId || row.classId !== classId)) return false;
    const rowType = row.evaluationTypeId || row.evaluationTypeCode || row.evaluationType || "";
    return !typeKey || rowType === typeKey;
  });
}
