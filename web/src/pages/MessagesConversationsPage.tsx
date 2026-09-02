import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import {
  messagesApi,
  type ConversationMessage,
  type ConversationSummary,
  type MessageAttachment,
  type MessageRecipient,
} from "../lib/messagesApi";
import { hasCommunicationSchoolScope } from "../lib/communicationSchoolScope";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { ApiError } from "../api/client";

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

function counterpartName(conversation: ConversationSummary, selfId?: string) {
  const others = (conversation.participants ?? []).filter((row) => row.userId !== selfId);
  if (!others.length) return conversation.subject || "Conversation";
  return others.map((row) => row.name || row.userId).join(", ");
}

export function MessagesConversationsPage() {
  const { session } = useAuth();
  const { activeSchoolCode, requiresSelection } = useActiveSchool();
  const { canRead, canCreate, canUpdate } = useFeaturePermissions("Messages");
  const { showToast } = useToast();
  const selfId = String(session?.user?.id ?? "");
  const schoolScope = hasCommunicationSchoolScope(activeSchoolCode) ? activeSchoolCode : undefined;
  const scopeReady = !requiresSelection || Boolean(schoolScope);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [users, setUsers] = useState<MessageRecipient[]>([]);
  const [pendingFiles, setPendingFiles] = useState<MessageAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const intentionRef = useRef<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadConversations = useCallback(async () => {
    if (!canRead || !scopeReady) return;
    const result = await messagesApi.listConversations("", schoolScope);
    setConversations(result.items ?? []);
  }, [canRead, schoolScope, scopeReady]);

  const loadThread = useCallback(async (conversationId: string) => {
    const result = await messagesApi.listMessages(conversationId, "", schoolScope);
    const items = result.items ?? [];
    setMessages(items);
    if (canUpdate) {
      await Promise.all(
        items
          .filter((row) => row.senderUserId !== selfId && !row.readAt)
          .map((row) => messagesApi.markRead(row.id, schoolScope).catch(() => null)),
      );
    }
  }, [canUpdate, schoolScope, selfId]);

  useEffect(() => {
    if (!scopeReady) {
      setConversations([]);
      setUsers([]);
      return;
    }
    void loadConversations().catch((error) => {
      showToast(error instanceof ApiError ? error.message : "Impossible de charger les conversations", "error");
    });
    void messagesApi.listRecipients(schoolScope).then((rows) => {
      const list = Array.isArray(rows) ? rows : rows?.items ?? [];
      setUsers(list);
    }).catch((error) => {
      setUsers([]);
      showToast(error instanceof ApiError ? error.message : "Impossible de charger les destinataires", "error");
    });
  }, [loadConversations, schoolScope, scopeReady, showToast]);

  useEffect(() => {
    if (!selectedId || !scopeReady) {
      setMessages([]);
      return;
    }
    void loadThread(selectedId).catch((error) => {
      showToast(error instanceof ApiError ? error.message : "Impossible de charger le fil", "error");
    });
  }, [loadThread, selectedId, showToast, scopeReady]);

  const selected = useMemo(
    () => conversations.find((row) => row.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length || !canCreate) return;
    try {
      const uploaded: MessageAttachment[] = [];
      for (const file of Array.from(fileList)) {
        uploaded.push(await messagesApi.uploadAttachment(file, schoolScope));
      }
      setPendingFiles((current) => [...current, ...uploaded]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Upload refusé", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body) {
      setSendError("Message est obligatoire.");
      return;
    }
    if (!canCreate) return;
    if (!intentionRef.current) intentionRef.current = crypto.randomUUID();
    setSending(true);
    setSendError("");
    try {
      const payload = {
        message: body,
        attachmentIds: pendingFiles.map((file) => file.id),
        ...(selectedId ? {} : { participantUserIds: recipientId ? [recipientId] : [] }),
      };
      const saved = selectedId
        ? await messagesApi.reply(selectedId, payload, intentionRef.current, schoolScope)
        : await messagesApi.createConversation(payload, intentionRef.current, schoolScope);
      setDraft("");
      setPendingFiles([]);
      intentionRef.current = "";
      setSelectedId(saved.conversationId);
      await loadConversations();
      await loadThread(saved.conversationId);
      showToast("Message envoyé", "success");
    } catch (error) {
      setSendError(error instanceof ApiError ? error.message : "Envoi échoué. Réessayez.");
      showToast("Envoi échoué", "error");
    } finally {
      setSending(false);
    }
  }

  if (!canRead) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Vous n'avez pas accès aux messages.</p>
      </Card>
    );
  }

  if (!scopeReady) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Sélectionnez un établissement pour ouvrir Messages.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
      <Card className="p-4">
        <SectionHeader title="Conversations" description="Fils auxquels vous participez." />
        <div className="mt-3 space-y-1">
          {conversations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Aucune conversation.</p>
          ) : (
            conversations.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`w-full rounded-xl px-3 py-2 text-left ${selectedId === row.id ? "bg-slate-100" : "hover:bg-slate-50"}`}
                onClick={() => setSelectedId(row.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{counterpartName(row, selfId)}</span>
                  {(row.unreadCount ?? 0) > 0 ? (
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{row.unreadCount}</span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted">{row.lastMessage?.body || "—"}</p>
                <p className="text-xs text-muted">{formatDisplayDate(row.lastMessage?.sentAt || row.updatedAt)}</p>
              </button>
            ))
          )}
        </div>
        {canCreate ? (
          <Button className="mt-3 w-full" variant="secondary" size="sm" onClick={() => setSelectedId("")}>
            Nouvelle conversation
          </Button>
        ) : null}
      </Card>

      <Card className="flex min-h-[520px] flex-col p-4">
        <SectionHeader
          title={selected ? counterpartName(selected, selfId) : "Nouveau message"}
          description={selected ? `Conversation ${selected.id.slice(0, 8)}` : "Choisissez un destinataire puis écrivez."}
        />
        <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
          {messages.map((row) => (
            <div key={row.id} className={`max-w-[80%] rounded-2xl px-3 py-2 ${row.senderUserId === selfId ? "ml-auto bg-slate-900 text-white" : "bg-slate-100 text-ink"}`}>
              <p className="text-xs opacity-80">
                {row.senderName || row.senderUserId} · {formatDisplayDate(row.sentAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm">{row.body || row.message || row.content}</p>
              {(row.attachments ?? []).map((file) => (
                <a
                  key={file.id}
                  className="mt-1 block text-xs underline"
                  href={`${window.location.origin.replace(/\/$/, "")}`}
                  onClick={async (event) => {
                    event.preventDefault();
                    try {
                      const blob = await messagesApi.downloadAttachment(file.id, schoolScope);
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = file.fileName;
                      link.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      showToast("Téléchargement refusé", "error");
                    }
                  }}
                >
                  {file.fileName}
                </a>
              ))}
            </div>
          ))}
        </div>

        {canCreate ? (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            {!selectedId ? (
              <Field label="Destinataire">
                <select
                  className="w-full rounded-xl border border-line px-3 py-2"
                  value={recipientId}
                  onChange={(event) => setRecipientId(event.target.value)}
                >
                  <option value="">Choisir…</option>
                  {users
                    .filter((user) => user.userId !== selfId)
                    .map((user) => (
                      <option key={user.userId} value={user.userId}>
                        {user.displayName || user.roleLabel || user.userId}
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}
            <Field label="Message">
              <textarea
                className="min-h-[96px] w-full rounded-xl border border-line px-3 py-2"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            {sendError ? <p className="text-sm text-red-600">{sendError}</p> : null}
            {pendingFiles.length ? (
              <p className="text-xs text-muted">{pendingFiles.map((file) => file.fileName).join(", ")}</p>
            ) : null}
            {sending ? <p className="text-xs text-muted">Envoi en cours…</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(event) => void handleUpload(event.target.files)}
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                Pièce jointe
              </Button>
              <Button type="button" size="sm" disabled={sending} onClick={() => void handleSend()}>
                {sending ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
