import { request, requestBlob } from "../api/client";

export type StudentFileType =
  | "BIRTH_CERTIFICATE" | "PHOTO" | "IDENTITY_CARD" | "PASSPORT"
  | "VACCINATION_RECORD" | "MEDICAL_CERTIFICATE" | "REPORT_CARD"
  | "TRANSFER_CERTIFICATE" | "PROOF_OF_ADDRESS" | "OTHER";

export const STUDENT_FILE_TYPES: Readonly<Record<StudentFileType, string>> = {
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
};

export interface StudentStoredDocument {
  id: string;
  studentId: string;
  documentType: StudentFileType;
  title: string;
  status: "submitted" | "verified" | "archived";
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
}

export const STUDENT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const STUDENT_FILE_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

const prefix = (studentId: string) => "/students/" + encodeURIComponent(studentId) + "/documents";

export function validateStudentFile(file: File, type: StudentFileType): string | null {
  if (!file || file.size <= 0) return "Sélectionnez un fichier non vide.";
  if (file.size > STUDENT_FILE_MAX_BYTES) return "Le fichier dépasse 10 Mo.";
  if (!STUDENT_FILE_MIME.includes(file.type as typeof STUDENT_FILE_MIME[number])) {
    return "Seuls les fichiers PDF, JPEG et PNG sont autorisés.";
  }
  if (type === "PHOTO" && !file.type.startsWith("image/")) {
    return "La photo doit être une image.";
  }
  return null;
}

export const studentAdministrativeDocumentsApi = {
  list: (studentId: string) =>
    request<{ documents: StudentStoredDocument[] }>(prefix(studentId)),
  upload: (studentId: string, type: StudentFileType, file: File) => {
    const failure = validateStudentFile(file, type);
    if (failure) throw new Error(failure);
    return request<StudentStoredDocument>(prefix(studentId), {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        // HTTP Headers sont ByteString : accents et contrôles sont neutralisés.
        "X-Filename": file.name.replace(/[^\x20-\x7E]/g, "_"),
        "X-Document-Type": type,
      },
      body: file,
    });
  },
  verify: (studentId: string, documentId: string) =>
    request<StudentStoredDocument>(prefix(studentId) + "/" + encodeURIComponent(documentId) + "/verify", {
      method: "POST",
    }),
  archive: (studentId: string, documentId: string) =>
    request<StudentStoredDocument>(prefix(studentId) + "/" + encodeURIComponent(documentId) + "/archive", {
      method: "POST",
    }),
  download: (studentId: string, documentId: string) =>
    requestBlob(prefix(studentId) + "/" + encodeURIComponent(documentId) + "/file"),
};
