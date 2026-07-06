import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface TabItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  /** Correspondance exacte du chemin (sinon actif aussi sur les routes enfants). */
  end?: boolean;
}

interface TabNavProps {
  tabs: TabItem[];
  /** "primary" = onglets de module ; "sub" = sous-onglets. */
  variant?: "primary" | "sub";
  className?: string;
}

/**
 * Barre d'onglets pilotée par l'URL (routes imbriquées + Outlet).
 * Style shadcn/ui, icônes Lucide. Permet une navigation profonde propre :
 * /planning/emploi-du-temps/par-classe, etc.
 */
export function TabNav({ tabs, variant = "primary", className }: TabNavProps) {
  if (variant === "sub") {
    return (
      <nav
        className={cn("no-print flex flex-wrap items-center gap-1.5", className)}
        aria-label="Sous-onglets"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                isActive
                  ? "border-brand bg-brand-50 text-brand"
                  : "border-line bg-white text-slate-600 hover:border-brand/40 hover:text-ink",
              )
            }
          >
            {tab.icon ? <tab.icon className="h-4 w-4" /> : null}
            {tab.label}
          </NavLink>
        ))}
      </nav>
    );
  }

  return (
    <nav
      className={cn("no-print flex flex-wrap items-center gap-1 border-b border-line", className)}
      aria-label="Onglets"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition",
              isActive
                ? "border-brand text-brand"
                : "border-transparent text-slate-600 hover:border-line hover:text-ink",
            )
          }
        >
          {tab.icon ? <tab.icon className="h-4 w-4" /> : null}
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
