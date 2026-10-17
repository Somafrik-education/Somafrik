/** R3-2 — authenticated school-scoped, online-only diagnosis. Never sends a card token. */
import { httpRequest } from "./httpClient";
import { sanitizeDiagnosisResult, type DiagnosisResult, type PhysicalDiagnosis } from "../lib/studentCardNfcDiagnosis";

export async function diagnoseStudentNfcCard(physical: PhysicalDiagnosis): Promise<DiagnosisResult> {
  const payload = {
    uid: physical.uid,
    tagType: physical.tagType,
    ndef: physical.ndef,
    readOnly: physical.readOnly,
  };
  const response = await httpRequest<unknown>("/student-cards/nfc-diagnose", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return sanitizeDiagnosisResult(response);
}
