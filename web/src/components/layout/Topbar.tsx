import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Bell, Mail, Megaphone } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { displayRoleName, getInitials } from "../../lib/format";
import { scopedNotifications } from "../../lib/scope";
import { scopedMessages } from "../../lib/establishment";
import { countUnreadAnnouncements, useAnnouncementsReadListener } from "../../lib/announcementsRead";
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

export function Topbar({ title }: { title: string }) {
  const { session, logout } = useAuth();
  const { state, loading, error, refresh } = useData();
  const { scopedUser } = useActiveSchool();
  const ctx = usePermissionContext();
  const user = session?.user;
  const scopeUser = scopedUser ?? user ?? null;

  const canReadNotifications = canReadView(ctx, "notifications");
  const unreadCount = canReadNotifications
    ? scopedNotifications(user ?? null, state).filter((n) => n.status !== "Lu").length
    : 0;

  const canReadMessages = canReadView(ctx, "messages");
  const unreadMessages = canReadMessages
    ? scopedMessages(scopeUser, state).filter((m) => String(m.status ?? "") !== "Lu").length
    : 0;

  const canReadAnnouncements = canReadView(ctx, "announcements");
  useAnnouncementsReadListener();
  const unreadAnnouncements = canReadAnnouncements
    ? countUnreadAnnouncements(scopeUser, state)
    : 0;

  return (
    <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-line bg-white/90 px-6 py-3 backdrop-blur">
      <div>
        <h1 className="text-lg font-bold text-ink">{title}</h1>
        {session?.scope?.label ? <p className="text-xs text-muted">{session.scope.label}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <GlobalSearch />
        {error ? (
          <p className="max-w-xs truncate text-xs text-danger" title={error}>
            {error}
          </p>
        ) : null}
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Synchronisation…" : "Rafraîchir"}
        </Button>
        {canReadMessages ? (
          <TopbarIcon to="/messages" label="Messages" count={unreadMessages}>
            <Mail className="h-5 w-5" strokeWidth={1.8} />
          </TopbarIcon>
        ) : null}
        {canReadAnnouncements ? (
          <TopbarIcon to="/annonces" label="Annonces" count={unreadAnnouncements}>
            <Megaphone className="h-5 w-5" strokeWidth={1.8} />
          </TopbarIcon>
        ) : null}
        {canReadNotifications ? (
          <TopbarIcon to="/notifications" label="Notifications" count={unreadCount}>
            <Bell className="h-5 w-5" strokeWidth={1.8} />
          </TopbarIcon>
        ) : null}
        <div className="hidden items-center gap-3 sm:flex">
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
        <Button variant="ghost" size="sm" onClick={logout}>
          Déconnexion
        </Button>
      </div>
    </header>
  );
}
