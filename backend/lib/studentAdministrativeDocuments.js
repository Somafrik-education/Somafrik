"use strict";

/**
 * FICHE-DOC-01 — documents administratifs physiques d'un élève.
 * La table student_documents reste canonique ; les lignes administratives
 * sont identifiées par metadata.source (aucun second registre ou table parallèle).
 * Tous les appels SQL sont scellés school_id + student_id, sans accès plateforme.
 */
const { randomUUID } = require("node:crypto");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { isParentOrStudentRole } = require("./classStudentsAuthz");
const {
  validateUploadBuffer,
  persistAttachmentBytes,
  removeStoredAttachment,
  readAttachmentBytes,
} = require("./communicationsAttachments");

const DOC_TYPES = Object.freeze({
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
});
const SOURCE = "administrative_upload";

function error(statusCode, message, code) {
  const failure = new Error(message);
  failure.statusCode = statusCode;
  failure.code = code;
  return failure;
}

function assertDocumentRight(principal, action) {
  const rights = Array.isArray(principal?.permissions) ? principal.permissions : [];
  const roles = [principal?.roleKey, principal?.role, principal?.primaryRoleKey]
    .filter(Boolean).map((role) => String(role).trim().toUpperCase());
  const forbiddenRole = roles.some((role) =>
    ["COUNTRY_ADMIN", "ADMIN_PAYS", "ADMIN PAYS", "SUPER_ADMIN", "STUDENT", "STUDENT_USER"].includes(role) ||
    isParentOrStudentRole(role),
  );
  if (isSuperAdminPrincipal(principal) || forbiddenRole ||
      !principal?.schoolCode || principal.schoolCode === "*") {
    throw error(403, "Accès aux pièces d'élève refusé.", "STUDENT_DOC_DENIED");
  }
  const required = action === "read" ? "Documents:READ"
    : action === "create" ? "Documents:CREATE" : "Documents:UPDATE";
  if (!rights.includes(required)) {
    throw error(403, "Permission documentaire insuffisante.", "STUDENT_DOC_DENIED");
  }
}

function requireType(value) {
  const type = String(value ?? "").trim().toUpperCase();
  if (!Object.hasOwn(DOC_TYPES, type)) {
    throw error(400, "Type de document élève non autorisé.", "STUDENT_DOC_TYPE_INVALID");
  }
  return type;
}

function toPublic(row) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    documentType: row.document_type,
    title: row.title,
    status: row.status,
    fileName: typeof metadata.fileName === "string" ? metadata.fileName : "",
    mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : "",
    fileSize: Number(metadata.fileSize) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: typeof metadata.verifiedAt === "string" ? metadata.verifiedAt : null,
  };
}

function requireStore(repo) {
  if (repo?.engine === "memory" ||
      typeof repo?.one !== "function" ||
      typeof repo?.all !== "function" ||
      typeof repo?.query !== "function") {
    throw error(503, "Documents élève : PostgreSQL requis.", "STUDENT_DOC_PG_REQUIRED");
  }
  return repo;
}

async function requireStudent(repo, studentRef, schoolCode) {
  const row = await repo.one(
    "SELECT st.id, st.school_id FROM students st " +
    "JOIN schools sc ON sc.id = st.school_id " +
    "WHERE (st.student_code = $1 OR st.id::text = $1) " +
    // Côté Enrollment, schoolCode est TOUJOURS schools.login_code (membership UUID),
    // jamais l'ancien schools.school_code. Pas de fallback inter-tenant.
    "AND upper(btrim(sc.login_code)) = $2 LIMIT 1",
    [String(studentRef || "").trim(), String(schoolCode || "").trim().toUpperCase()],
  );
  if (!row) throw error(404, "Élève introuvable.", "STUDENT_DOC_NOT_FOUND");
  return row;
}

async function ownedDocument(repo, docId, student) {
  const row = await repo.one(
    "SELECT id, school_id, student_id, document_type, title, status, metadata, " +
    "storage_key, created_at, updated_at FROM student_documents " +
    "WHERE id::text = $1 AND student_id = $2 AND school_id = $3 " +
    "AND metadata->>'source' = $4 LIMIT 1",
    [String(docId || "").trim(), student.id, student.school_id, SOURCE],
  );
  if (!row) throw error(404, "Document introuvable.", "STUDENT_DOC_NOT_FOUND");
  return row;
}

