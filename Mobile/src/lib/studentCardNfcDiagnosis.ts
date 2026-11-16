/** R3-2: Android NFC UID diagnosis. Never records tokens or changes cards. */
import { resolveCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { cardTokenFromNdef, type NtagIdentity } from "./studentCardNfcEncoding";

export type PhysicalDiagnosis = NtagIdentity & {
  ndef: { state: "empty" | "somafrik" | "foreign" | "unreadable"; publicId?: string };
  readOnly: boolean;
};
export type DiagnosisResult = {
  code: string; sameSchool: boolean | null; message: string;
  physical: string; physicalMessage: string; physicalSource: "client_declared";
  recoverable: boolean; actions: string[];
  card?: { id: string; status: string; encodingState: string; tagType: string };
  holder?: { id: string; firstName: string; lastName: string; studentCode: string; className?: string | null; classCode?: string | null } | null;
};
/** Fail closed: platform, family and multi-role sessions are not eligible. Server remains the authority. */
export function canDiagnoseNfc(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  const role = resolveCanonicalRoleIdentity(session);
  const keys = role.roleKeys.map(k => k.toUpperCase());
  if (!keys.length || keys.some(k => k !== "SCHOOL_ADMIN")) return false;
  return role.permissions.includes("Élèves:UPDATE");
}
export function classifyDiagnosisNdef(value: string): PhysicalDiagnosis["ndef"] {
  if (value === "") return { state: "empty" };
  try {
    const token = cardTokenFromNdef(value);
    // Never return the token secret; only the public identifier.
    return { state: "somafrik", publicId: token.split(".")[0] };
  } catch {
    return { state: "foreign" };
  }
}
/** Only same-school students can appear in the UI, independent of a malformed server response. */
export function visibleDiagnosisHolder(value: DiagnosisResult) {
  return value.sameSchool === true && value.code !== "OTHER_SCHOOL" ? value.holder ?? null : null;
}
export function sanitizeDiagnosisResult(raw: unknown): DiagnosisResult {
  if (!raw || typeof raw !== "object") throw new Error("Réponse de diagnostic invalide.");
  const value = raw as Partial<DiagnosisResult>;
  if (typeof value.code !== "string" || typeof value.message !== "string"
      || ![true, false, null].includes(value.sameSchool as boolean | null)
      || value.physicalSource !== "client_declared" || !Array.isArray(value.actions)) throw new Error("Réponse de diagnostic invalide.");
  if (value.sameSchool !== true) return {
    code: value.code, message: value.message, sameSchool: value.sameSchool ?? null,
    physical: String(value.physical || ""), physicalMessage: String(value.physicalMessage || ""),
    physicalSource: "client_declared", recoverable: false,
    actions: value.code === "OTHER_SCHOOL" ? ["contact_owner_school"] : [],
  };
  return value as DiagnosisResult;
}
