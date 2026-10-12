import assert from "node:assert/strict";
import { test } from "node:test";
import { studentDocumentsAccess } from "./studentDocumentsAccess";
import {
  activeStudentDocuments,
  requiredStudentDocumentStatuses,
} from "./studentDocumentRequirements";
import type { StudentDocRecord } from "../services/studentAdministrativeDocumentsApi";

function row(status: StudentDocRecord["status"], documentType: StudentDocRecord["documentType"]): StudentDocRecord {
  return {
    id: status + documentType, studentId: "stu-1", documentType, title: "Pièce",
    status, fileName: "f.pdf", mimeType: "application/pdf", fileSize: 128,
    createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
    verifiedAt: status === "verified" ? "2026-10-12T01:00:00Z" : null,
  };
}

test("DOC-03 : seules les permissions établissement explicites ouvrent les opérations", () => {
  assert.deepEqual(studentDocumentsAccess(null), { canRead: false, canCreate: false, canUpdate: false });
  assert.deepEqual(
    studentDocumentsAccess({ role: "parent_student", permissions: ["Documents:READ", "Documents:CREATE"] }),
    { canRead: false, canCreate: false, canUpdate: false },
  );
  assert.deepEqual(
    studentDocumentsAccess({ role: "Super Administrateur Somafrik", permissions: ["Documents:READ", "Documents:CREATE"] }),
    { canRead: false, canCreate: false, canUpdate: false },
  );
  assert.deepEqual(
    studentDocumentsAccess({ role: "Directeur", permissions: ["Documents:READ", "Documents:CREATE"] }),
    { canRead: true, canCreate: true, canUpdate: false },
  );
  assert.deepEqual(
    studentDocumentsAccess({ role: "Directeur", permissions: ["Documents:CREATE", "Documents:UPDATE"] }),
    { canRead: false, canCreate: false, canUpdate: false },
  );
});

test("DOC-03 : un dépôt ne compte pas comme vérifié, une archive est exclue", () => {
  const docs = [
    row("submitted", "BIRTH_CERTIFICATE"),
    row("verified", "PHOTO"),
    row("archived", "MEDICAL_CERTIFICATE"),
  ];
  assert.equal(activeStudentDocuments(docs).length, 2);
  const req = requiredStudentDocumentStatuses(docs);
  assert.equal(req.find(x => x.key === "BIRTH_CERTIFICATE")?.status, "submitted");
  assert.equal(req.find(x => x.key === "PHOTO")?.status, "verified");
  assert.equal(req.find(x => x.key === "MEDICAL_CERTIFICATE")?.status, "missing");
  assert.equal(req.find(x => x.key === "IDENTITY")?.status, "missing");
});

test("DOC-03 : passeport et carte d'identité satisfont la même exigence documentaire", () => {
  const req = requiredStudentDocumentStatuses([row("verified", "PASSPORT")]);
  assert.equal(req.find(x => x.key === "IDENTITY")?.status, "verified");
});
