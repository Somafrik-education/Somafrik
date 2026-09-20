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
      sound?: string | null;
      enableVibrate?: boolean;
      showBadge?: boolean;
    },
  ) => Promise<unknown>;
  AndroidImportance?: { HIGH?: number; DEFAULT?: number };
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
  androidSdk?: number;
  postNotificationsGranted?: boolean | null;
  postNotificationsCanAskAgain?: boolean;
  requestPostNotificationsImpl?: () => Promise<PermissionResponse>;
};

export type PushRegistrationExitPoint =
  | "unsupported_platform"
  | "unsupported_store_client"
  | "unsupported_packager"
  | "unsupported_env"
  | "permission_denied"
  | "registered"
  | "failed";

export type PushRegistrationOutcome = {
  status: "registered" | "permission_denied" | "unsupported" | "failed";
  reason?: string;
  exitPoint?: PushRegistrationExitPoint;
  platform?: string;
  androidSdk?: number;
  executionEnvironment?: string;
  expoGoIndicatesExpoGo?: boolean;
  appProfile?: string;
  channelCreated?: boolean;
  postNotificationsRequested?: boolean;
};

const REMEMBERED_TOKEN_KEY = "somafrik.push.currentExpoToken";
let lastRegisteredToken: string | null = null;
let lastRegistrationOutcome: PushRegistrationOutcome | null = null;

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

function safeReleaseProfile(deps: PushRegisterDeps): string {
  try {
    return (deps.getReleaseProfileImpl ?? defaultReleaseProfile)();
  } catch {
    return "";
  }
}

function logInfo(message: string) {
  try {
    const { safeLogger } = require("./safeLogger") as { safeLogger: { info: (...args: unknown[]) => void } };
    safeLogger.info(message);
  } catch {
    /* tests node : pas de logs natifs */
  }
}

function logWarn(message: string) {
  try {
    const { safeLogger } = require("./safeLogger") as { safeLogger: { warn: (...args: unknown[]) => void } };
    safeLogger.warn(message);
  } catch {
    /* tests node : pas de logs natifs */
  }
}

function rememberOutcome(outcome: PushRegistrationOutcome) {
  lastRegistrationOutcome = outcome;
  logWarn("push register exit", {
    status: outcome.status,
    exitPoint: outcome.exitPoint,
    platform: outcome.platform,
    androidSdk: outcome.androidSdk,
    executionEnvironment: outcome.executionEnvironment,
    expoGoIndicatesExpoGo: outcome.expoGoIndicatesExpoGo,
    appProfile: outcome.appProfile,
    channelCreated: outcome.channelCreated,
    postNotificationsRequested: outcome.postNotificationsRequested,
  });
}

export function getLastPushRegistrationOutcome() {
  return lastRegistrationOutcome;
}

export function observePushRuntimeEvent(
  event: "mounted" | "canonical",
  extra: { from?: boolean; to?: boolean } = {},
) {
  logWarn(`push runtime ${event}`, extra);
}

export function observePushRegistrationFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown");
  const reason = raw.replace(/Expo(nent)?PushToken\[[^\]]+\]/gi, "[REDACTED_PUSH_TOKEN]").slice(0, 180);
  rememberOutcome({ status: "failed", reason, exitPoint: "failed" });
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

/**
 * SDK 54: `Constants.expoGoConfig` is not a boolean Expo-Go flag.
 * On an EAS APK the getter returns the EmbeddedManifest object (never null).
 * Packager `hostUri` / `debuggerHost` remain a fail-closed second guard.
 *
 * Native EAS Android preview/release: `standalone` (CNG/prebuild: `bare`).
 * Expo Go is `storeClient` (Android ConstantsBinding / iOS EXReactAppManager)
 * and is always unsupported, even without a packager host.
 */
function expoGoConfigIndicatesExpoGo(expoGoConfig: unknown): boolean {
  if (expoGoConfig == null || typeof expoGoConfig !== "object") {
    return false;
  }
  const record = expoGoConfig as Record<string, unknown>;
  const hostUri = String(record.hostUri ?? "").trim();
  const debuggerHost = String(record.debuggerHost ?? "").trim();
  return hostUri.length > 0 || debuggerHost.length > 0;
}

export function isNativePushCompatible(
  executionEnvironment?: string | null,
  expoGoConfig?: unknown | null,
) {
  return classifyNativePushCompatibility(executionEnvironment, expoGoConfig).compatible;
}

export function classifyNativePushCompatibility(
  executionEnvironment?: string | null,
  expoGoConfig?: unknown | null,
): { compatible: boolean; env: string; expoGoIndicatesExpoGo: boolean; exitPoint?: PushRegistrationExitPoint } {
  const env = String(executionEnvironment ?? readExecutionEnvironment());
  const resolvedExpoGoConfig = expoGoConfig === undefined ? readExpoGoConfig() : expoGoConfig;
  const expoGoIndicatesExpoGo = expoGoConfigIndicatesExpoGo(resolvedExpoGoConfig);
  if (env === "storeClient") {
    return { compatible: false, env, expoGoIndicatesExpoGo, exitPoint: "unsupported_store_client" };
  }
  if (expoGoIndicatesExpoGo) {
    return { compatible: false, env, expoGoIndicatesExpoGo, exitPoint: "unsupported_packager" };
  }
  if (env === "bare" || env === "standalone") {
    return { compatible: true, env, expoGoIndicatesExpoGo };
  }
  return { compatible: false, env, expoGoIndicatesExpoGo, exitPoint: "unsupported_env" };
}

