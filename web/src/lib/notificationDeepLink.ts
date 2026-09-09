/**
 * Lecture des identifiants de deep-link portés par l'URL.
 *
 * `notificationNavigation.ts` construit la destination d'une notification en
 * joignant l'identifiant métier à la route ; les pages de destination lisent ce
 * même identifiant ici. Le deep-link ne fait que désigner une ressource : il ne
 * contourne aucun contrôle d'accès, chaque page conserve ses gardes RBAC.
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/** Identifiant demandé par l'URL, chaîne vide si absent. */
export function useDeepLinkId(key: string): string {
  const [params] = useSearchParams();
  return (params.get(key) ?? "").trim();
}

/** Plusieurs identifiants lus en une fois, dans un objet stable. */
export function useDeepLinkIds<K extends string>(keys: readonly K[]): Record<K, string> {
  const [params] = useSearchParams();
  const serialized = keys.map((key) => `${key}=${params.get(key) ?? ""}`).join("&");
  return useMemo(() => {
    const values = {} as Record<K, string>;
    for (const key of keys) values[key] = (params.get(key) ?? "").trim();
    return values;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);
}
