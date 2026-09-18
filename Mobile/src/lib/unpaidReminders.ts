import { hasSecurityPermission } from "../domain/security/permissions";
import { formatFinanceDate } from "./financeCurrency";

/** Délai minimum entre deux relances pour le même élève (IMP-013, même règle Web). */
export const REMINDER_COOLDOWN_DAYS = 3;

/** POST unpaid reminders — Impayés:CREATE | Paiements:UPDATE. */
export function canSendUnpaidReminder(session: unknown): boolean {
  return (
    hasSecurityPermission(session, "Impayés", "CREATE") ||
    hasSecurityPermission(session, "Paiements", "UPDATE")
  );
}

/** Forçage cooldown — Impayés:CREATE, aligné backend canForceReminder. */
export function canForceUnpaidReminder(session: unknown): boolean {
  return hasSecurityPermission(session, "Impayés", "CREATE");
}

export function canSendReminder(
  reminders: Array<{ studentId?: string; sendStatus?: string; sentAt?: string }>,
  studentId: string,
  cooldownDays = REMINDER_COOLDOWN_DAYS,
  now = new Date(),
): { allowed: boolean; lastReminderAt?: string; message?: string } {
  const recent = reminders
    .filter((row) => row.studentId === studentId && row.sendStatus !== "Échouée")
    .sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")))[0];

  if (!recent?.sentAt) return { allowed: true };

  const last = new Date(recent.sentAt);
  const daysSince = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince < cooldownDays) {
    return {
      allowed: false,
      lastReminderAt: recent.sentAt,
      message: `Une relance a déjà été envoyée le ${formatFinanceDate(recent.sentAt)}. Attendez ${cooldownDays - daysSince} jour(s) ou confirmez l'envoi.`,
    };
  }
  return { allowed: true, lastReminderAt: recent.sentAt };
}

export function buildReminderMessage(
  row: {
    studentName?: string;
    periodLabel?: string;
    amountDue?: number;
    currency?: string;
    dueDate?: string;
    daysLate?: number;
  },
  schoolName?: string,
): string {
  const establishment = schoolName ? ` (${schoolName})` : "";
  return (
    `Bonjour,\n\n` +
    `Nous vous rappelons que des frais scolaires restent dus pour ${row.studentName}${establishment}.\n\n` +
    `Période : ${row.periodLabel}\n` +
    `Montant restant : ${Number(row.amountDue ?? 0).toLocaleString("fr-FR")} ${row.currency}\n` +
    (row.dueDate ? `Échéance dépassée depuis ${row.daysLate} jour(s).\n\n` : "\n") +
    `Merci de régulariser votre situation auprès du service comptabilité de l'établissement.\n\n` +
    `— Somafrik`
  );
}
