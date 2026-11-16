/**
 * NFC-PRES-LOCAL-PR2 — dépendances natives de la base d'appel hors ligne (Android / iOS).
 *
 *  - expo-sqlite construit avec `useSQLCipher: true` (app.config.js), connexion dédiée par base ;
 *  - expo-secure-store (Android Keystore), accès « appareil déverrouillé, cet appareil seulement » ;
 *  - expo-crypto : aléa système (clé de 256 bits, sel d'appareil) et UUID v4 ;
 *  - expo-file-system (legacy) : dossier des bases SQLite de l'application uniquement.
 *
 * Web et Node : aucun adaptateur, donc aucune base (SQLCipher natif obligatoire).
 */
import { base64StdDecode } from "../crypto/bytes";
import type { RcPlatformDeps } from "./database";

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,160}$/;

function safeName(fileName: string): string {
  if (!SAFE_NAME.test(fileName) || fileName.includes("..")) throw new Error("Nom de fichier refusé.");
  return fileName;
}

export function createNativeRollCallPlatform(): RcPlatformDeps | null {
  let platform = "unknown";
  try {
    const ReactNative = require("react-native") as { Platform?: { OS?: string } };
    platform = String(ReactNative.Platform?.OS ?? "unknown");
  } catch {
    return null;
  }
  if (platform !== "android" && platform !== "ios") return null;

  const SQLite = require("expo-sqlite") as typeof import("expo-sqlite");
  const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
  const Crypto = require("expo-crypto") as typeof import("expo-crypto");
  const FileSystem = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");

  const directory = String((SQLite as { defaultDatabaseDirectory?: string }).defaultDatabaseDirectory ?? "").replace(/\/+$/, "");
  if (!directory) return null;
  const dirUri = directory.startsWith("file://") ? `${directory}/` : `file://${directory}/`;
  const uri = (fileName: string) => `${dirUri}${safeName(fileName)}`;
  const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

  return {
    platform,
    openDatabase: (name, options) => SQLite.openDatabaseAsync(safeName(name), options) as never,
    keyStore: {
      getItem: (key) => SecureStore.getItemAsync(key, secureOptions),
      setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
      deleteItem: (key) => SecureStore.deleteItemAsync(key, secureOptions),
    },
    fs: {
      async exists(fileName) {
        return (await FileSystem.getInfoAsync(uri(fileName))).exists;
      },
      async deleteFile(fileName) {
        await FileSystem.deleteAsync(uri(fileName), { idempotent: true });
      },
      async moveFile(fromName, toName) {
        await FileSystem.moveAsync({ from: uri(fromName), to: uri(toName) });
      },
      async readHeader(fileName, length) {
        const info = await FileSystem.getInfoAsync(uri(fileName));
        if (!info.exists) return null;
        const text = await FileSystem.readAsStringAsync(uri(fileName), {
          encoding: FileSystem.EncodingType.Base64,
          position: 0,
          length,
        });
        return base64StdDecode(text);
      },
      async listFiles() {
        const info = await FileSystem.getInfoAsync(dirUri);
        return info.exists ? FileSystem.readDirectoryAsync(dirUri) : [];
      },
      async readText(fileName) {
        const info = await FileSystem.getInfoAsync(uri(fileName));
        return info.exists ? FileSystem.readAsStringAsync(uri(fileName)) : null;
      },
      async writeText(fileName, text) {
        const info = await FileSystem.getInfoAsync(dirUri);
        if (!info.exists) await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
        const tmp = `${fileName}.tmp`;
        await FileSystem.writeAsStringAsync(uri(tmp), text);
        await FileSystem.deleteAsync(uri(fileName), { idempotent: true });
        await FileSystem.moveAsync({ from: uri(tmp), to: uri(fileName) });
      },
    },
    randomBytes: (size) => Crypto.getRandomBytesAsync(size),
    randomUUID: () => Crypto.randomUUID(),
    nowMs: () => Date.now(),
  };
}
