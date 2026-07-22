import type { ReactNode } from "react";
import { ForbiddenState } from "../../feedback/ForbiddenState";

/**
 * EntityListForbidden — état accès refusé pour une liste d’entité (D2.7).
 * Le calcul `canRead` reste chez l’appelant (permissions inchangées).
 */
export interface EntityListForbiddenProps {
  /** Libellé module (ex. « Classes ») — injecté dans le message. */
  moduleLabel: string;
  action?: ReactNode;
  className?: string;
}

export function EntityListForbidden({
  moduleLabel,
  action,
  className,
}: EntityListForbiddenProps) {
  return (
    <ForbiddenState
      className={className}
      title="Accès non autorisé"
      message={`Vous n'avez pas l'autorisation de consulter ${moduleLabel.toLowerCase()}.`}
      action={action}
    />
  );
}
