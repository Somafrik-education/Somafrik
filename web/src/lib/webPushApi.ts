import { api, request } from "../api/client";

export type WebPushPublicConfig = {
  enabled: boolean;
  vapidPublicKey: string | null;
};

export type WebPushSubscriptionBody = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

export const webPushApi = {
  config: () => api.get<WebPushPublicConfig>("/web/push-config"),
  subscribe: (body: WebPushSubscriptionBody) =>
    api.post<{ id: string; backendEnvironment: string }>("/web/push-subscriptions", body),
  unsubscribe: (endpoint: string) =>
    request<{ revoked: boolean; id: string | null }>("/web/push-subscriptions/current", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),
};
