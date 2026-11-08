import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../../context/AuthContext";
import { subscribeConnectivity } from "../../../lib/connectivity";
import { rollCallRuntime } from "./rollCallRuntime";

/** Tentative différée (backoff) vérifiée au premier plan ; une simple lecture SQLite si rien n'est dû. */
export const RC_SYNC_TIMER_MS = 60_000;

/**
 * NFC-PRES-LOCAL-PR3/PR4 — cycle de vie du stockage d'appel hors ligne. Aucun écran.
 *  - démarrage et reprise : purges à échéance (sans ouvrir de base), puis synchronisation des
 *    appels du compte si sa base est ouverte ;
 *  - changement de session : fermeture de la base d'un autre compte (le runner est arrêté) ;
 *    retour du même compte : reprise des envois ;
 *  - connexion retrouvée : envoi ; au premier plan, minuterie pour les tentatives différées.
 * Aucune tâche d'arrière-plan : une application suspendue ou tuée reprend à la prochaine occasion.
 */
export default function RollCallOfflineRuntime() {
  const { session } = useAuth();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const runtime = rollCallRuntime();
    void runtime.startup();
    let foreground = AppState.currentState === "active";
    const subscription = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (state === "active") {
        void runtime.startup().then(() => runtime.requestSync(sessionRef.current, "resume"));
      }
    });
    let previous: string | null = null;
    const unsubscribe = subscribeConnectivity((state) => {
      if (state === "online" && previous !== "online") void runtime.requestSync(sessionRef.current, "online");
      previous = state;
    });
    const timer = setInterval(() => {
      if (foreground) void runtime.requestSync(sessionRef.current, "timer");
    }, RC_SYNC_TIMER_MS);
    return () => {
      subscription.remove();
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void rollCallRuntime().onSessionChanged(session);
  }, [session, session?.user?.id, session?.school?.id]);

  return null;
}
