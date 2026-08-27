/**
 * Inventaire des mutations Mobile (POST/PUT/PATCH/DELETE) — LOT 5.
 * A = idempotente naturellement
 * B = non idempotente, backend accepte Idempotency-Key
 * C = non idempotente sans protection historique
 * D = jamais en outbox
 */
export type MutationClass = "A" | "B" | "C" | "D";

export const MOBILE_MUTATION_INVENTORY = [
  { name: "savePresences", method: "POST", path: "/presences", class: "B", outbox: true, domain: "presences" },
  { name: "saveNote", method: "POST", path: "/notes", class: "B", outbox: true, domain: "notes" },
  { name: "createEvaluation", method: "POST", path: "/evaluations", class: "B", outbox: false, domain: "evaluations" },
  { name: "updateEvaluation", method: "PATCH", path: "/evaluations/:id", class: "A", outbox: false, domain: "evaluations" },
  { name: "createSchoolPayment", method: "POST", path: "/payments", class: "B", outbox: false, domain: "payments" },
  { name: "cancelSchoolPayment", method: "POST", path: "/payments/:id/cancel", class: "B", outbox: false, domain: "payments" },
  {
    name: "reconcilePaymentAllocations",
    method: "POST",
    path: "/finance/reconcile-payment-allocations",
    class: "A",
    outbox: false,
    domain: "payments",
  },
  { name: "sendClientsMessage", method: "POST", path: "/backoffice/messages", class: "B", outbox: true, domain: "messages" },
  { name: "createCourseSchedule", method: "POST", path: "/course-schedules", class: "B", outbox: false, domain: "planning" },
  { name: "updateCourseSchedule", method: "PATCH", path: "/course-schedules/:id", class: "A", outbox: false, domain: "planning" },
  { name: "deleteCourseSchedule", method: "DELETE", path: "/course-schedules/:id", class: "A", outbox: false, domain: "planning" },
  { name: "createCourseScheduleReplacement", method: "POST", path: "/course-schedule-replacements", class: "B", outbox: false, domain: "replacements" },
  { name: "deleteCourseScheduleReplacement", method: "DELETE", path: "/course-schedule-replacements/:id", class: "A", outbox: false, domain: "replacements" },
  { name: "createClientsAnnouncement", method: "POST", path: "/backoffice/announcements", class: "D", outbox: false, domain: "announcements" },
  { name: "updateClientsAnnouncement", method: "PATCH", path: "/backoffice/announcements/:id", class: "A", outbox: false, domain: "announcements" },
  { name: "createClientsUser", method: "POST", path: "/backoffice/users", class: "D", outbox: false, domain: "users" },
  { name: "createTeacherIdentityFromUsers", method: "POST", path: "/backoffice/users/create-teacher", class: "D", outbox: false, domain: "users" },
  { name: "grantClientsUserRole", method: "POST", path: "/backoffice/users/:id/roles/grant", class: "D", outbox: false, domain: "users" },
  { name: "revokeClientsUserRole", method: "POST", path: "/backoffice/users/:id/roles/revoke", class: "D", outbox: false, domain: "users" },
  { name: "updateClientsUser", method: "PATCH", path: "/backoffice/users/:id", class: "D", outbox: false, domain: "users" },
  { name: "createSchoolClass", method: "POST", path: "/classes", class: "D", outbox: false, domain: "classes" },
  { name: "updateSchoolClass", method: "PATCH", path: "/classes/:classCode", class: "A", outbox: false, domain: "classes" },
  { name: "enrollClassStudent", method: "POST", path: "/classes/:classCode/students", class: "D", outbox: false, domain: "students" },
  { name: "updateSchoolStudent", method: "PATCH", path: "/students/:id", class: "A", outbox: false, domain: "students" },
  { name: "deleteSchoolStudent", method: "DELETE", path: "/students/:id", class: "A", outbox: false, domain: "students" },
  { name: "updateSchoolTeacher", method: "PATCH", path: "/teachers/:teacherCode", class: "A", outbox: false, domain: "teachers" },
  { name: "deleteSchoolTeacher", method: "DELETE", path: "/teachers/:teacherCode", class: "A", outbox: false, domain: "teachers" },
  { name: "createTeacherAssignment", method: "POST", path: "/assignments", class: "D", outbox: false, domain: "assignments" },
  { name: "createPlatformNotification", method: "POST", path: "/backoffice/notifications", class: "D", outbox: false, domain: "notifications" },
  { name: "login", method: "POST", path: "/login", class: "D", outbox: false, domain: "auth" },
  { name: "logout", method: "POST", path: "/auth/logout", class: "D", outbox: false, domain: "auth" },
  { name: "changePassword", method: "POST", path: "/auth/change-password", class: "D", outbox: false, domain: "auth" },
] as const;
