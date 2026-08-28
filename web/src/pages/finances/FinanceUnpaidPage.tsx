import { useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { PrintButton } from "../../components/ui/PrintButton";
import { Badge, StatusBadge } from "../../components/ui/Badge";
import { Table, type Column } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import type {
  ReminderChannel,
  ReminderRecipient,
  StudentUnpaidRow,
} from "../../types";
import {
  aggregateUnpaidByStudent,
  buildReminderMessage,
  buildUnpaidDashboard,
  canSendReminder,
  classOptionsFromUnpaid,
  getStudentUnpaidDetail,
  listUnpaidStudentFees,
  periodOptionsFromFees,
  REMINDER_COOLDOWN_DAYS,
  scopedPaymentReminders,
  severityTone,
} from "../../lib/unpaidModule";
import {
  canAccessUnpaidModule,
  canSendUnpaidReminder,
  isOwnUnpaidScopeOnly,
} from "../../lib/unpaidPermissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { financeApi } from "../../lib/financeApi";
import { createFinanceIdempotencyKey } from "../../lib/financeIdempotency";
import { ApiError } from "../../api/client";
import { formatFinanceAmount, formatFinanceDate, resolveFinanceCurrency } from "../../lib/financeCurrency";
import { financeObligationStatusLabel, financePaymentStatusLabel } from "../../lib/financeObligationStatus";
import { EmptyState } from "../../design-system";

const REMINDER_CHANNELS: { value: ReminderChannel; label: string }[] = [
  { value: "notification", label: "Notification application" },
  { value: "email", label: "Email (si configuré)" },
  { value: "sms", label: "SMS (si configuré)" },
  { value: "whatsapp", label: "WhatsApp (si configuré)" },
];

const RECIPIENTS: ReminderRecipient[] = ["Parent", "Responsable", "Étudiant"];

export function FinanceUnpaidPage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const canAccess = canAccessUnpaidModule(ctx);
  const canRemind = canSendUnpaidReminder(ctx);
  const ownScopeOnly = isOwnUnpaidScopeOnly(ctx);

  const [search, setSearch] = useState("");
  const [className, setClassName] = useState("");
  const [period, setPeriod] = useState("");
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  const [reminderRow, setReminderRow] = useState<StudentUnpaidRow | null>(null);
  const [reminderChannel, setReminderChannel] = useState<ReminderChannel>("notification");
  const [reminderRecipient, setReminderRecipient] = useState<ReminderRecipient>("Parent");
  const [reminderMessage, setReminderMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reminderIntentionRef = useRef(createFinanceIdempotencyKey());

  const reminders = useMemo(
    () => scopedPaymentReminders(session?.user ?? null, state),
    [session?.user, state.paymentReminders],
  );

  const fees = useMemo(
    () =>
      listUnpaidStudentFees(state, session?.user ?? null, {
        search,
        className: className || undefined,
        period: period || undefined,
      }),
    [state, session?.user, search, className, period],
  );

  const rows = useMemo(
    () => aggregateUnpaidByStudent(fees, reminders, state),
    [fees, reminders, state],
  );

  const dashboard = useMemo(() => buildUnpaidDashboard(rows), [rows]);
  const classOptions = useMemo(() => classOptionsFromUnpaid(rows), [rows]);
  const periodOptions = useMemo(() => periodOptionsFromFees(fees), [fees]);

  const detail = useMemo(() => {
    if (!detailStudentId) return null;
    return getStudentUnpaidDetail(state, session?.user ?? null, detailStudentId, fees, reminders);
  }, [detailStudentId, state, session?.user, fees, reminders]);

  if (!canAccess) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">
          Accès refusé — vous n&apos;êtes pas autorisé à consulter les impayés.
        </p>
      </Card>
    );
  }

  async function sendReminder(row: StudentUnpaidRow, force = false) {
    if (!canRemind) {
      showToast("Vous n'êtes pas autorisé à envoyer des relances", "error");
      return;
    }
    if (!navigator.onLine) {
      showToast("Connexion requise pour envoyer une relance (IMP-025)", "error");
      return;
    }

    let forceSend = force;
    const gate = canSendReminder(reminders, row.studentId);
    if (!gate.allowed && !forceSend) {
      const ok = await confirm({
        title: "Relance récente",
        description: gate.message ?? "Une relance a déjà été envoyée récemment.",
        confirmLabel: "Envoyer quand même",
      });
      if (!ok) return;
      forceSend = true;
    }

    setBusy(true);
    try {
      const school = state.schools.find((item) => item.code === row.schoolCode);
      const message = reminderMessage.trim() || buildReminderMessage(row, school?.name);
      await financeApi.createReminder(
        row.studentId,
        {
          channel: reminderChannel,
          recipient: reminderRecipient,
          message,
          force: Boolean(forceSend),
        },
        { idempotencyKey: reminderIntentionRef.current },
      );
      reminderIntentionRef.current = createFinanceIdempotencyKey();
      await refresh();

      showToast(
        reminderChannel === "notification"
          ? "Relance envoyée par notification"
          : "Relance enregistrée — envoi externe en attente de configuration",
        "success",
      );
      setReminderRow(null);
      setReminderMessage("");
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      showToast(
        code === "REMINDER_COOLDOWN"
          ? error instanceof Error ? error.message : "Relance récente, cooldown actif"
          : error instanceof Error ? error.message : "Échec de l'enregistrement de la relance",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  function openReminderModal(row: StudentUnpaidRow) {
    const school = state.schools.find((item) => item.code === row.schoolCode);
    setReminderRow(row);
    setReminderMessage(buildReminderMessage(row, school?.name));
    setReminderChannel("notification");
    setReminderRecipient("Parent");
  }

  const columns: Column<StudentUnpaidRow>[] = [
    {
      key: "studentName",
      header: "Élève",
      render: (row) => (
        <div>
          <p className="font-semibold text-ink">{row.studentName}</p>
          {row.matricule ? <p className="text-xs text-muted">{row.matricule}</p> : null}
        </div>
      ),
    },
    { key: "className", header: "Classe" },
    {
      key: "amountDue",
      header: "Montant dû",
      align: "right",
      render: (row) => (
        <span className="font-semibold">
          {formatFinanceAmount(row.amountDue, resolveFinanceCurrency(row.currency))}
        </span>
      ),
    },
    { key: "periodLabel", header: "Période" },
    {
      key: "daysLate",
      header: "Retard",
      align: "center",
      render: (row) =>
        row.daysLate > 0 ? (
          <Badge tone={severityTone(row.severity)}>{row.daysLate} j</Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "severity",
      header: "Criticité",
      render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>,
    },
    {
      key: "reminders",
      header: "Relances",
      align: "center",
      render: (row) => row.reminderCount || "—",
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDetailStudentId(row.studentId)}>
            Détail
          </Button>
          {canRemind && !ownScopeOnly ? (
            <Button size="sm" onClick={() => openReminderModal(row)}>
              Relancer
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title="Impayés & restes à payer"
          description={
            ownScopeOnly
              ? "Votre situation financière : montant dû, déjà payé et reste à régler."
              : "Élèves avec un reste à payer — lecture des obligations ouvertes après application des tarifs."
          }
          actions={<PrintButton documentTitle="Impayés — Somafrik" />}
        />

        <div className="no-print mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total restant"
            value={formatFinanceAmount(dashboard.totalAmountDue, resolveFinanceCurrency(dashboard.currency))}
          />
          <Stat label="Élèves en retard" value={dashboard.studentCount} />
          <Stat label="Lignes en retard" value={dashboard.overdueLineCount} />
          <Stat label="Délai relance min." value={`${REMINDER_COOLDOWN_DAYS} jours`} />
        </div>

        {!fees.length ? (
          <div className="mt-6">
            <EmptyState
              title="Aucun reste à payer"
              description="Les obligations ouvertes apparaissent ici dès qu'un tarif a été appliqué et qu'un solde demeure."
            />
          </div>
        ) : null}

        <div className="no-print mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Recherche">
            <Input
              placeholder="Nom, matricule, classe…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Classe">
            <Select
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              options={[
                { value: "", label: "Toutes les classes" },
                ...classOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Field>
          <Field label="Période">
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              options={[
                { value: "", label: "Toutes les périodes" },
                ...periodOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Field>
        </div>

        {dashboard.byClass.length > 1 ? (
          <div className="mt-6">
            <p className="text-xs font-black uppercase tracking-wide text-muted">Impayés par classe</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {dashboard.byClass.slice(0, 6).map((item) => (
                <div key={item.className} className="rounded-lg border border-line/70 px-3 py-2 text-sm">
                  <p className="font-semibold">{item.className}</p>
                  <p className="text-muted">
                    {item.studentCount} élève(s) · {formatFinanceAmount(item.amountDue, resolveFinanceCurrency(dashboard.currency))}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <Table columns={columns} rows={rows} rowKey={(row) => row.studentId} emptyLabel="Aucun reste à payer" stackOnMobile />
        </div>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetailStudentId(null)}
        title={detail ? `Impayé — ${detail.row.studentName}` : "Détail"}
        footer={<Button onClick={() => setDetailStudentId(null)}>Fermer</Button>}
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <Info label="Classe" value={detail.row.className} />
              <Info label="Période" value={detail.row.periodLabel} />
              <Info
                label="Reste à payer"
                value={formatFinanceAmount(detail.row.amountDue, resolveFinanceCurrency(detail.row.currency))}
              />
              <Info label="Criticité" value={detail.row.severity} />
            </div>

            <div>
              <p className="font-semibold text-ink">Obligations ouvertes</p>
              <ul className="mt-2 space-y-1">
                {detail.fees.map((fee) => (
                  <li key={fee.id} className="flex justify-between gap-2 rounded border border-line/60 px-2 py-1">
                    <span>
                      {fee.label}
                      {fee.className ? ` · ${fee.className}` : ""}
                    </span>
                    <span>
                      {formatFinanceAmount(fee.balance, resolveFinanceCurrency(fee.currency, detail.row.currency))}{" "}
                      <StatusBadge status={financeObligationStatusLabel(fee.status)} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-semibold text-ink">Paiements enregistrés</p>
              {detail.payments.length ? (
                <ul className="mt-2 space-y-1">
                  {detail.payments.map((payment, index) => (
                    <li key={String(payment.id ?? index)} className="flex justify-between gap-2 text-muted">
                      <span>{String(payment.label ?? payment.feeType ?? "Paiement")}</span>
                      <span>
                      {formatFinanceAmount(Number(payment.amount ?? 0), String(payment.currency ?? detail.row.currency))}
                      {" · "}
                      {financePaymentStatusLabel(payment.status)}
                      {payment.date ? ` · ${formatFinanceDate(String(payment.date))}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted">Aucun paiement enregistré.</p>
              )}
            </div>

            <div>
              <p className="font-semibold text-ink">Historique des relances</p>
              {detail.reminders.length ? (
                <ul className="mt-2 space-y-2">
                  {detail.reminders.map((item) => (
                    <li key={item.id} className="rounded border border-line/60 px-2 py-2">
                      <p className="font-medium">
                        {formatFinanceDate(item.sentAt)} — {item.channel} — {item.sendStatus}
                      </p>
                      <p className="text-muted">{item.summary ?? item.message.slice(0, 120)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted">Aucune relance envoyée.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reminderRow)}
        onClose={() => setReminderRow(null)}
        title="Envoyer une relance"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReminderRow(null)}>
              Annuler
            </Button>
            <Button
              disabled={busy || !reminderRow}
              onClick={() => reminderRow && void sendReminder(reminderRow)}
            >
              Envoyer
            </Button>
          </>
        }
      >
        {reminderRow ? (
          <div className="space-y-3">
            <Field label="Destinataire">
              <Select
                value={reminderRecipient}
                onChange={(e) => setReminderRecipient(e.target.value as ReminderRecipient)}
                options={RECIPIENTS.map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field label="Canal">
              <Select
                value={reminderChannel}
                onChange={(e) => setReminderChannel(e.target.value as ReminderChannel)}
                options={REMINDER_CHANNELS.map((item) => ({ value: item.value, label: item.label }))}
              />
            </Field>
            <Field label="Message">
              <textarea
                className="min-h-[160px] w-full rounded-lg border border-line px-3 py-2 text-sm"
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-line/70 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-ink">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="font-semibold text-ink">{value}</p>
    </div>
  );
}
