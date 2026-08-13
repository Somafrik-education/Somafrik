import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedNotifications } from "../lib/scope";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge, StatusBadge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { platformApi } from "../lib/platformApi";
import type { PlatformNotification } from "../types";

const AUDIENCE_OPTIONS = [
  "Tous",
  "Super Administrateur Somafrik",
  "Admin Pays",
  "Administrateurs Établissement",
  "Enseignants",
  "Parents",
  "Élèves",
];

const TYPE_OPTIONS = ["Information", "Alerte", "Paiement", "Académique", "Système"];
const PRIORITY_OPTIONS = ["Normale", "Haute", "Critique"];

function emptyNotification(): PlatformNotification {
  return {
    title: "",
    message: "",
    type: "Information",
    audience: "Tous",
    priority: "Normale",
    status: "Non lu",
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ntf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function NotificationsPage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState<PlatformNotification | null>(null);
  const { showToast } = useToast();

  const rows = scopedNotifications(session?.user ?? null, state);
  const { canCreate, canUpdate, canDelete } = useFeaturePermissions("Notifications");

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!composing) return;
    if (!composing.title.trim() || !composing.message.trim()) {
      showToast("Titre et message obligatoires", "error");
      return;
    }
    setBusy(true);
    const notification: PlatformNotification = {
      ...composing,
      id: newId(),
      date: new Date().toLocaleDateString("fr-FR").replace(/\//g, "-"),
      createdBy: session?.user?.identifier ?? session?.user?.email ?? "Plateforme",
      countryCode:
        composing.countryCode ??
        (session?.user?.role === "Admin Pays" ? session.user.countryScope : undefined),
      audience:
        composing.type === "Système" && session?.user?.role === "Admin Pays"
          ? "Super Administrateur Somafrik"
          : composing.audience,
    };
    try {
      await platformApi.createNotification(notification as unknown as Record<string, unknown>);
      await refresh();
      showToast("Notification envoyée", "success");
      setComposing(null);
    } catch {
      showToast("Échec de l'envoi", "error");
    } finally {
      setBusy(false);
    }
  }

  async function markRead(notification: PlatformNotification) {
    setBusy(true);
    try {
      if (notification.id) {
        await platformApi.updateNotification(String(notification.id), { status: "Lu" });
      }
      await refresh();
    } catch {
      showToast("Échec de la mise à jour", "error");
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      for (const notification of rows) {
        if (notification.id) {
          await platformApi.updateNotification(String(notification.id), { status: "Lu" });
        }
      }
      await refresh();
      showToast("Notifications marquées comme lues", "success");
    } catch {
      showToast("Échec de la mise à jour", "error");
    } finally {
      setBusy(false);
    }
  }

  async function archive(notification: PlatformNotification) {
    setBusy(true);
    try {
      if (notification.id) {
        await platformApi.updateNotification(String(notification.id), { archived: true });
      }
      await refresh();
      showToast("Notification archivée", "success");
    } catch {
      showToast("Échec de l'archivage", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Card className="p-6">
      <SectionHeader
        title="Notifications"
        description={`${rows.length} notification(s) dans votre périmètre.`}
        actions={
          <div className="flex gap-2">
            <PrintButton documentTitle="Notifications — Somafrik" />
            {canUpdate ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void markAllRead()}>
                Tout marquer comme lu
              </Button>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setComposing(emptyNotification())}>
                Nouvelle notification
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-muted">Aucune notification.</p>
        ) : (
          rows.map((notification) => (
            <div
              key={notification.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{notification.title}</p>
                  {notification.type ? <Badge tone="info">{notification.type}</Badge> : null}
                  <StatusBadge status={notification.status} />
                </div>
                <p className="mt-1 text-sm text-muted">{notification.message}</p>
                <p className="mt-1 text-xs text-muted">
                  {notification.audience} · {notification.date}
                </p>
              </div>
              <div className="no-print flex gap-2">
                {canUpdate && notification.status !== "Lu" ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void markRead(notification)}>
                    Marquer lu
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void archive(notification)}>
                    Archiver
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>

      <Modal
        open={Boolean(composing)}
        onClose={() => setComposing(null)}
        title="Nouvelle notification"
        description="Diffusée aux destinataires de votre périmètre."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setComposing(null)}>
              Annuler
            </Button>
            <Button form="notification-form" type="submit" disabled={busy}>
              Envoyer
            </Button>
          </>
        }
      >
        {composing ? (
          <form id="notification-form" onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Titre" required>
                <Input
                  value={composing.title}
                  onChange={(e) => setComposing({ ...composing, title: e.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Message" required>
                <textarea
                  className="input-base min-h-[96px] resize-y"
                  value={composing.message}
                  onChange={(e) => setComposing({ ...composing, message: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Destinataires">
              <Select
                value={composing.audience ?? "Tous"}
                onChange={(e) => setComposing({ ...composing, audience: e.target.value })}
                options={AUDIENCE_OPTIONS.map((a) => ({ value: a, label: a }))}
              />
            </Field>
            <Field label="Type">
              <Select
                value={composing.type ?? "Information"}
                onChange={(e) => setComposing({ ...composing, type: e.target.value })}
                options={TYPE_OPTIONS.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="Priorité">
              <Select
                value={composing.priority ?? "Normale"}
                onChange={(e) => setComposing({ ...composing, priority: e.target.value })}
                options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
              />
            </Field>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
