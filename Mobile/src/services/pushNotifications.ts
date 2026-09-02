import {
  SOMAFRIK_PUSH_CHANNEL_ID,
  resolvePushDestination,
  type AllowedPushDestination,
} from "../lib/pushNotificationDestinations";

export const TEST_PUSH_CONFIRM = "TEST_SOMAFRIK_PUSH";

type PermissionResponse = {
  status: string;
  granted?: boolean;
  canAskAgain?: boolean;
};

type NotificationsLike = {
  setNotificationChannelAsync?: (
    id: string,
    channel: {
      name: string;
      importance: number;
      vibrationPattern?: number[];
      lightColor?: string;
    },
  ) => Promise<unknown>;
  AndroidImportance?: { DEFAULT: number };
  getPermissionsAsync: () => Promise<PermissionResponse>;
  requestPermissionsAsync: () => Promise<PermissionResponse>;
  getExpoPushTokenAsync: (options: { projectId: string }) => Promise<{ data?: string }>;
};

export type PushRegisterDeps = {
  platform?: string;
  executionEnvironment?: string | null;
  expoGoConfig?: unknown | null;
  notifications?: NotificationsLike;
  httpRequestImpl?: (path: string, init?: RequestInit) => Promise<unknown>;
  getProjectId?: () => string | null;
  getReleaseProfileImpl?: () => string;
};

const REMEMBERED_TOKEN_KEY = "somafrik.push.currentExpoToken";
let lastRegisteredToken: string | null = null;

