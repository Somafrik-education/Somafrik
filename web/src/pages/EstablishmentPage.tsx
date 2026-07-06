import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Card, SectionHeader } from "../components/ui/Card";
import {
  ENTITY_MODULE_GROUP_LABELS,
  ENTITY_MODULE_GROUP_ORDER,
  getModulesByGroup,
  SCHOOL_ENTITY_MODULES,
  SCHOOL_ENTITY_SIDEBAR_VIEWS,
} from "../lib/entityModules";
import { canReadView, hasBackOfficePermission, canAccessSchoolBackOffice } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";
import { NAV_ITEMS } from "../lib/constants";

export function EstablishmentPage() {
  const { session } = useAuth();
  const ctx = usePermissionContext();
  const user = session?.user ?? null;

  const modules = useMemo(
    () =>
      SCHOOL_ENTITY_MODULES.filter(
        (module) =>
          module.group !== "utilisateurs" && hasBackOfficePermission(ctx, module.feature, "READ"),
      ),
    [ctx],
  );

  const modulesByGroup = useMemo(() => getModulesByGroup(modules), [modules]);

  const adminModules = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) =>
          item.view !== "overview" &&
          item.view !== "establishment" &&
          !item.schoolOnly &&
          !SCHOOL_ENTITY_SIDEBAR_VIEWS.has(item.view) &&
          canReadView(ctx, item.view),
      ),
    [ctx],
  );

  if (!canAccessSchoolBackOffice(user?.role)) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">
          Le pilotage établissement est réservé aux comptes internes d'une école.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {modules.length ? (
        <section className="space-y-6">
          {ENTITY_MODULE_GROUP_ORDER.map((group) => {
            const groupModules = modulesByGroup[group];
            if (!groupModules.length) return null;
            return (
              <div key={group}>
                <SectionHeader
                  title={ENTITY_MODULE_GROUP_LABELS[group]}
                  description="Modules autorisés pour votre établissement."
                />
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groupModules.map((module) => (
                    <Link key={module.key} to={module.path}>
                      <Card className="h-full p-5 transition hover:border-brand/40 hover:shadow-md">
                        <p className="text-base font-bold text-ink">{module.label}</p>
                        <p className="mt-1 text-sm text-muted">{module.description}</p>
                        <span className="mt-3 inline-block text-sm font-semibold text-brand">Ouvrir →</span>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {adminModules.length ? (
        <section>
          <SectionHeader
            title="Administration interne"
            description="Utilisateurs, notifications, configuration et rapports selon vos droits."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {adminModules.map((item) => (
              <Link key={item.view} to={item.path}>
                <Card className="h-full p-5 transition hover:border-brand/40 hover:shadow-md">
                  <p className="text-base font-bold text-ink">{item.label}</p>
                  <span className="mt-3 inline-block text-sm font-semibold text-brand">Ouvrir →</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
