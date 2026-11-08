import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../../context/AuthContext";
import { rollCallRuntime } from "./rollCallRuntime";

/**
 * NFC-PRES-LOCAL-PR3 — cycle de vie du stockage d'appel hors ligne. Aucun écran, aucune base
 * ouverte ici : purges à échéance au démarrage et à la reprise, fermeture de la base d'un compte
 * dès que la session change de compte ou d'établissement.
 */
export default function RollCallOfflineRuntime() {
  const { session } = useAuth();

  useEffect(() => {
    void rollCallRuntime().startup();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void rollCallRuntime().startup();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void rollCallRuntime().onSessionChanged(session);
  }, [session, session?.user?.id, session?.school?.id]);

  return null;
}
