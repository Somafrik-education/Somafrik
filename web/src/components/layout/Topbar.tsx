import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { displayRoleName, getInitials } from "../../lib/format";
import { formatSchoolOption } from "../../lib/superadminCrudPath";
import { scopedNotifications } from "../../lib/scope";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { Button } from "../ui/Button";
import { Field, Select } from "../ui/Field";

export function Topbar({ title }: { title: string }) {
  const { session, logout } = useAuth();
  const { state, loading, error, refresh } = useData();
  const { requiresSelection, availableSchools, activeSchoolCode, setActiveSchoolCode } = useActiveSchool();
  const ctx = usePermissionContext();
  const user = session?.user;
  const scope = session?.scope;

  const showSchoolPicker = requiresSelection && availableSchools.length > 0;

  const canReadNotifications = canReadView(ctx, "notifications");
  const unreadCount = canReadNotifications
    ? scopedNotifications(user ?? null, state).filter((n) => n.status !== "Lu").length
    : 0;

  return (
    <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-line bg-white/90 px-6 py-3 backdrop-blur">
      <div>
        <h1 className="text-lg font-bold text-ink">{title}</h1>
        {scope?.label ? <p className="text-xs text-muted">{scope.label}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        {showSchoolPicker ? (
          <div className="hidden min-w-[220px] md:block">
            <Field label="Établissement actif">
              <Select
                value={activeSchoolCode}
                onChange={(e) => setActiveSchoolCode(e.target.value)}
                options={availableSchools.map(formatSchoolOption)}
              />
            </Field>
          </div>
        ) : null}
        {error ? (
          <p className="max-w-xs truncate text-xs text-danger" title={error}>
            {error}
          </p>
        ) : null}
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Synchronisation…" : "Rafraîchir"}
        </Button>
        {canReadNotifications ? (
          <NavLink
            to="/notifications"
            aria-label={`Notifications${unreadCount ? ` (${unreadCount} non lue${unreadCount > 1 ? "s" : ""})` : ""}`}
            className={({ isActive }) =>
              `relative flex h-9 w-9 items-center justify-center rounded-full transition ${
                isActive ? "bg-brand-50 text-brand" : "text-slate-500 hover:bg-slate-50 hover:text-ink"
              }`
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </NavLink>
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
