import { useEffect, useMemo, useState } from "react";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { canManageEstablishmentSettings } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import {
  getSchoolNotificationSettings,
  patchSchoolNotificationSettings,
  type SchoolNotificationChannel,
  type SchoolNotificationEvent,
  type SchoolNotificationEventRule,
  type SchoolNotificationRecipient,
  type SchoolNotificationSettings,
} from "../../lib/schoolNotificationSettingsApi";
import {
  DashboardLayout,
  EmptyState,
  InlineAlert,
  SectionHeader,
  Switch,
} from "../../design-system";

const EVENT_ORDER: SchoolNotificationEvent[] = [
  "STUDENT_ABSENT",
  "STUDENT_LATE",
  "GRADE_PUBLISHED",
  "REPORT_CARD_PUBLISHED",
  "PAYMENT_RECEIVED",
  "PAYMENT_DUE",
  "ANNOUNCEMENT_PUBLISHED",
  "TIMETABLE_CHANGED",
  "TEACHER_REPLACEMENT",
];

const EVENT_LABELS: Record<SchoolNotificationEvent, string> = {
  STUDENT_ABSENT: "Absence d'un élève",
  STUDENT_LATE: "Retard d'un élève",
  GRADE_PUBLISHED: "Note publiée",
  REPORT_CARD_PUBLISHED: "Bulletin publié",
  PAYMENT_RECEIVED: "Paiement reçu",
  PAYMENT_DUE: "Paiement à régler",
  ANNOUNCEMENT_PUBLISHED: "Annonce publiée",
  TIMETABLE_CHANGED: "Emploi du temps modifié",
  TEACHER_REPLACEMENT: "Remplacement d'enseignant",
};

const RECIPIENT_LABELS: Record<SchoolNotificationRecipient, string> = {
  PARENT: "Parents",
  STUDENT: "Élèves",
  TEACHER: "Enseignants",
  SCHOOL_ADMIN: "Administration",
};

const CHANNELS: Array<{ key: SchoolNotificationChannel; label: string }> = [
  { key: "IN_APP", label: "Application" },
  { key: "PUSH", label: "Push" },
  { key: "EMAIL", label: "E-mail" },
];

type GridRow = {
  id: string;
  event: SchoolNotificationEvent;
  recipient: SchoolNotificationRecipient;
};

function rowsFromSettings(settings: SchoolNotificationSettings | null): GridRow[] {
  if (!settings) return [];
  const rows: GridRow[] = [];
  for (const event of EVENT_ORDER) {
    const rule = settings.events[event];
    if (!rule) continue;
    for (const recipient of rule.allowedRecipients) {
      rows.push({ id: `${event}:${recipient}`, event, recipient });
    }
  }
  return rows;
}

function channelOf(rule: SchoolNotificationEventRule | undefined, recipient: SchoolNotificationRecipient, channel: SchoolNotificationChannel) {
  return rule?.[recipient]?.[channel] ?? true;
}

export function SettingsNotificationsPage() {
  const { activeSchool } = useActiveSchool();
  const ctx = usePermissionContext();
  const canEdit = canManageEstablishmentSettings(ctx);
  const schoolCode = activeSchool?.code ?? "";

  const [settings, setSettings] = useState<SchoolNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schoolCode) {
      setSettings(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setSettings(null);
    setSavingKey("");
    setError("");
    void getSchoolNotificationSettings(schoolCode)
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Impossible de charger les règles de notification.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [schoolCode]);

  const rows = useMemo(() => rowsFromSettings(settings), [settings]);

  async function toggle(event: SchoolNotificationEvent, recipient: SchoolNotificationRecipient, channel: SchoolNotificationChannel) {
    if (!settings || !canEdit || savingKey || loading) return;
    const previous = settings;
    const nextValue = !channelOf(settings.events[event], recipient, channel);
    const next: SchoolNotificationSettings = {
      ...settings,
      events: {
        ...settings.events,
        [event]: {
          ...settings.events[event],
          [recipient]: {
            ...settings.events[event][recipient],
            [channel]: nextValue,
          },
        },
      },
    };
    setSettings(next);
    setSavingKey(`${event}:${recipient}:${channel}`);
    setError("");
    try {
      const saved = await patchSchoolNotificationSettings(schoolCode, {
        events: { [event]: { [recipient]: { [channel]: nextValue } } },
      });
      setSettings(saved);
    } catch (cause) {
      setSettings(previous);
      setError(cause instanceof Error ? cause.message : "L’enregistrement a été refusé. Les interrupteurs ont été rétablis.");
    } finally {
      setSavingKey("");
    }
  }

  return (
    <DashboardLayout>
      <DashboardLayout.Header>
        <SectionHeader
          title="Notifications"
          description="Choisissez quels événements informent les familles, les élèves, les enseignants et l’administration, et par quels canaux."
        />
      </DashboardLayout.Header>
      <DashboardLayout.Content>
        {!schoolCode ? (
          <EmptyState
            title="Aucun établissement actif"
            description="Sélectionnez un établissement pour configurer ses notifications."
          />
        ) : (
          <div className="space-y-4">
            {error ? (
              <InlineAlert tone="danger">{error}</InlineAlert>
            ) : null}

            {loading && !settings ? (
              <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-slate-50 px-4 py-10 text-center text-sm text-muted">
                Chargement des règles de notification…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Événement</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Destinataires</th>
                      {CHANNELS.map((channel) => (
                        <th key={channel.key} scope="col" className="px-4 py-3 font-semibold">
                          {channel.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rule = settings?.events[row.event];
                      return (
                        <tr key={row.id} className="border-b border-line/70 last:border-0">
                          <td className="px-4 py-3 font-semibold text-ink">{EVENT_LABELS[row.event]}</td>
                          <td className="px-4 py-3 text-ink">{RECIPIENT_LABELS[row.recipient]}</td>
                          {CHANNELS.map((channel) => {
                            const checked = channelOf(rule, row.recipient, channel.key);
                            const label = `${EVENT_LABELS[row.event]} — ${RECIPIENT_LABELS[row.recipient]} — ${channel.label}`;
                            return (
                              <td key={channel.key} className="px-4 py-3">
                                <Switch
                                  checked={checked}
                                  aria-label={label}
                                  disabled={!canEdit || Boolean(savingKey) || loading}
                                  onCheckedChange={() => void toggle(row.event, row.recipient, channel.key)}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!canEdit && settings ? (
              <p className="text-sm text-muted">Vous pouvez consulter ces règles. Seuls les administrateurs de l’établissement peuvent les modifier.</p>
            ) : null}
          </div>
        )}
      </DashboardLayout.Content>
    </DashboardLayout>
  );
}
