/* Somafrik Web Push — Chrome / Edge. Aucun secret VAPID ici. */
/* eslint-disable no-restricted-globals */

const FALLBACK_PATH = "/notifications";
const ALLOWED_PATHS = new Set([
  "/notifications",
  "/messages",
  "/annonces",
  "/finances/paiements",
  "/presences",
  "/notes",
  "/bulletins",
  "/finances/impayes",
  "/planning/emploi-du-temps/calendrier",
  "/planning/remplacements",
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readParam(target, key) {
  const value = target[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const DESTINATIONS = {
  conversation: { path: "/messages", requiredKey: "conversationId" },
  announcement: { path: "/annonces", requiredKey: "announcementId" },
  payment: { path: "/finances/paiements", requiredKey: "paymentId", contextKeys: ["studentId"] },
  attendance: { path: "/presences", requiredKey: "attendanceId", contextKeys: ["studentId"] },
  grade: { path: "/notes", requiredKey: "gradeId", contextKeys: ["studentId"] },
  report_card: {
    path: "/bulletins",
    requiredKey: "reportCardId",
    contextKeys: ["studentId", "termId", "academicYearId"],
  },
  finance_obligation: {
    path: "/finances/impayes",
    requiredKey: "obligationId",
    contextKeys: ["studentId"],
  },
  timetable: {
    path: "/planning/emploi-du-temps/calendrier",
    requiredKey: "weeklySlotId",
    contextKeys: ["classId"],
  },
  teacher_replacement: {
    path: "/planning/remplacements",
    requiredKey: "replacementId",
    contextKeys: ["weeklySlotId", "occurrenceDate", "classId"],
  },
};

function isAllowlistedAppPath(path) {
  const raw = String(path || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || /[a-z]+:/i.test(raw)) return false;
  return ALLOWED_PATHS.has(raw.split("?")[0]);
}

function resolveWebPushClickPath(data) {
  const payload = asRecord(data);
  const target = asRecord(payload.navigationTarget);
  const spec = DESTINATIONS[String(target.type || "")];
  if (!spec) return FALLBACK_PATH;
  const requiredValue = readParam(target, spec.requiredKey);
  if (!requiredValue) return FALLBACK_PATH;
  const params = new URLSearchParams();
  params.set(spec.requiredKey, requiredValue);
  for (const key of spec.contextKeys || []) {
    const value = readParam(target, key);
    if (value) params.set(key, value);
  }
  const destination = `${spec.path}?${params.toString()}`;
  return isAllowlistedAppPath(destination) ? destination : FALLBACK_PATH;
}

function clickHref(data) {
  const path = resolveWebPushClickPath(data);
  const scope = String(self.registration?.scope || self.location.origin);
  const base = new URL(scope);
  const prefix = base.pathname.replace(/\/$/, "");
  return `${base.origin}${prefix}${path}`;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = String(payload.title || "Somafrik");
  const body = String(payload.body || "");
  const data = asRecord(payload.data);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: "/favicon.svg",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = clickHref(event.notification.data);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (typeof client.navigate === "function") {
          return client.focus().then(() => client.navigate(href));
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(href);
      return undefined;
    }),
  );
});
