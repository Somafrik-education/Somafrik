import type { LucideIcon } from "lucide-react";

interface PagePlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
}

/** Écran « à venir » propre pour les onglets dont la fonctionnalité n'est pas encore développée. */
export function PagePlaceholder({
  icon: Icon,
  title,
  description,
  badge = "Bientôt disponible",
}: PagePlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/70 px-6 py-16 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-black text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted">{description}</p>
      <span className="mt-4 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
        {badge}
      </span>
    </div>
  );
}
