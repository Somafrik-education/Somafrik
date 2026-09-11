import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import {
  internalNotificationsApi,
  type InternalNotificationRecord,
} from "../../lib/internalNotificationsApi";
import { notifyInternalNotificationsChanged } from "../../lib/internalNotificationsRead";
import { resolveNotificationDestination } from "../../lib/notificationNavigation";
import { filterCommunicationRows, excerptCommunication } from "../../lib/communicationListFilter";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { CommunicationChrome, useCommunicationListQuery } from "./CommunicationChrome";
import { ExpandableCommunicationCard } from "./ExpandableCommunicationCard";

function formatDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(eventType?: string): string {
  const value = String(eventType ?? "");
  if (value.includes("message")) return "Message";
  if (value.includes("announcement")) return "Annonce";
  if (value.includes("attendance")) return "Présence";
  if (value.includes("grade")) return "Note";
  if (value.includes("payment")) return "Paiement";
  return "Information";
}

export function InternalNotificationsCenter() {
  const { activeSchoolCode } = useActiveSchool();
  const { canCreate } = useFeaturePermissions("Notifications");
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<InternalNotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
  const { search, setSearch, unreadOnly, setUnreadOnly } = useCommunicationListQuery();

  async function refreshUnread() {
    try {
      const result = await internalNotificationsApi.unreadCount(activeSchoolCode ?? undefined);
      setUnread(Math.max(0, Number(result?.count) || 0));
    } catch {
      setUnread(null);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await internalNotificationsApi.list(activeSchoolCode ?? undefined);
      setRows(result.items ?? []);
      setCursor(result.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notifications indisponibles");
    } finally {
      setLoading(false);
    }
    await refreshUnread();
  }

  const visibleRows = useMemo(
    () =>
      filterCommunicationRows(
        rows.map((row) => ({
          ...row,
          excerpt: excerptCommunication(row.body),
          author: row.senderName,
          unread: !row.readAt,
        })),
        search,
        unreadOnly,
      ),
    [rows, search, unreadOnly],
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await internalNotificationsApi.list(activeSchoolCode ?? undefined, { cursor });
      const items = result.items ?? [];
      setRows((current) => {
        const known = new Set(current.map((row) => row.id));
        return [...current, ...items.filter((row) => !known.has(row.id))];
      });
      setCursor(result.nextCursor ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chargement interrompu", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchoolCode]);

  async function openNotification(row: InternalNotificationRecord) {
    try {
      const updated = row.readAt
        ? row
        : await internalNotificationsApi.markRead(row.id, activeSchoolCode ?? undefined);
      setRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
      notifyInternalNotificationsChanged();
      const destination = resolveNotificationDestination(updated.navigationTarget);
      if (destination) navigate(destination);
      else showToast("Cette notification ne renvoie vers aucune ressource consultable.", "info");
      if (!row.readAt) void refreshUnread();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec de la lecture", "error");
    }
  }

  async function archiveNotification(row: InternalNotificationRecord) {
    try {
      await internalNotificationsApi.archive(row.id, activeSchoolCode ?? undefined);
      setRows((current) => current.filter((item) => item.id !== row.id));
      notifyInternalNotificationsChanged();
      if (!row.readAt) void refreshUnread();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec de l'archivage", "error");
    }
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const attachmentIds: string[] = [];
      for (const file of files) {
        const uploaded = await internalNotificationsApi.uploadAttachment(file, activeSchoolCode ?? undefined);
        attachmentIds.push(uploaded.id);
      }
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await internalNotificationsApi.create(
        { title: title.trim(), body: body.trim(), attachmentIds },
        key,
        activeSchoolCode ?? undefined,
      );
      setComposer(false);
      setTitle("");
      setBody("");
      setFiles([]);
      showToast("Notification envoyée", "success");
      notifyInternalNotificationsChanged();
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec de l'envoi", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CommunicationChrome
        surface="notifications"
        title="Communication"
        searchPlaceholder="Rechercher"
        unreadLabel="Non lus"
        countLabel={
          unread === null ? "Notifications" : `${unread} non lue(s) · historique synchronisé Web/Mobile.`
        }
        search={search}
        onSearch={setSearch}
        unreadOnly={unreadOnly}
        onUnreadOnly={setUnreadOnly}
        primaryAction={canCreate ? <Button onClick={() => setComposer(true)}>Nouvelle notification</Button> : undefined}
      >
      <Card className="p-4">
        {loading ? <p className="py-10 text-center text-muted">Chargement…</p> : null}
        {error ? (
          <div className="py-8 text-center">
            <p className="text-danger">{error}</p>
            <Button className="mt-3" variant="secondary" onClick={() => void load()}>Réessayer</Button>
          </div>
        ) : null}
        {!loading && !error && visibleRows.length === 0 ? (
          <p className="py-10 text-center text-muted">Aucune notification.</p>
        ) : null}
        <div className="mt-2 space-y-2">
          {visibleRows.map((row) => (
            <ExpandableCommunicationCard
              key={row.id}
              title={row.title}
              subtitle={`${row.senderName} · ${formatDateTime(row.publishedAt || row.createdAt)}`}
              badge={row.readAt ? "Lu" : "Non lu"}
              badgeTone={row.readAt ? "default" : "info"}
              testID={`notification-card-${row.id}`}
            >
              <p className="whitespace-pre-wrap text-sm text-ink">{row.body}</p>
              <p className="text-xs text-muted">{sourceLabel(row.eventType)}</p>
              {row.attachments?.length ? (
                <div className="flex flex-wrap gap-2">
                  {row.attachments.map((attachment) => (
                    <Button
                      key={attachment.id}
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        const blob = await internalNotificationsApi.downloadAttachment(
                          attachment.id,
                          activeSchoolCode ?? undefined,
                        );
                        const href = URL.createObjectURL(blob);
                        window.open(href, "_blank", "noopener,noreferrer");
                        setTimeout(() => URL.revokeObjectURL(href), 60_000);
                      }}
                    >
                      {attachment.fileName}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void openNotification(row)}>
                  {row.readAt ? "Ouvrir" : "Lire"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void archiveNotification(row)}>
                  Archiver
                </Button>
              </div>
            </ExpandableCommunicationCard>
          ))}
        </div>
        {!loading && !error && cursor ? (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Chargement…" : "Charger les notifications plus anciennes"}
            </Button>
          </div>
        ) : null}
      </Card>
      </CommunicationChrome>

      <Modal
        open={composer}
        onClose={() => setComposer(false)}
        title="Nouvelle notification interne"
        description="Diffusée à l'établissement actif et historisée dans Somafrik."
        footer={
          <>
            <Button variant="secondary" onClick={() => setComposer(false)}>Annuler</Button>
            <Button form="internal-notification-form" type="submit" disabled={busy}>Envoyer</Button>
          </>
        }
      >
        <form id="internal-notification-form" onSubmit={submitManual} className="space-y-4">
          <Field label="Titre" required>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </Field>
          <Field label="Message" required>
            <textarea
              className="input-base min-h-[110px] w-full resize-y"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </Field>
          <Field label="Pièces jointes PDF / JPEG / PNG">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
