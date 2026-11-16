import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card, SectionHeader } from "../../design-system";
import { StudentDocumentsList } from "./StudentDocumentsList";
import { StudentDocumentsSummary } from "./StudentDocumentsSummary";
import {
  studentAdministrativeDocumentsApi,
  STUDENT_FILE_TYPES,
  validateStudentFile,
  type StudentFileType,
  type StudentStoredDocument,
} from "../../lib/studentAdministrativeDocumentsApi";
import { buildCanonicalStudentDocumentsView } from "../../lib/studentAdministrativeDocumentView";
import { useFeaturePermissions, usePermissionContext } from "../../lib/usePermissionContext";
import { canAccessSchoolBackOffice } from "../../lib/permissions";

interface StudentDocumentsTabProps {
  workspace: StudentWorkspaceViewModel;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Opération documentaire indisponible.";
}

export function StudentDocumentsTab({ workspace }: StudentDocumentsTabProps) {
  const permissions = useFeaturePermissions("Documents");
  const ctx = usePermissionContext();
  const allowed = permissions.canRead && canAccessSchoolBackOffice(ctx.user?.role);
  const [documents, setDocuments] = useState<StudentStoredDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [documentType, setDocumentType] = useState<StudentFileType>("BIRTH_CERTIFICATE");
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) {
      setDocuments(null);
      return;
    }
    let current = true;
    setDocuments(null);
    setLoadError(null);
    void studentAdministrativeDocumentsApi.list(workspace.studentId)
      .then((response) => {
        if (!current) return;
        if (!Array.isArray(response.documents)) {
          throw new Error("Réponse documentaire invalide.");
        }
        setDocuments(response.documents);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(messageOf(error));
      });
    return () => { current = false; };
  }, [allowed, reload, workspace.studentId]);

  const computed = useMemo(
    () => documents ? buildCanonicalStudentDocumentsView(workspace.studentId, documents) : null,
    [documents, workspace.studentId],
  );

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permissions.canCreate || !allowed || working) return;
    if (!file) {
      setActionError("Sélectionnez un fichier.");
      return;
    }
    const invalid = validateStudentFile(file, documentType);
    if (invalid) {
      setActionError(invalid);
      return;
    }
    setWorking("upload");
    setActionError(null);
    setNotice(null);
    try {
      await studentAdministrativeDocumentsApi.upload(workspace.studentId, documentType, file);
      setFile(null);
      setNotice("Document déposé. Il reste à vérifier par une personne habilitée.");
      setReload((x) => x + 1);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setWorking(null);
    }
  }

  async function updateDocument(documentId: string, action: "verify" | "archive") {
    if (!permissions.canUpdate || !allowed || working) return;
    if (action === "archive" && !window.confirm("Archiver ce document ? Il ne sera plus téléchargeable.")) return;
    setWorking(documentId);
    setActionError(null);
    setNotice(null);
    try {
      if (action === "verify") {
        await studentAdministrativeDocumentsApi.verify(workspace.studentId, documentId);
        setNotice("Document vérifié.");
      } else {
        await studentAdministrativeDocumentsApi.archive(workspace.studentId, documentId);
        setNotice("Document archivé.");
      }
      setReload((x) => x + 1);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setWorking(null);
    }
  }

  async function downloadDocument(entry: StudentStoredDocument) {
    if (!allowed || working) return;
    setWorking(entry.id);
    setActionError(null);
    try {
      const blob = await studentAdministrativeDocumentsApi.download(workspace.studentId, entry.id);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = entry.fileName || "document";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setWorking(null);
    }
  }

  if (!allowed) {
    return <Card className="p-6">Lecture des documents non autorisée pour ce compte.</Card>;
  }
  return (
    <div className="space-y-6" data-testid="student-documents-tab">
      {loadError ? (
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">{loadError}</p>
          <button type="button" onClick={() => setReload((x) => x + 1)}
            className="mt-3 rounded-lg border border-line px-4 py-2 text-sm">Réessayer</button>
        </Card>
      ) : !computed ? (
        <Card className="p-6">Chargement des documents…</Card>
      ) : (
        <>
          <StudentDocumentsSummary documents={computed} />
          <StudentDocumentsList documents={computed.documents} />
        </>
      )}

      {permissions.canCreate && !loadError && computed ? (
        <Card className="p-6">
          <SectionHeader title="Déposer une pièce" description="PDF, JPEG ou PNG, 10 Mo maximum. Le dépôt reste en attente de vérification." />
          <form onSubmit={(event) => void submitUpload(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Type de document
              <select value={documentType} onChange={(event) => setDocumentType(event.target.value as StudentFileType)}
                className="mt-1 block w-full rounded-lg border border-line p-3">
                {Object.entries(STUDENT_FILE_TYPES).map(([value, label]) =>
                  <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink">
              Fichier
              <input key={reload} type="file" accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full rounded-lg border border-line p-3" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={Boolean(working)}
                className="rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {working === "upload" ? "Dépôt en cours…" : "Téléverser"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {documents && !loadError && documents.some((doc) => doc.status !== "archived") ? (
        <Card className="p-6">
          <SectionHeader title="Fichiers déposés" description="Fichiers enregistrés réellement dans PostgreSQL et le stockage privé." />
          <ul className="mt-4 divide-y divide-line">
            {documents.filter((doc) => doc.status !== "archived").map((doc) => (
              <li key={doc.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-ink">{doc.title} — {doc.fileName}</p>
                  <p className="text-sm text-muted">{doc.status === "verified" ? "Vérifié" : "En attente de vérification"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={Boolean(working)}
                    onClick={() => void downloadDocument(doc)}
                    className="rounded-lg border border-line px-3 py-2 text-sm">Télécharger</button>
                  {permissions.canUpdate && doc.status === "submitted" ? (
                    <button type="button" disabled={Boolean(working)}
                      onClick={() => void updateDocument(doc.id, "verify")}
                      className="rounded-lg border border-line px-3 py-2 text-sm">Vérifier</button>
                  ) : null}
                  {permissions.canUpdate ? (
                    <button type="button" disabled={Boolean(working)}
                      onClick={() => void updateDocument(doc.id, "archive")}
                      className="rounded-lg border border-line px-3 py-2 text-sm">Archiver</button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      {notice ? <p role="status" className="text-sm text-ink">{notice}</p> : null}
    </div>
  );
}
