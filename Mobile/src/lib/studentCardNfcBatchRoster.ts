import { nfcFailure } from "./studentCardNfcEncoding";
import type { BatchRoster } from "./studentCardNfcBatch";
export type BatchScope = {
  schoolId: string;
  schoolCodes: string[];
  classId: string;
  classCode: string;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): Record<string, unknown>[] => {
  if (
    !Array.isArray(value) ||
    value.some((r) => !r || typeof r !== "object" || Array.isArray(r))
  )
    throw nfcFailure("NFC_RESPONSE_INVALID");
  return value as Record<string, unknown>[];
};
export function parseBatchRoster(
  scope: BatchScope,
  classes: unknown,
  pupils: unknown,
): BatchRoster {
  if (
    !uuid(scope.schoolId) ||
    !uuid(scope.classId) ||
    !scope.classCode ||
    !scope.schoolCodes.length
  )
    throw nfcFailure("NFC_SCOPE_DENIED");
  const matches = rows(classes).filter(
    (r) =>
      text(r.id ?? r.classId) === scope.classId &&
      text(r.classCode ?? r.publicId) === scope.classCode,
  );
  if (matches.length !== 1) throw nfcFailure("NFC_SCOPE_DENIED");
  const schoolClass = matches[0];
  if (
    (schoolClass.schoolId && schoolClass.schoolId !== scope.schoolId) ||
    !scope.schoolCodes.includes(text(schoolClass.schoolCode)) ||
    !["active", "actif"].includes(text(schoolClass.status).toLowerCase())
  )
    throw nfcFailure("NFC_SCOPE_DENIED");
  const students = rows(pupils).map((r) => {
    const id = text(r.studentUuid ?? r.studentId ?? r.id);
    if (
      !uuid(id) ||
      text(r.schoolId) !== scope.schoolId ||
      text(r.classId) !== scope.classId ||
      text(r.classCode) !== scope.classCode
    )
      throw nfcFailure("NFC_SCOPE_DENIED");
    const name =
      text(r.name) ||
      [text(r.firstName), text(r.lastName)].filter(Boolean).join(" ");
    const code = text(r.studentCode ?? r.publicId ?? r.matricule);
    if (!name || !code) throw nfcFailure("NFC_RESPONSE_INVALID");
    return { id, name, code };
  });
  if (new Set(students.map((s) => s.id)).size !== students.length)
    throw nfcFailure("NFC_RESPONSE_INVALID");
  return {
    classId: scope.classId,
    classCode: scope.classCode,
    className: text(schoolClass.name ?? schoolClass.className),
    students,
  };
}
export function createBatchRosterLoader(
  request: <T>(path: string) => Promise<T>,
  scope: BatchScope,
) {
  return async () => {
    const classes = await request<unknown>("/classes");
    // Validate catalogue before fetching any pupil data for a supplied class.
    parseBatchRoster(scope, classes, []);
    const students = await request<unknown>(
      `/classes/${encodeURIComponent(scope.classCode)}/students`,
    );
    return parseBatchRoster(scope, classes, students);
  };
}
