import { useEffect, useState } from "react";
import { BellRing, Mail, ShieldCheck, Smartphone, X } from "lucide-react";
import {
  getCommunicationPreferences,
  updateCommunicationPreferences,
  type CommunicationChannel,
  type CommunicationChannels,
} from "../../lib/communicationPreferencesApi";

const ITEMS: Array<{
  channel: CommunicationChannel;
  label: string;
  description: string;
  icon: typeof BellRing;
}> = [
  {
    channel: "IN_APP",
    label: "Notifications dans l’application",
    description: "Afficher les notifications Somafrik dans votre centre de notifications.",
    icon: BellRing,
  },
  {
    channel: "PUSH",
    label: "Notifications push",
    description: "Recevoir les alertes Somafrik sur vos appareils autorisés.",
    icon: Smartphone,
  },
  {
    channel: "EMAIL",
    label: "E-mails",
    description: "Recevoir par e-mail les communications scolaires prévues pour ce canal.",
    icon: Mail,
  },
];

export function CommunicationPreferencesPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<CommunicationChannels | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<CommunicationChannel | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void getCommunicationPreferences()
      .then((result) => {
        if (active) setChannels(result.channels);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Impossible de charger vos préférences.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  async function toggle(channel: CommunicationChannel) {
    if (!channels || saving) return;
    const previous = channels;
    const nextValue = !channels[channel];
    setChannels({ ...channels, [channel]: nextValue });
    setSaving(channel);
    setError("");
    try {
      const result = await updateCommunicationPreferences({ [channel]: nextValue });
      setChannels(result.channels);
    } catch (cause) {
      setChannels(previous);
      setError(cause instanceof Error ? cause.message : "La préférence n’a pas pu être enregistrée.");
    } finally {
      setSaving(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Préférences de communication">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/30"
        aria-label="Fermer les préférences"
        onClick={onClose}
      />
      <section className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-brand">Mon compte</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Préférences de communication</h2>
            <p className="mt-1 text-sm text-muted">Choisissez comment Somafrik vous informe pour cet établissement.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
              {error}
            </div>
          ) : null}

          {loading && !channels ? (
            <div className="rounded-2xl border border-line bg-slate-50 px-4 py-8 text-center text-sm text-muted">
              Chargement des préférences…
            </div>
          ) : (
            <div className="space-y-3">
              {ITEMS.map(({ channel, label, description, icon: Icon }) => {
                const checked = channels?.[channel] ?? true;
                const isSaving = saving === channel;
                return (
                  <div key={channel} className="flex items-center gap-4 rounded-2xl border border-line p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">
                      <Icon className="h-5 w-5" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">{label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={label}
                      disabled={!channels || Boolean(saving)}
                      onClick={() => void toggle(channel)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                        checked ? "bg-brand" : "bg-slate-300"
                      } ${!channels || saving ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                          checked ? "left-6" : "left-1"
                        }`}
                      />
                      <span className="sr-only">{isSaving ? "Enregistrement…" : checked ? "Activé" : "Désactivé"}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <p className="text-xs leading-5 text-amber-900">
              Les e-mails indispensables à la sécurité du compte, notamment la réinitialisation du mot de passe, restent envoyés même si le canal E-mails est désactivé.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
