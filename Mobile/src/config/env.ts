import Constants from "expo-constants";
import { Platform } from "react-native";

function normalizeBaseUrl(value?: string) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function isLocalhostUrl(url: string) {
  return /:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
}

function isEmulatorLoopback(url: string) {
  return /:\/\/(10\.0\.2\.2)(:|\/|$)/i.test(url);
}

function isPrivateLanHttp(url: string) {
  return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:|\/|$)/i.test(
    url,
  );
}

/** Runtime de développement (Expo Go / debug). */
export function isDevelopmentRuntime() {
  if (typeof __DEV__ !== "undefined" && __DEV__) return true;
  if (process.env.NODE_ENV === "development") return true;
  // Builds EAS production / preview ne sont pas du dev.
  const channel = String(
    (Constants.expoConfig as { extra?: { eas?: { build?: { profile?: string } } } } | null)?.extra?.eas
      ?.build?.profile ?? "",
  );
  if (channel === "production" || channel === "preview") return false;
  return Constants.appOwnership === "expo";
}

/** IP de la machine de dev (PC) telle qu'Expo Go la voit via Metro. */
function getDevMachineHost(): string | null {
  const candidates = [
    Constants.expoGoConfig?.debuggerHost,
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri,
    (Constants.manifest2 as { extra?: { expoClient?: { hostUri?: string } } } | null)?.extra?.expoClient
      ?.hostUri,
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const raw = String(value).replace(/^exp:\/\//, "").replace(/^https?:\/\//, "");
    const host = raw.split(":")[0]?.trim();
    if (host && !isLocalhostUrl(`http://${host}`)) {
      return host;
    }
  }

  return null;
}

function rewriteLocalhostForDevice(url: string): string {
  if (!Constants.isDevice || !isLocalhostUrl(url)) {
    return url;
  }

  const devHost = getDevMachineHost();
  if (!devHost) {
    return url;
  }

  const portMatch = url.match(/:(\d+)/);
  const port = portMatch?.[1] ?? "5000";
  return `http://${devHost}:${port}`;
}

/**
 * S2.3 — Valide l'URL API.
 * Production : HTTPS uniquement.
 * Développement : http localhost / émulateur / LAN privés autorisés.
 */
export function validateApiRootUrl(rootUrl: string) {
  const url = normalizeBaseUrl(rootUrl);
  if (!url) {
    throw new Error("EXPO_PUBLIC_API_URL est obligatoire.");
  }
  if (url.startsWith("https://")) {
    return url;
  }
  if (!url.startsWith("http://")) {
    throw new Error("URL API invalide.");
  }
  if (!isDevelopmentRuntime()) {
    throw new Error("En production, l'API doit utiliser HTTPS.");
  }
  if (isLocalhostUrl(url) || isEmulatorLoopback(url) || isPrivateLanHttp(url)) {
    return url;
  }
  throw new Error("HTTP non sécurisé refusé hors localhost / émulateur / réseau local de développement.");
}

/** URL racine du backend (sans /api) — uniquement via variables d'environnement / extra Expo. */
export function resolveApiRootUrl(): string {
  const fromExtra = normalizeBaseUrl(Constants.expoConfig?.extra?.apiUrl as string | undefined);
  const fromEnv = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL);
  let configured = fromExtra || fromEnv;

  if (!configured) {
    if (!isDevelopmentRuntime()) {
      throw new Error("EXPO_PUBLIC_API_URL manquante en production.");
    }
    // Fallbacks de développement uniquement (jamais en production).
    if (Platform.OS === "android" && !Constants.isDevice) {
      configured = "http://10.0.2.2:5000";
    } else {
      const devHost = getDevMachineHost();
      configured = devHost ? `http://${devHost}:5000` : "http://localhost:5000";
    }
  }

  if (configured) {
    if (!Constants.expoGoConfig && !isLocalhostUrl(configured)) {
      return validateApiRootUrl(configured);
    }
    return validateApiRootUrl(rewriteLocalhostForDevice(configured));
  }

  return validateApiRootUrl("http://localhost:5000");
}

export function resolveApiBaseUrl(): string {
  return `${resolveApiRootUrl()}/api`;
}

export function isDemoMode(): boolean {
  if (Constants.expoConfig?.extra?.demoMode === true) {
    return true;
  }
  return process.env.EXPO_PUBLIC_DEMO_MODE === "true";
}

/** Boutons démo : jamais en preview/production. Expo Go / __DEV__ seulement, ou EXPO_PUBLIC_DEMO_MODE. */
export function shouldShowDemoLogin(): boolean {
  if (!isDevelopmentRuntime()) return false;
  if (isDemoMode()) return true;
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function isUsingLocalhostOnDevice(): boolean {
  try {
    const root =
      normalizeBaseUrl(Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
      normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL);
    return Boolean(Constants.isDevice && root && isLocalhostUrl(root) && !getDevMachineHost());
  } catch {
    return false;
  }
}

/** Intervalle de synchronisation automatique avec le backend (5 minutes). */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
