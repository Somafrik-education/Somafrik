import { useEffect } from "react";
import { Platform } from "react-native";
import { openNativeL1Database } from "./database";

/**
 * Ouvre SQLCipher au boot natif (login compris) pour le smoke
 * PRAGMA cipher_version + write → kill → relaunch → read.
 * Aucun GET métier. Aucune clé dans les logs.
 */
export default function NativeSqlCipherBootProbe() {
  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    void openNativeL1Database();
  }, []);
  return null;
}
