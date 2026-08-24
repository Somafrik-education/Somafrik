/**
 * LOT 1 — vérité des données Mobile.
 * PostgreSQL/API = autorité. Jamais [] pour masquer une erreur. Jamais catalog.ts en SoT métier.
 */

export type ResourceStatus = "idle" | "loading" | "success" | "empty" | "error" | "offline";

export type ResourceSnapshot<T> = {
  status: ResourceStatus;
  data: T[];
  errorMessage?: string;
};

export function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const row = payload as Record<string, unknown>;
    if (Array.isArray(row.items)) return row.items;
    if (Array.isArray(row.bulletins)) return row.bulletins;
    if (Array.isArray(row.data)) return row.data;
    if (Array.isArray(row.results)) return row.results;
  }
  return [];
}

export function classifyLoadFailure(error: unknown): {
  status: "error" | "offline";
  message: string;
} {
  const statusCode =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Impossible de charger les données.";
  const offline =
    statusCode === 0 ||
    statusCode === 408 ||
    /indisponible|délai|timeout|offline|réseau|network|abort/i.test(message);
  return {
    status: offline ? "offline" : "error",
    message,
  };
}

export function snapshotFromSuccess<T>(data: T[]): ResourceSnapshot<T> {
  return {
    status: data.length ? "success" : "empty",
    data,
  };
}

export function snapshotFromFailure<T>(error: unknown, previous: T[] = []): ResourceSnapshot<T> {
  const classified = classifyLoadFailure(error);
  return {
    status: classified.status,
    data: previous,
    errorMessage: classified.message,
  };
}

export const NO_SESSION_RESOURCE_SCOPE = "session:none";

export function emptyResourceSnapshot<T>(): ResourceSnapshot<T> {
  return { status: "idle", data: [] };
}

export type ResourceCacheResetKind = "principal" | "tenant";

