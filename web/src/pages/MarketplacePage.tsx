import { Link } from "react-router-dom";
import { Store } from "lucide-react";
import { ComingSoonState } from "../design-system";

/**
 * Module de place de marché (préproduction) — écran d'attente sans effet de bord sur les données.
 */
export function MarketplacePage() {
  return (
    <div className="space-y-4">
      <ComingSoonState
        icon={<Store className="h-7 w-7" />}
        title="Place de marché Somafrik"
        description="Catalogue de modules, extensions et services complémentaires pour les établissements. Ce module est en préparation : aucune transaction ni synchronisation n'est active."
        badge="Préproduction — accès pilote"
      />
      <p className="text-center text-xs text-muted">
        <Link to="/tableau-de-bord" className="font-semibold text-brand hover:underline">
          Retour au tableau de bord
        </Link>
      </p>
    </div>
  );
}