async function rememberPushToken(token: string | null) {
  lastRegisteredToken = token;
  try {
    const SecureStore = require("expo-secure-store") as {
      setItemAsync: (key: string, value: string) => Promise<void>;
      deleteItemAsync: (key: string) => Promise<void>;
    };
    if (token) await SecureStore.setItemAsync(REMEMBERED_TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(REMEMBERED_TOKEN_KEY);
  } catch {
    /* tests Node / SecureStore indisponible : mémoire process seulement */
  }
}

async function readRememberedPushToken() {
  if (lastRegisteredToken) return lastRegisteredToken;
  try {
    const SecureStore = require("expo-secure-store") as {
      getItemAsync: (key: string) => Promise<string | null>;
    };
    lastRegisteredToken = (await SecureStore.getItemAsync(REMEMBERED_TOKEN_KEY)) || null;
  } catch {
    /* tests Node */
  }
  return lastRegisteredToken;
}

function defaultPlatform() {
  try {
    return require("react-native").Platform.OS as string;
  } catch {
    return "unknown";
  }
}

function defaultHttpRequest(path: string, init?: RequestInit) {
  const { httpRequest } = require("./httpClient") as { httpRequest: (path: string, init?: RequestInit) => Promise<unknown> };
  return httpRequest(path, init);
}

function defaultReleaseProfile() {
  const { getReleaseProfile } = require("../config/env") as { getReleaseProfile: () => string };
  return getReleaseProfile();
}

function logInfo(message: string) {
  try {
    const { safeLogger } = require("./safeLogger") as { safeLogger: { info: (...args: unknown[]) => void } };
    safeLogger.info(message);
  } catch {
    /* tests node : pas de logs natifs */
  }
}

function nativeNotifications(): NotificationsLike {
  return require("expo-notifications") as NotificationsLike;
}

function readProjectId(): string | null {
  try {
    const Constants = require("expo-constants") as {
      expoConfig?: { extra?: { eas?: { projectId?: string } } };
      easConfig?: { projectId?: string };
      executionEnvironment?: string;
    };
    const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
    const fromExtra = String(extra.eas?.projectId ?? "").trim();
    if (fromExtra) return fromExtra;
    const fromEas = String(Constants.easConfig?.projectId ?? "").trim();
    return fromEas || null;
  } catch {
    return null;
  }
}

function readExecutionEnvironment(): string {
  try {
    const Constants = require("expo-constants") as { executionEnvironment?: string };
    return String(Constants.executionEnvironment ?? "");
  } catch {
    return "";
  }
}

function readExpoGoConfig(): unknown | null {
  try {
    const Constants = require("expo-constants") as { expoGoConfig?: unknown };
    return Constants.expoGoConfig ?? null;
  } catch {
    return null;
  }
}

function isNativePushCompatible(executionEnvironment?: string | null, expoGoConfig?: unknown | null) {
  const env = String(executionEnvironment ?? readExecutionEnvironment());
  const resolvedExpoGoConfig = expoGoConfig === undefined ? readExpoGoConfig() : expoGoConfig;
  if (resolvedExpoGoConfig != null) return false;
  return env === "bare" || env === "standalone" || env === "storeClient";
}

export function getLastRegisteredPushTokenForTests() {
  return lastRegisteredToken;
}

export function resetPushRegistrationStateForTests() {
  lastRegisteredToken = null;
}

export async function registerAuthenticatedPushDevice(deps: PushRegisterDeps = {}): Promise<
  "registered" | "permission_denied" | "unsupported"
> {
  const platform = deps.platform ?? defaultPlatform();
  if (platform !== "android") return "unsupported";
  if (!isNativePushCompatible(deps.executionEnvironment, deps.expoGoConfig)) return "unsupported";

  const notifications = deps.notifications ?? nativeNotifications();
  const importance = notifications.AndroidImportance?.DEFAULT ?? 3;
  if (typeof notifications.setNotificationChannelAsync === "function") {
    await notifications.setNotificationChannelAsync(SOMAFRIK_PUSH_CHANNEL_ID, {
      name: "Somafrik",
      importance,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1d4ed8",
    });
  }

  let permission = await notifications.getPermissionsAsync();
  if (permission.status !== "granted" && permission.canAskAgain !== false) {
    permission = await notifications.requestPermissionsAsync();
  }
  if (permission.status !== "granted") {
    await rememberPushToken(null);
    return "permission_denied";
  }

  const projectId = (deps.getProjectId ?? readProjectId)();
  if (!projectId) {
    throw new Error("ProjectId EAS absent : enregistrement push fail-closed.");
  }

  const tokenResponse = await notifications.getExpoPushTokenAsync({ projectId });
  const expoPushToken = String(tokenResponse?.data ?? "").trim();
  if (!expoPushToken) {
    throw new Error("Jeton Expo Push indisponible.");
  }

  const post = deps.httpRequestImpl ?? defaultHttpRequest;
  await post("/mobile/push-devices", {
    method: "POST",
    body: JSON.stringify({
      expoPushToken,
      platform: "android",
      appProfile: (deps.getReleaseProfileImpl ?? defaultReleaseProfile)(),
    }),
  });
  await rememberPushToken(expoPushToken);
  logInfo("push device registered");
  return "registered";
}

export async function revokeCurrentPushDevice(deps: { httpRequestImpl?: PushRegisterDeps["httpRequestImpl"] } = {}) {
  const token = await readRememberedPushToken();
  if (!token) return { revoked: false };
  try {
    const post = deps.httpRequestImpl ?? defaultHttpRequest;
    await post("/mobile/push-devices/current", {
      method: "DELETE",
      body: JSON.stringify({ expoPushToken: token }),
    });
    return { revoked: true };
  } catch {
    return { revoked: false };
  } finally {
    await rememberPushToken(null);
  }
}

export async function sendControlledPushTest(deps: PushRegisterDeps = {}) {
  const post = deps.httpRequestImpl ?? defaultHttpRequest;
  return post("/mobile/push-devices/test", {
    method: "POST",
    body: JSON.stringify({
      confirm: TEST_PUSH_CONFIRM,
    }),
  });
}

export function destinationFromNotificationData(data: unknown): AllowedPushDestination {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return resolvePushDestination(record.somafrikDestination);
}