function scopePart(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Identité utilisateur/pays. La liste des établissements accessibles
 * appartient à ce scope, pas à l'école active du sélecteur.
 */
export function buildPrincipalScopeKey(input: {
  hasSession: boolean;
  userId?: string | null;
  role?: string | null;
  schoolCode?: string | null;
  countryScope?: string | null;
}): string {
  if (!input.hasSession) return NO_SESSION_RESOURCE_SCOPE;
  return [
    `user:${String(input.userId ?? "").trim()}`,
    `role:${String(input.role ?? "").trim()}`,
    `home:${scopePart(input.schoolCode)}`,
    `country:${scopePart(input.countryScope)}`,
  ].join("|");
}

export function buildResourceScopeKey(input: {
  hasSession: boolean;
  userId?: string | null;
  role?: string | null;
  schoolCode?: string | null;
  countryScope?: string | null;
  activeSchoolCode?: string | null;
}): string {
  if (!input.hasSession) return NO_SESSION_RESOURCE_SCOPE;
  return `${buildPrincipalScopeKey(input)}|tenant:${scopePart(input.activeSchoolCode)}`;
}

/** Purge écoles/pays seulement si l'identité change, pas si on change d'établissement actif. */
export function resourceCacheResetKind(input: {
  previousPrincipalKey: string | null;
  nextPrincipalKey: string;
  nextResourceKey: string;
}): ResourceCacheResetKind {
  if (input.nextResourceKey === NO_SESSION_RESOURCE_SCOPE) return "principal";
  if (input.previousPrincipalKey !== input.nextPrincipalKey) return "principal";
  return "tenant";
}

export const PRINCIPAL_RESOURCE_LOADERS = [
  "loadSchools",
  "loadCountries",
  "loadSubscriptions",
  "loadNotifications",
] as const;

export const TENANT_RESOURCE_LOADERS = [
  "refreshBackOfficeState",
  "loadUsers",
  "loadTeachers",
  "loadPayments",
  "loadStudentFees",
  "loadAnnouncements",
  "loadMessages",
] as const;

export type ScopeHydrationPlan = {
  resetKind: ResourceCacheResetKind;
  loadPrincipal: boolean;
  loadTenant: boolean;
};

/**
 * Login / changement d'identité → reset + reload principal (écoles).
 * Changement d'école active → reset tenant seulement, écoles conservées.
 * Logout → reset principal, aucun reload.
 */
export function scopeHydrationPlan(input: {
  previousPrincipalKey: string | null;
  nextPrincipalKey: string;
  nextResourceKey: string;
}): ScopeHydrationPlan {
  const resetKind = resourceCacheResetKind(input);
  if (input.nextResourceKey === NO_SESSION_RESOURCE_SCOPE) {
    return { resetKind, loadPrincipal: false, loadTenant: false };
  }
  return {
    resetKind,
    loadPrincipal: resetKind === "principal",
    loadTenant: true,
  };
}

/** Applique le filtrage tenant/session sans transformer une erreur en liste vide métier. */
export function withScopedSnapshotData<T>(
  snapshot: ResourceSnapshot<T>,
  scopedData: T[],
): ResourceSnapshot<T> {
  if (snapshot.status === "success" || snapshot.status === "empty") {
    return snapshotFromSuccess(scopedData);
  }
  return { ...snapshot, data: scopedData };
}

/** Une erreur réseau/serveur ne doit jamais être présentée comme une liste vide métier. */
export function shouldRenderEmpty(snapshot: ResourceSnapshot<unknown>): boolean {
  return snapshot.status === "empty";
}

export function shouldRenderError(snapshot: ResourceSnapshot<unknown>): boolean {
  return snapshot.status === "error" || snapshot.status === "offline";
}

export const METRIC_PENDING_LABEL = "—";
export const METRIC_UNAVAILABLE_LABEL = "Indisponible";

/**
 * Un 0 n'est affiché que si le serveur a confirmé une liste vide (status empty)
 * ou une valeur métier nulle après success. idle/loading → —, error → Indisponible.
 */
export function metricLabelFromSnapshot<T>(
  snapshot: ResourceSnapshot<T>,
  formatReady: (data: T[]) => string,
  emptyLabel = "0",
): string {
  if (snapshot.status === "idle" || snapshot.status === "loading") return METRIC_PENDING_LABEL;
  if (snapshot.status === "error") return METRIC_UNAVAILABLE_LABEL;
  if (snapshot.status === "offline") {
    return snapshot.data.length ? formatReady(snapshot.data) : METRIC_UNAVAILABLE_LABEL;
  }
  if (snapshot.status === "empty") return emptyLabel;
  return formatReady(snapshot.data);
}

export function isMetricReady(snapshot: ResourceSnapshot<unknown>): boolean {
  return snapshot.status === "success" || snapshot.status === "empty"
    || (snapshot.status === "offline" && snapshot.data.length > 0);
}

export type PaymentLine = {
  id?: string;
  feeTypeId?: string | null;
  feeType?: string;
  feeLabel?: string;
  amount: number;
};

export type CanonicalPayment = {
  id: string;
  publicId?: string;
  reference?: string;
  studentId: string;
  studentName?: string;
  amount: number;
  totalAmount?: number;
  paymentMethod?: string;
  method?: string;
  paidAt?: string;
  date?: string;
  status: string;
  items?: PaymentLine[];
  itemCount?: number;
  itemsDetail?: string;
  feeType?: string;
};

export function paymentReference(payment: CanonicalPayment): string {
  return String(payment.reference || payment.publicId || payment.id || "").trim();
}

export function paymentTotal(payment: CanonicalPayment): number {
  const items = Array.isArray(payment.items) ? payment.items : [];
  if (items.length) {
    return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }
  return Number(payment.totalAmount ?? payment.amount ?? 0);
}

export function paymentMethodLabel(payment: CanonicalPayment): string {
  return String(payment.paymentMethod || payment.method || "Non renseigné").trim() || "Non renseigné";
}

export function paymentPaidAt(payment: CanonicalPayment): string {
  return String(payment.paidAt || payment.date || "").trim();
}

export function paymentItems(payment: CanonicalPayment): PaymentLine[] {
  return Array.isArray(payment.items) ? payment.items : [];
}

export function paymentItemCount(payment: CanonicalPayment): number {
  if (Number.isFinite(Number(payment.itemCount)) && Number(payment.itemCount) > 0) {
    return Number(payment.itemCount);
  }
  const items = paymentItems(payment);
  if (items.length) return items.length;
  return 1;
}

export function paymentItemsDetail(payment: CanonicalPayment): string {
  if (payment.itemsDetail) return payment.itemsDetail;
  const count = paymentItemCount(payment);
  if (count <= 1) {
    const items = paymentItems(payment);
    return items[0]?.feeLabel || items[0]?.feeType || payment.feeType || "1 libellé";
  }
  return `${count} libellés`;
}

export function isPaidStatus(status?: string): boolean {
  const value = String(status ?? "").trim().toUpperCase();
  return value === "PAYE" || value === "PAID" || value === "PAYÉ";
}

export function paymentStatusLabel(status?: string): string {
  if (isPaidStatus(status)) return "Payé";
  const value = String(status ?? "").trim();
  if (/attente|pending/i.test(value)) return "En attente";
  if (/cancel|annul/i.test(value)) return "Annulé";
  return value || "—";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asPaymentLine(value: unknown): PaymentLine {
  const row = asRecord(value);
  return {
    id: row.id ? String(row.id) : undefined,
    feeTypeId: row.feeTypeId == null ? null : String(row.feeTypeId),
    feeType: row.feeType ? String(row.feeType) : undefined,
    feeLabel: String(row.feeLabel || row.feeType || row.label || "").trim() || undefined,
    amount: Number(row.amount || 0),
  };
}

/** Reçu canonique : 1 paiement = 1 reçu, total = SUM(items). */
export function normalizePaymentRow(raw: unknown): CanonicalPayment {
  const row = asRecord(raw);
  const student = asRecord(row.student);
  const items = Array.isArray(row.items) ? row.items.map(asPaymentLine) : [];
  const total = items.length
    ? items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    : Number(row.totalAmount ?? row.amount ?? 0);
  return {
    id: String(row.id ?? row.publicId ?? row.reference ?? ""),
    publicId: row.publicId ? String(row.publicId) : undefined,
    reference: row.reference ? String(row.reference) : undefined,
    studentId: String(row.studentId ?? student.id ?? ""),
    studentName: String(row.studentName ?? student.name ?? "").trim() || undefined,
    amount: total,
    totalAmount: total,
    paymentMethod: row.paymentMethod ? String(row.paymentMethod) : undefined,
    method: row.method ? String(row.method) : undefined,
    paidAt: row.paidAt ? String(row.paidAt) : undefined,
    date: row.date ? String(row.date) : undefined,
    status: String(row.status ?? ""),
    items,
    itemCount: Number(row.itemCount ?? items.length) || items.length,
    itemsDetail: row.itemsDetail ? String(row.itemsDetail) : undefined,
    feeType: row.feeType ? String(row.feeType) : undefined,
  };
}

export function isPublishedBulletin(status?: string): boolean {
  return /publi/i.test(String(status ?? "").trim());
}

export function bulletinPeriod(card: { period?: string; term?: string }): string {
  return String(card.period || card.term || "").trim();
}

export function parentAverageDisplay(options: {
  notesReady: boolean;
  notesForStudent: Array<{ studentId?: string; value?: number }>;
  average?: number;
}): { available: boolean; label: string } {
  if (!options.notesReady) {
    return { available: false, label: "Moyenne indisponible" };
  }
  if (!options.notesForStudent.length) {
    return { available: false, label: "Moyenne indisponible" };
  }
  if (!Number.isFinite(Number(options.average))) {
    return { available: false, label: "Moyenne indisponible" };
  }
  return { available: true, label: Number(options.average).toFixed(1) };
}

export function isMustChangePasswordUser(user: { mustChangePassword?: boolean } | null | undefined): boolean {
  return Boolean(user?.mustChangePassword);
}

export function canPersistFullSession(session: {
  user?: { mustChangePassword?: boolean };
} | null): boolean {
  if (!session) return false;
  return !isMustChangePasswordUser(session.user);
}

/** Kill/relaunch : pas de Home si token absent ou changement de mot de passe obligatoire. */
export function canRestorePersistedSession(options: {
  hasAccessToken: boolean;
  profile?: { user?: { mustChangePassword?: unknown } } | null;
}): boolean {
  if (!options.hasAccessToken) return false;
  if (!options.profile) return false;
  return canPersistFullSession({
    user: { mustChangePassword: Boolean(options.profile.user?.mustChangePassword) },
  });
}

export const DATA_TRUTH_COPY = {
  retry: "Réessayer",
  emptyPlanning: "Aucun créneau planifié",
  errorPlanning: "Impossible de charger le planning",
  offlinePlanning: "Réseau indisponible. L'emploi du temps n'a pas pu être chargé.",
  emptyPayments: "Aucun paiement.",
  errorPayments: "Impossible de charger les paiements.",
  offlinePayments: "Réseau indisponible. Les paiements n'ont pas pu être chargés.",
  emptyBulletins: "Aucun bulletin disponible",
  errorBulletins: "Impossible de charger les bulletins.",
  offlineBulletins: "Réseau indisponible. Les bulletins n'ont pas pu être chargés.",
  writePaymentsWebOnly:
    "La saisie d'un paiement multi-libellés se fait depuis le web établissement pour le moment.",
  parentAverageUnavailable: "Moyenne indisponible",
  emptyEvaluations: "Aucune évaluation.",
  errorEvaluations: "Impossible de charger les évaluations.",
  offlineEvaluations: "Réseau indisponible. Les évaluations n'ont pas pu être chargées.",
  emptyNotes: "Aucune note disponible",
  errorNotes: "Impossible de charger les notes.",
  offlineNotes: "Réseau indisponible. Les notes n'ont pas pu être chargées.",
  unavailable: "Indisponible",
} as const;

export const DATA_TRUTH_TEST_IDS = {
  retry: "data-truth-retry",
  planningEmpty: "planning-empty",
  planningError: "planning-error",
  planningList: "planning-list",
  paymentsEmpty: "payments-empty",
  paymentsError: "payments-error",
  paymentsList: "payments-list",
  bulletinsEmpty: "bulletins-empty",
  bulletinsError: "bulletins-error",
  bulletinsList: "bulletins-list",
  parentAverage: "parent-average-value",
  passwordChangeModal: "login-password-change-modal",
  paymentsReceipt: "payments-receipt",
  evaluationsList: "evaluations-v2-list",
  evaluationsEmpty: "evaluations-v2-empty",
  evaluationsError: "evaluations-v2-error",
  notesList: "evaluations-v2-notes-list",
  notesEmpty: "evaluations-v2-notes-empty",
  notesError: "evaluations-v2-notes-error",
  homeUsersValue: "home-users-value",
  homePresenceValue: "home-presence-value",
  homePaymentsValue: "home-payments-value",
  homeStudentsValue: "home-students-value",
} as const;
