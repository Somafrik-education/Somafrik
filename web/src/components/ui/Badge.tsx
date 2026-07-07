import type { ReactNode } from "react";
import { normalize } from "../../lib/format";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-teal/10 text-teal",
  warning: "bg-amber/10 text-amber",
  danger: "bg-danger/10 text-danger",
  info: "bg-brand-50 text-brand",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// Choisit automatiquement une couleur selon un statut métier courant.
export function StatusBadge({ status }: { status?: string }) {
  const value = normalize(status);
  let tone: Tone = "neutral";
  if (["actif", "a jour", "valide", "couvert", "paye", "lu", "active", "valide", "approuvee"].includes(value)) tone = "success";
  else if (["en attente", "en attente de validation", "non lu", "moyenne", "essai", "brouillon", "emise"].includes(value)) tone = "warning";
  else if (["suspendu", "en retard", "refuse", "critique", "haute", "expire", "annule", "resilie"].includes(value)) tone = "danger";
  return <Badge tone={tone}>{status ?? "—"}</Badge>;
}
