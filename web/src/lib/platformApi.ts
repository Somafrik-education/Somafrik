import { api } from "../api/client";

export const platformApi = {
  listCountries: () => api.get<unknown[]>("/backoffice/countries"),
  createCountry: (payload: Record<string, unknown>) => api.post("/backoffice/countries", payload),
  updateCountry: (code: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/countries/${encodeURIComponent(code)}`, payload),

  listSubscriptions: () => api.get<unknown[]>("/backoffice/subscriptions"),
  upsertSubscription: (payload: Record<string, unknown>) => api.post("/backoffice/subscriptions", payload),
  patchSubscription: (subscriptionId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/subscriptions/${encodeURIComponent(subscriptionId)}`, payload),

  listNotifications: () => api.get<unknown[]>("/backoffice/notifications"),
  createNotification: (payload: Record<string, unknown>) => api.post("/backoffice/notifications", payload),
  updateNotification: (notificationId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/notifications/${encodeURIComponent(notificationId)}`, payload),

  getRolePermissions: () => api.get<Record<string, string[]>>("/backoffice/role-permissions"),
  replaceRolePermissions: (payload: Record<string, string[]>) => api.put("/backoffice/role-permissions", payload),

  getDashboardChartConfig: () => api.get<Record<string, unknown>>("/backoffice/dashboard-chart-config"),
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
};
