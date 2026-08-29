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
import {
  platformAnnouncementsApi,
  type PlatformAnnouncementRecord,
  type PlatformAnnouncementType,
  type PlatformAudienceKey,
} from "../lib/platformAnnouncementsApi";
import { hasCommunicationSchoolScope } from "../lib/communicationSchoolScope";
import { isSuperAdminRole } from "../lib/orgHierarchy";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { ApiError } from "../api/client";

const RECIPIENT_KIND_FALLBACK: AudienceKindOption[] = [
  { id: "parent", label: "parents" },
  { id: "teacher", label: "enseignants" },
  { id: "student", label: "élèves" },
  { id: "staff", label: "personnel" },
];

const PLATFORM_ADMIN_AUDIENCES: Array<{ id: PlatformAudienceKey; label: string }> = [
  { id: "country_admins", label: "Administrateurs pays" },
  { id: "school_admins", label: "Administrateurs d'établissement" },
  { id: "all_admins", label: "Tous les administrateurs" },
];

type UnifiedAnnouncement = AnnouncementRecord & {
  source?: "school" | "platform";
  domain?: "platform";
  announcementType?: PlatformAnnouncementType;
  audienceKey?: PlatformAudienceKey;
  senderDisplayName?: string;
  originLabel?: string;
  badge?: string;
  systemBroadcast?: boolean;
};

function isPlatformRow(row: UnifiedAnnouncement | null | undefined) {
  return row?.source === "platform" || row?.domain === "platform" || row?.type === "platform-announcement";
}

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

function sortByPublishedAt(rows: UnifiedAnnouncement[]) {
  return [...rows].sort((left, right) => {
    const a = Date.parse(String(left.publishedAt || left.createdAt || "")) || 0;
    const b = Date.parse(String(right.publishedAt || right.createdAt || "")) || 0;
    return b - a;
  });
}