function readAndroidSdk(): number {
  try {
    const { Platform } = require("react-native") as { Platform: { Version?: string | number } };
    return Number(Platform.Version ?? 0);
  } catch {
    return 0;
  }
}

async function defaultRequestPostNotifications(): Promise<PermissionResponse> {
  const { PermissionsAndroid } = require("react-native") as {
    PermissionsAndroid: {
      PERMISSIONS: { POST_NOTIFICATIONS?: string };
      RESULTS: { GRANTED: string; NEVER_ASK_AGAIN: string };
      request: (permission: string) => Promise<string>;
    };
  };
  const permission =
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ?? "android.permission.POST_NOTIFICATIONS";
  const result = await PermissionsAndroid.request(permission);
  return {
    status: result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied",
    granted: result === PermissionsAndroid.RESULTS.GRANTED,
    canAskAgain: result !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
  };
}

async function ensureAndroid13PostNotifications(
  deps: PushRegisterDeps,
): Promise<PermissionResponse | null> {
  const sdk = deps.androidSdk ?? readAndroidSdk();
  if (sdk < 33) return null;
  if (deps.postNotificationsGranted === true) {
    return { status: "granted", granted: true, canAskAgain: true };
  }
  if (deps.postNotificationsGranted === false && deps.postNotificationsCanAskAgain === false) {
    return { status: "denied", granted: false, canAskAgain: false };
  }
  const request = deps.requestPostNotificationsImpl ?? defaultRequestPostNotifications;
  return request();
}

export function getLastRegisteredPushTokenForTests() {
  return lastRegisteredToken;
}

export function resetPushRegistrationStateForTests() {
  lastRegisteredToken = null;
  lastRegistrationOutcome = null;
}

export async function registerAuthenticatedPushDevice(deps: PushRegisterDeps = {}): Promise<
  "registered" | "permission_denied" | "unsupported"
> {
  try {
    return await registerAuthenticatedPushDeviceUnchecked(deps);
  } catch (error) {
    observePushRegistrationFailure(error);
    throw error;
  }
}

async function registerAuthenticatedPushDeviceUnchecked(deps: PushRegisterDeps): Promise<
  "registered" | "permission_denied" | "unsupported"
> {
  const platform = deps.platform ?? defaultPlatform();
  const androidSdk = deps.androidSdk ?? readAndroidSdk();
  const classification = classifyNativePushCompatibility(deps.executionEnvironment, deps.expoGoConfig);
  const appProfile = safeReleaseProfile(deps);
  const trace = {
    platform,
    androidSdk,
    executionEnvironment: classification.env,
    expoGoIndicatesExpoGo: classification.expoGoIndicatesExpoGo,
    appProfile,
  };

  if (platform !== "android") {
    rememberOutcome({ status: "unsupported", exitPoint: "unsupported_platform", ...trace });
    return "unsupported";
  }
  if (!classification.compatible) {
    rememberOutcome({
      status: "unsupported",
      exitPoint: classification.exitPoint,
      ...trace,
      channelCreated: false,
      postNotificationsRequested: false,
    });
    return "unsupported";
  }

  const notifications = deps.notifications ?? nativeNotifications();
  const importance = notifications.AndroidImportance?.HIGH ?? 4;
  let channelCreated = false;
  if (typeof notifications.setNotificationChannelAsync === "function") {
    await notifications.setNotificationChannelAsync(SOMAFRIK_PUSH_CHANNEL_ID, {
      name: "Somafrik",
      importance,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1d4ed8",
      showBadge: true,
    });
    channelCreated = true;
  }

  let postNotificationsRequested = false;
  const android13Permission = await ensureAndroid13PostNotifications({
    ...deps,
    requestPostNotificationsImpl: async () => {
      postNotificationsRequested = true;
      const request = deps.requestPostNotificationsImpl ?? defaultRequestPostNotifications;
      return request();
    },
  });
  if (android13Permission && android13Permission.status !== "granted") {
    await rememberPushToken(null);
    rememberOutcome({
      status: "permission_denied",
      exitPoint: "permission_denied",
      ...trace,
      channelCreated,
      postNotificationsRequested,
    });
    return "permission_denied";
  }

  let permission = await notifications.getPermissionsAsync();
  if (permission.status !== "granted" && permission.canAskAgain !== false) {
    permission = await notifications.requestPermissionsAsync();
  }
  if (permission.status !== "granted") {
    await rememberPushToken(null);
    rememberOutcome({
      status: "permission_denied",
      exitPoint: "permission_denied",
      ...trace,
      channelCreated,
      postNotificationsRequested,
    });
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
      appProfile: safeReleaseProfile(deps),
    }),
  });
  await rememberPushToken(expoPushToken);
  rememberOutcome({
    status: "registered",
    exitPoint: "registered",
    ...trace,
    channelCreated,
    postNotificationsRequested,
  });
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
