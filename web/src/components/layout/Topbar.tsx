import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Bell, LogOut, Mail, Megaphone, Menu, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { displayRoleName, getInitials } from "../../lib/format";
import { scopedNotifications } from "../../lib/scope";
import { scopedMessages } from "../../lib/establishment";
import { useAnnouncementsUnreadCount } from "../../lib/announcementsRead";
import { useInternalNotificationsUnreadCount } from "../../lib/internalNotificationsRead";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { Button } from "../ui/Button";
import { GlobalSearch } from "./GlobalSearch";

/** Icône d'accès rapide (haut à droite) avec pastille rouge de comptage optionnelle. */
function TopbarIcon({
  to,
  label,
  count = 0,
  children,
}: {
  to: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  const badgeLabel = count > 0 ? ` (${count} non lu${count > 1 ? "s" : ""})` : "";
  return (
    <NavLink
      to={to}
      aria-label={`${label}${badgeLabel}`}
      className={({ isActive }) =>
        `relative flex h-9 w-9 items-center justify-center rounded-full transition ${
          isActive ? "bg-brand-50 text-brand" : "text-slate-500 hover:bg-slate-50 hover:text-ink"
        }`
      }
    >
      {children}
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Topbar({ title, onMenuOpen }: { title: string; onMenuOpen?: () => void }) {
  const { session, logout } = useAuth();
  const { state, loading, error, refresh } = useData();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const ctx = usePermissionContext();
  const user = session?.user;
  const scopeUser = scopedUser ?? user ?? null;

  const canReadNotifications = canReadView(ctx, "notifications");
  const hasInternalNotificationScope = Boolean(activeSchoolCode && activeSchoolCode !== "*");
  const internalUnreadCount = useInternalNotificationsUnreadCount(
    canReadNotifications && hasInternalNotificationScope,
    activeSchoolCode,
  );
  const unreadCount = hasInternalNotificationScope
    ? internalUnreadCount
    : canReadNotifications
      ? scopedNotifications(user ?? null, state).filter((n) => n.status !== "Lu").length
      : 0;

  const canReadMessages = canReadView(ctx, "messages");
  const unreadMessages = canReadMessages
    ? scopedMessages(scopeUser, state).filter((m) => String(m.status ?? "") !== "Lu").length
    : 0;

  const canReadAnnouncements = canReadView(ctx, "announcements");
  const unreadAnnouncements = useAnnouncementsUnreadCount(canReadAnnouncements, activeSchoolCode);

  return (
    <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-white/90 px-3 py-3 backdrop-blur sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onMenuOpen ? (
          <button
            type="button"
            onClick={onMenuOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-50 hover:text-ink lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-ink sm:text-lg">{title}</h1>
          {session?.scope?.label ? (
            <p className="truncate text-xs text-muted">{session.scope.label}</p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2 xl:gap-3">
        <GlobalSearch />
        {error ? (
          <p className="hidden max-w-xs truncate text-xs text-danger 2xl:block" title={error}>
            {error}
          </p>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label={loading ? "Synchronisation en cours" : "Rafraîchir les données"}
          className="hidden px-2.5 lg:inline-flex xl:px-3"
        >
          <RefreshCw className={`h-4 w-4 xl:hidden ${loading ? "animate-spin" : ""}`} />
          <span className="hidden xl:inline">{loading ? "Synchronisation…" : "Rafraîchir"}</span>
        </Button>
        {canReadMessages ? (
          <div className="hidden lg:block">
            <TopbarIcon to="/messages" label="Messages" count={unreadMessages}>
              <Mail className="h-5 w-5" strokeWidth={1.8} />
            </TopbarIcon>
          </div>
        ) : null}
        {canReadAnnouncements ? (
          <div className="hidden lg:block">
            <TopbarIcon to="/annonces" label="Annonces" count={unreadAnnouncements}>
              <Megaphone className="h-5 w-5" strokeWidth={1.8} />
            </TopbarIcon>
          </div>
        ) : null}
        {canReadNotifications ? (
          <TopbarIcon to="/notifications" label="Notifications" count={unreadCount}>
            <Bell className="h-5 w-5" strokeWidth={1.8} />
          </TopbarIcon>
        ) : null}
        <div className="hidden items-center gap-3 xl:flex">
          <div className="text-right">
            <p className="text-sm font-semibold leading-tight text-ink">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted">{displayRoleName(user?.role)}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand">
            {getInitials(user?.firstName, user?.lastName)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          aria-label="Déconnexion"
          data-testid="logout-button"
          className="px-2.5 xl:px-3"
        >
          <LogOut className="h-4 w-4 xl:hidden" />
          <span className="hidden xl:inline">Déconnexion</span>
        </Button>
      </div>
    </header>
  );
}