export function AnnouncementsPage() {
  const { session } = useAuth();
  const { confirm } = useConfirm();
  const { activeSchoolCode, requiresSelection } = useActiveSchool();
  const { canRead, canCreate, canUpdate } = useFeaturePermissions("Announcements");
  const { showToast } = useToast();
  const isGlobalSuperadmin = isSuperAdminRole(session?.user?.role);
  const schoolScope = hasCommunicationSchoolScope(activeSchoolCode) ? activeSchoolCode : undefined;
  const scopeReady = isGlobalSuperadmin || !requiresSelection || Boolean(schoolScope);
  const [items, setItems] = useState<UnifiedAnnouncement[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<UnifiedAnnouncement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [scopeType, setScopeType] = useState<"school" | "roles" | "classes">("school");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [classes, setClasses] = useState<AudienceClassOption[]>([]);
  const [kinds, setKinds] = useState<AudienceKindOption[]>(RECIPIENT_KIND_FALLBACK);
  const [platformType, setPlatformType] = useState<PlatformAnnouncementType>("administrative");
  const [platformAudience, setPlatformAudience] = useState<PlatformAudienceKey>("country_admins");
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
      const [platformResult, schoolResult] = await Promise.all([
        platformAnnouncementsApi.list().catch(() => ({ items: [] as PlatformAnnouncementRecord[] })),
        schoolScope
          ? announcementsApi.list(schoolScope).catch(() => ({ items: [] as AnnouncementRecord[] }))
          : Promise.resolve({ items: [] as AnnouncementRecord[] }),
      ]);
      const platformItems = (platformResult.items ?? []).map((row) => ({
        ...row,
        source: "platform" as const,
      }));
      const schoolItems = (schoolResult.items ?? []).map((row) => ({
        ...row,
        source: "school" as const,
      }));
      setItems(sortByPublishedAt([...platformItems, ...schoolItems]));
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
    if (canCreate && !isGlobalSuperadmin && schoolScope) {
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
  }, [loadList, schoolScope, scopeReady, canCreate, isGlobalSuperadmin]);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!selectedId || !scopeReady) {
      setDetail(null);
      return;
    }
    const listed = itemsRef.current.find((row) => row.id === selectedId);
    const platform = isPlatformRow(listed);
    let cancelled = false;
    void (async () => {
      try {
        const row = platform
          ? await platformAnnouncementsApi.get(selectedId)
          : await announcementsApi.get(selectedId, schoolScope);
        const tagged: UnifiedAnnouncement = {
          ...row,
          source: platform ? "platform" : "school",
        };
        if (cancelled) return;
        setDetail(tagged);
        if (!tagged.readAt && canRead) {
          const marked = platform
            ? await platformAnnouncementsApi.markRead(selectedId).catch(() => null)
            : await announcementsApi.markRead(selectedId, schoolScope).catch(() => null);
          if (!cancelled && marked) {
            const next = { ...marked, source: platform ? ("platform" as const) : ("school" as const) };
            setDetail(next);
            setItems((current) =>
              current.map((item) => (item.id === next.id ? { ...item, readAt: next.readAt } : item)),
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
        uploaded.push(
          isGlobalSuperadmin
            ? await platformAnnouncementsApi.uploadAttachment(file)
            : await announcementsApi.uploadAttachment(file, schoolScope),
        );
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
    if (isGlobalSuperadmin && platformType === "system") {
      const confirmed = await confirm({
        title: "Annonce système Somafrik",
        description: "Cette annonce sera visible par tous les utilisateurs actifs de Somafrik.",
        confirmLabel: "Publier",
      });
      if (!confirmed) return;
    }
    if (!intentionRef.current) intentionRef.current = crypto.randomUUID();
    setSubmitting(true);
    setSubmitError("");
    try {
      let saved: UnifiedAnnouncement;
      if (isGlobalSuperadmin) {
        const audienceKey: PlatformAudienceKey =
          platformType === "system" ? "all_active_users" : platformAudience;
        saved = {
          ...(await platformAnnouncementsApi.publish(
            {
              announcementType: platformType,
              audienceKey,
              title: nextTitle,
              message: nextMessage,
              attachmentIds: pendingFiles.map((file) => file.id),
            },
            intentionRef.current,
          )),
          source: "platform",
        };
      } else {
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
        saved = {
          ...(await announcementsApi.publish(payload, intentionRef.current, schoolScope)),
          source: "school",
        };
      }
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
      if (isPlatformRow(selected)) {
        await platformAnnouncementsApi.archive(selectedId);
      } else {
        await announcementsApi.archive(selectedId, schoolScope);
      }
      showToast("Annonce archivée", "success");
      setSelectedId("");
      await loadList();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Archivage impossible.", "error");
    }
  }

  async function handleDownload(attachment: AnnouncementAttachment) {
    try {
      const blob = isPlatformRow(selected)
        ? await platformAnnouncementsApi.downloadAttachment(attachment.id)
        : await announcementsApi.downloadAttachment(attachment.id, schoolScope);
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
        <SectionHeader title="Annonces" description="Sélectionnez un établissement pour continuer." />
        <p className="mt-4 text-sm text-muted">Établissement requis.</p>
      </div>
    );
  }

  const viewed = detail ?? selected;
  const originLabel = isPlatformRow(viewed)
    ? viewed?.announcementType === "system"
      ? "Annonce Somafrik"
      : "Annonce administrative Somafrik"
    : "Annonce établissement";
  const senderLabel = isPlatformRow(viewed)
    ? viewed?.senderDisplayName || viewed?.createdByName
    : viewed?.createdByName;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <SectionHeader title="Annonces" description="Historique publié, lecture PostgreSQL." />
        {canCreate && isGlobalSuperadmin ? (
          <Card>
            <h2 className="mb-3 text-sm font-bold">Nouvelle annonce</h2>
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-ink">
                Type d'annonce
                <select
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                  value={platformType}
                  onChange={(event) => {
                    const next = event.target.value as PlatformAnnouncementType;
                    setPlatformType(next);
                    if (next === "system") setPlatformAudience("all_active_users");
                    else if (platformAudience === "all_active_users") setPlatformAudience("country_admins");
                  }}
                >
                  <option value="administrative">Annonce administrative</option>
                  <option value="system">Annonce système Somafrik</option>
                </select>
              </label>
              {platformType === "administrative" ? (
                <label className="block text-xs font-semibold text-ink">
                  Audience
                  <select
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    value={platformAudience}
                    onChange={(event) => setPlatformAudience(event.target.value as PlatformAudienceKey)}
                  >
                    {PLATFORM_ADMIN_AUDIENCES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-sm text-muted">Audience : Tous les utilisateurs Somafrik</p>
              )}
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
              {platformType === "system" ? (
                <p className="text-xs text-muted">
                  Cette annonce sera visible par tous les utilisateurs actifs de Somafrik. Expéditeur visible : Somafrik.
                </p>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                onChange={(event) => void handleUpload(event.target.files)}
              />
              {pendingFiles.length ? (
                <ul className="text-xs text-muted">
                  {pendingFiles.map((file) => (
                    <li key={file.id}>{file.fileName}</li>
                  ))}
                </ul>
              ) : null}
              {submitError ? <p className="text-sm text-danger">{submitError}</p> : null}
              <Button type="button" disabled={submitting} onClick={() => void handlePublish()}>
                {submitting ? "Publication…" : "Publier"}
              </Button>
            </div>
          </Card>
        ) : null}
        {canCreate && !isGlobalSuperadmin ? (
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
                <ul className="text-xs text-muted">
                  {pendingFiles.map((file) => (
                    <li key={file.id}>{file.fileName}</li>
                  ))}
                </ul>
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
            <li key={`${row.source ?? "row"}-${row.id}`}>
              <button
                type="button"
                className={`w-full rounded-xl border px-3 py-3 text-left ${
                  selectedId === row.id ? "border-brand bg-brand-50" : "border-line bg-white"
                }`}
                onClick={() => setSelectedId(row.id)}
              >
                <p className="font-semibold text-ink">{row.title}</p>
                <p className="text-xs text-muted">
                  {isPlatformRow(row)
                    ? row.announcementType === "system"
                      ? "Annonce Somafrik"
                      : "Annonce administrative Somafrik"
                    : "Annonce établissement"}
                  {row.badge ? ` · ${row.badge}` : ""}
                </p>
                <p className="text-xs text-muted">
                  {isPlatformRow(row) ? row.senderDisplayName || row.createdByName || "Expéditeur" : row.createdByName || "Expéditeur"}{" "}
                  · {formatDisplayDate(row.publishedAt || row.createdAt)}
                </p>
                <p className="text-xs">{row.readAt ? "Lu" : "Non lu"}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {viewed ? (
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{originLabel}</p>
            {viewed.badge ? (
              <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand">
                {viewed.badge}
              </span>
            ) : null}
            <h2 className="text-lg font-bold">{viewed.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {senderLabel} · {formatDisplayDate(viewed.publishedAt || viewed.createdAt)}
            </p>
            {viewed.audienceLabel ? <p className="mt-1 text-xs text-muted">{viewed.audienceLabel}</p> : null}
            <p className="mt-4 whitespace-pre-wrap text-sm">{viewed.content || viewed.message}</p>
            {(viewed.attachments ?? []).length ? (
              <ul className="mt-4 space-y-1">
                {viewed.attachments?.map((file) => (
                  <li key={file.id}>
                    <button type="button" className="text-sm text-brand underline" onClick={() => void handleDownload(file)}>
                      {file.fileName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {canUpdate && viewed.status !== "archived" && (isGlobalSuperadmin || !isPlatformRow(viewed)) ? (
              <Button type="button" variant="secondary" className="mt-4" onClick={() => void handleArchive()}>
                Archiver
              </Button>
            ) : null}
            {viewed.unresolved ? (
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
