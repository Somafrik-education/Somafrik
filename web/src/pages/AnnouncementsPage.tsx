import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import {
  announcementsApi,
  type AnnouncementAttachment,
  type AnnouncementRecord,
  type AudienceClassOption,
  type AudienceKindOption,
} from "../lib/announcementsApi";
import { hasCommunicationSchoolScope } from "../lib/communicationSchoolScope";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { ApiError } from "../api/client";

const RECIPIENT_KIND_FALLBACK: AudienceKindOption[] = [
  { id: "parent", label: "parents" },
  { id: "teacher", label: "enseignants" },
  { id: "student", label: "élèves" },
  { id: "staff", label: "personnel" },
];

function formatDisplayDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AnnouncementsPage() {
  const { session } = useAuth();
  const { activeSchoolCode, requiresSelection } = useActiveSchool();
  const { canRead, canCreate, canUpdate } = useFeaturePermissions("Announcements");
  const { showToast } = useToast();
  const schoolScope = hasCommunicationSchoolScope(activeSchoolCode) ? activeSchoolCode : undefined;
  const scopeReady = !requiresSelection || Boolean(schoolScope);
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AnnouncementRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [scopeType, setScopeType] = useState<"school" | "roles" | "classes">("school");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [classes, setClasses] = useState<AudienceClassOption[]>([]);
  const [kinds, setKinds] = useState<AudienceKindOption[]>(RECIPIENT_KIND_FALLBACK);
  const [pendingFiles, setPendingFiles] = useState<AnnouncementAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const intentionRef = useRef<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    if (!canRead || !scopeReady) return;
    setLoading(true);
    setError("");
    try {
      const result = await announcementsApi.list(schoolScope);
      setItems(result.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de charger les annonces.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [canRead, schoolScope, scopeReady]);

  useEffect(() => {
    if (!scopeReady) {
      setItems([]);
      setDetail(null);
      setClasses([]);
      return;
    }
    void loadList();
    if (canCreate) {
      void announcementsApi
        .audienceOptions(schoolScope)
        .then((data) => {
          setClasses(data.classes ?? []);
          if (data.recipientKinds?.length) setKinds(data.recipientKinds);
        })
        .catch(() => {
          setClasses([]);
        });
    }
  }, [loadList, schoolScope, scopeReady, canCreate]);

  useEffect(() => {
    if (!selectedId || !scopeReady) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const row = await announcementsApi.get(selectedId, schoolScope);
        if (cancelled) return;
        setDetail(row);
        if (!row.readAt && canRead) {
          const marked = await announcementsApi.markRead(selectedId, schoolScope).catch(() => null);
          if (!cancelled && marked) {
            setDetail(marked);
            setItems((current) =>
              current.map((item) => (item.id === marked.id ? { ...item, readAt: marked.readAt } : item)),
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof ApiError ? err.message : "Annonce introuvable.", "error");
          setDetail(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, schoolScope, scopeReady, canRead, showToast]);

  const selected = useMemo(
    () => items.find((row) => row.id === selectedId) ?? detail,
    [items, selectedId, detail],
  );

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length || !canCreate) return;
    try {
      const uploaded: AnnouncementAttachment[] = [];
      for (const file of Array.from(fileList)) {
        uploaded.push(await announcementsApi.uploadAttachment(file, schoolScope));
      }
      setPendingFiles((current) => [...current, ...uploaded]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload refusé", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handlePublish() {
    const nextTitle = title.trim();
    const nextMessage = message.trim();
    if (!nextTitle) {
      setSubmitError("Titre obligatoire.");
      return;
    }
    if (!nextMessage) {
      setSubmitError("Contenu obligatoire.");
      return;
    }
    if (!canCreate) return;
    if (!intentionRef.current) intentionRef.current = crypto.randomUUID();
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload: Record<string, unknown> = {
        title: nextTitle,
        message: nextMessage,
        attachmentIds: pendingFiles.map((file) => file.id),
      };
      if (scopeType === "school") {
        payload.audience = "Tous";
      } else if (scopeType === "roles") {
        payload.recipientKinds = selectedKinds;
      } else {
        payload.classIds = selectedClasses;
        payload.recipientKinds = selectedKinds;
      }
      const saved = await announcementsApi.publish(payload, intentionRef.current, schoolScope);
      setTitle("");
      setMessage("");
      setPendingFiles([]);
      setSelectedKinds([]);
      setSelectedClasses([]);
      intentionRef.current = "";
      setSelectedId(saved.id);
      await loadList();
      showToast("Annonce publiée", "success");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Publication échouée. Réessayez.");
      showToast("Publication échouée", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive() {
    if (!selectedId || !canUpdate) return;
    try {
      await announcementsApi.archive(selectedId, schoolScope);
      showToast("Annonce archivée", "success");
      setSelectedId("");
      await loadList();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Archivage impossible.", "error");
    }
  }

  async function handleDownload(attachment: AnnouncementAttachment) {
    try {
      const blob = await announcementsApi.downloadAttachment(attachment.id, schoolScope);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Téléchargement refusé", "error");
    }
  }

  if (!canRead) {
    return (
      <div className="p-6">
        <p className="text-sm text-danger">Accès refusé aux annonces.</p>
      </div>
    );
  }

  if (!scopeReady) {
    return (
      <div className="p-6">
        <SectionHeader title="Annonces" subtitle="Sélectionnez un établissement pour continuer." />
        <p className="mt-4 text-sm text-muted">Établissement requis.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <SectionHeader title="Annonces" subtitle="Historique publié, lecture PostgreSQL." />
        {canCreate ? (
          <Card>
            <h2 className="mb-3 text-sm font-bold">Nouvelle annonce</h2>
            <div className="space-y-3">
              <Field label="Titre">
                <input
                  className="w-full rounded-xl border border-line px-3 py-2"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="Message">
                <textarea
                  className="min-h-[96px] w-full rounded-xl border border-line px-3 py-2"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </Field>
              <label className="block text-xs font-semibold text-ink">
                Audience
                <select
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                  value={scopeType}
                  onChange={(event) => setScopeType(event.target.value as "school" | "roles" | "classes")}
                >
                  <option value="school">Établissement entier</option>
                  <option value="roles">Rôle(s)</option>
                  <option value="classes">Classe(s) + catégories</option>
                </select>
              </label>
              {scopeType !== "school" ? (
                <fieldset className="space-y-1">
                  <legend className="text-xs font-semibold">Catégories</legend>
                  {kinds.map((kind) => (
                    <label key={kind.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedKinds.includes(kind.id)}
                        onChange={() =>
                          setSelectedKinds((current) =>
                            current.includes(kind.id)
                              ? current.filter((id) => id !== kind.id)
                              : [...current, kind.id],
                          )
                        }
                      />
                      {kind.label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {scopeType === "classes" ? (
                <fieldset className="space-y-1">
                  <legend className="text-xs font-semibold">Classes</legend>
                  {classes.length ? (
                    classes.map((row) => (
                      <label key={row.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedClasses.includes(row.id)}
                          onChange={() =>
                            setSelectedClasses((current) =>
                              current.includes(row.id)
                                ? current.filter((id) => id !== row.id)
                                : [...current, row.id],
                            )
                          }
                        />
                        {row.name || row.code}
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-muted">Aucune classe disponible.</p>
                  )}
                </fieldset>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                onChange={(event) => void handleUpload(event.target.files)}
              />
              {pendingFiles.length ? (
                <p className="text-xs text-muted">{pendingFiles.length} pièce(s) jointe(s) prête(s)</p>
              ) : null}
              {submitError ? <p className="text-sm text-danger">{submitError}</p> : null}
              <Button type="button" disabled={submitting} onClick={() => void handlePublish()}>
                {submitting ? "Publication…" : "Publier"}
              </Button>
            </div>
          </Card>
        ) : null}
        {loading ? <p className="text-sm text-muted">Chargement des annonces…</p> : null}
        {error ? (
          <div>
            <p className="text-sm text-danger">{error}</p>
            <Button type="button" variant="secondary" onClick={() => void loadList()}>
              Réessayer
            </Button>
          </div>
        ) : null}
        {!loading && !error && !items.length ? <p className="text-sm text-muted">Aucune annonce.</p> : null}
        <ul className="space-y-2">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`w-full rounded-xl border px-3 py-3 text-left ${
                  selectedId === row.id ? "border-brand bg-brand-50" : "border-line bg-white"
                }`}
                onClick={() => setSelectedId(row.id)}
              >
                <p className="font-semibold text-ink">{row.title}</p>
                <p className="text-xs text-muted">
                  {row.createdByName || "Expéditeur"} · {formatDisplayDate(row.publishedAt || row.createdAt)}
                </p>
                <p className="text-xs">{row.readAt ? "Lu" : "Non lu"}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {selected || detail ? (
          <Card>
            <h2 className="text-lg font-bold">{(detail ?? selected)?.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {(detail ?? selected)?.createdByName} ·{" "}
              {formatDisplayDate((detail ?? selected)?.publishedAt || (detail ?? selected)?.createdAt)}
            </p>
            {(detail ?? selected)?.audienceLabel ? (
              <p className="mt-1 text-xs text-muted">{(detail ?? selected)?.audienceLabel}</p>
            ) : null}
            <p className="mt-4 whitespace-pre-wrap text-sm">{(detail ?? selected)?.content || (detail ?? selected)?.message}</p>
            {((detail ?? selected)?.attachments ?? []).length ? (
              <ul className="mt-4 space-y-1">
                {(detail ?? selected)?.attachments?.map((file) => (
                  <li key={file.id}>
                    <button type="button" className="text-sm text-brand underline" onClick={() => void handleDownload(file)}>
                      {file.fileName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {canUpdate && (detail ?? selected)?.status !== "archived" ? (
              <Button type="button" variant="secondary" className="mt-4" onClick={() => void handleArchive()}>
                Archiver
              </Button>
            ) : null}
            {(detail ?? selected)?.unresolved ? (
              <p className="mt-3 text-xs text-muted">Annonce historique sans destinataires résolus.</p>
            ) : null}
          </Card>
        ) : (
          <p className="text-sm text-muted">Sélectionnez une annonce.</p>
        )}
      </div>
    </div>
  );
}
