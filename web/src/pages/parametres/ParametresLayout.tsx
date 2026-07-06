import { Link, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/** Module Paramètres : en-tête + retour au hub, contenu via <Outlet />. */
export function ParametresLayout() {
  const location = useLocation();
  const isHub = location.pathname === "/parametres" || location.pathname === "/parametres/";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-brand">Configuration</p>
          <h1 className="mt-1 text-2xl font-black text-ink">Paramètres</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Configuration stable de la plateforme, séparée des opérations quotidiennes (élèves, notes,
            paiements, planning).
          </p>
        </div>
        {!isHub ? (
          <Link
            to="/parametres"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
          >
            <ArrowLeft className="h-4 w-4" />
            Tous les paramètres
          </Link>
        ) : null}
      </div>
      <Outlet />
    </div>
  );
}
