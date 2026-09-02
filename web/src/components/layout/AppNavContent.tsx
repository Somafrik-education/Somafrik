import { NavLink } from "react-router-dom";
import { NAV_GROUP_ORDER, type NavItem } from "../../lib/constants";
import { useVisibleNavItems } from "./useVisibleNavItems";

interface AppNavContentProps {
  onNavigate?: () => void;
}

export function AppNavContent({ onNavigate }: AppNavContentProps) {
  const { visible, dashboard, internalSchool, schoolCode } = useVisibleNavItems();

  function NavLinks({ items }: { items: NavItem[] }) {
    return items.map((item) => (
      <NavLink
        key={item.view}
        to={item.path}
        data-testid={`nav-${item.view}`}
        end={item.path === "/tableau-de-bord"}
        onClick={() => onNavigate?.()}
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
    <>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {dashboard.length ? (
          <div className="space-y-1">
            <NavLinks items={dashboard} />
          </div>
        ) : null}

        {NAV_GROUP_ORDER.map(({ group, label }) => {
          const items = visible.filter((item) => item.group === group);
          if (!items.length) return null;
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

      {internalSchool && schoolCode ? (
        <p className="border-t border-line px-6 py-4 text-xs text-muted">
          Établissement · {schoolCode}
        </p>
      ) : (
        <p className="border-t border-line px-6 py-4 text-xs text-muted">
          SaaS multi-pays · multi-établissements
        </p>
      )}
    </>
  );
}
