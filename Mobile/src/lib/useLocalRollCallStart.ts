/**
 * PRES-LOCAL-NAV-01 — démarrage de l'appel local depuis l'écran Présences (hook sans dépendance
 * React Native, testé avec de vrais effets React).
 *
 *  - aucune classe ouverte → sélecteur habituel ;
 *  - classe ouverte proposée par la liste serveur du compte → appel direct sur cette classe ;
 *  - sinon (classe non proposée, refus serveur, liste indisponible ou expirée) → sélecteur.
 *
 * Un seul démarrage à la fois ; rien n'est ouvert si le compte, l'établissement ou la classe
 * changent pendant la lecture de la liste, ni après démontage de l'écran.
 */
import { useCallback, useEffect, useRef } from "react";
import type { RollCallClassOption } from "../services/rollCallOfflineApi";
import { loadRollCallClasses, matchDirectRollCallTarget, type DirectRollCallTarget } from "./rollCallDirectStart";

type OpenedClass = { classId?: unknown; className?: unknown } | null | undefined;

export type LocalRollCallStartArgs = {
  /** Portée du compte connecté (environnement | établissement | compte). */
  scopeKey: string;
  selectedClass: OpenedClass;
  fetchClasses: () => Promise<{ classes: RollCallClassOption[] }>;
  onOpenPicker: () => void;
  onOpenTarget: (target: DirectRollCallTarget) => void;
};

function startScopeOf(scopeKey: string, selectedClass: OpenedClass) {
  return `${scopeKey}\0${String(selectedClass?.classId ?? "").trim().toLowerCase()}`;
}

export function useLocalRollCallStart(args: LocalRollCallStartArgs): () => void {
  const argsRef = useRef(args);
  argsRef.current = args;
  const scopeRef = useRef(startScopeOf(args.scopeKey, args.selectedClass));
  scopeRef.current = startScopeOf(args.scopeKey, args.selectedClass);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(() => {
    if (startingRef.current) return;
    const { scopeKey, selectedClass, fetchClasses } = argsRef.current;
    if (!selectedClass) {
      argsRef.current.onOpenPicker();
      return;
    }
    startingRef.current = true;
    const startScope = scopeRef.current;
    void loadRollCallClasses(scopeKey, fetchClasses)
      .then((list) => matchDirectRollCallTarget(selectedClass, list.classes))
      .catch(() => null)
      .then((target) => {
        // Écran fermé, ou compte / établissement / classe changés pendant la lecture : rien n'est ouvert.
        if (!mountedRef.current || scopeRef.current !== startScope) return;
        if (target) argsRef.current.onOpenTarget(target);
        else argsRef.current.onOpenPicker();
      })
      .finally(() => {
        startingRef.current = false;
      });
  }, []);
}
