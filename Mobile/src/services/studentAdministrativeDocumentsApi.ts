import * as FileSystem from "expo-file-system/legacy";
import { ApiClientError, httpRequest } from "./httpClient";

export const STUDENT_DOC_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
export const STUDENT_DOC_MAX_BYTES = 10 * 1024 * 1024;

export const STUDENT_DOC_TYPES = {
  BIRTH_CERTIFICATE: "Acte de naissance",
  PHOTO: "Photo",
  IDENTITY_CARD: "Pièce d'identité",
  PASSPORT: "Passeport",
  VACCINATION_RECORD: "Carnet de vaccination",
  MEDICAL_CERTIFICATE: "Certificat médical",
  REPORT_CARD: "Bulletin scolaire",
  TRANSFER_CERTIFICATE: "Certificat de transfert",
  PROOF_OF_ADDRESS: "Justificatif de domicile",
  OTHER: "Autre document",
} as const;

export type StudentDocType = keyof typeof STUDENT_DOC_TYPES;

export interface StudentDocRecord {
  id: string;
  studentId: string;
  documentType: StudentDocType;
  title: string;
  status: "submitted" | "verified" | "archived";
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
}

export type StudentDocFile = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

function studentDocsPath(studentId: string) {
  return "/students/" + encodeURIComponent(studentId) + "/documents";
}

export function validateStudentDocUpload(mimeType: string, size: number, type: StudentDocType) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new ApiClientError("Impossible de mesurer le fichier.");
  }
  if (size > STUDENT_DOC_MAX_BYTES) {
    throw new ApiClientError("Le fichier dépasse 10 Mo.");
  }
  if (!STUDENT_DOC_MIME.includes(mimeType as typeof STUDENT_DOC_MIME[number])) {
    throw new ApiClientError("Seuls les PDF, JPEG et PNG sont autorisés.");
  }
  if (type === "PHOTO" && !mimeType.startsWith("image/")) {
    throw new ApiClientError("Une photo doit être une image.");
  }
}

export const studentAdministrativeDocumentsApi = {
  list: (studentId: string) =>
    httpRequest<{ documents: StudentDocRecord[] }>(studentDocsPath(studentId)),
  async upload(studentId: string, type: StudentDocType, file: StudentDocFile) {
    const mimeType = String(file.mimeType ?? "").toLowerCase().trim();
    let size = Number(file.size ?? 0);
    if (size <= 0) {
      const info = await FileSystem.getInfoAsync(file.uri);
      size = info.exists && "size" in info ? Number(info.size ?? 0) : 0;
    }
    validateStudentDocUpload(mimeType, size, type);
    // L'API attend un flux binaire, jamais FormData. fetch() ne sert qu'à lire
    // le fichier local file:// ; le transport HTTP reste centralisé dans httpRequest.
    const blob = await (await fetch(file.uri)).blob();
    validateStudentDocUpload(mimeType, blob.size, type);
    return httpRequest<StudentDocRecord>(studentDocsPath(studentId), {
      method: "POST",
      timeoutMs: 60_000,
      body: blob,
      headers: {
        "Content-Type": mimeType,
        "X-Filename": file.name,
        "X-Document-Type": type,
      },
    });
  },
  verify: (studentId: string, documentId: string) =>
    httpRequest<StudentDocRecord>(studentDocsPath(studentId) + "/" + encodeURIComponent(documentId) + "/verify", {
      method: "POST",
    }),
  archive: (studentId: string, documentId: string) =>
    httpRequest<StudentDocRecord>(studentDocsPath(studentId) + "/" + encodeURIComponent(documentId) + "/archive", {
      method: "POST",
    }),
};
