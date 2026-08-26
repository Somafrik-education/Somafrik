/**
 * S2.3 — Stockage sécurisé des tokens (Expo SecureStore / Keychain / Keystore).
 * Interdit AsyncStorage / MMKV pour les JWT.
 */
import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "somafrik.accessToken";
const REFRESH_TOKEN_KEY = "somafrik.refreshToken";
const SESSION_PROFILE_KEY = "somafrik.sessionProfile";
const EFFECTIVE_PERMISSIONS_SNAPSHOT_KEY = "somafrik.effectivePermissionsSnapshotV1";

export type SessionProfile = {
  role: string;
  roleKeys?: string[];
  permissions?: string[];
  user: Record<string, unknown>;
  school?: Record<string, unknown>;
};

async function setItem(key: string, value: string | null) {
  if (value == null || value === "") {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function saveTokens(accessToken: string | null, refreshToken: string | null) {
  await Promise.all([
    setItem(ACCESS_TOKEN_KEY, accessToken),
    setItem(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function saveSessionProfile(profile: SessionProfile | null) {
  if (!profile) {
    await SecureStore.deleteItemAsync(SESSION_PROFILE_KEY);
    return;
  }
  await SecureStore.setItemAsync(SESSION_PROFILE_KEY, JSON.stringify(profile), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const raw = await SecureStore.getItemAsync(SESSION_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionProfile;
  } catch {
    return null;
  }
}

export async function saveEffectivePermissionsSnapshot(raw: string | null) {
  if (!raw) {
    await SecureStore.deleteItemAsync(EFFECTIVE_PERMISSIONS_SNAPSHOT_KEY);
    return;
  }
  await SecureStore.setItemAsync(EFFECTIVE_PERMISSIONS_SNAPSHOT_KEY, raw, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getEffectivePermissionsSnapshotRaw(): Promise<string | null> {
  return SecureStore.getItemAsync(EFFECTIVE_PERMISSIONS_SNAPSHOT_KEY);
}

/** Supprime tokens + profil session + snapshot permissions (logout / 401). */
export async function clearSecureSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SESSION_PROFILE_KEY),
    SecureStore.deleteItemAsync(EFFECTIVE_PERMISSIONS_SNAPSHOT_KEY),
  ]);
}
