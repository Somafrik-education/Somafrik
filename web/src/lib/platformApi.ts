import { api, type RequestArgs } from "../api/client";

export const platformApi = {
  listCountries: (...init: RequestArgs) => api.get<unknown[]>("/backoffice/countries", ...init),
  createCountry: (payload: Record<string, unknown>) => api.post("/backoffice/countries", payload),
  updateCountry: (code: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/countries/${encodeURIComponent(code)}`, payload),

  listSubscriptions: (...init: RequestArgs) => api.get<unknown[]>("/backoffice/subscriptions", ...init),
  upsertSubscription: (payload: Record<string, unknown>) => api.post("/backoffice/subscriptions", payload),
  patchSubscription: (subscriptionId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/subscriptions/${encodeURIComponent(subscriptionId)}`, payload),

  listNotifications: (...init: RequestArgs) => api.get<unknown[]>("/backoffice/notifications", ...init),
  createNotification: (payload: Record<string, unknown>) => api.post("/backoffice/notifications", payload),
  updateNotification: (notificationId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/notifications/${encodeURIComponent(notificationId)}`, payload),

  getRolePermissions: (...init: RequestArgs) =>
    api.get<Record<string, string[]>>("/backoffice/role-permissions", ...init),

  getDashboardChartConfig: (...init: RequestArgs) =>
    api.get<Record<string, unknown>>("/backoffice/dashboard-chart-config", ...init),
  saveDashboardChartConfig: (payload: Record<string, unknown>) => api.put("/backoffice/dashboard-chart-config", payload),

  upsertSubscriptionOffer: (payload: Record<string, unknown>) => api.post("/backoffice/subscription-offers", payload),
  patchSubscriptionOffer: (offerId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/subscription-offers/${encodeURIComponent(offerId)}`, payload),

  createSubscriptionPayment: (payload: Record<string, unknown>) => api.post("/backoffice/subscription-payments", payload),
  patchSubscriptionPayment: (paymentId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/subscription-payments/${encodeURIComponent(paymentId)}`, payload),

  createSubscriptionDiscount: (payload: Record<string, unknown>) => api.post("/backoffice/subscription-discounts", payload),
  patchSubscriptionDiscount: (discountId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/subscription-discounts/${encodeURIComponent(discountId)}`, payload),

  listTrialRequests: () => api.get<unknown[]>("/backoffice/trial-requests"),
};