/** Toujours appelé après l'autorisation dossier élève établie côté HTTP. */
function createStudentDocumentsService(repo) {
  const db = requireStore(repo);

  async function list({ studentRef, schoolCode, principal }) {
    assertDocumentRight(principal, "read");
    const student = await requireStudent(db, studentRef, schoolCode);
    const rows = await db.all(
      "SELECT id, student_id, document_type, title, status, metadata, created_at, updated_at " +
      "FROM student_documents WHERE school_id=$1 AND student_id=$2 " +
      "AND metadata->>'source'=$3 ORDER BY created_at DESC",
      [student.school_id, student.id, SOURCE],
    );
    return rows.map(toPublic);
  }

  async function upload({ studentRef, schoolCode, principal, documentType, buffer, mimeType, fileName }) {
    assertDocumentRight(principal, "create");
    const student = await requireStudent(db, studentRef, schoolCode);
    const type = requireType(documentType);
    const info = validateUploadBuffer(buffer, mimeType, fileName);
    if (type === "PHOTO" && !info.mimeType.startsWith("image/")) {
      throw error(400, "La photo doit être une image.", "STUDENT_DOC_TYPE_INVALID");
    }
    const storageKey = await persistAttachmentBytes(String(student.school_id) + "/student-documents", buffer);
    const metadata = {
      source: SOURCE,
      fileName: info.fileName,
      fileSize: info.fileSize,
      mimeType: info.mimeType,
      uploadedAt: new Date().toISOString(),
    };
    try {
      const row = await db.one(
        "INSERT INTO student_documents " +
        "(school_id, student_id, document_code, document_type, title, format, version, " +
        " storage_key, status, metadata) " +
        "VALUES ($1,$2,$3,$4,$5,$6,1,$7,'submitted',$8::jsonb) " +
        "RETURNING id, student_id, document_type, title, status, metadata, created_at, updated_at",
        [
          student.school_id, student.id, "DOC-" + randomUUID(),
          type, DOC_TYPES[type], info.mimeType === "application/pdf" ? "PDF" : "IMAGE",
          storageKey, JSON.stringify(metadata),
        ],
      );
      return toPublic(row);
    } catch (cause) {
      await removeStoredAttachment(storageKey);
      throw cause;
    }
  }

  async function verify({ studentRef, schoolCode, principal, documentId }) {
    assertDocumentRight(principal, "update");
    const student = await requireStudent(db, studentRef, schoolCode);
    const current = await ownedDocument(db, documentId, student);
    if (current.status !== "submitted") {
      throw error(409, "Seul un document déposé peut être vérifié.", "STUDENT_DOC_STATE_CONFLICT");
    }
    const row = await db.one(
      "UPDATE student_documents SET status='verified', updated_at=NOW(), " +
      "metadata=metadata || $4::jsonb " +
      "WHERE id=$1 AND student_id=$2 AND school_id=$3 AND status='submitted' " +
      "RETURNING id, student_id, document_type, title, status, metadata, created_at, updated_at",
      [current.id, student.id, student.school_id,
        JSON.stringify({ verifiedAt: new Date().toISOString() })],
    );
    if (!row) throw error(409, "Statut documentaire modifié entre-temps.", "STUDENT_DOC_STATE_CONFLICT");
    return toPublic(row);
  }

  async function archive({ studentRef, schoolCode, principal, documentId }) {
    assertDocumentRight(principal, "update");
    const student = await requireStudent(db, studentRef, schoolCode);
    const current = await ownedDocument(db, documentId, student);
    if (current.status === "archived") return toPublic(current);
    const row = await db.one(
      "UPDATE student_documents SET status='archived', updated_at=NOW(), " +
      "metadata=metadata || $4::jsonb " +
      "WHERE id=$1 AND student_id=$2 AND school_id=$3 AND status IN ('submitted','verified') " +
      "RETURNING id, student_id, document_type, title, status, metadata, created_at, updated_at",
      [current.id, student.id, student.school_id,
        JSON.stringify({ archivedAt: new Date().toISOString() })],
    );
    if (!row) throw error(409, "Statut documentaire modifié entre-temps.", "STUDENT_DOC_STATE_CONFLICT");
    return toPublic(row);
  }

  async function download({ studentRef, schoolCode, principal, documentId }) {
    assertDocumentRight(principal, "read");
    const student = await requireStudent(db, studentRef, schoolCode);
    const doc = await ownedDocument(db, documentId, student);
    if (doc.status === "archived") {
      throw error(404, "Document archivé.", "STUDENT_DOC_NOT_FOUND");
    }
    if (!doc.storage_key) throw error(404, "Fichier introuvable.", "STUDENT_DOC_NOT_FOUND");
    const bytes = await readAttachmentBytes(doc.storage_key);
    const metadata = doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
    return {
      bytes,
      mimeType: metadata.mimeType || "application/octet-stream",
      fileName: metadata.fileName || "document",
    };
  }

  return { list, upload, verify, archive, download };
}

module.exports = { DOC_TYPES, SOURCE, assertDocumentRight, requireType, createStudentDocumentsService };
