/**
 * Permission navigateur + abonnement PushManager.
 * Permission denied → aucun subscribe, aucun POST serveur.
 */

import { webPushApi, type WebPushPublicConfig } from "./webPushApi";

export type WebPushSyncStatus = "subscribed" | "denied" | "unsupported" | "disabled" | "default";

export type WebPushPermissionBridge = {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
};

export type WebPushServiceWorkerBridge = {
  register: (scriptURL: string, options?: { scope?: string }) => Promise<unknown>;
  ready: Promise<unknown>;
};

export type WebPushSyncDeps = {
  notification?: WebPushPermissionBridge | null;
  serviceWorker?: WebPushServiceWorkerBridge | null;
  subscribe?: (
    registration: unknown,
    applicationServerKey: Uint8Array,
  ) => Promise<PushSubscription>;
  fetchConfig?: () => Promise<WebPushPublicConfig>;
  saveSubscription?: (subscription: PushSubscriptionJSON) => Promise<unknown>;
  swUrl?: string;
  swScope?: string;
};

export type WebPushRevokeDeps = {
  getSubscription?: () => Promise<{ endpoint?: string; unsubscribe?: () => Promise<boolean> } | null>;
  revokeSubscription?: (endpoint: string) => Promise<unknown>;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function defaultNotification(): WebPushPermissionBridge | null {
  if (typeof window === "undefined" || typeof Notification === "undefined") return null;
  return {
    permission: Notification.permission,
    requestPermission: () => Notification.requestPermission(),
  };
}

function defaultServiceWorker(): WebPushServiceWorkerBridge | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker;
}

async function defaultSubscribe(
  registration: unknown,
  applicationServerKey: Uint8Array,
): Promise<PushSubscription> {
  const pushManager = (registration as ServiceWorkerRegistration | undefined)?.pushManager;
  if (!pushManager) {
    throw new Error("PushManager indisponible");
  }
  return pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as BufferSource,
  });
}

export async function syncWebPushSubscription(deps: WebPushSyncDeps = {}): Promise<WebPushSyncStatus> {
  const notification = deps.notification === undefined ? defaultNotification() : deps.notification;
  const serviceWorker =
    deps.serviceWorker === undefined ? defaultServiceWorker() : deps.serviceWorker;
  if (!notification || !serviceWorker) return "unsupported";

  let permission: NotificationPermission = notification.permission;
  if (permission === "denied") return "denied";
  if (permission === "default") {
    permission = await notification.requestPermission();
  }
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "default";

  const fetchConfig = deps.fetchConfig ?? webPushApi.config;
  const config = await fetchConfig();
  if (!config.enabled || !config.vapidPublicKey) return "disabled";

  const viteBase = import.meta.env.BASE_URL || "/";
  const scope = deps.swScope ?? (viteBase.endsWith("/") ? viteBase : `${viteBase}/`);
  const swUrl = deps.swUrl ?? `${scope}sw.js`;
  const registration = await serviceWorker.register(swUrl, { scope });
  await serviceWorker.ready;
  const subscribe = deps.subscribe ?? defaultSubscribe;
  const subscription = await subscribe(registration, urlBase64ToUint8Array(config.vapidPublicKey));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "unsupported";
  const save = deps.saveSubscription ?? ((body) =>
    webPushApi.subscribe({
      endpoint: body.endpoint as string,
      keys: { p256dh: body.keys!.p256dh, auth: body.keys!.auth },
      userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
    }));
  await save(json);
  return "subscribed";
}

async function defaultGetSubscription(): Promise<{ endpoint?: string; unsubscribe?: () => Promise<boolean> } | null> {
  const serviceWorker = defaultServiceWorker();
  if (!serviceWorker) return null;
  const registration = (await serviceWorker.ready) as ServiceWorkerRegistration | undefined;
  const current = await registration?.pushManager?.getSubscription();
  if (!current) return null;
  return {
    endpoint: current.endpoint,
    unsubscribe: () => current.unsubscribe(),
  };
}

/**
 * Révoque l'abonnement courant tant que le jeton de session est encore valide.
 * Aucun endpoint / clé n'est journalisé.
 */
export async function revokeWebPushOnSessionEnd(deps: WebPushRevokeDeps = {}): Promise<"revoked" | "none"> {
  const getSubscription = deps.getSubscription ?? defaultGetSubscription;
  const current = await getSubscription();
  const endpoint = String(current?.endpoint ?? "").trim();
  if (!current || !endpoint) return "none";
  const revoke = deps.revokeSubscription ?? ((value: string) => webPushApi.unsubscribe(value));
  await revoke(endpoint);
  if (typeof current.unsubscribe === "function") {
    await current.unsubscribe();
  }
  return "revoked";
}
