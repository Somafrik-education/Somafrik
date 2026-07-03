import { NavLink } from "react-router-dom";
import { BrandLogo } from "../BrandLogo";
import { NAV_ITEMS } from "../../lib/constants";
import { SCHOOL_ENTITY_SIDEBAR_VIEWS } from "../../lib/entityModules";
import { isInternalSchoolRole } from "../../lib/format";
import { isSuperAdminRole, COUNTRY_ADMIN_ROLE } from "../../lib/orgHierarchy";
import { canReadView, canAccessSchoolBackOffice } from "../../lib/permissions";
import {
  SUPER_ADMIN_BULLETIN_VIEWS,
  SUPER_ADMIN_PLATFORM_VIEWS,
  SUPER_ADMIN_SCHOOL_SETTINGS_VIEWS,
} from "../../lib/superAdminAccess";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { useAuth } from "../../context/AuthContext";

const SCHOOL_VIEWS = new Set(["establishment", "configuration", ...SCHOOL_ENTITY_SIDEBAR_VIEWS]);
const STRUCTURE_VIEWS = new Set(["countries", "schools", "subscriptions"]);
const SUPER_ADMIN_PLATFORM = new Set<string>(SUPER_ADMIN_PLATFORM_VIEWS);
const SUPER_ADMIN_SCHOOL = new Set<string>([...SUPER_ADMIN_SCHOOL_SETTINGS_VIEWS, ...SUPER_ADMIN_BULLETIN_VIEWS]);

export function Sidebar() {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const role = session?.user?.role;
  const superAdmin = isSuperAdminRole(role);
  const internalSchool = isInternalSchoolRole(role);
  const schoolBackOffice = canAccessSchoolBackOffice(role);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.schoolOnly && !schoolBackOffice) return false;
    return canReadView(ctx, item.view);
  });

  const schoolItems = visible.filter((item) => SCHOOL_VIEWS.has(item.view));
  const platformItems = visible.filter(
    (item) =>
      !SCHOOL_VIEWS.has(item.view) &&
      !(internalSchool && (item.view === "users" || item.view === "permissions")),
  );
  const structureItems = platformItems.filter((item) => STRUCTURE_VIEWS.has(item.view));
  const adminItems = platformItems.filter((item) => !STRUCTURE_VIEWS.has(item.view));

  const superAdminStructure = visible.filter((item) => SUPER_ADMIN_PLATFORM.has(item.view) && STRUCTURE_VIEWS.has(item.view));
  const superAdminAdmin = visible.filter(
    (item) => SUPER_ADMIN_PLATFORM.has(item.view) && !STRUCTURE_VIEWS.has(item.view),
  );
  const superAdminSchool = visible.filter((item) => SUPER_ADMIN_SCHOOL.has(item.view));

  const structureTitle = role === COUNTRY_ADMIN_ROLE ? "Périmètre pays" : "Pays → Local";

  function NavLinks({ items }: { items: typeof visible }) {
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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
      <div className="px-6 py-5">
        <BrandLogo size="lg" />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {!superAdmin ? (
          <div className="space-y-1">
            <NavLinks items={visible.filter((item) => item.view === "overview")} />
          </div>
        ) : null}

        {superAdmin ? (
          <>
            {visible.some((item) => item.view === "overview") ? (
              <div className="space-y-1">
                <NavLinks items={visible.filter((item) => item.view === "overview")} />
              </div>
            ) : null}
            {superAdminStructure.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-brand">
                  Paramétrage plateforme
                </p>
                <div className="space-y-1">
                  <NavLinks items={superAdminStructure} />
                </div>
              </div>
            ) : null}
            {superAdminAdmin.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-muted">
                  Administration
                </p>
                <div className="space-y-1">
                  <NavLinks items={superAdminAdmin} />
                </div>
              </div>
            ) : null}
            {superAdminSchool.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-brand">
                  Établissement & bulletins
                </p>
                <div className="space-y-1">
                  <NavLinks items={superAdminSchool} />
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {schoolBackOffice && schoolItems.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-brand">
                  Mon établissement
                </p>
                <div className="space-y-1">
                  <NavLinks items={schoolItems} />
                </div>
              </div>
            ) : null}

            {!internalSchool && structureItems.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-brand">
                  {structureTitle}
                </p>
                <div className="space-y-1">
                  <NavLinks items={structureItems} />
                </div>
              </div>
            ) : null}

            {!internalSchool && adminItems.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-muted">
                  Administration
                </p>
                <div className="space-y-1">
                  <NavLinks items={adminItems} />
                </div>
              </div>
            ) : null}

            {internalSchool && adminItems.length ? (
              <div>
                <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-muted">
                  Administration
                </p>
                <div className="space-y-1">
                  <NavLinks items={adminItems} />
                </div>
              </div>
            ) : null}
          </>
        )}
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
