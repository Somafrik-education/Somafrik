/**
 * Harnais de recette UX Communication — hors graphe de production.
 * Branché uniquement via App.communicationUxSmoke.tsx + Metro
 * SOMAFRIK_COMMUNICATION_UX_SMOKE_ENTRY=1 (pas un flag EXPO_PUBLIC_*).
 * Les écrans Messages / Annonces / Notifications restent les composants de production.
 */
import type { LoginResponse } from "../src/services/api";
import { getInternalRoleDefaults } from "../src/lib/internalRoleDefaults";
import * as SecureStore from "expo-secure-store";

export const COMMUNICATION_UX_SMOKE_SCHOOL = "CD-2026-0001";
export const COMMUNICATION_UX_SMOKE_USER_ID = "user-smoke-admin";

export function createCommunicationUxSmokeSession(): LoginResponse {
  const permissions = getInternalRoleDefaults("Admin School");
  return {
    role: "school_admin",
    roleLabel: "Admin School",
    permissions,
    user: {
      id: COMMUNICATION_UX_SMOKE_USER_ID,
      name: "Admin Recette",
      firstName: "Admin",
      lastName: "Recette",
      role: "school_admin",
      schoolCode: COMMUNICATION_UX_SMOKE_SCHOOL,
      schoolPublicCode: COMMUNICATION_UX_SMOKE_SCHOOL,
      schoolId: "11111111-1111-4111-8111-111111111111",
      permissions,
    },
    school: {
      code: COMMUNICATION_UX_SMOKE_SCHOOL,
      name: "École recette Communication",
      city: "Kinshasa",
      id: "11111111-1111-4111-8111-111111111111",
    },
  };
}

const PLATFORM_ANNOUNCEMENT = {
  id: "ann-platform-smoke-1",
  title: "Rentrée Somafrik",
  content: "Message plateforme : les établissements ouvrent lundi. Détail visible seulement après dépliage.",
  announcementType: "system",
  systemBroadcast: true,
  originLabel: "Annonce Somafrik",
  senderDisplayName: "Somafrik",
  source: "platform",
  domain: "platform",
  type: "platform-announcement",
  publishedAt: "2026-09-10T08:00:00.000Z",
  createdAt: "2026-09-10T08:00:00.000Z",
  audienceLabel: "Tous les utilisateurs Somafrik",
  status: "published",
  attachments: [{ id: "att-platform-1", fileName: "calendrier.pdf" }],
};

const SCHOOL_ANNOUNCEMENT = {
  id: "ann-school-smoke-1",
  title: "Réunion parents",
  message: "Détail établissement : salle 12 à 17h. Archiver et audience seulement après dépliage.",
  createdByName: "Direction",
  audienceLabel: "Parents · 6ème A",
  status: "published",
  publishedAt: "2026-09-10T09:00:00.000Z",
  schoolCode: COMMUNICATION_UX_SMOKE_SCHOOL,
  attachments: [{ id: "att-school-1", fileName: "ordre-du-jour.pdf" }],
};

const NOTIFICATION = {
  type: "notification",
  id: "notif-smoke-1",
  schoolCode: COMMUNICATION_UX_SMOKE_SCHOOL,
  eventType: "finance.payment.received",
  sourceEntityType: "payment",
  sourceEntityId: "pay-smoke-1",
  senderType: "system",
  senderUserId: null,
  senderName: "Comptabilité",
  title: "Paiement reçu",
  body: "Le paiement de septembre a été enregistré. Corps, PJ et actions uniquement après dépliage.",
  createdAt: "2026-09-10T10:00:00.000Z",
  publishedAt: "2026-09-10T10:00:00.000Z",
  status: "Non lu",
  attachments: [{ id: "att-notif-1", fileName: "recu-septembre.pdf" }],
  navigationTarget: { type: "payment", paymentId: "pay-smoke-1" },
};

const CONVERSATION = {
  id: "conv-smoke-1",
  schoolCode: COMMUNICATION_UX_SMOKE_SCHOOL,
  subject: "Absence du 10/09",
  updatedAt: "2026-09-10T11:00:00.000Z",
  unreadCount: 1,
  participants: [
    { userId: "user-parent-smoke", name: "Parent Kalala" },
    { userId: COMMUNICATION_UX_SMOKE_USER_ID, name: "Admin Recette" },
  ],
  lastMessage: {
    id: "msg-smoke-1",
    body: "Bonjour, Marie sera absente demain.",
    sentAt: "2026-09-10T11:00:00.000Z",
    senderUserId: "user-parent-smoke",
    senderName: "Parent Kalala",
  },
};

const THREAD_MESSAGES = [
  {
    id: "msg-smoke-1",
    conversationId: "conv-smoke-1",
    body: "Bonjour, Marie sera absente demain.",
    message: "Bonjour, Marie sera absente demain.",
    senderUserId: "user-parent-smoke",
    senderName: "Parent Kalala",
    sentAt: "2026-09-10T11:00:00.000Z",
    schoolCode: COMMUNICATION_UX_SMOKE_SCHOOL,
  },
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function pathnameOf(input: RequestInfo | URL) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, "http://localhost:5000").pathname;
  } catch {
    return String(raw);
  }
}

let installed = false;

function installCommunicationUxSmokeSecureStore() {
  const memory = new Map<string, string>();
  const patched = {
    getItemAsync: async (key: string) => memory.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      memory.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      memory.delete(key);
    },
  };
  Object.assign(SecureStore, patched);
}

export function installCommunicationUxSmokeFetch() {
  if (installed || typeof fetch !== "function") return;
  installed = true;
  installCommunicationUxSmokeSecureStore();
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathnameOf(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (path.endsWith("/auth/effective-permissions")) {
      return jsonResponse({ permissions: getInternalRoleDefaults("Admin School") });
    }
    if (path.includes("/backoffice/platform-announcements") && method === "GET") {
      if (path.includes("/unread-count")) return jsonResponse({ count: 1 });
      return jsonResponse({ items: [PLATFORM_ANNOUNCEMENT], nextCursor: null });
    }
    if (path.includes("/backoffice/announcements") && method === "GET") {
      if (path.includes("/unread-count")) return jsonResponse({ count: 1 });
      if (path.includes("/audience-options")) return jsonResponse({ classes: [], recipientKinds: [] });
      return jsonResponse({ items: [SCHOOL_ANNOUNCEMENT], nextCursor: null });
    }
    if (path.includes("/backoffice/internal-notifications") && method === "GET") {
      if (path.includes("/unread-count")) return jsonResponse({ count: 1 });
      return jsonResponse({ items: [NOTIFICATION], nextCursor: null });
    }
    if (path.includes("/backoffice/conversations") && path.includes("/messages") && method === "GET") {
      return jsonResponse({ items: THREAD_MESSAGES });
    }
    if (path.includes("/backoffice/conversations") && method === "GET") {
      return jsonResponse({ items: [CONVERSATION], nextCursor: null });
    }
    if (path.includes("/backoffice/messages/unread-count")) {
      return jsonResponse({ count: 1 });
    }
    if (path.includes("/backoffice/messages/recipients")) {
      return jsonResponse({ items: [] });
    }
    if (method === "PATCH" || method === "POST") {
      return jsonResponse({ ok: true, ...NOTIFICATION, readAt: "2026-09-11T00:00:00.000Z", status: "Lu" });
    }
    return jsonResponse({ items: [] });
  }) as typeof fetch;

  void original;
}
