import { NavLink } from "react-router-dom";
import { BrandLogo } from "../BrandLogo";
import { NAV_ITEMS, NAV_GROUP_ORDER, type NavItem } from "../../lib/constants";
import { isInternalSchoolRole } from "../../lib/format";
import { canReadView, canAccessSchoolBackOffice } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { useAuth } from "../../context/AuthContext";

export function Sidebar() {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const role = session?.user?.role;
  const internalSchool = isInternalSchoolRole(role);
  const schoolBackOffice = canAccessSchoolBackOffice(role);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.schoolOnly && !schoolBackOffice) return false;
    // Les comptes établissement gèrent utilisateurs / droits via Paramètres.
    if (internalSchool && (item.view === "users" || item.view === "permissions")) return false;
    return canReadView(ctx, item.view);
  });

  const dashboard = visible.filter((item) => item.group === "dashboard");

  function NavLinks({ items }: { items: NavItem[] }) {
    return items.map((item) => (
      <NavLink
        key={item.view}
        to={item.path}
        end={item.path === "/tableau-de-bord"}
        className={({ isActive }) =>
          `block rounded-lg px-3 py-2 text-sm font-semibold transition ${
            isActive ? "bg-brand-50 text-brand" : "text-slate-600 hover:bg-slate-50 hover:text-ink"
          }`
        }
      >
        {item.label}
      </NavLink>
    ));
  }

  return (
    <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
      <div className="px-6 py-5">
        <BrandLogo size="lg" />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {dashboard.length ? (
          <div className="space-y-1">
            <NavLinks items={dashboard} />
          </div>
        ) : null}

        {NAV_GROUP_ORDER.map(({ group, label }) => {
          const items = visible.filter((item) => item.group === group);
          if (!items.length) return null;
          // Groupe réduit à un seul module (ex. Finances, Communication) :
          // on affiche directement le lien, sans en-tête de section redondant.
          if (items.length === 1) {
            return (
              <div key={group} className="space-y-1">
                <NavLinks items={items} />
              </div>
            );
          }
          return (
            <div key={group}>
              <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-brand">
                {label}
              </p>
              <div className="space-y-1">
                <NavLinks items={items} />
              </div>
            </div>
          );
        })}
      </nav>

      {internalSchool && session?.user?.schoolCode ? (
        <p className="border-t border-line px-6 py-4 text-xs text-muted">
          Établissement · {session.user.schoolCode}
        </p>
      ) : (
        <p className="px-6 py-4 text-xs text-muted">SaaS multi-pays · multi-établissements</p>
      )}
    </aside>
  );
}
