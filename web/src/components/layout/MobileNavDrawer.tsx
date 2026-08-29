import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Bell, Mail, Megaphone, RefreshCw, X } from "lucide-react";
import { useData } from "../../context/DataContext";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { BrandLogo } from "../BrandLogo";
import { AppNavContent } from "./AppNavContent";

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const { loading, refresh } = useData();
  const ctx = usePermissionContext();

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const quickLinks = [
    canReadView(ctx, "messages")
      ? { to: "/messages", label: "Messages", icon: Mail }
      : null,
    canReadView(ctx, "announcements")
      ? { to: "/annonces", label: "Annonces", icon: Megaphone }
      : null,
    canReadView(ctx, "notifications")
      ? { to: "/notifications", label: "Notifications", icon: Bell }
      : null,
  ].filter(Boolean) as Array<{
    to: string;
    label: string;
    icon: typeof Mail;
  }>;

  return (
    <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu de navigation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Fermer le menu"
      />
      <aside className="relative flex h-full w-[min(18rem,85vw)] flex-col border-r border-line bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <BrandLogo size="lg" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-50 hover:text-ink"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-line px-3 py-3">
          <p className="px-2 pb-2 text-[11px] font-black uppercase tracking-wide text-brand">
            Accès rapides
          </p>
          <div className="grid grid-cols-2 gap-1">
            {quickLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition ${
                    isActive ? "bg-brand-50 text-brand" : "text-slate-600 hover:bg-slate-50 hover:text-ink"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => {
                onClose();
                void refresh();
              }}
              disabled={loading}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${loading ? "animate-spin" : ""}`} strokeWidth={1.8} />
              <span className="truncate">{loading ? "Synchro…" : "Rafraîchir"}</span>
            </button>
          </div>
        </div>

        <AppNavContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
